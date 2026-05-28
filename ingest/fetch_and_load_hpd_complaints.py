"""
Fetch ALL HPD Complaints from the Socrata API and load into the database.

Use this instead of clean_hpd_complaints.py + load_hpd_complaints.py when
the CSV download is unavailable.

Features
--------
- Pages through the full ~14 M row dataset (50 k rows per API call)
- Saves progress to data/.hpd_complaints_fetch_offset — re-run to resume
- Fresh start: begins at offset 0; existing rows replaced by ON CONFLICT DO UPDATE
- Resume: reads saved offset, skips already-fetched pages
- Refreshes hpd_complaints_building_summary + building_summary when done

Usage
-----
  cd ingest
  python fetch_and_load_hpd_complaints.py

To force a restart from scratch, delete data/.hpd_complaints_fetch_offset.
"""
import asyncio
import logging
from datetime import date
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
_BASE            = Path(__file__).parent.parent
CHECKPOINT_FILE  = _BASE / "data" / ".hpd_complaints_fetch_offset"
LOG_FILE         = _BASE / "data" / "sync.log"

# ── tunables ──────────────────────────────────────────────────────────────────
PAGE_SIZE    = 50_000   # max Socrata allows per request
DB_BATCH     = 5_000    # rows per executemany call

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


def _load_checkpoint() -> int:
    if CHECKPOINT_FILE.exists():
        val = int(CHECKPOINT_FILE.read_text().strip())
        log.info("Resuming from checkpoint offset %d", val)
        return val
    return 0


def _save_checkpoint(offset: int) -> None:
    CHECKPOINT_FILE.parent.mkdir(parents=True, exist_ok=True)
    CHECKPOINT_FILE.write_text(str(offset))


# ── clean ──────────────────────────────────────────────────────────────────────

def _clean(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
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

    df = df.drop_duplicates(subset=["problem_id"], keep="last")
    return df[HPD_COMPLAINTS_DB_COLUMNS]


# ── database ───────────────────────────────────────────────────────────────────

async def upsert_batch(conn: asyncpg.Connection, df: pd.DataFrame) -> int:
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
    for start in range(0, len(df), DB_BATCH):
        chunk = df.iloc[start : start + DB_BATCH]
        chunk = chunk.where(pd.notnull(chunk), None)
        records = [tuple(row) for row in chunk.itertuples(index=False, name=None)]
        await conn.executemany(sql, records)
        total += len(records)
    return total


async def refresh_views(conn: asyncpg.Connection) -> None:
    log.info("Refreshing hpd_complaints_building_summary…")
    await conn.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY hpd_complaints_building_summary")
    log.info("Refreshing building_summary…")
    await conn.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY building_summary")
    row = await conn.fetchrow("SELECT COUNT(*) AS n FROM hpd_complaints")
    log.info("Done — %d rows in hpd_complaints.", row["n"])


# ── fetch ──────────────────────────────────────────────────────────────────────

@retry(
    retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.TransportError)),
    wait=wait_exponential(multiplier=2, min=5, max=120),
    stop=stop_after_attempt(6),
    reraise=True,
)
def _fetch_page(client: httpx.Client, offset: int) -> list[dict]:
    r = client.get(
        HPD_COMPLAINTS_API,
        params={
            "$limit":  PAGE_SIZE,
            "$offset": offset,
            "$order":  "problem_id ASC",   # stable ordering for consistent pagination
        },
    )
    r.raise_for_status()
    return r.json()


# ── main ───────────────────────────────────────────────────────────────────────

async def run() -> None:
    start_offset = _load_checkpoint()

    conn = await asyncpg.connect(
        _asyncpg_url(DATABASE_URL),
        ssl="require",
        statement_cache_size=0,
    )

    total_inserted = 0
    offset = start_offset

    headers = {"X-App-Token": SOCRATA_APP_TOKEN} if SOCRATA_APP_TOKEN else {}

    try:
        with httpx.Client(timeout=180, headers=headers) as client:
            log.info("Starting fetch from offset %d (page size %d)…", offset, PAGE_SIZE)

            while True:
                log.info("  Fetching offset %d…", offset)
                page = _fetch_page(client, offset)

                if not page:
                    log.info("Empty page at offset %d — fetch complete.", offset)
                    break

                df = _clean(page)
                n = await upsert_batch(conn, df)
                total_inserted += n
                offset += len(page)
                _save_checkpoint(offset)
                log.info("  → upserted %d rows  |  running total: %d", n, total_inserted)

                if len(page) < PAGE_SIZE:
                    log.info("Last page reached at offset %d.", offset)
                    break

        log.info("Fetch complete — %d rows upserted total.", total_inserted)

        await refresh_views(conn)

        # Clear checkpoint so a future re-run starts fresh
        if CHECKPOINT_FILE.exists():
            CHECKPOINT_FILE.unlink()
        log.info("Checkpoint cleared.")

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(run())
