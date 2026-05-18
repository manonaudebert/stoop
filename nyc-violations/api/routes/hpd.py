import re
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from database import get_db
from limiter import limiter
from cache import cache_get, cache_set
from schemas import (
    HpdBuildingSummaryResponse,
    HpdBuildingDetailResponse,
    HpdViolationResponse,
    ViolationClassBreakdownItem,
    TimelinePoint,
)

router = APIRouter(prefix="/hpd", tags=["hpd"])

PAGE_SIZE         = 50
CLUSTER_MAX_ZOOM  = 13
PER_BOROUGH_LIMIT = 2500

# HPD risk tier → display color (matches DOB palette for visual consistency)
HPD_TIER_COLORS: dict[str, str] = {
    "Emergency":     "#EF4637",
    "Hazardous":     "#F5A047",
    "Non-hazardous": "#FFD930",
    "Resolved":      "#A8E5A0",
}

# Maps HPD tier → equivalent DOB risk_level string so Map.tsx coloring reuses
# the existing match expression without changes.
HPD_TIER_TO_RISK_LEVEL: dict[str, str] = {
    "Emergency":     "Very high",
    "Hazardous":     "High",
    "Non-hazardous": "Moderate",
    "Resolved":      "Low",
}


def _hpd_risk_tier(class_a: int, class_b: int, open_count: int) -> str:
    if open_count == 0:
        return "Resolved"
    if class_a > 0:
        return "Emergency"
    if class_b > 0:
        return "Hazardous"
    return "Non-hazardous"


# ── map queries — backed by hpd_building_summary materialized view ───────────

_BOROUGH_CAPPED_SQL = text("""
    WITH ranked AS (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY borough ORDER BY total_violations DESC) AS rn
        FROM hpd_building_summary
        WHERE latitude  BETWEEN :south AND :north
          AND longitude BETWEEN :west  AND :east
          AND latitude IS NOT NULL
    )
    SELECT * FROM ranked WHERE rn <= :per_borough
""")

_BBOX_SQL = text("""
    SELECT *
    FROM hpd_building_summary
    WHERE latitude  BETWEEN :south AND :north
      AND longitude BETWEEN :west  AND :east
      AND latitude IS NOT NULL
""")


@router.get("/map/clusters")
@limiter.limit("120/minute")
async def get_hpd_clusters(
    request: Request,
    west: float = Query(...),
    south: float = Query(...),
    east: float = Query(...),
    north: float = Query(...),
    zoom: float = Query(...),
    db: AsyncSession = Depends(get_db),
):
    cache_key = f"hpd_clusters:{west:.4f},{south:.4f},{east:.4f},{north:.4f},{zoom:.2f}"
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
        tier = _hpd_risk_tier(r.class_a_violations, r.class_b_violations, r.open_violations)
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [r.longitude, r.latitude]},
            "properties": {
                "bin":                  r.bin,
                "address":              r.address,
                "borough":              r.borough,
                "zip_code":             r.zip_code,
                "nta_code":             r.nta_code,
                # Use DOB-compatible property names so Map.tsx click handler
                # and cluster coloring work without modification.
                "total_complaints":     r.total_violations,
                "open_complaints":      r.open_violations,
                "priority_a_complaints": r.class_a_violations,
                "risk_level":           HPD_TIER_TO_RISK_LEVEL[tier],
                # HPD-specific extras (read by HpdBuildingSidebar)
                "hpd_risk_tier":        tier,
                "class_a_violations":   r.class_a_violations,
                "class_b_violations":   r.class_b_violations,
                "rent_impairing_count": r.rent_impairing_count,
                "latest_violation_date": str(r.latest_violation_date) if r.latest_violation_date else None,
            },
        })

    geojson = {"type": "FeatureCollection", "features": features}
    cache_set(cache_key, geojson, ttl_seconds=1800)
    return JSONResponse(content=geojson)


# ── search ────────────────────────────────────────────────────────────────────

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


@router.get("/building/search", response_model=list[HpdBuildingSummaryResponse])
@limiter.limit("30/minute")
async def search_hpd_buildings(
    request: Request,
    q: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
):
    cache_key = f"hpd_search:{q.strip().lower()}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    patterns = _search_patterns(q.strip())
    like_params = {f"like_{i}": p for i, p in enumerate(patterns)}
    like_clauses = " OR ".join(
        f"hs.address ILIKE :like_{i}"
        for i in range(len(patterns))
    )

    rows = await db.execute(
        text(f"""
            SELECT hs.*
            FROM hpd_building_summary hs
            WHERE hs.bin = :q
               OR {like_clauses}
            ORDER BY hs.total_violations DESC
            LIMIT 20
        """),
        {"q": q.strip(), **like_params},
    )
    results = [_row_to_summary(r) for r in rows.all()]
    cache_set(cache_key, results, ttl_seconds=600)
    return results


# ── building detail ───────────────────────────────────────────────────────────

