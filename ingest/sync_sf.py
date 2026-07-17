"""SF data sync: fetch all five DataSF datasets, upsert, then refresh views.

Phases:
  1. Fetch: parcels, footprints, 311 housing complaints, DBI NOV, EAS addresses
  2. DB:    upsert raw tables; join 311 → EAS to populate mapblklot;
            refresh sf_housing_complaints_summary and sf_violations_summary
  3. State: write .last_sync_sf

Run manually:
    cd ingest && python sync_sf.py

Or add to sync_all.py / weekly_sync.sh after NYC data refreshes.
"""
import asyncio
import logging
import math
import re
from datetime import date
from pathlib import Path

import asyncpg
import httpx
import pandas as pd
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

import sys
sys.path.insert(0, str(Path(__file__).parent))

from sf_config import (
    DATABASE_URL,
    SOCRATA_APP_TOKEN,
    SF_PARCELS_API,
    SF_FOOTPRINTS_API,
    SF_311_API,
    SF_DBI_NOV_API,
    SF_ADDRESSES_API,
    SF_311_SERVICE_NAMES,
    SF_PARCELS_DB_COLUMNS,
    SF_FOOTPRINTS_DB_COLUMNS,
    SF_311_DB_COLUMNS,
    SF_DBI_NOV_DB_COLUMNS,
    SF_ADDRESSES_DB_COLUMNS,
)

_BASE      = Path(__file__).parent.parent
STATE_FILE = _BASE / "data" / ".last_sync_sf"
LOG_FILE   = _BASE / "data" / "sync.log"

LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    handlers=[logging.StreamHandler(), logging.FileHandler(LOG_FILE)],
)
log = logging.getLogger(__name__)

PAGE_SIZE   = 50_000
UPSERT_BATCH = 5_000


def _asyncpg_url(url: str) -> str:
    return url.split("?")[0]


def _load_last_sync() -> date:
    if STATE_FILE.exists():
        return date.fromisoformat(STATE_FILE.read_text().strip())
    return date(2000, 1, 1)


def _save_last_sync(d: date) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(d.isoformat())


def _socrata_headers() -> dict:
    return {"X-App-Token": SOCRATA_APP_TOKEN} if SOCRATA_APP_TOKEN else {}


# ── Pure transforms ───────────────────────────────────────────────────────────
# Extracted to module scope so they can be unit-tested directly. Every one of
# these runs on the weekly sync and fails *silently* if it drifts (wrong join
# key = rows detach from parcels and vanish from the views, no error raised).

def _centroid(shape) -> tuple[float | None, float | None]:
    """(lat, lon) from a GeoJSON Point, or the arithmetic centroid of the first
    Polygon / MultiPolygon ring. (None, None) for anything unrecognised."""
    if not isinstance(shape, dict):
        return None, None
    coords = shape.get("coordinates")
    typ = shape.get("type", "")
    if typ == "Point" and coords and len(coords) >= 2:
        return float(coords[1]), float(coords[0])  # lat, lon
    if typ == "Polygon" and coords:
        ring = coords[0]
        if ring:
            lons = [c[0] for c in ring]
            lats = [c[1] for c in ring]
            return sum(lats) / len(lats), sum(lons) / len(lons)
    if typ == "MultiPolygon" and coords:
        ring = coords[0][0] if coords[0] else []
        if ring:
            lons = [c[0] for c in ring]
            lats = [c[1] for c in ring]
            return sum(lats) / len(lats), sum(lons) / len(lons)
    return None, None


def _polygon_area_sqm(shape) -> float | None:
    """Shoelace formula on the GeoJSON ring, converted to m² at SF latitude."""
    if not isinstance(shape, dict):
        return None
    coords = shape.get("coordinates")
    typ    = shape.get("type", "")
    ring: list | None = None
    if typ == "Polygon" and coords:
        ring = coords[0]
    elif typ == "MultiPolygon" and coords and coords[0]:
        ring = coords[0][0]
    if not ring or len(ring) < 3:
        return None
    n = len(ring)
    area_deg2 = abs(sum(
        ring[i][0] * ring[(i + 1) % n][1] - ring[(i + 1) % n][0] * ring[i][1]
        for i in range(n)
    )) / 2.0
    avg_lat = sum(c[1] for c in ring) / n
    cos_lat = math.cos(math.radians(avg_lat))
    area_sqm = area_deg2 * (111_320 ** 2) * cos_lat
    return float(area_sqm) if area_sqm > 0 else None


def _mblr_to_mapblklot(mblr) -> str | None:
    """Footprint MBLR → parcel key: drop the leading 'SF', strip a trailing
    condo letter."""
    if not isinstance(mblr, str):
        return None
    s = mblr.upper().replace("SF", "", 1)
    return re.sub(r"[A-Z]$", "", s) or None


