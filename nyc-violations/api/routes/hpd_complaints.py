import re
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from database import get_db
from limiter import limiter
from cache import cache_get, cache_set
from schemas import (
    HpdComplaintBuildingSummaryResponse,
    HpdComplaintBuildingDetailResponse,
    HpdComplaintResponse,
    ComplaintCategoryBreakdownItem,
    ComplaintMinorBreakdownItem,
    ComplaintTypePeriodItem,
    ComplaintResolutionItem,
    TimelinePoint,
)

router = APIRouter(prefix="/hpd-complaints", tags=["hpd-complaints"])

PAGE_SIZE           = 50
CLUSTER_MAX_ZOOM    = 13
PER_BOROUGH_LIMIT   = 2500
LEADERBOARD_LIMIT   = 100

LEADERBOARD_QUERY = """
    SELECT bin, address, zip_code, borough, latitude, longitude,
           total_complaints, open_complaints, open_emergency_complaints,
           heat_complaints, recent_complaint_count, prior_complaint_count,
           recent_emergency_count, trend_direction, latest_complaint_date,
           complaints_density_pct, risk_level, nta_code, nta_name
    FROM hpd_complaints_building_summary
    WHERE recent_complaint_count > 0
      AND total_complaints >= 10
      {borough_clause}
    ORDER BY recent_complaint_count DESC,
             recent_emergency_count DESC
    LIMIT {limit}
"""

def _complaint_risk_tier(open_emergency: int, open_count: int) -> str:
    if open_emergency > 0:
        return "Emergency"
    if open_count > 0:
        return "Active"
    return "Resolved"


# ── leaderboard ───────────────────────────────────────────────────────────────

@router.get("/building/leaderboard-recent", response_model=list[HpdComplaintBuildingSummaryResponse])
async def get_hpd_complaint_leaderboard(
    borough: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    cache_key = f"hpd_complaint_leaderboard:{borough or 'all'}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    clause = "AND UPPER(borough) = UPPER(:borough)" if borough else ""
    params: dict = {"borough": borough} if borough else {}
    rows = await db.execute(
        text(LEADERBOARD_QUERY.format(borough_clause=clause, limit=LEADERBOARD_LIMIT)),
        params,
    )
    result = [_row_to_summary(r) for r in rows.all()]
    cache_set(cache_key, result, ttl_seconds=86400)
    return result


# ── map queries — backed by hpd_complaints_building_summary mat view ──────────

_BOROUGH_CAPPED_SQL = text("""
    WITH ranked AS (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY borough ORDER BY total_complaints DESC) AS rn
        FROM hpd_complaints_building_summary
        WHERE latitude  BETWEEN :south AND :north
          AND longitude BETWEEN :west  AND :east
          AND latitude IS NOT NULL
    )
    SELECT * FROM ranked WHERE rn <= :per_borough
""")

_BBOX_SQL = text("""
    SELECT *
    FROM hpd_complaints_building_summary
    WHERE latitude  BETWEEN :south AND :north
      AND longitude BETWEEN :west  AND :east
      AND latitude IS NOT NULL
""")


@router.get("/map/clusters")
@limiter.limit("120/minute")
async def get_hpd_complaint_clusters(
    request: Request,
    west: float = Query(...),
    south: float = Query(...),
    east: float = Query(...),
    north: float = Query(...),
    zoom: float = Query(...),
    db: AsyncSession = Depends(get_db),
):
    cache_key = f"hpd_complaint_clusters:{west:.4f},{south:.4f},{east:.4f},{north:.4f},{zoom:.2f}"
    cached = cache_get(cache_key)
    if cached:
        return JSONResponse(content=cached)

    bbox = {"south": south, "north": north, "west": west, "east": east}

    if zoom >= CLUSTER_MAX_ZOOM:
        result = await db.execute(_BBOX_SQL, bbox)
    else:
        result = await db.execute(_BOROUGH_CAPPED_SQL, {**bbox, "per_borough": PER_BOROUGH_LIMIT})
    all_rows = result.all()

    features = []
    for r in all_rows:
        tier = _complaint_risk_tier(r.open_emergency_complaints, r.open_complaints)
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [r.longitude, r.latitude]},
            "properties": {
                "bin":                       r.bin,
                "address":                   r.address,
                "borough":                   r.borough,
                "zip_code":                  r.zip_code,
                "nta_code":                  r.nta_code,
                # DOB-compatible names for Map.tsx
                "total_complaints":          r.total_complaints,
                "open_complaints":           r.open_complaints,
                "priority_a_complaints":     r.open_emergency_complaints,
                "risk_level":                r.risk_level or "Very low",
                # HPD complaints-specific extras
                "complaint_risk_tier":       tier,
                "open_emergency_complaints": r.open_emergency_complaints,
                "heat_complaints":           r.heat_complaints,
                "latest_complaint_date":     str(r.latest_complaint_date) if r.latest_complaint_date else None,
            },
        })

    geojson = {"type": "FeatureCollection", "features": features}
    cache_set(cache_key, geojson, ttl_seconds=1800)
    return JSONResponse(content=geojson)


