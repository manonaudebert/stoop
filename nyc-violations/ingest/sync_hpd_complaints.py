"""Incremental weekly sync for HPD Housing Maintenance Code Complaints.

Steps:
  1. Read last-sync date from data/.last_sync_hpd_complaints (defaults to 7 days ago)
  2. Fetch complaints where received_date >= since OR problem_status_date >= since
  3. Clean and normalise records
  4. Upsert into hpd_complaints table
  5. Refresh hpd_complaints_building_summary and building_summary mat views
  6. Write today's date back to data/.last_sync_hpd_complaints
"""
import asyncio
import logging
from datetime import date, timedelta
from pathlib import Path

import asyncpg
import httpx
import pandas as pd
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from config import (
    DATABASE_URL,
    HPD_COMPLAINTS_API,
    HPD_COMPLAINTS_DB_COLUMNS,
    HPD_COMPLAINTS_JSON_COLUMN_MAP,
    SOCRATA_APP_TOKEN,
)

# ── paths ─────────────────────────────────────────────────────────────────────
_BASE      = Path(__file__).parent.parent
STATE_FILE = _BASE / "data" / ".last_sync_hpd_complaints"
LOG_FILE   = _BASE / "data" / "sync.log"

# ── tunables ──────────────────────────────────────────────────────────────────
LOOKBACK_DAYS = 3
PAGE_SIZE     = 10_000
UPSERT_BATCH  = 5_000

# ── logging ───────────────────────────────────────────────────────────────────
LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    handlers=[logging.StreamHandler(), logging.FileHandler(LOG_FILE)],
)
log = logging.getLogger(__name__)

DATE_COLS = ("complaint_status_date", "problem_status_date", "received_date")


# ── helpers ───────────────────────────────────────────────────────────────────

def _asyncpg_url(url: str) -> str:
    return url.split("?")[0]


def _load_last_sync() -> date:
    if STATE_FILE.exists():
        return date.fromisoformat(STATE_FILE.read_text().strip())
    log.info("No HPD complaints state file found — defaulting to 7 days ago for first run.")
    return date.today() - timedelta(days=7)


def _save_last_sync(d: date) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(d.isoformat())


# ── fetch ──────────────────────────────────────────────────────────────────────

def fetch_since(since: date) -> pd.DataFrame:
    since_str = since.strftime("%Y-%m-%dT00:00:00.000")
    where = (
        f"received_date >= '{since_str}' "
        f"OR problem_status_date >= '{since_str}'"
    )

    rows: list[dict] = []
    offset = 0
    log.info("Fetching HPD complaints received/updated since %s", since)

    @retry(
        retry=retry_if_exception_type(httpx.HTTPStatusError),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        stop=stop_after_attempt(4),
        reraise=True,
    )
    def _get_page(client: httpx.Client, offset: int) -> list[dict]:
        r = client.get(
            HPD_COMPLAINTS_API,
            params={
                "$where":  where,
                "$limit":  PAGE_SIZE,
                "$offset": offset,
                "$order":  "received_date ASC",
            },
        )
        r.raise_for_status()
        return r.json()

    headers = {"X-App-Token": SOCRATA_APP_TOKEN} if SOCRATA_APP_TOKEN else {}
    with httpx.Client(timeout=120, headers=headers) as client:
        while True:
            page: list[dict] = _get_page(client, offset)
            if not page:
                break
            rows.extend(page)
            offset += len(page)
            log.info("  … %d records fetched", offset)
            if len(page) < PAGE_SIZE:
                break

    log.info("Total fetched: %d HPD complaint records", len(rows))
    return pd.DataFrame(rows) if rows else pd.DataFrame()


# ── clean ──────────────────────────────────────────────────────────────────────

def clean(df: pd.DataFrame) -> pd.DataFrame:
    df = df.rename(columns=HPD_COMPLAINTS_JSON_COLUMN_MAP)

    df = df.dropna(subset=["problem_id"])
    df["problem_id"] = df["problem_id"].astype(str).str.strip()
    df = df[df["problem_id"] != ""]

    for col in DATE_COLS:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors="coerce").dt.date

    bin_col = df.get("bin", pd.Series(dtype=str)).fillna("").astype(str).str.strip()
    df["bin"] = bin_col
    df.loc[df["bin"].str.lstrip("0").isin({"", "1000000"}), "bin"] = None

    for col in ("latitude", "longitude"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    for col in HPD_COMPLAINTS_DB_COLUMNS:
        if col not in df.columns:
            df[col] = None

    before = len(df)
    df = df.drop_duplicates(subset=["problem_id"], keep="last")
    if (dupes := before - len(df)):
        log.info("  dropped %d duplicate problem_id rows", dupes)

    return df[HPD_COMPLAINTS_DB_COLUMNS]


# ── database ops ───────────────────────────────────────────────────────────────

async def upsert(conn: asyncpg.Connection, df: pd.DataFrame) -> int:
    col_list     = ", ".join(HPD_COMPLAINTS_DB_COLUMNS)
    placeholders = ", ".join(f"${i + 1}" for i in range(len(HPD_COMPLAINTS_DB_COLUMNS)))
    set_clause   = ", ".join(
        f"{c} = EXCLUDED.{c}" for c in HPD_COMPLAINTS_DB_COLUMNS if c != "problem_id"
    )
    sql = (
        f"INSERT INTO hpd_complaints ({col_list}) VALUES ({placeholders}) "
        f"ON CONFLICT (problem_id) DO UPDATE SET {set_clause}"
    )

    total = 0
    for start in range(0, len(df), UPSERT_BATCH):
        chunk = df.iloc[start : start + UPSERT_BATCH]
        chunk = chunk.where(pd.notnull(chunk), None)
        records = [tuple(row) for row in chunk.itertuples(index=False, name=None)]
        await conn.executemany(sql, records)
        total += len(records)

    return total


async def refresh_views(conn: asyncpg.Connection) -> int:
    log.info("Refreshing hpd_complaints_building_summary…")
    await conn.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY hpd_complaints_building_summary")
    log.info("Refreshing building_summary…")
    await conn.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY building_summary")
    row = await conn.fetchrow("SELECT COUNT(*) AS n FROM building_summary")
    return row["n"]


# ── main ───────────────────────────────────────────────────────────────────────

async def run() -> None:
    last_sync = _load_last_sync()
    since     = last_sync - timedelta(days=LOOKBACK_DAYS)
    log.info(
        "HPD complaints last sync: %s  →  querying since %s (-%d day buffer)",
        last_sync, since, LOOKBACK_DAYS,
    )

    df_raw = fetch_since(since)

    if df_raw.empty:
        log.info("No new HPD complaint records — skipping upsert.")
    else:
        df = clean(df_raw)
        log.info("Upserting %d HPD complaint records…", len(df))

        conn = await asyncpg.connect(
            _asyncpg_url(DATABASE_URL),
            ssl="require",
            statement_cache_size=0,
        )
        try:
            n_upserted = await upsert(conn, df)
            log.info("Upserted %d HPD complaint records.", n_upserted)
            n_buildings = await refresh_views(conn)
            log.info("building_summary refreshed — %d buildings.", n_buildings)
        finally:
            await conn.close()

    today = date.today()
    _save_last_sync(today)
    log.info("HPD complaints sync done. State saved: %s", today)


if __name__ == "__main__":
    asyncio.run(run())
