import re
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from database import get_db
from limiter import limiter
from schemas import BuildingSummaryResponse, BuildingDetailResponse, ComplaintResponse, TimelinePoint, CategoryBreakdownItem, NeighborhoodResponse
from cache import cache_get, cache_set

router = APIRouter(prefix="/building", tags=["building"])

PAGE_SIZE = 50


def _complaint_row_to_response(row) -> ComplaintResponse:
    return ComplaintResponse(**dict(row._mapping))


LEADERBOARD_LIMIT = 100
LEADERBOARD_RECENT_QUERY = """
    SELECT bin, address, zip_code, borough, latitude, longitude,
           total_complaints, open_complaints, closed_complaints,
           priority_a_complaints, priority_ab_complaints, priority_ab_2yr,
           open_priority_a_complaints, open_priority_b_complaints,
           first_complaint_date, latest_complaint_date,
           recent_complaint_count, prior_complaint_count,
           trend_direction, risk_level, nta_code, nta_name,
           normalized_percentile
    FROM building_summary
    WHERE recent_complaint_count > 0
      AND total_complaints >= 10
      AND nta_type = 0 {borough_clause}
    ORDER BY recent_complaint_count DESC,
             priority_ab_2yr DESC
    LIMIT {limit}
"""


@router.get("/leaderboard-recent", response_model=list[BuildingSummaryResponse])
async def get_leaderboard_recent(
    borough: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    cache_key = f"leaderboard-recent:{borough or 'all'}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    clause = "AND UPPER(borough) = UPPER(:borough)" if borough else ""
    params: dict = {"borough": borough} if borough else {}
    rows = await db.execute(
        text(LEADERBOARD_RECENT_QUERY.format(borough_clause=clause, limit=LEADERBOARD_LIMIT)),
        params,
    )
    result = [BuildingSummaryResponse(**dict(r._mapping)) for r in rows]
    cache_set(cache_key, result, ttl_seconds=86400)
    return result


# Ordered long-form first so "WEST" is checked before "W"
_DIRECTION_EXPANSIONS = [
    (r"\bWEST\b",  "W"),
    (r"\bEAST\b",  "E"),
    (r"\bNORTH\b", "N"),
    (r"\bSOUTH\b", "S"),
    (r"\bW\b",     "WEST"),
    (r"\bE\b",     "EAST"),
    (r"\bN\b",     "NORTH"),
    (r"\bS\b",     "SOUTH"),
]

def _normalize(s: str) -> str:
    """Uppercase and strip ordinal suffixes so '81st' matches '81'."""
    s = s.upper().strip()
    return re.sub(r'\b(\d+)(ST|ND|RD|TH)\b', r'\1', s)

def _search_patterns(query: str) -> list[str]:
    """Return unique ILIKE patterns covering ordinal stripping and direction variants."""
    patterns: set[str] = {query}          # original as typed
    normalized = _normalize(query)
    patterns.add(normalized)              # e.g. "WEST 81 ST"
    # Direction variant of the normalized form
    for pattern, replacement in _DIRECTION_EXPANSIONS:
        variant = re.sub(pattern, replacement, normalized)
        if variant != normalized:
            patterns.add(variant)         # e.g. "W 81 ST"
            break
    return [f"%{p}%" for p in patterns]


@router.get("/search", response_model=list[BuildingSummaryResponse])
@limiter.limit("30/minute")
async def search_buildings(
    request: Request,
    q: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
):
    cache_key = f"search:{q.strip().lower()}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    q = q.strip()
    patterns = _search_patterns(q)
    like_params = {f"like_{i}": p for i, p in enumerate(patterns)}
    like_clauses = " OR ".join(f"bs.address ILIKE :like_{i}" for i in range(len(patterns)))

    rows = await db.execute(
        text(f"""
            SELECT bs.*
            FROM building_summary bs
            WHERE bs.bin = :q
               OR {like_clauses}
            ORDER BY bs.total_complaints DESC
            LIMIT 20
        """),
        {"q": q, **like_params},
    )
    summary_rows = rows.all()

    if not summary_rows:
        cache_set(cache_key, [], ttl_seconds=600)
        return []

    results = [BuildingSummaryResponse(**dict(r._mapping)) for r in summary_rows]
    cache_set(cache_key, results, ttl_seconds=600)
    return results


@router.get("/{bin}", response_model=BuildingDetailResponse)
async def get_building(
    bin: str,
    page: int = Query(1, ge=1),
    status: str | None = None,
    category: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    summary_row = await db.execute(
        text("""
            SELECT bs.*, b.construction_year
            FROM building_summary bs
            LEFT JOIN buildings b ON bs.bin = b.bin
            WHERE bs.bin = :bin
        """),
        {"bin": bin},
    )
    summary = summary_row.first()
    if not summary:
        # Building not in building_summary (no DOB complaints) — check buildings table.
        # Return a zero-complaint stub so the frontend can render an empty state
        # instead of a generic 404 (common for buildings that only have HPD data).
        fallback_row = await db.execute(
            text("""
                SELECT
                    b.bin,
                    MAX(v.house_number || ' ' || v.street_name) AS address,
                    MAX(v.zip_code)     AS zip_code,
                    b.borough,
                    b.latitude,
                    b.longitude,
                    b.nta_code,
                    b.nta_name,
                    b.construction_year
                FROM buildings b
                LEFT JOIN hpd_violations v ON b.bin = v.bin
                WHERE b.bin = :bin
                GROUP BY b.bin, b.borough, b.latitude, b.longitude,
                         b.nta_code, b.nta_name, b.construction_year
            """),
            {"bin": bin},
        )
        fallback = fallback_row.first()
        if not fallback:
            raise HTTPException(status_code=404, detail="Building not found")
        fb = dict(fallback._mapping)
        return BuildingDetailResponse(
            bin=fb["bin"],
            address=fb.get("address"),
            zip_code=fb.get("zip_code"),
            borough=fb.get("borough"),
            latitude=fb.get("latitude"),
            longitude=fb.get("longitude"),
            nta_code=fb.get("nta_code"),
            nta_name=fb.get("nta_name"),
            construction_year=fb.get("construction_year"),
            total_complaints=0,
            open_complaints=0,
            closed_complaints=0,
            priority_a_complaints=0,
            priority_ab_complaints=0,
            first_complaint_date=None,
            latest_complaint_date=None,
            complaints=[],
            total_count=0,
            page=page,
            page_size=PAGE_SIZE,
        )

    # Complaints count (with optional filters)
    count_q = """
        SELECT COUNT(*) FROM complaints c
        LEFT JOIN complaint_categories cc ON c.complaint_category = cc.code
        WHERE c.bin = :bin
    """
    params: dict = {"bin": bin}
    if status:
        count_q += " AND c.status = :status"
        params["status"] = status.upper()
    if category:
        count_q += " AND c.complaint_category = :category"
        params["category"] = category

    total_count = (await db.execute(text(count_q), params)).scalar()

    # Paginated complaints
    offset = (page - 1) * PAGE_SIZE
    complaints_q = """
        SELECT c.id, c.complaint_number, c.status, c.date_entered,
               c.address, c.zip_code, c.bin, c.community_board,
               c.complaint_category, cc.description AS category_description,
               cc.priority AS category_priority,
               c.unit, c.disposition_date, c.disposition_code,
               dc.description AS disposition_description,
               c.inspection_date, c.borough
        FROM complaints c
        LEFT JOIN complaint_categories cc ON c.complaint_category = cc.code
        LEFT JOIN complaint_disposition_codes dc ON c.disposition_code = dc.code
        WHERE c.bin = :bin
    """
    if status:
        complaints_q += " AND c.status = :status"
    if category:
        complaints_q += " AND c.complaint_category = :category"
    complaints_q += " ORDER BY c.date_entered DESC NULLS LAST LIMIT :limit OFFSET :offset"
    params["limit"] = PAGE_SIZE
    params["offset"] = offset

    rows = await db.execute(text(complaints_q), params)
    complaints = [_complaint_row_to_response(r) for r in rows]

    return BuildingDetailResponse(
        **dict(summary._mapping),
        complaints=complaints,
        total_count=total_count,
        page=page,
        page_size=PAGE_SIZE,
    )


@router.get("/{bin}/timeline", response_model=list[TimelinePoint])
async def get_timeline(bin: str, db: AsyncSession = Depends(get_db)):
    cache_key = f"timeline:{bin}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    rows = await db.execute(
        text("""
            SELECT TO_CHAR(date_trunc('month', date_entered), 'YYYY-MM') AS month,
                   COUNT(*) AS count
            FROM complaints
            WHERE bin = :bin AND date_entered IS NOT NULL
            GROUP BY 1
            ORDER BY 1
        """),
        {"bin": bin},
    )
    result = [TimelinePoint(month=r.month, count=r.count) for r in rows]
    cache_set(cache_key, result)
    return result


@router.get("/{bin}/breakdown", response_model=list[CategoryBreakdownItem])
async def get_breakdown(bin: str, years: int | None = Query(None, ge=1, le=100), db: AsyncSession = Depends(get_db)):
    cache_key = f"breakdown:{bin}:{years or 'all'}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    date_filter = "AND c.date_entered >= NOW() - (:years * INTERVAL '1 year')" if years else ""
    rows = await db.execute(
        text(f"""
            SELECT c.complaint_category AS category,
                   cc.description,
                   cc.priority,
                   COUNT(*) AS count
            FROM complaints c
            LEFT JOIN complaint_categories cc ON c.complaint_category = cc.code
            WHERE c.bin = :bin {date_filter}
            GROUP BY 1, 2, 3
            ORDER BY count DESC
        """),
        {"bin": bin, "years": years},
    )
    result = [
        CategoryBreakdownItem(
            category=r.category or "Unknown",
            description=r.description,
            priority=r.priority,
            count=r.count,
        )
        for r in rows
    ]
    cache_set(cache_key, result)
    return result


@router.get("/{bin}/neighborhood", response_model=NeighborhoodResponse)
async def get_neighborhood(bin: str, db: AsyncSession = Depends(get_db)):
    cache_key = f"neighborhood:{bin}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    # Building's NTA info + normalized_percentile
    bldg_row = await db.execute(
        text("""
            SELECT b.nta_code, b.nta_name, b.nta_type,
                   bs.normalized_percentile
            FROM buildings b
            LEFT JOIN building_summary bs ON b.bin = bs.bin
            WHERE b.bin = :bin
        """),
        {"bin": bin},
    )
    bldg = bldg_row.first()
    if not bldg or not bldg.nta_code:
        raise HTTPException(status_code=404, detail="NTA not found for this building")

    nta_code = bldg.nta_code
    nta_name = bldg.nta_name

    # NTA-level stats from the materialized view
    stats_row = await db.execute(
        text("SELECT building_count, nta_type, median_serious_rate FROM nta_stats WHERE nta_code = :nta_code"),
        {"nta_code": nta_code},
    )
    stats = stats_row.first()
    if not stats:
        raise HTTPException(status_code=404, detail="No NTA stats for this building")

    nta_percentile = round(float(bldg.normalized_percentile), 1) if bldg.normalized_percentile is not None else None

    result = NeighborhoodResponse(
        nta_code=nta_code,
        nta_name=nta_name,
        nta_type=int(stats.nta_type) if stats.nta_type is not None else None,
        building_count=int(stats.building_count),
        nta_percentile=nta_percentile,
        median_serious_rate=float(stats.median_serious_rate) if stats.median_serious_rate is not None else None,
    )
    cache_set(cache_key, result, ttl_seconds=3600)
    return result
