"""Smoke-run the Building Brief against real buildings.

Default mode is the deterministic layer only: SQL signals in, selected rules and
a confidence note out. No model call, no API key, no cost. That is most of the
brief, so it is the useful default.

`--with-model` adds the one generated sentence. It defaults to a local
open-weights model through Ollama, so prompt iteration stays free; only
`--provider anthropic` costs anything.

    # deterministic, free
    cd api && ../.venv/bin/python -m services.briefs.smoke
    cd api && ../.venv/bin/python -m services.briefs.smoke --bin 3096715 --signals

    # adds the generated context line (local model, still free)
    cd api && ../.venv/bin/python -m services.briefs.smoke --with-model
    cd api && ../.venv/bin/python -m services.briefs.smoke --with-model --prompt

    # measured run against the paid API — costs money, note the cap
    cd api && ../.venv/bin/python -m services.briefs.smoke \\
        --with-model --provider anthropic --limit 5 --cap 5

NOTE ON SAMPLING: the default sample is stratified by percentile bucket and
takes the *worst* building in each, so every rule fires on it by construction.
It is built to exercise the rendering, not to measure anything. Never read rule
base rates off this output — for that, dump `to_signals()` over an `ORDER BY
random()` sample and count offline.

Queries run inline rather than off a materialized view. The view is a
performance concern for corpus generation; there is no reason to commit to a
schema change before the rules read right against real buildings.
"""

import argparse
import asyncio
import os
import sys
import textwrap
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from services.briefs.confidence import confidence_note_from_signals  # noqa: E402
from services.briefs.rules import load_rules, select_rules  # noqa: E402
from services.briefs.taxonomy import minor_categories  # noqa: E402

load_dotenv(dotenv_path=Path(__file__).resolve().parents[3] / ".env")

# Complaint minor-categories behind the mold and pest rules. Named explicitly
# rather than taken from the mold_pests_sanitation taxonomy group, which also
# contains RUBBISH, ODOR, and UNSANITARY CONDITION — real complaints, but not
# what the HPD guidance for mold or pests is about. That narrowing is safe
# because the rule text makes a narrower claim than the card does: "Tenants here
# have reported mold" against a card labelled "Mold & pests". Different label,
# different number, no contradiction.
MOLD_CATEGORIES = ["MOLD"]
PEST_CATEGORIES = ["PESTS", "VERMIN"]

# Heat is the opposite case and must NOT be narrowed. The rule says "problems
# with heat or hot water" and the building page shows a "Heat / hot water" card
# — same label, so they have to be the same number. Read from the shared
# taxonomy so they cannot drift.
#
# This replaced `major_category = 'HEAT/HOT WATER'`, which looked more faithful
# to HPD but disagreed with the card: RADIATOR (36,162 complaints over five
# years) and BOILER sit in other majors while being squarely inside the
# renter-facing heat group. Measured over 4,000 random buildings, the two
# definitions produced a different count on 263 of them — 21% of the buildings
# where the rule fires — and every one of those would have printed a number next
# to a card showing a different one.
HEAT_CATEGORIES = minor_categories("heating_hot_water")

# Violation categories behind the detector rule. One signal, because the source
# gives one section of guidance for both devices.
DETECTOR_CATEGORIES = ["SMOKE DETECTING DEVICES", "CARBON MONOXIDE DETECTING DEVICES"]

# Every violation category the lead/detector LATERAL needs to scan. Passed as a
# single filter so that subquery walks a building's open violations once rather
# than once per signal.
VIOLATION_CATEGORIES_SCANNED = ["LEAD-BASED PAINT", *DETECTOR_CATEGORIES]

# The complaint window every complaint-driven rule uses. Stated once because the
# rules used to disagree: mold and pests were windowed here while heat was read
# from `hpd_complaints_building_summary.heat_complaints`, which carries NO date
# filter at all. Measured on 3,000 random buildings, that fired the heat rule on
# 46.5% of them versus 31.0% within five years — 15.5% of all buildings were
# being told about heat complaints whose most recent entry was over five years
# old, some of them single complaints from the early 2000s. The view column is
# still correct for the pages that want a lifetime total; it is the wrong input
# for a rule that tells a prospective tenant what to expect this winter.
COMPLAINT_WINDOW_YEARS = 5

