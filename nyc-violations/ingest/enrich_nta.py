"""
One-time enrichment: assign NTA code/name to every building via point-in-polygon.
Uses the NYC 2020 NTA GeoJSON (WGS84) from ArcGIS FeatureServer.
Adds nta_code + nta_name columns to the buildings table.
"""
import asyncio
import httpx
import asyncpg
import numpy as np
from shapely.geometry import shape
from shapely import points as make_points
from shapely.strtree import STRtree
from tqdm import tqdm
from config import DATABASE_URL

NTA_URL = (
    "https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/arcgis/rest/services/"
    "NYC_Neighborhood_Tabulation_Areas_2020/FeatureServer/0/query"
    "?where=1=1&outFields=NTA2020,NTAName,NTAType&outSR=4326&f=pgeojson"
)
CHUNK = 50_000


async def main() -> None:
    # ── 1. Fetch NTA polygons ────────────────────────────────────────────────
    print("Fetching NTA GeoJSON…")
    async with httpx.AsyncClient() as client:
        resp = await client.get(NTA_URL, timeout=60)
        resp.raise_for_status()
        geojson = resp.json()

    features = geojson["features"]
    nta_polys  = [shape(f["geometry"])           for f in features]
    nta_codes  = [f["properties"]["NTA2020"]     for f in features]
    nta_names  = [f["properties"]["NTAName"]     for f in features]
    nta_types  = [int(v) if (v := f["properties"].get("NTAType")) is not None else None for f in features]
    tree = STRtree(nta_polys)
    print(f"  → {len(nta_polys)} NTAs indexed")

    # ── 2. Connect + add columns ─────────────────────────────────────────────
    conn = await asyncpg.connect(DATABASE_URL)
    await conn.execute("ALTER TABLE buildings ADD COLUMN IF NOT EXISTS nta_code TEXT")
    await conn.execute("ALTER TABLE buildings ADD COLUMN IF NOT EXISTS nta_name TEXT")
    await conn.execute("ALTER TABLE buildings ADD COLUMN IF NOT EXISTS nta_type SMALLINT")
    await conn.execute("CREATE INDEX IF NOT EXISTS idx_buildings_nta ON buildings(nta_code)")

    total_buildings = await conn.fetchval(
        "SELECT COUNT(*) FROM buildings WHERE latitude IS NOT NULL AND longitude IS NOT NULL"
    )
    print(f"  → {total_buildings:,} buildings to process")

    # ── 3. Stream rows in chunks, assign NTA, batch-update ───────────────────
    matched = 0
    offset = 0

    with tqdm(total=total_buildings, unit="bldg") as bar:
        while True:
            rows = await conn.fetch(
                """SELECT bin, latitude, longitude FROM buildings
                   WHERE latitude IS NOT NULL AND longitude IS NOT NULL
                   ORDER BY bin
                   LIMIT $1 OFFSET $2""",
                CHUNK, offset,
            )
            if not rows:
                break

            bins = [r["bin"]       for r in rows]
            lons = [r["longitude"] for r in rows]
            lats = [r["latitude"]  for r in rows]

            # Vectorised point-in-polygon via STRtree
            pts = make_points(lons, lats)
            # result shape: (2, n_matches) — row 0 = input indices, row 1 = tree indices
            result = tree.query(pts, predicate="within")

            nta_by_pt: dict[int, tuple[str, str, int | None]] = {}
            if result.size > 0:
                for pt_idx, nta_idx in zip(result[0], result[1]):
                    nta_by_pt[int(pt_idx)] = (nta_codes[int(nta_idx)], nta_names[int(nta_idx)], nta_types[int(nta_idx)])

            updates = [
                (nta_by_pt[i][0], nta_by_pt[i][1], nta_by_pt[i][2], bins[i])
                for i in range(len(bins))
                if i in nta_by_pt
            ]
            if updates:
                await conn.executemany(
                    "UPDATE buildings SET nta_code=$1, nta_name=$2, nta_type=$3 WHERE bin=$4",
                    updates,
                )
                matched += len(updates)

            bar.update(len(rows))
            offset += CHUNK

    # ── 4. Report ─────────────────────────────────────────────────────────────
    final = await conn.fetchval("SELECT COUNT(*) FROM buildings WHERE nta_code IS NOT NULL")
    print(f"\nDone: {final:,} / {total_buildings:,} buildings assigned to an NTA")
    unmatched = total_buildings - final
    if unmatched:
        print(f"  {unmatched:,} unmatched (likely outside NYC boundary or missing coords)")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
