from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from database import get_db
from limiter import limiter
from cache import cache_get, cache_set
from routes.map import RISK_COLORS
from routes.hpd_complaints import _search_patterns, _normalize
from schemas import (
    SfBuildingSummaryResponse,
    SfBuildingDetailResponse,
    Sf311ComplaintResponse,
    SfNovResponse,
    SfComplaintBreakdownItem,
    SfViolationBreakdownItem,
    TimelinePoint,
)

router = APIRouter(prefix="/sf", tags=["sf"])

PAGE_SIZE         = 50
CLUSTER_MAX_ZOOM  = 13
# Citywide (clustered) sample cap, per SF analysis neighborhood. SF has 41
# neighborhoods, so this multiplies out to the total point budget shipped to the
# browser at low zoom (41 × limit). It was 2500 — the value NYC uses per BOROUGH
# — but NYC only has 5 boroughs, so the same cap gave SF ~43k points / ~19.6 MB,
# 3.5× NYC's ~12.5k / 5.6 MB. That mattered for more than parse time: 19.6 MB
# EXCEEDED the CDN's max cacheable response size, so every SF map load was a
# cache MISS — a full origin round-trip + 19.6 MB transfer — while NYC (under the
# limit) served from the edge. 300 puts the citywide payload at ~10k points /
# ~4.2 MB (measured), safely under NYC's proven-cacheable 5.6 MB, so SF caches
# too. Only affects the zoomed-out clustered view; at zoom ≥ CLUSTER_MAX_ZOOM the
# bbox query returns every parcel in view, uncapped.
PER_NEIGHBORHOOD_LIMIT = 300
LEADERBOARD_LIMIT = 100

# Unified clusters: FULL OUTER JOIN complaints + violations per parcel.
# The complaints/violations column projections and the join are identical for the
# zoomed-in (bbox) and zoomed-out (citywide) queries, so they're factored here.
_C_SELECT = """
    SELECT mapblklot, address, neighborhood, latitude, longitude,
           total_complaints, recent_complaint_count, heat_complaints,
           complaints_density_pct, risk_level AS complaints_risk_level,
           latest_complaint_date
    FROM sf_housing_complaints_summary
"""
_V_SELECT = """
    SELECT mapblklot, address, neighborhood, latitude, longitude,
           total_violations, open_violations,
           violations_density_pct, risk_level AS violations_risk_level
    FROM sf_violations_summary
"""
_UNIFIED_PROJECTION = """
    COALESCE(c.mapblklot, v.mapblklot)       AS mapblklot,
    COALESCE(c.address,   v.address)         AS address,
    COALESCE(c.neighborhood, v.neighborhood) AS neighborhood,
    COALESCE(c.latitude,  v.latitude)        AS latitude,
    COALESCE(c.longitude, v.longitude)       AS longitude,
    COALESCE(c.total_complaints, 0)          AS total_complaints,
    COALESCE(c.recent_complaint_count, 0)    AS recent_complaint_count,
    COALESCE(c.heat_complaints, 0)           AS heat_complaints,
    c.complaints_density_pct,
    c.complaints_risk_level,
    c.latest_complaint_date,
    COALESCE(v.total_violations, 0)          AS total_violations,
    COALESCE(v.open_violations, 0)           AS open_violations,
    v.violations_density_pct,
    v.violations_risk_level
"""

# Zoomed in: single bbox query, no per-neighborhood cap — viewport is small.
_UNIFIED_BBOX_SQL = text(f"""
    WITH c AS ({_C_SELECT}
        WHERE latitude BETWEEN :south AND :north
          AND longitude BETWEEN :west  AND :east
    ),
    v AS ({_V_SELECT}
        WHERE latitude BETWEEN :south AND :north
          AND longitude BETWEEN :west  AND :east
    )
    SELECT {_UNIFIED_PROJECTION}
    FROM c FULL OUTER JOIN v ON c.mapblklot = v.mapblklot
""")

# Zoomed out: one deterministic per-neighborhood sample for the whole city in a
# SINGLE query. ROW_NUMBER() over hashtext(mapblklot) gives a stable, spatially
# representative scramble per neighborhood (same idea as the NYC borough sample),
# capped at :limit each. This replaces the previous loop that issued one query
# per SF neighborhood (~40 round-trips) with a single scan on cache miss.
_UNIFIED_CITYWIDE_SQL = text(f"""
    WITH c AS ({_C_SELECT} WHERE latitude IS NOT NULL),
    v AS ({_V_SELECT} WHERE latitude IS NOT NULL),
    joined AS (
        SELECT {_UNIFIED_PROJECTION}
        FROM c FULL OUTER JOIN v ON c.mapblklot = v.mapblklot
    ),
    ranked AS (
        SELECT *,
               ROW_NUMBER() OVER (
                   PARTITION BY neighborhood
                   ORDER BY hashtext(mapblklot)
               ) AS rn
        FROM joined
    )
    SELECT * FROM ranked WHERE rn <= :limit
""")