SAMPLE = """
    hv.bin, hv.address, hv.borough, hv.nta_name,
    hv.violations_density_pct AS hpd_violations_percentile,
    hv.open_violations,
    hv.total_violations,
    hv.rent_impairing_count AS open_rent_impairing_violations,
    hv.latest_violation_date
"""

# Enrichment runs only against the already-chosen sample. Applying these
# correlated subqueries across all 227,915 rows before narrowing does not
# complete against an 11M-row hpd_violations.
ENRICH = """
LEFT JOIN hpd_complaints_building_summary hc ON s.bin = hc.bin
LEFT JOIN LATERAL (
    SELECT
        count(*) FILTER (WHERE violation_class = 'A') AS open_class_a_violations,
        count(*) FILTER (WHERE violation_class = 'B') AS open_class_b_violations,
        count(*) FILTER (WHERE violation_class = 'C') AS open_class_c_violations
    FROM hpd_violations
    WHERE bin = s.bin AND violation_status = 'Open'
) oc ON TRUE
LEFT JOIN LATERAL (
    SELECT
        count(*) FILTER (WHERE o.category = 'LEAD-BASED PAINT')
                                                AS lead_paint_violations,
        -- Smoke and CO in one signal: the source treats them as one section and
        -- the guidance is identical. Neither category carries any open class C
        -- violations, so this cannot be folded into the class C signal.
        count(*) FILTER (WHERE o.category = ANY($4))
                                                AS smoke_co_detector_violations
    FROM hpd_violations v
    JOIN hpd_order_numbers o ON v.order_number = o.order_number
    WHERE v.bin = s.bin
      AND v.violation_status = 'Open'
      AND o.category = ANY($5)
) lead ON TRUE
LEFT JOIN LATERAL (
    SELECT
        count(*) FILTER (WHERE minor_category = ANY($2)) AS mold_complaints,
        count(*) FILTER (WHERE minor_category = ANY($3)) AS pest_complaints,
        -- Windowed here rather than read off the summary view, which counts
        -- heat complaints for all time. See COMPLAINT_WINDOW_YEARS. Grouped by
        -- the shared taxonomy, not major_category — see HEAT_CATEGORIES.
        count(*) FILTER (WHERE minor_category = ANY($6)) AS heat_hot_water_complaints
    FROM hpd_complaints
    WHERE bin = s.bin AND received_date >= NOW() - INTERVAL '5 years'
) cc ON TRUE
-- The categories behind this building's OPEN class C violations, most common
-- first. Without these the class C rule is the only abstract one in the set:
-- "conditions HPD classifies as immediately hazardous" names no observable
-- thing, and a model asked for something concrete anyway invented nouns that
-- traced to nothing in its input. These are what make it answerable.
LEFT JOIN LATERAL (
    SELECT array_agg(category ORDER BY n DESC) AS open_class_c_categories
    FROM (
        SELECT o.category, count(*) AS n
        FROM hpd_violations v
        JOIN hpd_order_numbers o ON v.order_number = o.order_number
        WHERE v.bin = s.bin
          AND v.violation_status = 'Open'
          AND v.violation_class = 'C'
          AND o.category IS NOT NULL
        GROUP BY o.category
        ORDER BY n DESC
        LIMIT 3
    ) t
) cat ON TRUE
"""

COLUMNS = """
    s.*,
    hc.complaints_density_pct AS hpd_complaints_percentile,
    hc.total_complaints,
    hc.trend_direction,
    hc.latest_complaint_date,
    oc.open_class_a_violations, oc.open_class_b_violations, oc.open_class_c_violations,
    lead.lead_paint_violations, lead.smoke_co_detector_violations,
    cc.mold_complaints, cc.pest_complaints, cc.heat_hot_water_complaints,
    cat.open_class_c_categories
"""

STRATIFIED_QUERY = f"""
WITH s AS (
    SELECT DISTINCT ON (width_bucket(hv.violations_density_pct, 0, 100, 5)) {SAMPLE}
    FROM hpd_building_summary hv
    WHERE hv.violations_density_pct IS NOT NULL
    ORDER BY width_bucket(hv.violations_density_pct, 0, 100, 5), hv.open_violations DESC
    LIMIT $1
)
SELECT {COLUMNS} FROM s {ENRICH}
"""

