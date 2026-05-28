"""Run all three incremental syncs in sequence, then do a single clean view refresh.

Order:
  Phase 1 — HTTP fetches (no DB connection held open):
    1. DOB complaints      fetch
    2. HPD violations      fetch
    3. HPD complaints      fetch

  Phase 2 — DB work (connection open only here):
    4. Upsert all three datasets
    5. Refresh all materialized views in dependency order:
         hpd_building_summary            (no view deps)
         hpd_complaints_building_summary (no view deps)
         building_summary                (reads raw tables; embeds HPD data)
         nta_stats                       (depends on building_summary)

  Phase 3 — Persist state files

Separating fetches from DB work avoids the connection being dropped during
the long Socrata HTTP calls (which can take 30+ minutes for large datasets).
"""
import asyncio
import logging
from datetime import date, timedelta
from pathlib import Path

import asyncpg
import pandas as pd

import sys
sys.path.insert(0, str(Path(__file__).parent))

import sync as dob_sync
import sync_hpd as hpd_sync
import sync_hpd_complaints as hpd_complaints_sync
from config import DATABASE_URL

_BASE    = Path(__file__).parent.parent
LOG_FILE = _BASE / "data" / "sync.log"

LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    handlers=[logging.StreamHandler(), logging.FileHandler(LOG_FILE)],
)
log = logging.getLogger(__name__)


def _asyncpg_url(url: str) -> str:
    return url.split("?")[0]


# ── Phase 1: fetch (no DB connection) ────────────────────────────────────────

def _fetch_dob() -> tuple[date, pd.DataFrame]:
    """Return (last_sync_date, cleaned_dataframe). DataFrame may be empty."""
    last_sync = dob_sync._load_last_sync()
    since = last_sync - timedelta(days=dob_sync.LOOKBACK_DAYS)
    log.info("DOB: last sync %s → querying since %s", last_sync, since)
    df_raw = dob_sync.fetch_since(since)
    if df_raw.empty:
        log.info("DOB: no new records.")
        return last_sync, pd.DataFrame()
    df = dob_sync.clean(df_raw)
    log.info("DOB: %d records ready to upsert.", len(df))
    return last_sync, df


def _fetch_hpd() -> tuple[date, pd.DataFrame]:
    last_sync = hpd_sync._load_last_sync()
    since = last_sync - timedelta(days=hpd_sync.LOOKBACK_DAYS)
    log.info("HPD violations: last sync %s → querying since %s", last_sync, since)
    df_raw = hpd_sync.fetch_since(since)
    if df_raw.empty:
        log.info("HPD violations: no new records.")
        return last_sync, pd.DataFrame()
    df = hpd_sync.clean(df_raw)
    log.info("HPD violations: %d records ready to upsert.", len(df))
    return last_sync, df


def _fetch_hpd_complaints() -> tuple[date, pd.DataFrame]:
    last_sync = hpd_complaints_sync._load_last_sync()
    since = last_sync - timedelta(days=hpd_complaints_sync.LOOKBACK_DAYS)
    log.info("HPD complaints: last sync %s → querying since %s", last_sync, since)
    df_raw = hpd_complaints_sync.fetch_since(since)
    if df_raw.empty:
        log.info("HPD complaints: no new records.")
        return last_sync, pd.DataFrame()
    df = hpd_complaints_sync.clean(df_raw)
    log.info("HPD complaints: %d records ready to upsert.", len(df))
    return last_sync, df


# ── Phase 2: upsert + view refresh (connection open only here) ────────────────

async def _upsert_all(
    conn: asyncpg.Connection,
    df_dob: pd.DataFrame,
    df_hpd: pd.DataFrame,
    df_hpd_complaints: pd.DataFrame,
) -> None:
    if not df_dob.empty:
        n = await dob_sync.upsert(conn, df_dob)
        log.info("DOB: upserted %d records.", n)

    if not df_hpd.empty:
        n = await hpd_sync.upsert(conn, df_hpd)
        log.info("HPD violations: upserted %d records.", n)

    if not df_hpd_complaints.empty:
        n = await hpd_complaints_sync.upsert(conn, df_hpd_complaints)
        log.info("HPD complaints: upserted %d records.", n)


async def _refresh_all_views(conn: asyncpg.Connection) -> None:
    """Refresh all four materialized views in dependency order."""
    log.info("Refreshing hpd_building_summary…")
    await conn.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY hpd_building_summary")

    log.info("Refreshing hpd_complaints_building_summary…")
    await conn.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY hpd_complaints_building_summary")

    # building_summary reads from all three raw tables; refresh after all upserts.
    log.info("Refreshing building_summary…")
    await conn.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY building_summary")

    # nta_stats depends on building_summary; must come last.
    log.info("Refreshing nta_stats…")
    await conn.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY nta_stats")

    row = await conn.fetchrow("SELECT COUNT(*) AS n FROM building_summary")
    log.info("All views refreshed — building_summary has %d buildings.", row["n"])


# ── Phase 3: save state ───────────────────────────────────────────────────────

def _save_all_state() -> None:
    today = date.today()
    dob_sync._save_last_sync(today)
    hpd_sync._save_last_sync(today)
    hpd_complaints_sync._save_last_sync(today)
    log.info("State files updated to %s.", today)


# ── main ──────────────────────────────────────────────────────────────────────

async def run() -> None:
    log.info("=" * 60)
    log.info("=== sync_all: starting full data refresh ===")
    log.info("=" * 60)

    # ── Phase 1: fetch all data (no DB connection held open) ─────────────────
    log.info("--- Phase 1: fetching from Socrata APIs ---")
    _, df_dob            = _fetch_dob()
    _, df_hpd            = _fetch_hpd()
    _, df_hpd_complaints = _fetch_hpd_complaints()

    # ── Phase 2: DB work (connection open only for this block) ───────────────
    log.info("--- Phase 2: upserting and refreshing views ---")
    conn = await asyncpg.connect(
        _asyncpg_url(DATABASE_URL),
        ssl="require",
        statement_cache_size=0,
    )
    try:
        await _upsert_all(conn, df_dob, df_hpd, df_hpd_complaints)
        await _refresh_all_views(conn)
    finally:
        await conn.close()

    # ── Phase 3: persist state ────────────────────────────────────────────────
    log.info("--- Phase 3: saving state ---")
    _save_all_state()

    log.info("=" * 60)
    log.info("=== sync_all: done ===")
    log.info("=" * 60)


if __name__ == "__main__":
    asyncio.run(run())
