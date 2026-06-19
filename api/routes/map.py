from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from database import get_db
from limiter import limiter
from cache import cache_get, cache_set

router = APIRouter(prefix="/map", tags=["map"])

CLUSTER_MAX_ZOOM  = 13    # must match clusterMaxZoom in Map.tsx
PER_BOROUGH_LIMIT = 2500  # cap per borough when zoomed out (clustering mode)

BOROUGHS = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"]

RISK_COLORS: dict[str, str] = {
    "Very low":          "#D4F5CB",
    "Low":               "#A8E5A0",
    "Moderate":          "#FFD930",
    "High":              "#F5A047",
    "Very high":         "#EF4637",
    "Insufficient data": "#D4F5CB",  # few complaints — positive signal, light green
    "Not comparable":    "#D4D1C3",  # non-residential NTA or no NTA — grey
}

# Zoomed out: a deterministic citywide sample per borough. Ordering by
# hashtext(bin) (bin is unique) is a location-independent scramble, so the
# sample is spatially representative — unlike a bare LIMIT, which follows heap
# order and can omit whole areas (e.g. upper Manhattan). It's also stable, so
# dots don't reshuffle as you pan and the result caches under a constant key.
# No bbox filter: the clustered view shows the whole city regardless of viewport.
_BOROUGH_SQL = text("""
    SELECT bin, address, borough, zip_code,
           total_complaints, open_complaints, priority_a_complaints,
           risk_level, nta_code, latitude, longitude
    FROM building_summary
    WHERE borough = :borough
      AND latitude IS NOT NULL
    ORDER BY hashtext(bin)
    LIMIT :per_borough
""")

# Zoomed in: single bbox query, no borough cap — viewport is small enough
_BBOX_SQL = text("""
    SELECT bin, address, borough, zip_code,
           total_complaints, open_complaints, priority_a_complaints,
           risk_level, nta_code, latitude, longitude
    FROM building_summary
    WHERE latitude  BETWEEN :south AND :north
      AND longitude BETWEEN :west  AND :east
      AND latitude IS NOT NULL
""")


