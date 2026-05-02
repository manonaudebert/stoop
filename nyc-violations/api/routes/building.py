import re
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from database import get_db
from schemas import BuildingSummaryResponse, BuildingDetailResponse, ComplaintResponse, TimelinePoint, CategoryBreakdownItem, NeighborhoodResponse
from services.scoring import compute_score
from cache import cache_get, cache_set

router = APIRouter(prefix="/building", tags=["building"])

PAGE_SIZE = 50

SCORING_QUERY = """
    SELECT COALESCE(cc.priority, 'C') AS priority, c.date_entered
    FROM complaints c
    LEFT JOIN complaint_categories cc ON c.complaint_category = cc.code
    WHERE c.bin = :bin
"""

BATCH_SCORING_QUERY = """
    SELECT c.bin, COALESCE(cc.priority, 'C') AS priority, c.date_entered
    FROM complaints c
    LEFT JOIN complaint_categories cc ON c.complaint_category = cc.code
    WHERE c.bin = ANY(:bins)
"""


async def _score_building(bin: str, db: AsyncSession):
    rows = await db.execute(text(SCORING_QUERY), {"bin": bin})
    return compute_score([{"priority": r.priority, "date_entered": r.date_entered} for r in rows])


async def _score_buildings_batch(bins: list[str], db: AsyncSession) -> dict[str, object]:
    """Returns {bin: ScoreResult} for all bins in one query."""
    rows = await db.execute(text(BATCH_SCORING_QUERY), {"bins": bins})
    by_bin: dict[str, list[dict]] = {b: [] for b in bins}
    for r in rows:
        by_bin[r.bin].append({"priority": r.priority, "date_entered": r.date_entered})
    return {bin: compute_score(complaints) for bin, complaints in by_bin.items()}


def _summary_row_to_response(row, score_result) -> BuildingSummaryResponse:
    d = dict(row._mapping)
    d["score"] = score_result.score
    return BuildingSummaryResponse(**d)


def _complaint_row_to_response(row) -> ComplaintResponse:
    return ComplaintResponse(**dict(row._mapping))


LEADERBOARD_LIMIT = 100
LEADERBOARD_QUERY = """
    SELECT bin, address, zip_code, borough, latitude, longitude,
           total_complaints, open_complaints, closed_complaints,
           priority_a_complaints, priority_ab_complaints,
           first_complaint_date, latest_complaint_date,
           score_numeric AS score
    FROM building_summary
    WHERE total_complaints > 0 {borough_clause}
    ORDER BY total_complaints DESC
    LIMIT {limit}
"""


@router.get("/leaderboard", response_model=list[BuildingSummaryResponse])
async def get_leaderboard(
    borough: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    cache_key = f"leaderboard:{borough or 'all'}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    clause = "AND UPPER(borough) = UPPER(:borough)" if borough else ""
    params: dict = {"borough": borough} if borough else {}
    rows = await db.execute(
        text(LEADERBOARD_QUERY.format(borough_clause=clause, limit=LEADERBOARD_LIMIT)),
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
async def search_buildings(
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

    bins = [str(r.bin) for r in summary_rows]
    scores = await _score_buildings_batch(bins, db)

    results = [_summary_row_to_response(r, scores[r.bin]) for r in summary_rows]
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
    # Summary row + score (runs in parallel via two awaits — both are fast)
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
        raise HTTPException(status_code=404, detail="Building not found")

    score_result = await _score_building(bin, db)

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

    d = dict(summary._mapping)
    d["score"] = score_result.score

    from schemas import ScoreDetail, PriorityTierDetail
    score_detail = ScoreDetail(
        score=score_result.score,
        by_priority={
            p: PriorityTierDetail(
                count=tier.count,
                weighted_deduction=tier.weighted_deduction,
            )
            for p, tier in score_result.by_priority.items()
        },
        by_recency=score_result.by_recency,
    )

    return BuildingDetailResponse(
        **d,
        score_detail=score_detail,
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
async def get_breakdown(bin: str, db: AsyncSession = Depends(get_db)):
    cache_key = f"breakdown:{bin}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    rows = await db.execute(
        text("""
            SELECT c.complaint_category AS category,
                   cc.description,
                   cc.priority,
                   COUNT(*) AS count
            FROM complaints c
            LEFT JOIN complaint_categories cc ON c.complaint_category = cc.code
            WHERE c.bin = :bin
            GROUP BY 1, 2, 3
            ORDER BY count DESC
        """),
        {"bin": bin},
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

    # Building's NTA info + stored neighborhood_percentile
    bldg_row = await db.execute(
        text("""
            SELECT b.nta_code, b.nta_name, b.nta_type,
                   bs.score_numeric AS score, bs.neighborhood_percentile
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
        text("SELECT building_count, avg_score, median_score, p25_score, p75_score, nta_type FROM nta_stats WHERE nta_code = :nta_code"),
        {"nta_code": nta_code},
    )
    stats = stats_row.first()
    if not stats:
        raise HTTPException(status_code=404, detail="No NTA stats for this building")

    nta_percentile = round(float(bldg.neighborhood_percentile), 1) if bldg.neighborhood_percentile is not None else None

    # Sample of peer scores for the dot-plot — residential peers only (nta_type = 0)
    sample_rows = await db.execute(
        text("""
            SELECT score_numeric AS score
            FROM building_summary
            WHERE nta_code = :nta_code
              AND nta_type = 0
              AND score_numeric IS NOT NULL
              AND bin != :bin
            ORDER BY RANDOM()
            LIMIT 200
        """),
        {"nta_code": nta_code, "bin": bin},
    )
    peer_scores = sorted(float(r.score) for r in sample_rows)

    result = NeighborhoodResponse(
        nta_code=nta_code,
        nta_name=nta_name,
        nta_type=int(stats.nta_type) if stats.nta_type is not None else None,
        building_count=int(stats.building_count),
        avg_score=float(stats.avg_score) if stats.avg_score is not None else None,
        median_score=float(stats.median_score) if stats.median_score is not None else None,
        p25_score=float(stats.p25_score) if stats.p25_score is not None else None,
        p75_score=float(stats.p75_score) if stats.p75_score is not None else None,
        nta_percentile=nta_percentile,
        peer_scores=peer_scores,
    )
    cache_set(cache_key, result, ttl_seconds=3600)
    return result
