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

    # same, but writes the publishable sentences into brief_texts so the page
    # renders them. --reset clears the current prompt version first, which is
    # what you want while iterating: see write_corpus.
    cd api && ../.venv/bin/python -m services.briefs.smoke \\
        --with-model --provider anthropic --write --reset \\
        --bin 3096715 --bin 2003187 --cap 5

The fast prompt loop is this script WITHOUT --write: it prints the brief as the
page renders it, plus the validator verdict, in seconds and with no database or
cache in the way. Add --write only once the wording reads right, to see the
layout.

NOTE ON SAMPLING: the default sample is stratified by percentile bucket and
takes the *worst* building in each, so every rule fires on it by construction.
It is built to exercise the rendering, not to measure anything. Never read rule
base rates off this output — for that, dump `to_signals()` over an `ORDER BY
random()` sample and count offline.

Queries run inline against the base tables, NOT off `hpd_brief_signals`. That is
deliberate and worth keeping: the view is what the page reads, and a smoke run
that read the same view could not catch the view being wrong. The two are held
equal by `tests/test_briefs_signals_sql.py` plus a periodic parity check
(`--check-view`), which is the only thing that would surface a stale refresh.
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
from services.briefs.schema import PROMPT_VERSION  # noqa: E402
from services.briefs.validate import (  # noqa: E402
    failures, is_publishable, validate,
)
# The category lists and the complaint window live in signals.py, shared with
# the hpd_brief_signals materialized view and the route that serves it. They
# were defined here first; they moved when the view was added, because a smoke
# run that disagrees with the view is a smoke run that proves nothing.
from services.briefs.signals import (  # noqa: E402,F401
    COMPLAINT_WINDOW_YEARS, DETECTOR_CATEGORIES, HAZARD_AREA_LIMIT,
    HEAT_CATEGORIES, MOLD_CATEGORIES, PEST_CATEGORIES,
    RETIRED_LEAD_ORDER_NUMBERS, VIOLATION_CATEGORIES_SCANNED,
)

load_dotenv(dotenv_path=Path(__file__).resolve().parents[3] / ".env")


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
ENRICH = f"""
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
        -- Mirrors hpd_brief_signals: the LEAD-BASED PAINT category plus the
        -- repealed order numbers whose violations are open lead paint but whose
        -- category reads RETIRED. See signals.RETIRED_LEAD_ORDER_NUMBERS.
        count(*) FILTER (
            WHERE o.category = 'LEAD-BASED PAINT'
               OR v.order_number = ANY($7)
        )                                       AS lead_paint_violations,
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
    WHERE bin = s.bin
      AND received_date >= CURRENT_DATE - INTERVAL '{COMPLAINT_WINDOW_YEARS} years'
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
        LIMIT {HAZARD_AREA_LIMIT}
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

# Used only by --check-view. The stratified sampler above cannot serve a parity
# check: DISTINCT ON over six percentile buckets returns at most six rows, so
# `--limit 50` against it silently checks six buildings and reports success.
RANDOM_QUERY = f"""
WITH s AS (
    SELECT {SAMPLE}
    FROM hpd_building_summary hv
    WHERE hv.violations_density_pct IS NOT NULL
    ORDER BY random()
    LIMIT $1
)
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
        # Not a `when` predicate input — the suppression layer reads it. See
        # rules.eligible_rules.
        "open_class_c_categories": row["open_class_c_categories"],
        "hpd_record_count": (row["total_violations"] or 0) + (row["total_complaints"] or 0),
        "latest_hpd_activity": max(latest) if latest else None,
    }


async def fetch_buildings(
    limit: int, bins: list[str] | None, random_sample: bool = False
) -> list[dict]:
    conn = await asyncpg.connect(
        os.environ["DATABASE_URL"].split("?")[0],
        # A selection query should never be what hangs a run. Query-side
        # equivalent of the call cap: fail fast and loudly. Random sampling
        # enriches one row per building and needs longer than the stratified six.
        server_settings={"statement_timeout": "300000" if random_sample else "30000"},
    )
    try:
        if bins:
            rows = [
                await conn.fetchrow(
                    BY_BIN_QUERY, b, MOLD_CATEGORIES, PEST_CATEGORIES,
                    DETECTOR_CATEGORIES, VIOLATION_CATEGORIES_SCANNED,
                    HEAT_CATEGORIES, RETIRED_LEAD_ORDER_NUMBERS,
                )
                for b in bins
            ]
            return [dict(r) for r in rows if r is not None]
        rows = await conn.fetch(
            RANDOM_QUERY if random_sample else STRATIFIED_QUERY,
            limit, MOLD_CATEGORIES, PEST_CATEGORIES,
            DETECTOR_CATEGORIES, VIOLATION_CATEGORIES_SCANNED, HEAT_CATEGORIES,
            RETIRED_LEAD_ORDER_NUMBERS,
        )
        return [dict(r) for r in rows]
    finally:
        await conn.close()


