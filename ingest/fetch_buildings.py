"""Fetch building centroids from the NYC building footprints dataset (5zhs-2jue)
and load them into the buildings table.

Uses Socrata's $select with ST_Centroid to avoid downloading polygon geometry.
Falls back to averaging polygon coordinates if the geo function is unsupported.
Paginates at 50k rows per request (~22 pages for 1.1M buildings).
"""
import asyncio
import httpx
import asyncpg
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from tqdm import tqdm
from config import DATABASE_URL, BUILDINGS_API, BIN_BOROUGH_MAP

PAGE_SIZE  = 50_000
BATCH_SIZE = 10_000


def _asyncpg_url(url: str) -> str:
    return url.split('?')[0]


def _centroid_from_geom(geom: dict) -> tuple[float, float] | tuple[None, None]:
    """Average all coordinate pairs in the first polygon ring."""
    try:
        coords = geom['coordinates'][0][0]  # first polygon, outer ring
        lons = [c[0] for c in coords]
        lats = [c[1] for c in coords]
        return sum(lats) / len(lats), sum(lons) / len(lons)
    except Exception:
        return None, None


def _borough_from_bin(bin_str: str) -> str | None:
    if bin_str:
        return BIN_BOROUGH_MAP.get(bin_str.strip()[:1])
    return None


@retry(
    retry=retry_if_exception_type(httpx.HTTPStatusError),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    stop=stop_after_attempt(4),
    reraise=True,
)
async def _fetch_raw(client: httpx.AsyncClient, params: dict) -> httpx.Response:
    r = await client.get(BUILDINGS_API, params=params, timeout=60)
    r.raise_for_status()
    return r


async def fetch_page_centroid(client: httpx.AsyncClient, offset: int) -> list[dict]:
    """Try ST_Centroid first; fall back to raw the_geom on Socrata geo errors."""
    try:
        r = await _fetch_raw(client, {
            "$select": "bin, ST_Y(ST_Centroid(the_geom)) as latitude, ST_X(ST_Centroid(the_geom)) as longitude, construction_year",
            "$limit": PAGE_SIZE,
            "$offset": offset,
            "$where": "bin IS NOT NULL",
        })
        data = r.json()
        if isinstance(data, dict):
            raise ValueError("Socrata returned error object instead of list")
        return data
    except (ValueError, httpx.HTTPStatusError):
        r = await _fetch_raw(client, {
            "$select": "bin, the_geom, construction_year",
            "$limit": PAGE_SIZE,
            "$offset": offset,
            "$where": "bin IS NOT NULL",
        })
        rows = []
        for item in r.json():
            lat, lon = _centroid_from_geom(item.get('the_geom') or {})
            rows.append({"bin": item.get("bin"), "latitude": lat, "longitude": lon,
                         "construction_year": item.get("construction_year")})
        return rows


async def fetch_page_scalars(client: httpx.AsyncClient, offset: int) -> list[dict]:
    """Fetch height_roof and shape_area as plain scalar columns (no geometry functions)."""
    r = await _fetch_raw(client, {
        "$select": "bin, height_roof, shape_area",
        "$limit": PAGE_SIZE,
        "$offset": offset,
        "$where": "bin IS NOT NULL",
    })
    data = r.json()
    if isinstance(data, dict):
        raise ValueError("Socrata returned error object instead of list")
    return data


async def _get_total(client: httpx.AsyncClient) -> int:
    r = await client.get(BUILDINGS_API, params={"$select": "count(*)", "$limit": 1}, timeout=30)
    return int(r.json()[0]["count"])


async def update_scalars():
    """Update height_roof and footprint_area for all buildings (pass 2 only)."""
    async with httpx.AsyncClient() as client:
        total = await _get_total(client)
    print(f"  {total:,} buildings to update")

    conn = await asyncpg.connect(_asyncpg_url(DATABASE_URL), ssl='require', statement_cache_size=0)
    updated = 0
    with tqdm(total=total, unit='buildings') as bar:
        async with httpx.AsyncClient() as client:
            offset = 0
            while offset < total:
                rows = await fetch_page_scalars(client, offset)
                if not rows:
                    break

                records = []
                for row in rows:
                    bin_val = (row.get('bin') or '').strip()
                    if not bin_val or bin_val.lstrip('0') == '':
                        continue
                    try:
                        height = float(row['height_roof']) if row.get('height_roof') is not None else None
                    except (TypeError, ValueError):
                        height = None
                    try:
                        footprint = float(row['shape_area']) if row.get('shape_area') is not None else None
                    except (TypeError, ValueError):
                        footprint = None
                    if height is None and footprint is None:
                        continue
                    records.append((footprint, height, bin_val))

                if records:
                    await conn.executemany(
                        """
                        UPDATE buildings
                           SET footprint_area = $1,
                               height_roof    = $2
                         WHERE bin = $3
                        """,
                        records,
                    )
                    updated += len(records)
                    bar.update(len(rows))

                offset += PAGE_SIZE

    await conn.close()
    print(f"Done — {updated:,} buildings updated with height/footprint.")


async def load_buildings():
    print("Fetching building centroids from Socrata…")

    async with httpx.AsyncClient() as client:
        total = await _get_total(client)
    print(f"  {total:,} buildings to fetch")

    conn = await asyncpg.connect(_asyncpg_url(DATABASE_URL), ssl='require', statement_cache_size=0)
    await conn.execute("TRUNCATE buildings")

    inserted = 0
    print("  Pass 1/2: centroids…")
    with tqdm(total=total, unit='buildings') as bar:
        async with httpx.AsyncClient() as client:
            offset = 0
            while offset < total:
                rows = await fetch_page_centroid(client, offset)
                if not rows:
                    break

                records = []
                for row in rows:
                    bin_val = (row.get('bin') or '').strip()
                    if not bin_val or bin_val.lstrip('0') == '':
                        continue
                    try:
                        lat = float(row['latitude']) if row.get('latitude') is not None else None
                        lon = float(row['longitude']) if row.get('longitude') is not None else None
                    except (TypeError, ValueError):
                        lat, lon = None, None
                    records.append((
                        bin_val,
                        lat,
                        lon,
                        _borough_from_bin(bin_val),
                        row.get('construction_year'),
                    ))

                if records:
                    await conn.executemany(
                        """
                        INSERT INTO buildings (bin, latitude, longitude, borough, construction_year)
                        VALUES ($1, $2, $3, $4, $5)
                        ON CONFLICT (bin) DO UPDATE
                            SET latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude,
                                borough=EXCLUDED.borough, construction_year=EXCLUDED.construction_year
                        """,
                        records,
                    )
                    inserted += len(records)
                    bar.update(len(rows))

                offset += PAGE_SIZE

    await conn.close()
    print(f"  Pass 1 done — {inserted:,} buildings inserted.")

    print("  Pass 2/2: height and footprint area…")
    await update_scalars()


if __name__ == "__main__":
    import sys
    if "--pass2-only" in sys.argv:
        print("Running pass 2 only (height + footprint area)…")
        asyncio.run(update_scalars())
    else:
        asyncio.run(load_buildings())