def _safe_float(v) -> float | None:
    """Return None for NaN/Inf so JSON serialization never fails."""
    if v is None:
        return None
    try:
        f = float(v)
        return None if (f != f) else f  # f != f is True only for NaN
    except (TypeError, ValueError):
        return None


def _active_risk(complaints_risk: str | None, violations_risk: str | None) -> str:
    """Pick the more severe risk level to color the map dot by default."""
    order = ["Very high", "High", "Moderate", "Low", "Very low"]
    for level in order:
        if complaints_risk == level or violations_risk == level:
            return level
    return "Very low"


# ── map clusters ────────────────────────────────────────────────────────────

CITYWIDE_CACHE_KEY = "sf_clusters:citywide"


def _rows_to_features(all_rows) -> list[dict]:
    """Turn unified-projection rows into GeoJSON point features, skipping any
    row without usable coordinates."""
    features = []
    for r in all_rows:
        cr = r.complaints_risk_level
        vr = r.violations_risk_level
        active_risk = _active_risk(cr, vr)
        lat = _safe_float(r.latitude)
        lon = _safe_float(r.longitude)
        if lat is None or lon is None:
            continue
        features.append({
            "type": "Feature",
            # 5 decimals ≈ 1m — ample for a map dot, and ~12 fewer chars per
            # ordinate than raw float repr, which trims megabytes over ~40k points.
            "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
            "properties": {
                "mapblklot":             r.mapblklot,
                "address":               r.address,
                "neighborhood":          r.neighborhood,
                # Complaints domain
                "complaints_present":    1 if cr else 0,
                "complaints_risk_level": cr,
                "total_complaints":      r.total_complaints,
                "recent_complaints":     r.recent_complaint_count,
                "heat_complaints":       r.heat_complaints,
                # Violations domain
                "violations_present":    1 if vr else 0,
                "violations_risk_level": vr,
                "total_violations":      r.total_violations,
                "open_violations":       r.open_violations,
                # Composite risk (default dot coloring). risk_color is intentionally
                # omitted — the map paints from risk_level via Mapbox expressions and
                # never reads a precomputed color, so shipping it was dead weight.
                "risk_level":            active_risk,
            },
        })
    return features


async def _load_citywide(db: AsyncSession) -> dict:
    """Build the citywide (clustered) FeatureCollection: one deterministic
    per-neighborhood sample for the whole city. Shared by the route and the
    startup cache warmer so both produce byte-identical payloads."""
    result = await db.execute(_UNIFIED_CITYWIDE_SQL, {"limit": PER_NEIGHBORHOOD_LIMIT})
    return {"type": "FeatureCollection", "features": _rows_to_features(result.all())}


async def warm_citywide_cache() -> None:
    """Prime the citywide cluster cache so the first map load — and every CDN
    revalidation after the in-process cache is lost on restart — is served
    without paying for the heavy full-outer-join + per-neighborhood window sort.
    Called at API startup; any failure is swallowed so it never blocks boot."""
    if cache_get(CITYWIDE_CACHE_KEY):
        return
    from database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        geojson = await _load_citywide(db)
    cache_set(CITYWIDE_CACHE_KEY, geojson, ttl_seconds=86400)


