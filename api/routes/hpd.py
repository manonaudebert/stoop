import logging
import re
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from database import get_db
from limiter import limiter
from observability import emit_event, is_bot, is_internal
from cache import cache_get, cache_set
from schemas import (
    BriefCitation,
    BriefWatchItem,
    BuildingBriefResponse,
    HpdBuildingSummaryResponse,
    HpdBuildingDetailResponse,
    HpdViolationResponse,
    ViolationClassBreakdownItem,
    ViolationAgeBucketItem,
    TimelinePoint,
)
# Imported from the submodules directly, NOT from `services.briefs`. The package
# __init__ is lazy on purpose and importing the wrong name there drags in the
# Anthropic SDK — a ~17s cost the API must never pay at startup, for a code path
# that makes no model calls at all.
from services.briefs.confidence import confidence_note_from_signals
from services.briefs.route_support import generated_watch_for
from services.briefs.rules import load_rules, select_rules
from services.briefs.taxonomy import (
    describe_hazard_areas, describe_hazard_areas_prose, join_prose,
)

router = APIRouter(prefix="/hpd", tags=["hpd"])

logger = logging.getLogger(__name__)

# PostgreSQL undefined_table. See _generated_watch_for.

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
    cache_set(cache_key, geojson, ttl_seconds=86400)
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
        emit_event(kind="search", route="/hpd/building/search", city="nyc", query=q.strip(),
                   result_count=len(cached), internal=is_internal(request),
                   is_bot=is_bot(request.headers.get("User-Agent", "")))
        return cached

    q = q.strip()
    patterns = _search_patterns(q)        # ['%TEXT%', ...]
    like_params   = {f"like_{i}":  p          for i, p in enumerate(patterns)}
    exact_params  = {f"exact_{i}": p[1:-1]    for i, p in enumerate(patterns)}  # 'TEXT'
    word_params   = {f"word_{i}":  f"{p[1:-1]} %" for i, p in enumerate(patterns)}  # 'TEXT %' (token boundary)
    prefix_params = {f"pre_{i}":   p[1:]      for i, p in enumerate(patterns)}  # 'TEXT%'
    n = len(patterns)
    like_clauses   = " OR ".join(f"hs.address ILIKE :like_{i}"  for i in range(n))
    exact_clauses  = " OR ".join(f"hs.address ILIKE :exact_{i}" for i in range(n))
    word_clauses   = " OR ".join(f"hs.address ILIKE :word_{i}"  for i in range(n))
    prefix_clauses = " OR ".join(f"hs.address ILIKE :pre_{i}"   for i in range(n))

    rows = await db.execute(
        text(f"""
            SELECT hs.*
            FROM hpd_building_summary hs
            WHERE hs.bin = :q
               OR {like_clauses}
            ORDER BY
              CASE
                WHEN hs.bin = :q          THEN 0
                WHEN {exact_clauses}      THEN 1
                WHEN {word_clauses}       THEN 2
                WHEN {prefix_clauses}     THEN 3
                ELSE 4
              END,
              hs.total_violations DESC
            LIMIT 20
        """),
        {"q": q, **like_params, **exact_params, **word_params, **prefix_params},
    )
    results = [_row_to_summary(r) for r in rows.all()]
    cache_set(cache_key, results, ttl_seconds=3600)
    emit_event(kind="search", route="/hpd/building/search", city="nyc", query=q, result_count=len(results),
               internal=is_internal(request),
               is_bot=is_bot(request.headers.get("User-Agent", "")))
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


@router.get("/building/{bin}/open-ages", response_model=list[ViolationAgeBucketItem])
async def get_hpd_open_violation_ages(bin: str, db: AsyncSession = Depends(get_db)):
    cache_key = f"hpd_open_ages:{bin}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    rows = await db.execute(
        text("""
            SELECT
                CASE
                    WHEN NOW() - nov_issued_date < INTERVAL '30 days'  THEN '<30d'
                    WHEN NOW() - nov_issued_date < INTERVAL '90 days'  THEN '30-90d'
                    WHEN NOW() - nov_issued_date < INTERVAL '1 year'   THEN '3-12mo'
                    WHEN NOW() - nov_issued_date < INTERVAL '3 years'  THEN '1-3yr'
                    ELSE '3yr+'
                END AS bucket,
                COUNT(*) AS count
            FROM hpd_violations
            WHERE bin = :bin
              AND violation_status = 'Open'
              AND nov_issued_date IS NOT NULL
            GROUP BY bucket
            ORDER BY MIN(nov_issued_date)
        """),
        {"bin": bin},
    )
    bucket_order = ['<30d', '30-90d', '3-12mo', '1-3yr', '3yr+']
    by_bucket = {r.bucket: r.count for r in rows}
    result = [
        ViolationAgeBucketItem(bucket=b, count=by_bucket[b])
        for b in bucket_order if b in by_bucket
    ]
    cache_set(cache_key, result)
    return result


@router.get("/building/{bin}/breakdown-recent", response_model=list[ViolationClassBreakdownItem])
async def get_hpd_breakdown_recent(bin: str, db: AsyncSession = Depends(get_db)):
    cache_key = f"hpd_breakdown_recent:{bin}"
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
            WHERE v.bin = :bin
              AND v.violation_class IS NOT NULL
              AND v.nov_issued_date >= NOW() - INTERVAL '5 years'
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