BY_BIN_QUERY = f"""
WITH s AS (SELECT {SAMPLE} FROM hpd_building_summary hv WHERE hv.bin = $1)
SELECT {COLUMNS} FROM s {ENRICH}
"""


def to_signals(row: dict) -> dict:
    """Exactly the keys rules.yaml and confidence.py reference.

    Built explicitly rather than passing the whole row through, so a rule naming
    a signal nobody supplies raises instead of silently never firing.
    """
    latest = [d for d in (row["latest_violation_date"], row["latest_complaint_date"]) if d]
    return {
        "open_class_c_violations": row["open_class_c_violations"],
        "heat_hot_water_complaints": row["heat_hot_water_complaints"],
        "mold_complaints": row["mold_complaints"],
        "pest_complaints": row["pest_complaints"],
        "lead_paint_violations": row["lead_paint_violations"],
        "smoke_co_detector_violations": row["smoke_co_detector_violations"],
        "hpd_record_count": (row["total_violations"] or 0) + (row["total_complaints"] or 0),
        "latest_hpd_activity": max(latest) if latest else None,
    }


async def fetch_buildings(limit: int, bins: list[str] | None) -> list[dict]:
    conn = await asyncpg.connect(
        os.environ["DATABASE_URL"].split("?")[0],
        # A selection query should never be what hangs a run. Query-side
        # equivalent of the call cap: fail fast and loudly.
        server_settings={"statement_timeout": "30000"},
    )
    try:
        if bins:
            rows = [
                await conn.fetchrow(
                    BY_BIN_QUERY, b, MOLD_CATEGORIES, PEST_CATEGORIES,
                    DETECTOR_CATEGORIES, VIOLATION_CATEGORIES_SCANNED,
                    HEAT_CATEGORIES,
                )
                for b in bins
            ]
            return [dict(r) for r in rows if r is not None]
        rows = await conn.fetch(
            STRATIFIED_QUERY, limit, MOLD_CATEGORIES, PEST_CATEGORIES,
            DETECTOR_CATEGORIES, VIOLATION_CATEGORIES_SCANNED, HEAT_CATEGORIES,
        )
        return [dict(r) for r in rows]
    finally:
        await conn.close()


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--bin", action="append", dest="bins", help="specific BIN (repeatable)")
    parser.add_argument("--signals", action="store_true", help="dump the raw signal values")
    parser.add_argument(
        "--with-model", action="store_true",
        help="also generate the context line (default provider is local Ollama)",
    )
    parser.add_argument(
        "--prompt", action="store_true",
        help="print the user turn sent to the model — everything it is allowed to see",
    )
    parser.add_argument("--provider", choices=["ollama", "anthropic"], default="ollama")
    parser.add_argument("--model", default=None)
    parser.add_argument("--cap", type=int, default=50, help="hard call cap for this run")
    args = parser.parse_args()

    _, document = load_rules()
    rows = await fetch_buildings(args.limit, args.bins)

    provider = None
    if args.with_model:
        # Imported lazily: without --with-model this script must not pay the
        # Anthropic SDK import cost, and must not require an API key.
        from services.briefs.providers import AnthropicProvider, OllamaProvider
        from services.briefs.telemetry import CallCap

        cap = CallCap(limit=args.cap)
        provider = (
            OllamaProvider(model=args.model or "qwen3:8b", cap=cap)
            if args.provider == "ollama"
            else AnthropicProvider(model=args.model or "claude-haiku-4-5", cap=cap)
        )

    for row in rows:
        signals = to_signals(row)
        selected = select_rules(signals)
        note = confidence_note_from_signals(signals)

        print("=" * 78)
        print(f"BIN {row['bin']}  {row['address']}, {row['borough']}")
        print(f"  violations percentile {row['hpd_violations_percentile']} · "
              f"{row['open_violations']} open "
              f"(C:{row['open_class_c_violations']} "
              f"B:{row['open_class_b_violations']} "
              f"A:{row['open_class_a_violations']})")
        if args.signals:
            for k, v in signals.items():
                print(f"      {k}: {v}")
        from services.briefs.prompt import (
            SYSTEM, hazard_areas_for, hazard_issue_index, render_context,
        )

        user_turn = render_context(
            percentile=row["hpd_violations_percentile"],
            conditions=[r.condition for r in selected],
            hazard_areas=hazard_areas_for(row),
            hazard_issue_index=hazard_issue_index(selected),
        )

        print("-" * 78)
        print("PROMPT INPUT — everything the model is allowed to see")
        if args.prompt:
            print("\n  system:")
            for line in SYSTEM.splitlines():
                print(f"    {line}")
        else:
            print(f"  system: ({len(SYSTEM)} chars, identical every call; "
                  "pass --prompt to print it)")
        print("\n  user:")
        for line in user_turn.splitlines():
            print(f"    {line}")

        context = None
        if provider is not None:
            context = await _generate_context(row, selected, provider)

        print("-" * 78)
        _print_full_brief(context, selected, signals, note, document,
                          has_model=provider is not None)

    print("=" * 78)
    calls = 0 if provider is None else provider._cap.used  # type: ignore[attr-defined]
    cost = 0.0 if provider is None else _TOTAL_COST
    print(f"{len(rows)} buildings · {calls} model calls · ${cost:.4f}")
    return 0