@router.get("/map/clusters")
@limiter.limit("120/minute")
async def get_sf_clusters(
    request: Request,
    west: float = Query(...),
    south: float = Query(...),
    east: float = Query(...),
    north: float = Query(...),
    zoom: float = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """GeoJSON FeatureCollection of SF parcels with both complaints and violations
    data. One point per parcel; each feature carries both risk levels so the
    frontend can paint by either domain without a second fetch."""
    if zoom >= CLUSTER_MAX_ZOOM:
        cache_key = f"sf_clusters:{west:.4f},{south:.4f},{east:.4f},{north:.4f}"
    else:
        cache_key = CITYWIDE_CACHE_KEY

    cached = cache_get(cache_key)
    if cached:
        return JSONResponse(content=cached)

    if zoom >= CLUSTER_MAX_ZOOM:
        bbox = {"south": south, "north": north, "west": west, "east": east}
        result = await db.execute(_UNIFIED_BBOX_SQL, bbox)
        geojson = {"type": "FeatureCollection", "features": _rows_to_features(result.all())}
    else:
        # Deterministic per-neighborhood sample, whole city, in one query.
        geojson = await _load_citywide(db)

    cache_set(cache_key, geojson, ttl_seconds=86400)
    return JSONResponse(content=geojson)


# ── search (EAS-backed) ──────────────────────────────────────────────────────

# Both search paths (multi-pattern ILIKE, then trgm fallback) differ only in how
# `matches` is built; the DISTINCT-ON columns and the join to both summary views
# are identical, so they're factored out here.
_MATCH_COLS = """
        parcel_number AS mapblklot, address, latitude, longitude,
        nhood AS neighborhood, word_similarity(:q, address) AS sim
"""
_SEARCH_TAIL = """
    SELECT
        m.mapblklot, m.address, m.neighborhood, m.latitude, m.longitude,
        COALESCE(c.total_complaints, 0)       AS total_complaints,
        COALESCE(c.recent_complaint_count, 0) AS recent_complaint_count,
        COALESCE(c.prior_complaint_count, 0)  AS prior_complaint_count,
        c.trend_direction,
        COALESCE(c.heat_complaints, 0)        AS heat_complaints,
        COALESCE(c.lead_complaints, 0)        AS lead_complaints,
        COALESCE(c.pest_complaints, 0)        AS pest_complaints,
        c.latest_complaint_date,
        c.complaints_density_pct,
        c.risk_level                          AS complaints_risk_level,
        COALESCE(v.total_violations, 0)       AS total_violations,
        COALESCE(v.open_violations, 0)        AS open_violations,
        COALESCE(v.open_lead_violations, 0)   AS open_lead_violations,
        COALESCE(v.open_fire_violations, 0)   AS open_fire_violations,
        v.latest_violation_date,
        v.violations_density_pct,
        v.risk_level                          AS violations_risk_level
    FROM matches m
    LEFT JOIN sf_housing_complaints_summary c ON c.mapblklot = m.mapblklot
    LEFT JOIN sf_violations_summary         v ON v.mapblklot = m.mapblklot
    ORDER BY m.sim DESC, m.mapblklot
    LIMIT :limit
"""


@router.get("/building/search", response_model=list[SfBuildingSummaryResponse])
@limiter.limit("30/minute")
async def search_sf_buildings(
    request: Request,
    q: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
):
    """Search SF buildings via the EAS address corpus. Returns one result per
    parcel, joining to both summary views for stats."""
    q = q.strip()
    cache_key = f"sf_search:{q.lower()}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    # Reuse the NYC address normalization (ordinal stripping + N/S/E/W expansion)
    # so "3rd St" / "West" behave the same across cities. EAS addresses are
    # stored uppercase, and _normalize()/_search_patterns() uppercase too.
    norm_q   = _normalize(q)
    patterns = _search_patterns(q)                       # ['%PAT%', ...]
    like_params   = {f"like_{i}": p for i, p in enumerate(patterns)}
    ilike_clauses = " OR ".join(f"address ILIKE :like_{i}" for i in range(len(patterns)))

    rows = await db.execute(
        text(f"""
            WITH matches AS (
                SELECT DISTINCT ON (parcel_number)
                {_MATCH_COLS}
                FROM sf_addresses
                WHERE ({ilike_clauses})
                  AND parcel_number IS NOT NULL
                ORDER BY parcel_number, word_similarity(:q, address) DESC
            )
            {_SEARCH_TAIL}
        """),
        {"q": norm_q, "limit": 20, **like_params},
    )
    results = [_row_to_summary(r) for r in rows.all()]

    # Trgm fallback if ILIKE returned nothing
    if not results:
        rows2 = await db.execute(
            text(f"""
                WITH matches AS (
                    SELECT DISTINCT ON (parcel_number)
                    {_MATCH_COLS}
                    FROM sf_addresses
                    WHERE word_similarity(:q, address) > 0.15
                      AND parcel_number IS NOT NULL
                    ORDER BY parcel_number, word_similarity(:q, address) DESC
                )
                {_SEARCH_TAIL}
            """),
            {"q": norm_q, "limit": 10},
        )
        results = [_row_to_summary(r) for r in rows2.all()]

    cache_set(cache_key, results, ttl_seconds=3600)
    return results


def _row_to_summary(r) -> SfBuildingSummaryResponse:
    return SfBuildingSummaryResponse(
        mapblklot=r.mapblklot,
        address=getattr(r, "address", None),
        neighborhood=getattr(r, "neighborhood", None),
        latitude=_safe_float(r.latitude),
        longitude=_safe_float(r.longitude),
        total_complaints=getattr(r, "total_complaints", 0) or 0,
        recent_complaint_count=getattr(r, "recent_complaint_count", 0) or 0,
        prior_complaint_count=getattr(r, "prior_complaint_count", 0) or 0,
        trend_direction=getattr(r, "trend_direction", None),
        heat_complaints=getattr(r, "heat_complaints", 0) or 0,
        lead_complaints=getattr(r, "lead_complaints", 0) or 0,
        pest_complaints=getattr(r, "pest_complaints", 0) or 0,
        latest_complaint_date=getattr(r, "latest_complaint_date", None),
        complaints_density_pct=_safe_float(getattr(r, "complaints_density_pct", None)),
        complaints_risk_level=getattr(r, "complaints_risk_level", None),
        total_violations=getattr(r, "total_violations", 0) or 0,
        open_violations=getattr(r, "open_violations", 0) or 0,
        open_lead_violations=getattr(r, "open_lead_violations", 0) or 0,
        open_fire_violations=getattr(r, "open_fire_violations", 0) or 0,
        latest_violation_date=getattr(r, "latest_violation_date", None),
        violations_density_pct=_safe_float(getattr(r, "violations_density_pct", None)),
        violations_risk_level=getattr(r, "violations_risk_level", None),
    )


# ── leaderboard ──────────────────────────────────────────────────────────────

@router.get("/building/leaderboard", response_model=list[SfBuildingSummaryResponse])
async def get_sf_leaderboard(
    neighborhood: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Top SF parcels by recent 311 complaints (last 2 years), optionally filtered
    by neighborhood. Mirrors the HPD complaints leaderboard pattern."""
    cache_key = f"sf_leaderboard:{neighborhood or 'all'}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    nhood_clause = "AND neighborhood = :neighborhood" if neighborhood else ""
    params: dict = {"neighborhood": neighborhood} if neighborhood else {}

    rows = await db.execute(
        text(f"""
            SELECT
                c.mapblklot, c.address, c.neighborhood, c.latitude, c.longitude,
                c.total_complaints, c.recent_complaint_count, c.prior_complaint_count,
                c.trend_direction, c.heat_complaints, c.lead_complaints, c.pest_complaints,
                c.latest_complaint_date, c.complaints_density_pct,
                c.risk_level AS complaints_risk_level,
                COALESCE(v.total_violations, 0)     AS total_violations,
                COALESCE(v.open_violations, 0)      AS open_violations,
                COALESCE(v.open_lead_violations, 0) AS open_lead_violations,
                COALESCE(v.open_fire_violations, 0) AS open_fire_violations,
                v.latest_violation_date,
                v.violations_density_pct,
                v.risk_level AS violations_risk_level
            FROM sf_housing_complaints_summary c
            LEFT JOIN sf_violations_summary v ON v.mapblklot = c.mapblklot
            WHERE c.recent_complaint_count > 0
              AND c.total_complaints >= 5
              {nhood_clause}
            ORDER BY c.recent_complaint_count DESC
            LIMIT {LEADERBOARD_LIMIT}
        """),
        params,
    )
    result = [_row_to_summary(r) for r in rows.all()]
    cache_set(cache_key, result, ttl_seconds=86400)
    return result


# ── building detail ────────────────────────────────────────────────────────

@router.get("/building/{mapblklot}", response_model=SfBuildingDetailResponse)
async def get_sf_building(
    mapblklot: str,
    page: int = Query(1, ge=1),
    show: str | None = None,   # 'complaints' | 'violations'
    vst: str | None = None,    # violation status: 'Open' | 'Close'
    db: AsyncSession = Depends(get_db),
):
    # Summary from both views
    complaints_row = (await db.execute(
        text("SELECT * FROM sf_housing_complaints_summary WHERE mapblklot = :id"),
        {"id": mapblklot},
    )).first()
    violations_row = (await db.execute(
        text("SELECT * FROM sf_violations_summary WHERE mapblklot = :id"),
        {"id": mapblklot},
    )).first()

    # EAS resolves every SF address, so a parcel with zero complaints/violations
    # is a valid page (a clean building), not a 404. Fall back to the address
    # corpus for the header shell; only 404 if EAS has never heard of the parcel.
    if not complaints_row and not violations_row:
        eas_row = (await db.execute(
            text("""
                SELECT parcel_number AS mapblklot, address, nhood AS neighborhood,
                       latitude, longitude
                FROM sf_addresses
                WHERE parcel_number = :id
                ORDER BY address
                LIMIT 1
            """),
            {"id": mapblklot},
        )).first()
        if not eas_row:
            raise HTTPException(status_code=404, detail="No SF records found for this parcel")
        summary = _row_to_summary(eas_row)
        return SfBuildingDetailResponse(
            **summary.__dict__,
            complaints=[],
            violations=[],
            complaints_total_count=0,
            violations_total_count=0,
            page=1,
            page_size=PAGE_SIZE,
        )

    # Synthetic combined row for _row_to_summary
    class _Combined:
        def __init__(self, c, v):
            self.mapblklot              = mapblklot
            self.address                = (c and c.address) or (v and v.address)
            self.neighborhood           = (c and c.neighborhood) or (v and v.neighborhood)
            self.latitude               = (c and c.latitude) or (v and v.latitude)
            self.longitude              = (c and c.longitude) or (v and v.longitude)
            self.total_complaints       = c.total_complaints if c else 0
            self.recent_complaint_count = c.recent_complaint_count if c else 0
            self.prior_complaint_count  = c.prior_complaint_count if c else 0
            self.trend_direction        = c.trend_direction if c else None
            self.heat_complaints        = c.heat_complaints if c else 0
            self.lead_complaints        = c.lead_complaints if c else 0
            self.pest_complaints        = c.pest_complaints if c else 0
            self.latest_complaint_date  = c.latest_complaint_date if c else None
            self.complaints_density_pct = c.complaints_density_pct if c else None
            self.complaints_risk_level  = c.risk_level if c else None
            self.total_violations       = v.total_violations if v else 0
            self.open_violations        = v.open_violations if v else 0
            self.open_lead_violations   = v.open_lead_violations if v else 0
            self.open_fire_violations   = v.open_fire_violations if v else 0
            self.latest_violation_date  = v.latest_violation_date if v else None
            self.violations_density_pct = v.violations_density_pct if v else None
            self.violations_risk_level  = v.risk_level if v else None

    combined = _Combined(complaints_row, violations_row)
    summary = _row_to_summary(combined)

    # Paginated raw records
    offset = (page - 1) * PAGE_SIZE
    complaints: list[Sf311ComplaintResponse] = []
    complaints_total = 0
    violations: list[SfNovResponse] = []
    violations_total = 0

    if show == "complaints":
        complaints_total = (await db.execute(
            text("SELECT COUNT(*) FROM sf_311_housing WHERE mapblklot = :id"),
            {"id": mapblklot},
        )).scalar() or 0
        rows = await db.execute(
            text("""
                SELECT service_request_id, service_name, service_subtype,
                       address, requested_datetime::text, status_description
                FROM sf_311_housing
                WHERE mapblklot = :id
                ORDER BY requested_datetime DESC NULLS LAST
                LIMIT :limit OFFSET :offset
            """),
            {"id": mapblklot, "limit": PAGE_SIZE, "offset": offset},
        )
        complaints = [Sf311ComplaintResponse(**dict(r._mapping)) for r in rows.all()]

    elif show == "violations":
        # Status is a clean binary in source ('active' / 'not active'), matching
        # how sf_violations_summary.open_violations is defined.
        status_clause = ""
        if vst == "Open":
            status_clause = "AND LOWER(status) = 'active'"
        elif vst == "Close":
            status_clause = "AND LOWER(status) <> 'active'"

        violations_total = (await db.execute(
            text(f"SELECT COUNT(*) FROM sf_dbi_nov WHERE mapblklot = :id {status_clause}"),
            {"id": mapblklot},
        )).scalar() or 0
        rows = await db.execute(
            text(f"""
                SELECT row_id, mapblklot, status, nov_category_description,
                       item, nov_item_description,
                       date_filed, neighborhood, location_lat, location_lon
                FROM sf_dbi_nov
                WHERE mapblklot = :id {status_clause}
                ORDER BY date_filed DESC NULLS LAST
                LIMIT :limit OFFSET :offset
            """),
            {"id": mapblklot, "limit": PAGE_SIZE, "offset": offset},
        )
        violations = [
            SfNovResponse(**{
                **dict(r._mapping),
                "location_lat": _safe_float(r._mapping.get("location_lat")),
                "location_lon": _safe_float(r._mapping.get("location_lon")),
            })
            for r in rows.all()
        ]

    return SfBuildingDetailResponse(
        **summary.__dict__,
        complaints=complaints,
        violations=violations,
        complaints_total_count=complaints_total,
        violations_total_count=violations_total,
        page=page,
        page_size=PAGE_SIZE,
    )


# ── timelines ────────────────────────────────────────────────────────────────

@router.get("/building/{mapblklot}/complaints-timeline", response_model=list[TimelinePoint])
async def get_sf_complaints_timeline(mapblklot: str, db: AsyncSession = Depends(get_db)):
    cache_key = f"sf_complaint_timeline:{mapblklot}"
    cached = cache_get(cache_key)
    if cached:
        return cached
    rows = await db.execute(
        text("""
            SELECT TO_CHAR(date_trunc('month', requested_datetime), 'YYYY-MM') AS month,
                   COUNT(*) AS count
            FROM sf_311_housing
            WHERE mapblklot = :id AND requested_datetime IS NOT NULL
            GROUP BY 1
            ORDER BY 1
        """),
        {"id": mapblklot},
    )
    result = [TimelinePoint(month=r.month, count=r.count) for r in rows]
    cache_set(cache_key, result)
    return result


@router.get("/building/{mapblklot}/violations-timeline", response_model=list[TimelinePoint])
async def get_sf_violations_timeline(mapblklot: str, db: AsyncSession = Depends(get_db)):
    cache_key = f"sf_violation_timeline:{mapblklot}"
    cached = cache_get(cache_key)
    if cached:
        return cached
    rows = await db.execute(
        text("""
            SELECT TO_CHAR(date_trunc('month', date_filed), 'YYYY-MM') AS month,
                   COUNT(*) AS count
            FROM sf_dbi_nov
            WHERE mapblklot = :id AND date_filed IS NOT NULL
            GROUP BY 1
            ORDER BY 1
        """),
        {"id": mapblklot},
    )
    result = [TimelinePoint(month=r.month, count=r.count) for r in rows]
    cache_set(cache_key, result)
    return result


# ── breakdowns ────────────────────────────────────────────────────────────────

@router.get("/building/{mapblklot}/complaints-breakdown", response_model=list[SfComplaintBreakdownItem])
async def get_sf_complaints_breakdown(
    mapblklot: str,
    years: int | None = 5,
    db: AsyncSession = Depends(get_db),
):
    cache_key = f"sf_complaint_breakdown:{mapblklot}:{years}"
    cached = cache_get(cache_key)
    if cached:
        return cached
    date_filter = "AND requested_datetime >= NOW() - INTERVAL '5 years'" if years else ""
    rows = await db.execute(
        text(f"""
            SELECT
                COALESCE(service_subtype, 'unknown') AS subtype,
                COUNT(*)                             AS count
            FROM sf_311_housing
            WHERE mapblklot = :id
              AND service_subtype IS NOT NULL
              {date_filter}
            GROUP BY subtype
            ORDER BY count DESC
        """),
        {"id": mapblklot},
    )
    result = [SfComplaintBreakdownItem(subtype=r.subtype, count=r.count) for r in rows]
    cache_set(cache_key, result)
    return result


@router.get("/building/{mapblklot}/violations-breakdown", response_model=list[SfViolationBreakdownItem])
async def get_sf_violations_breakdown(
    mapblklot: str,
    years: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    cache_key = f"sf_violation_breakdown:{mapblklot}:{years}"
    cached = cache_get(cache_key)
    if cached:
        return cached
    date_filter = "AND date_filed >= NOW() - INTERVAL '5 years'" if years else ""
    rows = await db.execute(
        text(f"""
            SELECT
                COALESCE(nov_category_description, 'Unknown') AS category,
                COUNT(*)                                      AS count,
                COUNT(*) FILTER (WHERE LOWER(status) = 'active') AS open_count
            FROM sf_dbi_nov
            WHERE mapblklot = :id
              {date_filter}
            GROUP BY category
            ORDER BY count DESC
        """),
        {"id": mapblklot},
    )
    result = [
        SfViolationBreakdownItem(
            category=r.category,
            count=r.count,
            open_count=r.open_count,
        )
        for r in rows
    ]
    cache_set(cache_key, result)
    return result
