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

# Zoomed out: limited per-borough queries ensure geographic spread
_BOROUGH_SQL = text("""
    SELECT bin, address, borough, zip_code,
           total_complaints, open_complaints, priority_a_complaints,
           score_numeric, risk_level, nta_code, latitude, longitude
    FROM building_summary
    WHERE borough = :borough
      AND latitude  BETWEEN :south AND :north
      AND longitude BETWEEN :west  AND :east
      AND latitude IS NOT NULL
    LIMIT :per_borough
""")

# Zoomed in: single bbox query, no borough cap — viewport is small enough
_BBOX_SQL = text("""
    SELECT bin, address, borough, zip_code,
           total_complaints, open_complaints, priority_a_complaints,
           score_numeric, risk_level, nta_code, latitude, longitude
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
    cache_key = f"clusters:{west:.4f},{south:.4f},{east:.4f},{north:.4f},{zoom:.2f}"
    cached = cache_get(cache_key)
    if cached:
        return JSONResponse(content=cached)

    bbox = {"south": south, "north": north, "west": west, "east": east}

    if zoom >= CLUSTER_MAX_ZOOM:
        # Individual dots: fetch everything in the viewport
        result = await db.execute(_BBOX_SQL, bbox)
        all_rows = result.all()
    else:
        # Clustering: cap per borough so all boroughs are represented
        all_rows = []
        for borough in BOROUGHS:
            result = await db.execute(_BOROUGH_SQL, {**bbox, "borough": borough, "per_borough": PER_BOROUGH_LIMIT})
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
                "score_numeric": float(r.score_numeric) if r.score_numeric is not None else None,
                "risk_level": risk,
                "risk_color": RISK_COLORS.get(risk, RISK_COLORS["Insufficient data"]),
                "nta_code": r.nta_code,
            },
        })

    geojson = {"type": "FeatureCollection", "features": features}
    cache_set(cache_key, geojson, ttl_seconds=1800)
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
    cache_set(cache_key, result, ttl_seconds=3600)
    return result