# ── search ─────────────────────────────────────────────────────────────────────

_DIRECTION_EXPANSIONS = [
    (r"\bWEST\b",  "W"),  (r"\bEAST\b",  "E"),
    (r"\bNORTH\b", "N"),  (r"\bSOUTH\b", "S"),
    (r"\bW\b",  "WEST"),  (r"\bE\b",  "EAST"),
    (r"\bN\b", "NORTH"),  (r"\bS\b", "SOUTH"),
]

def _normalize(s: str) -> str:
    s = s.upper().strip()
    return re.sub(r'\b(\d+)(ST|ND|RD|TH)\b', r'\1', s)

def _search_patterns(query: str) -> list[str]:
    patterns: set[str] = {query}
    normalized = _normalize(query)
    patterns.add(normalized)
    for pattern, replacement in _DIRECTION_EXPANSIONS:
        variant = re.sub(pattern, replacement, normalized)
        if variant != normalized:
            patterns.add(variant)
            break
    return [f"%{p}%" for p in patterns]


@router.get("/building/search", response_model=list[HpdComplaintBuildingSummaryResponse])
@limiter.limit("30/minute")
async def search_hpd_complaint_buildings(
    request: Request,
    q: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
):
    cache_key = f"hpd_complaint_search:{q.strip().lower()}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    patterns = _search_patterns(q.strip())
    like_params = {f"like_{i}": p for i, p in enumerate(patterns)}
    like_clauses = " OR ".join(
        f"cs.address ILIKE :like_{i}"
        for i in range(len(patterns))
    )

    rows = await db.execute(
        text(f"""
            SELECT cs.*
            FROM hpd_complaints_building_summary cs
            WHERE cs.bin = :q
               OR {like_clauses}
            ORDER BY cs.total_complaints DESC
            LIMIT 20
        """),
        {"q": q.strip(), **like_params},
    )
    results = [_row_to_summary(r) for r in rows.all()]
    cache_set(cache_key, results, ttl_seconds=600)
    return results


# ── building detail ────────────────────────────────────────────────────────────

def _row_to_summary(r) -> HpdComplaintBuildingSummaryResponse:
    tier = _complaint_risk_tier(r.open_emergency_complaints, r.open_complaints)
    return HpdComplaintBuildingSummaryResponse(
        bin=r.bin,
        address=r.address,
        zip_code=r.zip_code,
        borough=r.borough,
        latitude=float(r.latitude) if r.latitude is not None else None,
        longitude=float(r.longitude) if r.longitude is not None else None,
        nta_code=getattr(r, "nta_code", None),
        nta_name=getattr(r, "nta_name", None),
        total_complaints=r.total_complaints,
        open_complaints=r.open_complaints,
        open_emergency_complaints=r.open_emergency_complaints,
        heat_complaints=r.heat_complaints,
        latest_complaint_date=r.latest_complaint_date,
        complaint_risk_tier=tier,
        recent_complaint_count=getattr(r, "recent_complaint_count", 0) or 0,
        prior_complaint_count=getattr(r, "prior_complaint_count", 0) or 0,
        recent_emergency_count=getattr(r, "recent_emergency_count", 0) or 0,
        trend_direction=getattr(r, "trend_direction", None),
        complaints_density_pct=getattr(r, "complaints_density_pct", None),
        risk_level=getattr(r, "risk_level", None),
    )