def _nov_mapblklot(block, lot) -> str | None:
    """DBI NOV block/lot → parcel key: zero-pad block to 4 and lot to 3 digits.
    The join key every violation hangs on — treat drift here as serious."""
    b = str(block or "").strip().zfill(4)
    l = str(lot   or "").strip().zfill(3)
    if b == "0000" or not l:
        return None
    return b + l


def _normalize_311_subtype(value) -> str | None:
    """Lowercase + strip the 'Building - ' prefix so subtypes line up with the
    SF_311_SEVERITY map keys. Empty/NaN → None."""
    if value is None or (isinstance(value, float) and value != value):
        return None
    s = re.sub(r"^building - ", "", str(value).lower())
    return s or None


def _clean_nov_date(value):
    """Coerce a NOV date_filed to a date, flooring out the pre-1980 garbage the
    source carries (min year in the feed is 0200). Returns None if unparseable
    or too old."""
    d = pd.to_datetime(value, errors="coerce")
    if pd.isna(d):
        return None
    d = d.date()
    return None if d < date(1980, 1, 1) else d


def _point_lat(p):
    if isinstance(p, dict):
        return pd.to_numeric(p.get("latitude"), errors="coerce")
    return None


def _point_lon(p):
    if isinstance(p, dict):
        return pd.to_numeric(p.get("longitude"), errors="coerce")
    return None


# ── Generic paginated Socrata fetch ──────────────────────────────────────────

def _fetch_all(api_url: str, where: str | None = None, select: str | None = None) -> list[dict]:
    rows: list[dict] = []
    offset = 0

    @retry(
        retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.TransportError)),
        wait=wait_exponential(multiplier=1, min=4, max=60),
        stop=stop_after_attempt(5),
        reraise=True,
    )
    def _get_page(client: httpx.Client, offset: int) -> list[dict]:
        params: dict = {"$limit": PAGE_SIZE, "$offset": offset, "$order": ":id"}
        if where:
            params["$where"] = where
        if select:
            params["$select"] = select
        r = client.get(api_url, params=params)
        r.raise_for_status()
        return r.json()

    with httpx.Client(timeout=300, headers=_socrata_headers()) as client:
        while True:
            page = _get_page(client, offset)
            if not page:
                break
            rows.extend(page)
            offset += len(page)
            log.info("  … %d records fetched from %s", offset, api_url.split("/")[-1])
            if len(page) < PAGE_SIZE:
                break

    return rows


# ── Dataset fetchers ──────────────────────────────────────────────────────────

def fetch_parcels() -> pd.DataFrame:
    log.info("Fetching SF parcels…")
    rows = _fetch_all(
        SF_PARCELS_API,
        select="mapblklot,blklot,analysis_neighborhood,shape",
    )
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    # Extract centroid from shape geometry (GeoJSON Point or Polygon centroid)
    centroids = df["shape"].apply(lambda s: _centroid(s) if isinstance(s, dict) else (None, None))
    df["centroid_latitude"]  = centroids.apply(lambda x: x[0])
    df["centroid_longitude"] = centroids.apply(lambda x: x[1])

    for col in SF_PARCELS_DB_COLUMNS:
        if col not in df.columns:
            df[col] = None

    df = df.dropna(subset=["mapblklot"])
    log.info("SF parcels: %d records", len(df))
    return df[SF_PARCELS_DB_COLUMNS].drop_duplicates(subset=["mapblklot"], keep="last")


def fetch_footprints() -> pd.DataFrame:
    log.info("Fetching SF building footprints…")
    rows = _fetch_all(SF_FOOTPRINTS_API, select="mblr,hgt_median_m,shape")
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)

    # Derive mapblklot: replace leading "SF" and strip trailing condo letter
    df["mapblklot"] = df["mblr"].apply(_mblr_to_mapblklot)
    df["hgt_median_m"] = pd.to_numeric(df.get("hgt_median_m", pd.Series(dtype=float)), errors="coerce")

    df["footprint_area_sqm"] = df["shape"].apply(
        lambda s: _polygon_area_sqm(s) if isinstance(s, dict) else None
    )

    for col in SF_FOOTPRINTS_DB_COLUMNS:
        if col not in df.columns:
            df[col] = None

    df = df.dropna(subset=["mblr"])
    log.info("SF footprints: %d records", len(df))
    return df[SF_FOOTPRINTS_DB_COLUMNS].drop_duplicates(subset=["mblr"], keep="last")