@router.get("/building/{bin}/brief", response_model=BuildingBriefResponse)
async def get_hpd_building_brief(bin: str, db: AsyncSession = Depends(get_db)):
    """The deterministic Building Brief — no model, no generated text.

    Reads the precomputed signals from `hpd_brief_signals` and runs the same
    rule evaluation `smoke.py` runs inline. The view exists because that inline
    computation takes ~2.5s per building against an 11M-row table; here it is a
    single indexed lookup.

    A building with no row in the view is NOT an error, and NOT a special case.
    The view covers every building with any HPD record; a BIN outside it has no
    HPD history at all, which is the same thing to a reader as a building whose
    signals are all zero. Both go through the identical path below and both come
    back with `no_flags` set — the only difference is the confidence note, which
    correctly says "no HPD records on file" for one and nothing for the other.
    """
    cache_key = f"hpd_brief:{bin}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    row = (await db.execute(
        text("""
            SELECT s.open_class_c_violations, s.lead_paint_violations,
                   s.smoke_co_detector_violations, s.open_class_c_categories,
                   s.mold_complaints, s.pest_complaints,
                   s.heat_hot_water_complaints,
                   s.hpd_record_count, s.latest_hpd_activity,
                   -- Not a rule signal, and deliberately not added to
                   -- hpd_brief_signals: it gates whether severity language was
                   -- permitted in the prompt, so it is part of the corpus key.
                   -- Joined here rather than materialized because it is an
                   -- indexed single-row lookup, and adding a column to the view
                   -- costs a full recompute for a value the rules never read.
                   hv.violations_density_pct
            FROM hpd_brief_signals s
            LEFT JOIN hpd_building_summary hv ON hv.bin = s.bin
            WHERE s.bin = :bin
        """),
        {"bin": bin},
    )).first()

    # Exactly the keys rules.yaml and confidence.py reference — built explicitly
    # so a rule naming a signal nobody supplies raises instead of silently never
    # firing. Mirrors smoke.to_signals; the two are pinned equal by a test.
    #
    # A BIN with no row in the view has no HPD record at all, and is fed through
    # this same path as all-zero signals rather than short-circuited above. The
    # two states are indistinguishable to a reader — both are "nothing flagged"
    # — and an early return would skip confidence_note's dedicated branch for a
    # zero record count, so the building with the LEAST history would be the one
    # rendering no caveat at all.
    signals = {
        "open_class_c_violations": row.open_class_c_violations if row else 0,
        "heat_hot_water_complaints": row.heat_hot_water_complaints if row else 0,
        "mold_complaints": row.mold_complaints if row else 0,
        "pest_complaints": row.pest_complaints if row else 0,
        "lead_paint_violations": row.lead_paint_violations if row else 0,
        "smoke_co_detector_violations": row.smoke_co_detector_violations if row else 0,
        # Read by the suppression layer, not by any `when` predicate.
        "open_class_c_categories": row.open_class_c_categories if row else None,
        "hpd_record_count": row.hpd_record_count if row else 0,
        "latest_hpd_activity": row.latest_hpd_activity if row else None,
    }

    selected = select_rules(signals)
    _, document = load_rules()
    generated = await generated_watch_for(
        db, selected,
        categories=row.open_class_c_categories if row else None,
        percentile=row.violations_density_pct if row else None,
    )

    watch_items = [
        BriefWatchItem(
            rule_id=rule.id,
            brief_line=rule.brief_line,
            watch_for=generated.get(rule.id) or rule.watch_for,
            # NYC generates this line; a rule whose corpus row is missing falls
            # back to its authored one, if it has one. The label follows the
            # source rather than the city, so a fallback is never mislabelled as
            # AI-assisted.
            watch_for_source=(
                "generated" if generated.get(rule.id)
                else "authored" if rule.watch_for
                else None
            ),
            # Authored sentence plus, for the class C rule only, this
            # building's hazard areas named inside it. Every other rule gets
            # its `condition` back unchanged — see Rule.condition_with_areas.
            condition=rule.condition_with_areas(
                describe_hazard_areas_prose(row.open_class_c_categories)
                if row else None
            ),
            why_it_matters=rule.why_it_matters,
            action=rule.action,
            citations=[
                BriefCitation(label=c.label, url=c.url)
                for c in rule.citations(document)
            ],
            # Only the class C rule is about hazard areas. For every other rule
            # this stays None, which is not the same as the empty list the class
            # C rule gets when nothing it flagged is describable.
            hazard_areas=(
                describe_hazard_areas(row.open_class_c_categories)
                if rule.id == "open_class_c" else None
            ),  # unreachable when row is None: no rule fires on all-zero signals
            # Joined here, not on the client: `join_prose` carries a serial-comma
            # rule that exists because these entries contain their own "and"
            # ("mold and pests, and building maintenance"), and a second
            # implementation of it in TypeScript would drift. Empty joins to ""
            # — falsy on both sides — so "flagged, nothing describable" needs no
            # special case in the renderer.
            hazard_area_phrase=(
                join_prose(describe_hazard_areas_prose(row.open_class_c_categories))
                or None
                if rule.id == "open_class_c" else None
            ),
        )
        for rule in selected
    ]

    result = BuildingBriefResponse(
        bin=bin,
        watch_items=watch_items,
        confidence_note=confidence_note_from_signals(signals),
        no_flags=not watch_items,
        has_records=bool(signals["hpd_record_count"]),
        record_count=signals["hpd_record_count"] or 0,
    )
    cache_set(cache_key, result)
    return result
