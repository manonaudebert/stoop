"""Fetch building centroids from the NYC building footprints dataset (5zhs-2jue)
and load them into the buildings table.

Uses Socrata's $select with ST_Centroid to avoid downloading polygon geometry.
Falls back to averaging polygon coordinates if the geo function is unsupported.
Paginates at 50k rows per request (~22 pages for 1.1M buildings).
"""
import asyncio
import httpx
import asyncpg
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


async def fetch_page_centroid(client: httpx.AsyncClient, offset: int) -> list[dict]:
    """Try ST_Centroid first; return raw the_geom rows as fallback."""
    try:
        r = await client.get(BUILDINGS_API, params={
            "$select": "bin, ST_Y(ST_Centroid(the_geom)) as latitude, ST_X(ST_Centroid(the_geom)) as longitude, construction_year",
            "$limit": PAGE_SIZE,
            "$offset": offset,
            "$where": "bin IS NOT NULL",
        }, timeout=60)
        r.raise_for_status()
        data = r.json()
        # If Socrata returned an error object instead of a list, fall back
        if isinstance(data, dict):
            raise ValueError("Socrata returned error, falling back")
        return data
    except Exception:
        r = await client.get(BUILDINGS_API, params={
            "$select": "bin, the_geom, construction_year",
            "$limit": PAGE_SIZE,
            "$offset": offset,
            "$where": "bin IS NOT NULL",
        }, timeout=60)
        r.raise_for_status()
        rows = []
        for item in r.json():
            lat, lon = _centroid_from_geom(item.get('the_geom') or {})
            rows.append({"bin": item.get("bin"), "latitude": lat, "longitude": lon,
                         "construction_year": item.get("construction_year")})
        return rows


async def load_buildings():
    print("Fetching building centroids from Socrata…")

    # Get total count
    async with httpx.AsyncClient() as client:
        r = await client.get(BUILDINGS_API, params={"$select": "count(*)", "$limit": 1}, timeout=30)
        total = int(r.json()[0]["count"])

    print(f"  {total:,} buildings to fetch")

    conn = await asyncpg.connect(_asyncpg_url(DATABASE_URL), ssl='require', statement_cache_size=0)
    await conn.execute("TRUNCATE buildings")

    inserted = 0
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
    print(f"Done — {inserted:,} buildings loaded.")


if __name__ == "__main__":
    asyncio.run(load_buildings())
