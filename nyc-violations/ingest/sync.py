"""Incremental weekly sync for DOB complaints.

Steps:
  1. Read last-sync date from data/.last_sync (defaults to 7 days ago on first run)
  2. Fetch complaints where date_entered IN (last_sync - LOOKBACK_DAYS ... today) from Socrata JSON API
  3. Clean and normalise the records
  4. Upsert into the complaints table
  5. Refresh building_summary materialized view concurrently
  6. Write today's date back to data/.last_sync
"""
import asyncio
import logging
import os
from datetime import date, timedelta
from pathlib import Path

import asyncpg
import httpx
import pandas as pd
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from config import BIN_BOROUGH_MAP, COMPLAINTS_API, DATABASE_URL, DB_COLUMNS, SOCRATA_APP_TOKEN

# ── paths ────────────────────────────────────────────────────────────────────
_BASE = Path(__file__).parent.parent
STATE_FILE = _BASE / "data" / ".last_sync"
LOG_FILE   = _BASE / "data" / "sync.log"

# ── tunables ─────────────────────────────────────────────────────────────────
LOOKBACK_DAYS = 3    # buffer for late-arriving / back-dated records
PAGE_SIZE     = 10_000
UPSERT_BATCH  = 5_000

# ── logging ──────────────────────────────────────────────────────────────────
LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    handlers=[logging.StreamHandler(), logging.FileHandler(LOG_FILE)],
)
log = logging.getLogger(__name__)

# Socrata JSON API field name → DB column name.
# The DOB complaints API (eabe-havv) already returns snake_case names that
# match DB_COLUMNS, so this map is empty by default.  Add overrides here if
# field names ever drift.
JSON_COLUMN_MAP: dict[str, str] = {}


# ── helpers ──────────────────────────────────────────────────────────────────

def _asyncpg_url(url: str) -> str:
    return url.split("?")[0]


def _load_last_sync() -> date:
    if STATE_FILE.exists():
        return date.fromisoformat(STATE_FILE.read_text().strip())
    log.info("No state file found — defaulting to 7 days ago for first run.")
    return date.today() - timedelta(days=7)


def _save_last_sync(d: date) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(d.isoformat())


# ── fetch ─────────────────────────────────────────────────────────────────────

def fetch_since(since: date) -> pd.DataFrame:
    # date_entered is a text column stored as MM/DD/YYYY, so range comparisons
    # break (string sort order differs from date order).  IN() with explicit
    # date strings is the only reliable SoQL filter for this field.
    today = date.today()
    lookback_days = (today - since).days
    if lookback_days > 90:
        raise ValueError(
            f"Lookback of {lookback_days} days exceeds the 90-day limit for incremental sync. "
            "Use the full pipeline (download.py → clean.py → load.py) for large re-syncs, "
            "then reset data/.last_sync."
        )

    date_list = ", ".join(
        f"'{(since + timedelta(days=i)).strftime('%m/%d/%Y')}'"
        for i in range(lookback_days + 1)
    )
    where = f"date_entered IN ({date_list})"

    rows: list[dict] = []
    offset = 0
    log.info("Fetching complaints for %d dates (%s → %s)", lookback_days + 1, since, today)

    @retry(
        retry=retry_if_exception_type(httpx.HTTPStatusError),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        stop=stop_after_attempt(4),
        reraise=True,
    )
    def _get_page(client: httpx.Client, offset: int) -> list[dict]:
        r = client.get(
            COMPLAINTS_API,
            params={
                "$where": where,
                "$limit": PAGE_SIZE,
                "$offset": offset,
                "$order": "date_entered ASC",
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

    log.info("Total fetched: %d records", len(rows))
    return pd.DataFrame(rows) if rows else pd.DataFrame()


# ── clean ─────────────────────────────────────────────────────────────────────

def clean(df: pd.DataFrame) -> pd.DataFrame:
    if JSON_COLUMN_MAP:
        df = df.rename(columns=JSON_COLUMN_MAP)

    df = df.dropna(subset=["complaint_number"])
    df["complaint_number"] = df["complaint_number"].astype(str).str.strip()
    df = df[df["complaint_number"] != ""]

    for col in ("date_entered", "disposition_date", "inspection_date"):
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors="coerce").dt.date

    bin_col = df.get("bin", pd.Series(dtype=str)).fillna("").astype(str).str.strip()
    df["borough"] = bin_col.str[:1].map(BIN_BOROUGH_MAP)
    df["bin"]     = bin_col
    df.loc[df["bin"].str.lstrip("0") == "", "bin"] = None

    for col in DB_COLUMNS:
        if col not in df.columns:
            df[col] = None

    before = len(df)
    df = df.drop_duplicates(subset=["complaint_number"], keep="last")
    if (dupes := before - len(df)):
        log.info("  dropped %d duplicate complaint_number rows", dupes)

    return df[DB_COLUMNS]


# ── database ops ──────────────────────────────────────────────────────────────

async def upsert(conn: asyncpg.Connection, df: pd.DataFrame) -> int:
    col_list    = ", ".join(DB_COLUMNS)
    placeholders = ", ".join(f"${i + 1}" for i in range(len(DB_COLUMNS)))
    set_clause  = ", ".join(
        f"{c} = EXCLUDED.{c}" for c in DB_COLUMNS if c != "complaint_number"
    )
    sql = (
        f"INSERT INTO complaints ({col_list}) VALUES ({placeholders}) "
        f"ON CONFLICT (complaint_number) DO UPDATE SET {set_clause}"
    )

    total = 0
    for start in range(0, len(df), UPSERT_BATCH):
        chunk = df.iloc[start : start + UPSERT_BATCH]
        chunk = chunk.where(pd.notnull(chunk), None)
        records = [tuple(row) for row in chunk.itertuples(index=False, name=None)]
        await conn.executemany(sql, records)
        total += len(records)

    return total


async def refresh_view(conn: asyncpg.Connection) -> int:
    log.info("Refreshing building_summary materialized view…")
    await conn.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY building_summary")
    row = await conn.fetchrow("SELECT COUNT(*) AS n FROM building_summary")
    return row["n"]


# ── main ──────────────────────────────────────────────────────────────────────

async def run() -> None:
    last_sync = _load_last_sync()
    since     = last_sync - timedelta(days=LOOKBACK_DAYS)
    log.info("Last sync: %s  →  querying since %s (-%d day buffer)", last_sync, since, LOOKBACK_DAYS)

    df_raw = fetch_since(since)

    if df_raw.empty:
        log.info("No new records — skipping upsert.")
    else:
        df = clean(df_raw)
        log.info("Upserting %d records…", len(df))

        conn = await asyncpg.connect(
            _asyncpg_url(DATABASE_URL),
            ssl="require",
            statement_cache_size=0,
        )
        try:
            n_upserted = await upsert(conn, df)
            log.info("Upserted %d records.", n_upserted)
            n_buildings = await refresh_view(conn)
            log.info("building_summary refreshed — %d buildings.", n_buildings)
        finally:
            await conn.close()

    today = date.today()
    _save_last_sync(today)
    log.info("Done. State saved: %s", today)


if __name__ == "__main__":
    asyncio.run(run())