def _row_to_summary(r) -> HpdBuildingSummaryResponse:
    tier = _hpd_risk_tier(r.class_a_violations, r.class_b_violations, r.open_violations)
    return HpdBuildingSummaryResponse(
        bin=r.bin,
        address=r.address,
        zip_code=r.zip_code,
        borough=r.borough,
        latitude=float(r.latitude) if r.latitude is not None else None,
        longitude=float(r.longitude) if r.longitude is not None else None,
        nta_code=getattr(r, "nta_code", None),
        nta_name=getattr(r, "nta_name", None),
        total_violations=r.total_violations,
        open_violations=r.open_violations,
        class_a_violations=r.class_a_violations,
        class_b_violations=r.class_b_violations,
        rent_impairing_count=r.rent_impairing_count,
        latest_violation_date=r.latest_violation_date,
        hpd_risk_tier=tier,
        violations_density_pct=getattr(r, "violations_density_pct", None),
    )


@router.get("/building/{bin}", response_model=HpdBuildingDetailResponse)
async def get_hpd_building(
    bin: str,
    page: int = Query(1, ge=1),
    violation_class: str | None = None,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    summary_row = await db.execute(
        text("SELECT * FROM hpd_building_summary WHERE bin = :bin"),
        {"bin": bin},
    )
    summary = summary_row.first()
    if not summary:
        raise HTTPException(status_code=404, detail="No HPD violations found for this building")

    # Filtered count
    count_q = "SELECT COUNT(*) FROM hpd_violations WHERE bin = :bin"
    params: dict = {"bin": bin}
    if violation_class:
        count_q += " AND violation_class = :violation_class"
        params["violation_class"] = violation_class.upper()
    if status:
        count_q += " AND violation_status = :status"
        params["status"] = status.capitalize()

    total_count = (await db.execute(text(count_q), params)).scalar()

    # Paginated violations with order number category lookup
    offset = (page - 1) * PAGE_SIZE
    violations_q = """
        SELECT
            v.violation_id, v.bin, v.apartment, v.violation_class,
            v.nov_issued_date, v.current_status, v.current_status_date,
            v.violation_status, v.rent_impairing, v.nov_description,
            v.order_number, o.category AS order_category,
            REGEXP_REPLACE(o.short_description, '^\\d+\\s*-\\s*', '') AS order_short_description,
            v.inspection_date, v.approved_date, v.certified_date
        FROM hpd_violations v
        LEFT JOIN hpd_order_numbers o ON v.order_number = o.order_number
        WHERE v.bin = :bin
    """
    if violation_class:
        violations_q += " AND v.violation_class = :violation_class"
    if status:
        violations_q += " AND v.violation_status = :status"
    violations_q += " ORDER BY v.nov_issued_date DESC NULLS LAST LIMIT :limit OFFSET :offset"
    params["limit"] = PAGE_SIZE
    params["offset"] = offset

    rows = await db.execute(text(violations_q), params)
    violations = [HpdViolationResponse(**dict(r._mapping)) for r in rows]

    return HpdBuildingDetailResponse(
        **_row_to_summary(summary).__dict__,
        violations=violations,
        total_count=total_count,
        page=page,
        page_size=PAGE_SIZE,
    )


@router.get("/building/{bin}/timeline", response_model=list[TimelinePoint])
async def get_hpd_timeline(bin: str, db: AsyncSession = Depends(get_db)):
    cache_key = f"hpd_timeline:{bin}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    rows = await db.execute(
        text("""
            SELECT TO_CHAR(date_trunc('month', nov_issued_date), 'YYYY-MM') AS month,
                   COUNT(*) AS count
            FROM hpd_violations
            WHERE bin = :bin AND nov_issued_date IS NOT NULL
            GROUP BY 1
            ORDER BY 1
        """),
        {"bin": bin},
    )
    result = [TimelinePoint(month=r.month, count=r.count) for r in rows]
    cache_set(cache_key, result)
    return result


@router.get("/building/{bin}/breakdown", response_model=list[ViolationClassBreakdownItem])
async def get_hpd_breakdown(bin: str, db: AsyncSession = Depends(get_db)):
    cache_key = f"hpd_breakdown:{bin}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    rows = await db.execute(
        text("""
            SELECT
                v.violation_class,
                o.category,
                COUNT(*)                                              AS count,
                COUNT(*) FILTER (WHERE v.violation_status = 'Open')  AS open_count
            FROM hpd_violations v
            LEFT JOIN hpd_order_numbers o ON v.order_number = o.order_number
            WHERE v.bin = :bin AND v.violation_class IS NOT NULL
            GROUP BY v.violation_class, o.category
            ORDER BY count DESC
        """),
        {"bin": bin},
    )
    result = [
        ViolationClassBreakdownItem(
            violation_class=r.violation_class,
            category=r.category,
            count=r.count,
            open_count=r.open_count,
        )
        for r in rows
    ]
    cache_set(cache_key, result)
    return result