@router.get("/building/{bin}", response_model=HpdComplaintBuildingDetailResponse)
async def get_hpd_complaint_building(
    bin: str,
    page: int = Query(1, ge=1),
    major_category: str | None = None,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    summary_row = await db.execute(
        text("SELECT * FROM hpd_complaints_building_summary WHERE bin = :bin"),
        {"bin": bin},
    )
    summary = summary_row.first()
    if not summary:
        raise HTTPException(status_code=404, detail="No HPD complaints found for this building")

    count_q = "SELECT COUNT(*) FROM hpd_complaints WHERE bin = :bin"
    params: dict = {"bin": bin}
    if major_category:
        count_q += " AND major_category = :major_category"
        params["major_category"] = major_category
    if status:
        count_q += " AND complaint_status = :status"
        params["status"] = status.capitalize()

    total_count = (await db.execute(text(count_q), params)).scalar()

    offset = (page - 1) * PAGE_SIZE
    complaints_q = """
        SELECT
            problem_id, complaint_id, bin, apartment, unit_type, space_type,
            type, major_category, minor_category,
            complaint_status, complaint_status_date,
            problem_status, problem_status_date, status_description,
            received_date
        FROM hpd_complaints
        WHERE bin = :bin
    """
    if major_category:
        complaints_q += " AND major_category = :major_category"
    if status:
        complaints_q += " AND complaint_status = :status"
    complaints_q += " ORDER BY received_date DESC NULLS LAST LIMIT :limit OFFSET :offset"
    params["limit"] = PAGE_SIZE
    params["offset"] = offset

    rows = await db.execute(text(complaints_q), params)
    complaints = [HpdComplaintResponse(**dict(r._mapping)) for r in rows]

    return HpdComplaintBuildingDetailResponse(
        **_row_to_summary(summary).__dict__,
        complaints=complaints,
        total_count=total_count,
        page=page,
        page_size=PAGE_SIZE,
    )


@router.get("/building/{bin}/timeline", response_model=list[TimelinePoint])
async def get_hpd_complaint_timeline(bin: str, db: AsyncSession = Depends(get_db)):
    cache_key = f"hpd_complaint_timeline:{bin}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    rows = await db.execute(
        text("""
            SELECT TO_CHAR(date_trunc('month', received_date), 'YYYY-MM') AS month,
                   COUNT(*) AS count
            FROM hpd_complaints
            WHERE bin = :bin AND received_date IS NOT NULL
            GROUP BY 1
            ORDER BY 1
        """),
        {"bin": bin},
    )
    result = [TimelinePoint(month=r.month, count=r.count) for r in rows]
    cache_set(cache_key, result)
    return result


@router.get("/building/{bin}/breakdown", response_model=list[ComplaintCategoryBreakdownItem])
async def get_hpd_complaint_breakdown(bin: str, db: AsyncSession = Depends(get_db)):
    cache_key = f"hpd_complaint_breakdown:{bin}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    rows = await db.execute(
        text("""
            SELECT
                type,
                major_category,
                COUNT(*)                                                 AS count,
                COUNT(*) FILTER (WHERE complaint_status = 'Open')        AS open_count
            FROM hpd_complaints
            WHERE bin = :bin AND major_category IS NOT NULL
            GROUP BY type, major_category
            ORDER BY count DESC
        """),
        {"bin": bin},
    )
    result = [
        ComplaintCategoryBreakdownItem(
            type=r.type,
            major_category=r.major_category,
            count=r.count,
            open_count=r.open_count,
        )
        for r in rows
    ]
    cache_set(cache_key, result)
    return result


@router.get("/building/{bin}/minor-breakdown", response_model=list[ComplaintMinorBreakdownItem])
async def get_hpd_complaint_minor_breakdown(bin: str, db: AsyncSession = Depends(get_db)):
    cache_key = f"hpd_complaint_minor_breakdown:{bin}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    rows = await db.execute(
        text("""
            SELECT
                minor_category,
                COUNT(*)                                                 AS count,
                COUNT(*) FILTER (WHERE complaint_status = 'Open')        AS open_count
            FROM hpd_complaints
            WHERE bin = :bin
              AND minor_category IS NOT NULL
              AND received_date >= NOW() - INTERVAL '5 years'
            GROUP BY minor_category
            ORDER BY count DESC
        """),
        {"bin": bin},
    )
    result = [
        ComplaintMinorBreakdownItem(
            minor_category=r.minor_category,
            count=r.count,
            open_count=r.open_count,
        )
        for r in rows
    ]
    cache_set(cache_key, result)
    return result