@router.get("/clusters")
@limiter.limit("120/minute")
async def get_clusters(
    request: Request,
    west: float = Query(...),
    south: float = Query(...),
    east: float = Query(...),
    north: float = Query(...),
    zoom: float = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Return a GeoJSON FeatureCollection of buildings within the bounding box.
    Mapbox GL JS uses this as the source for its cluster layer."""
    if zoom >= CLUSTER_MAX_ZOOM:
        # Individual dots: fetch everything in the viewport (bbox-dependent)
        cache_key = f"clusters:{west:.4f},{south:.4f},{east:.4f},{north:.4f}"
    else:
        # Clustering: one stable citywide sample, independent of the viewport
        cache_key = "clusters:citywide"
    cached = cache_get(cache_key)
    if cached:
        return JSONResponse(content=cached)

    if zoom >= CLUSTER_MAX_ZOOM:
        # Individual dots: fetch everything in the viewport
        bbox = {"south": south, "north": north, "west": west, "east": east}
        result = await db.execute(_BBOX_SQL, bbox)
        all_rows = result.all()
    else:
        # Clustering: deterministic per-borough sample so all boroughs and
        # neighborhoods are represented (see _BOROUGH_SQL).
        all_rows = []
        for borough in BOROUGHS:
            result = await db.execute(_BOROUGH_SQL, {"borough": borough, "per_borough": PER_BOROUGH_LIMIT})
            all_rows.extend(result.all())

    features = []
    for r in all_rows:
        risk = r.risk_level or "Insufficient data"
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [r.longitude, r.latitude]},
            "properties": {
                "bin": r.bin,
                "address": r.address,
                "borough": r.borough,
                "zip_code": r.zip_code,
                "total_complaints": r.total_complaints,
                "open_complaints": r.open_complaints,
                "priority_a_complaints": r.priority_a_complaints,
                "risk_level": risk,
                "risk_color": RISK_COLORS.get(risk, RISK_COLORS["Insufficient data"]),
                "nta_code": r.nta_code,
            },
        })

    geojson = {"type": "FeatureCollection", "features": features}
    cache_set(cache_key, geojson, ttl_seconds=86400)
    return JSONResponse(content=geojson)


# ── unified DOB + HPD clusters ──────────────────────────────────────────────────
#
# One point per building across BOTH datasets. A FULL OUTER JOIN on bin means a
# building shows up whether it has DOB records, HPD records, or both — the map
# renders the union, never just one source. Each feature carries both risk
# levels (dob_*/hpd_*) so the frontend can color by whichever lens is active
# without refetching. Identity/geo columns are coalesced because a building may
# be present in only one of the two summary tables.
#
# CRITICAL: the bbox/borough filter is applied to EACH table inside a CTE before
# the join, not as an OR over the joined result. A FULL OUTER JOIN with a WHERE
# that ORs predicates across both tables cannot push either predicate down — the
# planner has to hash-join both whole tables (~780k rows) and then filter, which
# made the map ~3x slower. Filtering each side first lets each table use its own
# lat/lng and borough indexes, so the join runs over only the matching rows.

_DOB_COLS = ("bin, address, borough, zip_code, nta_code, latitude, longitude, "
             "risk_level, total_complaints, open_complaints, priority_a_complaints")
_HPD_COLS = ("bin, address, borough, zip_code, nta_code, latitude, longitude, "
             "risk_level, total_complaints, open_complaints, open_emergency_complaints, "
             "heat_complaints, latest_complaint_date")

# Joins the two pre-filtered CTEs (d, h) and projects the unified shape.
_UNIFIED_JOIN = """
    SELECT
        COALESCE(d.bin, h.bin)             AS bin,
        COALESCE(d.address, h.address)     AS address,
        COALESCE(d.borough, h.borough)     AS borough,
        COALESCE(d.zip_code, h.zip_code)   AS zip_code,
        COALESCE(d.nta_code, h.nta_code)   AS nta_code,
        COALESCE(d.latitude, h.latitude)   AS latitude,
        COALESCE(d.longitude, h.longitude) AS longitude,
        d.risk_level            AS dob_risk_level,
        d.total_complaints      AS dob_total,
        d.open_complaints       AS dob_open,
        d.priority_a_complaints AS dob_priority_a,
        h.risk_level                AS hpd_risk_level,
        h.total_complaints          AS hpd_total,
        h.open_complaints           AS hpd_open,
        h.open_emergency_complaints AS hpd_open_emergency,
        h.heat_complaints           AS hpd_heat,
        h.latest_complaint_date     AS hpd_latest_date
    FROM d
    FULL OUTER JOIN h ON d.bin = h.bin
"""

_UNIFIED_BOROUGH_SQL = text(f"""
    WITH d AS (
        SELECT {_DOB_COLS} FROM building_summary
        WHERE borough = :borough AND latitude IS NOT NULL
    ),
    h AS (
        SELECT {_HPD_COLS} FROM hpd_complaints_building_summary
        WHERE borough = :borough AND latitude IS NOT NULL
    )
    {_UNIFIED_JOIN}
    ORDER BY hashtext(COALESCE(d.bin, h.bin))
    LIMIT :per_borough
""")

_UNIFIED_BBOX_SQL = text(f"""
    WITH d AS (
        SELECT {_DOB_COLS} FROM building_summary
        WHERE latitude  BETWEEN :south AND :north
          AND longitude BETWEEN :west  AND :east
    ),
    h AS (
        SELECT {_HPD_COLS} FROM hpd_complaints_building_summary
        WHERE latitude  BETWEEN :south AND :north
          AND longitude BETWEEN :west  AND :east
    )
    {_UNIFIED_JOIN}
""")


@router.get("/unified/clusters")
@limiter.limit("120/minute")
async def get_unified_clusters(
    request: Request,
    west: float = Query(...),
    south: float = Query(...),
    east: float = Query(...),
    north: float = Query(...),
    zoom: float = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """GeoJSON FeatureCollection of every building across DOB and HPD, joined on
    bin. Powers the single consolidated map: each feature carries both datasets'
    risk levels and stats so the active color lens is a paint swap, not a fetch."""
    if zoom >= CLUSTER_MAX_ZOOM:
        cache_key = f"unified_clusters:{west:.4f},{south:.4f},{east:.4f},{north:.4f}"
    else:
        cache_key = "unified_clusters:citywide"
    cached = cache_get(cache_key)
    if cached:
        return JSONResponse(content=cached)

    if zoom >= CLUSTER_MAX_ZOOM:
        bbox = {"south": south, "north": north, "west": west, "east": east}
        result = await db.execute(_UNIFIED_BBOX_SQL, bbox)
        all_rows = result.all()
    else:
        all_rows = []
        for borough in BOROUGHS:
            result = await db.execute(_UNIFIED_BOROUGH_SQL, {"borough": borough, "per_borough": PER_BOROUGH_LIMIT})
            all_rows.extend(result.all())

    features = []
    for r in all_rows:
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [r.longitude, r.latitude]},
            "properties": {
                "bin": r.bin,
                "address": r.address,
                "borough": r.borough,
                "zip_code": r.zip_code,
                "nta_code": r.nta_code,
                # Presence flags (1/0) — a building absent from a dataset is
                # "no data" for that lens, NOT low risk; the frontend greys it
                # out and excludes it from that lens's cluster severity.
                "dob_present": 1 if r.dob_risk_level is not None else 0,
                "hpd_present": 1 if r.hpd_risk_level is not None else 0,
                # DOB (building safety) — null when the building has no DOB record
                "dob_risk_level":  r.dob_risk_level,
                "dob_total":       r.dob_total,
                "dob_open":        r.dob_open,
                "dob_priority_a":  r.dob_priority_a,
                # HPD (housing conditions) — null when the building has no HPD record
                "hpd_risk_level":     r.hpd_risk_level,
                "hpd_total":          r.hpd_total,
                "hpd_open":           r.hpd_open,
                "hpd_open_emergency": r.hpd_open_emergency,
                "hpd_heat":           r.hpd_heat,
                "hpd_latest_date":    str(r.hpd_latest_date) if r.hpd_latest_date else None,
            },
        })

    geojson = {"type": "FeatureCollection", "features": features}
    cache_set(cache_key, geojson, ttl_seconds=86400)
    return JSONResponse(content=geojson)


@router.get("/heatmap")
async def get_heatmap(
    borough: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Return complaint counts aggregated by ZIP code for a choropleth layer."""
    cache_key = f"heatmap:{borough or 'all'}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    q = """
        SELECT zip_code,
               SUM(total_complaints)   AS total_complaints,
               SUM(open_complaints)    AS open_complaints,
               SUM(priority_a_complaints) AS priority_a_complaints,
               COUNT(*)                AS building_count
        FROM building_summary
        WHERE zip_code IS NOT NULL
    """
    params: dict = {}
    if borough:
        q += " AND borough = :borough"
        params["borough"] = borough
    q += " GROUP BY zip_code ORDER BY total_complaints DESC"

    rows = await db.execute(text(q), params)
    result = [
        {
            "zip_code": r.zip_code,
            "total_complaints": r.total_complaints,
            "open_complaints": r.open_complaints,
            "priority_a_complaints": r.priority_a_complaints,
            "building_count": r.building_count,
        }
        for r in rows
    ]
    cache_set(cache_key, result, ttl_seconds=86400)
    return result