def fetch_311() -> pd.DataFrame:
    """Fetch 311 residential building complaints — both service_name variants."""
    log.info("Fetching SF 311 housing complaints (both service_name variants)…")
    names_sql = ", ".join(f"'{n}'" for n in SF_311_SERVICE_NAMES)
    where = f"service_name IN ({names_sql})"
    rows = _fetch_all(
        SF_311_API,
        where=where,
        select="service_request_id,service_name,service_subtype,address,point,requested_datetime,status_description",
    )
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)

    # Unpack 'point' location object → lat/lon
    df["point_lat"] = df.get("point", pd.Series(dtype=object)).apply(_point_lat)
    df["point_lon"] = df.get("point", pd.Series(dtype=object)).apply(_point_lon)

    # Normalise subtype casing for the severity map: lowercase + strip "Building - " prefix
    if "service_subtype" in df.columns:
        df["service_subtype"] = df["service_subtype"].apply(_normalize_311_subtype)

    df["requested_datetime"] = pd.to_datetime(df.get("requested_datetime"), errors="coerce", utc=True)
    df["mapblklot"] = None  # populated later via EAS join

    for col in SF_311_DB_COLUMNS:
        if col not in df.columns:
            df[col] = None

    df = df.dropna(subset=["service_request_id"])
    log.info("SF 311: %d records", len(df))
    return df[SF_311_DB_COLUMNS].drop_duplicates(subset=["service_request_id"], keep="last")


def fetch_dbi_nov() -> pd.DataFrame:
    """Full fetch of DBI Notices of Violation (no incremental key available)."""
    log.info("Fetching SF DBI Notices of Violation…")
    rows = _fetch_all(
        SF_DBI_NOV_API,
        select=":id,block,lot,status,nov_category_description,item,nov_item_description,date_filed,neighborhoods_analysis_boundaries,location",
    )
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)

    df = df.rename(columns={
        ":id":                              "row_id",
        "neighborhoods_analysis_boundaries": "neighborhood",
    })

    # Derive mapblklot: zero-pad block to 4 digits and lot to 3 digits
    df["mapblklot"] = df.apply(
        lambda r: _nov_mapblklot(r.get("block"), r.get("lot")), axis=1
    )

    # Extract lat/lon from location field
    df["location_lat"] = df.get("location", pd.Series(dtype=object)).apply(_point_lat)
    df["location_lon"] = df.get("location", pd.Series(dtype=object)).apply(_point_lon)

    # Bad-date floor: exclude year < 1980 (source data has min year 0200)
    df["date_filed"] = df.get("date_filed", pd.Series(dtype=object)).apply(_clean_nov_date)

    # Normalise status to lowercase for consistent filtering
    if "status" in df.columns:
        df["status"] = df["status"].str.lower().str.strip()

    for col in SF_DBI_NOV_DB_COLUMNS:
        if col not in df.columns:
            df[col] = None

    df = df.dropna(subset=["row_id"])
    log.info("SF DBI NOV: %d records", len(df))
    return df[SF_DBI_NOV_DB_COLUMNS].drop_duplicates(subset=["row_id"], keep="last")


def fetch_addresses() -> pd.DataFrame:
    """EAS address corpus — the search index and 311→parcel crosswalk."""
    log.info("Fetching SF EAS addresses…")
    rows = _fetch_all(
        SF_ADDRESSES_API,
        select="eas_fullid,address,parcel_number,eas_baseid,latitude,longitude,nhood",
    )
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    df["latitude"]  = pd.to_numeric(df.get("latitude"),  errors="coerce")
    df["longitude"] = pd.to_numeric(df.get("longitude"), errors="coerce")
    for col in SF_ADDRESSES_DB_COLUMNS:
        if col not in df.columns:
            df[col] = None
    df = df.dropna(subset=["eas_fullid"])
    log.info("SF EAS addresses: %d records", len(df))
    return df[SF_ADDRESSES_DB_COLUMNS].drop_duplicates(subset=["eas_fullid"], keep="last")


# ── Database upserts ──────────────────────────────────────────────────────────

async def _upsert(
    conn: asyncpg.Connection,
    table: str,
    pk: str,
    columns: list[str],
    df: pd.DataFrame,
) -> int:
    col_list     = ", ".join(columns)
    placeholders = ", ".join(f"${i + 1}" for i in range(len(columns)))
    set_clause   = ", ".join(f"{c} = EXCLUDED.{c}" for c in columns if c != pk)
    sql = (
        f"INSERT INTO {table} ({col_list}) VALUES ({placeholders}) "
        f"ON CONFLICT ({pk}) DO UPDATE SET {set_clause}"
    )
    total = 0
    for start in range(0, len(df), UPSERT_BATCH):
        chunk = df.iloc[start : start + UPSERT_BATCH].where(pd.notnull(df.iloc[start : start + UPSERT_BATCH]), None)
        records = [tuple(row) for row in chunk.itertuples(index=False, name=None)]
        await conn.executemany(sql, records)
        total += len(records)
    return total