@router.get("/building/{bin}/type-period-breakdown", response_model=list[ComplaintTypePeriodItem])
async def get_hpd_complaint_type_period_breakdown(bin: str, db: AsyncSession = Depends(get_db)):
    cache_key = f"hpd_complaint_type_period:{bin}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    rows = await db.execute(
        text("""
            SELECT
                COALESCE(type, 'NON EMERGENCY') AS type,
                COUNT(*) FILTER (
                    WHERE received_date >= NOW() - INTERVAL '1 year'
                ) AS recent_count,
                COUNT(*) FILTER (
                    WHERE received_date >= NOW() - INTERVAL '5 years'
                      AND received_date <  NOW() - INTERVAL '1 year'
                ) AS prior_count
            FROM hpd_complaints
            WHERE bin = :bin
            GROUP BY 1
        """),
        {"bin": bin},
    )
    result = [
        ComplaintTypePeriodItem(type=r.type, recent_count=r.recent_count, prior_count=r.prior_count)
        for r in rows
    ]
    cache_set(cache_key, result)
    return result


# Mirrors classify_status() in classify_hpd_status.py — rules applied in the same order.
_RESOLUTION_CASE = """
    CASE
        WHEN LOWER(status_description) LIKE '%not able to gain access to your apartment to inspect for a lack of heat or hot water. however, hpd was able to verify%'
            THEN 'partial_no_access'
        WHEN LOWER(status_description) LIKE '%violations were issued. however, hpd also identified potential lead-based paint%'
            THEN 'inspected_violation'
        WHEN LOWER(status_description) LIKE '%identified potential lead-based paint conditions. hpd will attempt to contact you to schedule a follow-up%'
            THEN 'lead_followup'
        WHEN LOWER(status_description) LIKE '%a section 8 failure was issued%'
            THEN 'section_8_failure'
        WHEN LOWER(status_description) LIKE '%did not have enough time to inspect%'
            THEN 'insufficient_time'
        WHEN LOWER(status_description) LIKE '%not able to gain access to inspect%'
          OR LOWER(status_description) LIKE '%not able to gain access to your apartment%'
          OR LOWER(status_description) LIKE '%unable to access the rooms%'
          OR LOWER(status_description) LIKE '%unable to complete the inspection%'
            THEN 'no_access'
        WHEN LOWER(status_description) LIKE '%did not violate the housing laws%'
          OR LOWER(status_description) LIKE '%no violations were issued%'
          OR LOWER(status_description) LIKE '%heat was not required at the time of the inspection%'
            THEN 'inspected_no_violation'
        WHEN LOWER(status_description) LIKE '%violations were issued%'
          OR LOWER(status_description) LIKE '%violations were previously issued%'
            THEN 'inspected_violation'
        WHEN LOWER(status_description) LIKE '%called the telephone number on file%'
          OR LOWER(status_description) LIKE '%verified that the following conditions were corrected%'
          OR LOWER(status_description) LIKE '%confirmed heat and hot water had been restored%'
          OR LOWER(status_description) LIKE '%advised by a tenant in the building that heat and hot water had been restored%'
            THEN 'phone_resolved'
        WHEN complaint_status = 'Open'
            THEN 'open'
        ELSE 'unknown'
    END
"""


@router.get("/building/{bin}/resolution-breakdown", response_model=list[ComplaintResolutionItem])
async def get_hpd_complaint_resolution_breakdown(bin: str, db: AsyncSession = Depends(get_db)):
    cache_key = f"hpd_complaint_resolution:{bin}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    rows = await db.execute(
        text(f"""
            SELECT {_RESOLUTION_CASE} AS bucket, COUNT(*) AS count
            FROM hpd_complaints
            WHERE bin = :bin
            GROUP BY 1
            ORDER BY count DESC
        """),
        {"bin": bin},
    )
    result = [ComplaintResolutionItem(bucket=r.bucket, count=r.count) for r in rows]
    cache_set(cache_key, result)
    return result