VIEW_QUERY = """
SELECT bin, open_class_c_violations, lead_paint_violations,
       smoke_co_detector_violations, open_class_c_categories,
       mold_complaints, pest_complaints, heat_hot_water_complaints,
       hpd_record_count, latest_hpd_activity
FROM hpd_brief_signals WHERE bin = ANY($1)
"""


async def check_view(rows: list[dict]) -> int:
    """Compare `hpd_brief_signals` against the inline computation, per building.

    The view is what the page reads and the inline queries are what every
    measurement in BRIEF_ROLLOUT.md was taken from. If they disagree, one of two
    things is true and both matter: the generated SQL is wrong, or the view is
    stale. Neither is visible from the site — a stale view just renders
    confidently wrong numbers — so this is the check that has to be run after
    every refresh, not only after a schema change.
    """
    conn = await asyncpg.connect(
        os.environ["DATABASE_URL"].split("?")[0],
        server_settings={"statement_timeout": "60000"},
    )
    try:
        view = {r["bin"]: dict(r) for r in await conn.fetch(
            VIEW_QUERY, [row["bin"] for row in rows]
        )}
    finally:
        await conn.close()

    mismatches = 0
    missing = 0
    for row in rows:
        bin_ = row["bin"]
        inline = to_signals(row)
        got = view.get(bin_)
        if got is None:
            missing += 1
            print(f"MISSING  BIN {bin_} — no row in hpd_brief_signals")
            continue
        # Hazard areas are compared as a set: the view breaks count ties by
        # category name and the inline query does not, so ordering can differ
        # legitimately between two equally correct results.
        diffs = [
            (k, inline[k], got[k]) for k in inline
            if inline[k] != got[k]
        ]
        hazard_inline = set(row["open_class_c_categories"] or [])
        hazard_view = set(got["open_class_c_categories"] or [])
        if hazard_inline != hazard_view:
            diffs.append(("open_class_c_categories",
                          sorted(hazard_inline), sorted(hazard_view)))
        if diffs:
            mismatches += 1
            print(f"MISMATCH BIN {bin_} {row['address']}")
            for k, a, b in diffs:
                print(f"    {k}: inline={a!r} view={b!r}")

    checked = len(rows)
    print("=" * 78)
    print(f"{checked} buildings checked · {mismatches} mismatched · {missing} missing")
    if mismatches or missing:
        print("\nThe view disagrees with the base tables. Either the migration was "
              "edited by hand (run the tests) or the view needs a refresh:")
        print("  REFRESH MATERIALIZED VIEW CONCURRENTLY hpd_brief_signals;")
        return 1
    return 0


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
    parser.add_argument(
        "--check-view", action="store_true",
        help="compare hpd_brief_signals against the inline computation and exit",
    )
    parser.add_argument(
        "--write", action="store_true",
        help="upsert the publishable sentences into brief_texts (implies --with-model)",
    )
    parser.add_argument(
        "--reset", action="store_true",
        help=f"with --write: delete every row at the current prompt version "
             f"first. See write_corpus.",
    )
    args = parser.parse_args()

    if args.write and not args.with_model:
        # Not silently implied: --with-model is the flag that spends money, and
        # a flag that turns spending on as a side effect of another flag is how
        # an unintended bill happens.
        parser.error("--write needs --with-model: there is nothing to write without a call")
    if args.reset and not args.write:
        parser.error("--reset only makes sense with --write")

    _, document = load_rules()
    # --check-view samples randomly: the stratified sample is six buildings at
    # any --limit, which is far too few to trust a parity result.
    rows = await fetch_buildings(args.limit, args.bins, random_sample=args.check_view)

    if args.check_view:
        return await check_view(rows)

    provider = None
    cap = None
    CallCapExceeded = ()  # nothing to catch when no model is in play
    if args.with_model:
        # Imported lazily: without --with-model this script must not pay the
        # Anthropic SDK import cost, and must not require an API key.
        from services.briefs.providers import AnthropicProvider, OllamaProvider
        from services.briefs.telemetry import CallCap, CallCapExceeded

        cap = CallCap(limit=args.cap)
        provider = (
            OllamaProvider(model=args.model or "qwen3:8b", cap=cap)
            if args.provider == "ollama"
            else AnthropicProvider(model=args.model or "claude-haiku-4-5", cap=cap)
        )

    # Accumulated across buildings and written once at the end, so a run that
    # dies partway leaves the corpus untouched rather than half-updated.
    pending: list[tuple] = []

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
            try:
                result = await _generate_context(row, selected, provider)
                if result is not None:
                    context = result.context
                    if args.write:
                        pending += _corpus_rows(row, selected, result)
            except CallCapExceeded as e:
                # The cap raises BEFORE dispatch, so this building cost nothing
                # — but letting it propagate would abort the run and throw away
                # every brief already rendered above. Stop generating, keep
                # rendering: the deterministic layer is most of the output and
                # needs no model at all.
                print(f"\n  [cap]   {e}")
                print("          nothing was charged for this building. "
                      "Remaining buildings render without a generated sentence "
                      "— raise --cap to generate for all of them.")
                provider = None

        print("-" * 78)
        _print_full_brief(context, selected, signals, note, document,
                          has_model=provider is not None)

    print("=" * 78)
    calls = cap.used if cap else 0
    print(f"{len(rows)} buildings · {calls} model calls · ${_TOTAL_COST:.4f}")

    if args.write:
        await write_corpus(pending, reset=args.reset)
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

    from services.briefs.taxonomy import describe_hazard_areas_prose

    areas = describe_hazard_areas_prose(signals.get("open_class_c_categories"))
    for i, rule in enumerate(selected):
        print()
        print(_wrap(rule.condition_with_areas(areas), indent="  • ", hang="    "))
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
    """Generate the sentences the model writes; return the BriefResult, or None
    on failure.

    Returns rather than raising: a smoke run over several buildings is more
    useful when one refusal doesn't end it.

    The whole result rather than just `.context`, because `--write` needs the
    record's model and prompt version for the corpus row, and reading those off
    the run's arguments instead would record what was ASKED for rather than what
    answered — a repair or a provider fallback would then be logged wrong.
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
    # Run the publish gate here rather than only in the corpus builder: a smoke
    # run whose whole purpose is judging prompt output should say whether that
    # output would have been publishable, not leave it to be eyeballed. The
    # sentence is still printed on a failure — the point of a smoke run is to
    # see what the model wrote, and quarantining it from the terminal would hide
    # exactly what needs reading.
    verdicts = validate(result.context.watch_for, selected_rules=selected)
    if is_publishable(verdicts):
        print(f"  [valid] {len(verdicts)} check(s) passed")
    else:
        print(f"  [valid] WOULD NOT PUBLISH ({len(failures(verdicts))} failed)")
        for v in failures(verdicts):
            print(f"          {v.check}: {v.detail}")
    # Measured locally after the response returns — none of this comes from the
    # model, so it is tagged separately from the generated text and printed
    # outside the brief.
    dropped = " · dropped watch_for" if r.dropped_watch_for else ""
    print(f"\n  [call]  {r.latency_ms}ms · {r.repairs} repair(s) · "
          f"{r.input_tokens} in / {r.output_tokens} out · "
          f"${r.cost_usd:.5f}{dropped}")
    return result


def _corpus_rows(row: dict, selected, result) -> list[tuple]:
    """The `brief_texts` rows this building's generation earns, if any.

    Validated PER SENTENCE, not per building. `is_publishable` over the whole
    brief is all-or-nothing, which is right for deciding whether to show a
    building generated text at all, and wrong here: the corpus is keyed by rule
    and input shape, so one bad sentence would throw away a good sibling that
    thousands of other buildings share. Each pair is validated on its own by
    calling `validate` with a one-element list, which is the public API rather
    than a reimplementation of it — the `pairing` check still holds at 1:1.

    Keys come from `keys_for_selection`, the same function the route reads with.
    Computing them any other way here would let the writer and the reader drift,
    which is the one bug this design cannot detect: a mismatched key is a miss,
    and a miss looks exactly like phase 0.
    """
    from services.briefs.corpus import keys_for_selection

    keys = keys_for_selection(
        selected,
        categories=row["open_class_c_categories"],
        percentile=row["hpd_violations_percentile"],
    )
    rules = list(selected)
    record = result.record

    rows: list[tuple] = []
    for i, (rule_id, input_key) in enumerate(keys):
        if i >= len(result.context.watch_for):
            # Fewer sentences than keys: the model returned a short list, or one
            # was dropped. Not an error — that rule falls back to its authored
            # line — but it must not shift the pairing.
            break
        assert rule_id == rules[i].id, "keys_for_selection drifted from selected order"
        sentence = result.context.watch_for[i]
        verdicts = validate([sentence], selected_rules=[rules[i]])
        if not is_publishable(verdicts):
            print(f"  [write] SKIPPED {rule_id}: "
                  + "; ".join(v.detail for v in failures(verdicts)))
            continue
        rows.append((rule_id, input_key, sentence,
                     record.prompt_version, record.model))
    return rows


CORPUS_UPSERT = """
INSERT INTO brief_texts
    (rule_id, input_key, watch_for, prompt_version, model, validated_at)