async def _truncate_and_load(
    conn: asyncpg.Connection,
    table: str,
    pk: str,
    columns: list[str],
    df: pd.DataFrame,
) -> int:
    """Truncate then reload — for datasets with no reliable upsert key (DBI NOV)."""
    await conn.execute(f"TRUNCATE TABLE {table}")
    col_list     = ", ".join(columns)
    placeholders = ", ".join(f"${i + 1}" for i in range(len(columns)))
    sql = f"INSERT INTO {table} ({col_list}) VALUES ({placeholders})"
    total = 0
    for start in range(0, len(df), UPSERT_BATCH):
        chunk = df.iloc[start : start + UPSERT_BATCH].where(pd.notnull(df.iloc[start : start + UPSERT_BATCH]), None)
        records = [tuple(row) for row in chunk.itertuples(index=False, name=None)]
        await conn.executemany(sql, records)
        total += len(records)
    return total


# ── 311 → EAS address join (populate mapblklot) ───────────────────────────────

async def _join_311_to_eas(conn: asyncpg.Connection) -> None:
    """
    Join 311 addresses to EAS to populate sf_311_housing.mapblklot.

    Strategy: normalize both sides to uppercase street address (strip city/state
    suffix from 311), then match on equality. Unmatched rows keep mapblklot NULL
    (excluded from the materialized view — PostGIS fallback is a v2 item).
    """
    log.info("Joining 311 addresses → EAS to populate mapblklot…")
    await conn.execute("""
        UPDATE sf_311_housing c
        SET mapblklot = a.parcel_number
        FROM sf_addresses a
        WHERE c.mapblklot IS NULL
          AND UPPER(TRIM(SPLIT_PART(c.address, ',', 1)))
              = UPPER(TRIM(a.address))
          AND a.parcel_number IS NOT NULL
    """)
    matched = await conn.fetchval(
        "SELECT COUNT(*) FROM sf_311_housing WHERE mapblklot IS NOT NULL"
    )
    total = await conn.fetchval("SELECT COUNT(*) FROM sf_311_housing")
    log.info(
        "311 → EAS join complete: %d / %d records have mapblklot (%.1f%%)",
        matched, total, 100 * matched / max(total, 1),
    )


# ── View refresh ──────────────────────────────────────────────────────────────

async def _refresh_sf_views(conn: asyncpg.Connection) -> None:
    log.info("Refreshing sf_housing_complaints_summary…")
    await conn.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY sf_housing_complaints_summary")
    log.info("Refreshing sf_violations_summary…")
    await conn.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY sf_violations_summary")
    n_c = await conn.fetchval("SELECT COUNT(*) FROM sf_housing_complaints_summary")
    n_v = await conn.fetchval("SELECT COUNT(*) FROM sf_violations_summary")
    log.info("Views refreshed — %d complaint parcels, %d violation parcels.", n_c, n_v)


# ── Main ──────────────────────────────────────────────────────────────────────

async def run() -> None:
    log.info("=" * 60)
    log.info("=== sync_sf: starting SF data refresh ===")
    log.info("=" * 60)

    log.info("--- Phase 1: fetching from DataSF ---")
    df_parcels    = fetch_parcels()
    df_footprints = fetch_footprints()
    df_311        = fetch_311()
    df_nov        = fetch_dbi_nov()
    df_addresses  = fetch_addresses()

    log.info("--- Phase 2: upserting and refreshing views ---")
    conn = await asyncpg.connect(
        _asyncpg_url(DATABASE_URL),
        ssl="require",
        statement_cache_size=0,
    )
    try:
        if not df_parcels.empty:
            n = await _upsert(conn, "sf_parcels", "mapblklot", SF_PARCELS_DB_COLUMNS, df_parcels)
            log.info("sf_parcels: upserted %d", n)

        if not df_footprints.empty:
            n = await _upsert(conn, "sf_footprints", "mblr", SF_FOOTPRINTS_DB_COLUMNS, df_footprints)
            log.info("sf_footprints: upserted %d", n)

        if not df_addresses.empty:
            n = await _upsert(conn, "sf_addresses", "eas_fullid", SF_ADDRESSES_DB_COLUMNS, df_addresses)
            log.info("sf_addresses: upserted %d", n)

        if not df_311.empty:
            n = await _upsert(conn, "sf_311_housing", "service_request_id", SF_311_DB_COLUMNS, df_311)
            log.info("sf_311_housing: upserted %d", n)
            await _join_311_to_eas(conn)

        if not df_nov.empty:
            n = await _truncate_and_load(conn, "sf_dbi_nov", "row_id", SF_DBI_NOV_DB_COLUMNS, df_nov)
            log.info("sf_dbi_nov: loaded %d", n)

        await _refresh_sf_views(conn)
    finally:
        await conn.close()

    log.info("--- Phase 3: saving state ---")
    _save_last_sync(date.today())
    log.info("=== sync_sf: done ===")


if __name__ == "__main__":
    asyncio.run(run())