_TOTAL_COST = 0.0


def _wrap(text: str, indent: str = "  ", hang: str | None = None, width: int = 76) -> str:
    """Wrap for a terminal. Brief copy is prose and reads badly unwrapped.

    `hang` is the continuation indent; it defaults to `indent` but must differ
    for bullets, or every wrapped line repeats the bullet character.
    """
    return textwrap.fill(
        text, width=width, initial_indent=indent, subsequent_indent=hang or indent
    )


def _print_full_brief(context, selected, signals, note, document, *,
                      has_model: bool) -> None:
    """Render the brief as a renter would read it, in page order.

    This is the artifact under review — not the signals, not the prompt. The
    generated sentences open it and the authored watch items follow, because
    that is the order on the page. Printing the model output last made it read
    as a redundant summary of material already passed.
    """
    print("FULL BRIEF — what the user sees")

    # Each generated sentence answers one flagged issue, so it is printed with
    # that issue rather than collected at the top. `watch_for[i]` addresses
    # `selected[i]` — the same positional contract the schema documents, made
    # visible here so a mismatch is obvious on sight rather than only in a test.
    watch = list(context.watch_for) if context is not None else []

    for i, rule in enumerate(selected):
        print()
        print(_wrap(rule.condition, indent="  • ", hang="    "))
        magnitude = rule.magnitude_text(signals)
        if magnitude:
            print(f"    {magnitude}.")
        if i < len(watch):
            print(_wrap(watch[i], indent="    Worth checking: ", hang="    "))
        print(_wrap(rule.why_it_matters, indent="    "))
        print(_wrap(rule.action, indent="    "))
        print(f"    Source: {rule.cite(document)}")

    if not selected:
        print()
        print("  (nothing flagged — no watch items on this building)")
    elif context is None and has_model:
        print()
        print("  (generation failed — the page falls back to the authored items)")
    elif context is None:
        print()
        print("  (no generated sentences — run with --with-model)")

    if note:
        print()
        print(_wrap(note, indent="  Note: ", hang="        "))


async def _generate_context(row: dict, selected, provider):
    """Generate the sentences the model writes; return them, or None on failure.

    Returns rather than raising: a smoke run over several buildings is more
    useful when one refusal doesn't end it.
    """
    global _TOTAL_COST
    from services.briefs.generate import BriefGenerationFailed, generate_context_line

    try:
        result = await generate_context_line(
            row, selected, provider, building_id=row["bin"], city="nyc"
        )
    except BriefGenerationFailed as e:
        _TOTAL_COST += e.record.cost_usd or 0.0
        print(f"\n  [call]  FAILED {e.record.validation_result}: {e}")
        return None

    _TOTAL_COST += result.record.cost_usd or 0.0
    r = result.record
    # Measured locally after the response returns — none of this comes from the
    # model, so it is tagged separately from the generated text and printed
    # outside the brief.
    dropped = " · dropped watch_for" if r.dropped_watch_for else ""
    print(f"\n  [call]  {r.latency_ms}ms · {r.repairs} repair(s) · "
          f"{r.input_tokens} in / {r.output_tokens} out · "
          f"${r.cost_usd:.5f}{dropped}")
    return result.context


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