SELECT t.rule_id, t.input_key, t.watch_for, t.prompt_version, t.model, now()
FROM unnest(
    $1::text[], $2::text[], $3::text[], $4::text[], $5::text[]
) AS t(rule_id, input_key, watch_for, prompt_version, model)
ON CONFLICT (rule_id, input_key, prompt_version) DO UPDATE
SET watch_for    = EXCLUDED.watch_for,
    model        = EXCLUDED.model,
    validated_at = EXCLUDED.validated_at
"""


async def write_corpus(pending: list[tuple], *, reset: bool) -> None:
    """Upsert the run's sentences into `brief_texts`.

    Upsert rather than insert, because the whole point of this flag is a loop:
    tweak `prompt.py`, re-run, reload the page. An insert would collide on the
    primary key the second time round and a delete-then-insert would leave the
    corpus empty if the run died between them.

    `--reset` exists because upserting only covers the shapes this run
    regenerated. Change the prompt so a building resolves to a DIFFERENT input
    key and the old shape's row survives untouched at the same prompt version,
    still served to every other building that resolves to it. That stale row is
    invisible — a corpus hit looks identical whenever it was written — so during
    prompt iteration, clear the version and rewrite it.

    Bumping `PROMPT_VERSION` is the production answer to the same problem and is
    deliberately NOT done here: it invalidates the whole corpus for everyone,
    which is correct once per shipped prompt change and absurd once per edit.
    """
    if reset:
        # asyncpg returns the command tag, e.g. "DELETE 12".
        status = await _execute(
            "DELETE FROM brief_texts WHERE prompt_version = $1", PROMPT_VERSION
        )
        print(f"  [write] reset: cleared {status.split()[-1]} row(s) at {PROMPT_VERSION}")

    if not pending:
        print("  [write] nothing publishable to write")
        return

    # Deduplicated because the run is per building and the corpus is per input
    # shape: five buildings flagging lead paint produce five identical keys, and
    # ON CONFLICT cannot resolve two of them inside one statement.
    by_key = {(r[0], r[1], r[3]): r for r in pending}
    columns = list(zip(*by_key.values()))
    await _execute(CORPUS_UPSERT, *[list(c) for c in columns])
    print(f"  [write] {len(by_key)} row(s) upserted at {PROMPT_VERSION} "
          f"({len(pending)} generated, {len(pending) - len(by_key)} duplicate shape(s))")
    print("  [write] the API caches briefs for an hour and Next caches the "
          "fetch for a day — restart the API and rm -rf .next before reading "
          "the page, or check /hpd/building/<bin>/brief directly.")


async def _execute(sql: str, *params) -> str:
    conn = await asyncpg.connect(
        os.environ["DATABASE_URL"].split("?")[0],
        server_settings={"statement_timeout": "30000"},
    )
    try:
        return await conn.execute(sql, *params)
    finally:
        await conn.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
