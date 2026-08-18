"""Generate the whole `brief_texts` corpus, one call per distinct prompt shape.

`smoke.py --write` walks BUILDINGS. That is right for judging output and wrong
for filling the corpus: 133,247 NYC buildings flag at least one rule, and they
collapse to 3,170 distinct prompts covering 909 rows, so a per-building run
would pay for the same sentence thousands of times. This walks the shapes.

    # what it would do, and what it would cost. No model, no key, no spend.
    cd api && ../.venv/bin/python -m services.briefs.build_corpus --dry-run

    # the real run, highest-traffic shapes first, resumable
    cd api && ../.venv/bin/python -m services.briefs.build_corpus \\
        --provider anthropic --cap 4200

    # a taste of it: the 25 shapes that cover the most buildings
    cd api && ../.venv/bin/python -m services.briefs.build_corpus \\
        --provider anthropic --limit 25 --cap 25

**A shape is `keys_for_selection`'s output** — the ordered `(rule_id,
input_key)` pairs for a building. Two buildings sharing one produce a
byte-identical prompt, because `input_key` already encodes everything the prompt
varies on: which rules fired, their hazard areas in order, and whether severity
language was permitted. Nothing else about a building reaches the model. So one
representative building per shape is enough, and which one is arbitrary.

**Resumable by construction.** A shape whose rows are all present at the current
`PROMPT_VERSION` is skipped, so an interrupted run is restarted by running it
again. Nothing is passed between runs; the corpus itself is the progress marker.

**Ordered by coverage, most buildings first.** A run stopped halfway has then
bought the most site coverage it could for what it spent — the largest single
shape covers 25,173 buildings. It also front-loads the rows most worth reading
if you are reviewing as it goes.

Rows are flushed every `--flush-every` shapes rather than once at the end. Over
3,170 calls the end is far away, and an upsert is idempotent, so a crash at call
3,000 should not throw away 2,999 sentences.
"""

import argparse
import asyncio
import os
import sys
from collections import defaultdict
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from services.briefs.corpus import keys_for_selection  # noqa: E402
from services.briefs.rules import select_rules  # noqa: E402
from services.briefs.schema import PROMPT_VERSION  # noqa: E402
from services.briefs.smoke import (  # noqa: E402
    CORPUS_UPSERT, _execute,
)
from services.briefs.validate import failures, is_publishable, validate  # noqa: E402

load_dotenv(dotenv_path=Path(__file__).resolve().parents[3] / ".env")


# Read from the view the PAGE reads, not from the base tables smoke.py queries.
# smoke.py goes to the base tables on purpose, so a smoke run can catch the view
# being stale; this is the opposite job. The corpus must be keyed on exactly
# what the route will look up, and the route reads this view — generating
# against fresher numbers than the page serves would produce keys no page asks
# for. `hpd_building_summary` supplies the percentile, which is not in the view
# and gates only whether severity language was allowed.
SIGNALS_QUERY = """
SELECT s.bin,
       s.open_class_c_violations, s.lead_paint_violations,
       s.smoke_co_detector_violations, s.open_class_c_categories,
       s.mold_complaints, s.pest_complaints, s.heat_hot_water_complaints,
       s.hpd_record_count, s.latest_hpd_activity,
       v.violations_density_pct
FROM hpd_brief_signals s
LEFT JOIN hpd_building_summary v ON v.bin = s.bin
"""

EXISTING_KEYS = """
SELECT rule_id, input_key FROM brief_texts WHERE prompt_version = $1
"""


def _signals(row) -> dict:
    """The signals dict, mirroring routes/hpd.py rather than smoke.to_signals.

    smoke's version derives `hpd_record_count` from the two summary tables it
    joins; the view carries it directly, and the route reads it from the view.
    Same rule for `latest_hpd_activity`. Where the two disagree the route wins,
    because the route is what will look these rows up.
    """
    return {
        "open_class_c_violations": row["open_class_c_violations"] or 0,
        "heat_hot_water_complaints": row["heat_hot_water_complaints"] or 0,
        "mold_complaints": row["mold_complaints"] or 0,
        "pest_complaints": row["pest_complaints"] or 0,
        "lead_paint_violations": row["lead_paint_violations"] or 0,
        "smoke_co_detector_violations": row["smoke_co_detector_violations"] or 0,
        "open_class_c_categories": row["open_class_c_categories"],
        "hpd_record_count": row["hpd_record_count"] or 0,
        "latest_hpd_activity": row["latest_hpd_activity"],
    }


async def plan(conn) -> tuple[list, dict, int]:
    """(shapes newest-first by coverage, existing keys, buildings that flag).

    One pass over every building. The representative row kept per shape is
    whichever came first — arbitrary on purpose, since by definition every
    building in a shape renders the same prompt.
    """
    rows = await conn.fetch(SIGNALS_QUERY)
    existing = {
        (r["rule_id"], r["input_key"])
        for r in await conn.fetch(EXISTING_KEYS, PROMPT_VERSION)
    }

    coverage: dict[tuple, int] = defaultdict(int)
    representative: dict[tuple, tuple] = {}
    flagged = 0

    for row in rows:
        signals = _signals(row)
        selected = select_rules(signals)
        if not selected:
            continue
        flagged += 1
        keys = tuple(keys_for_selection(
            selected,
            categories=row["open_class_c_categories"],
            percentile=row["violations_density_pct"],
        ))
        if not keys:
            continue
        coverage[keys] += 1
        representative.setdefault(keys, (row, selected))

    shapes = sorted(
        ((keys, representative[keys], coverage[keys]) for keys in coverage),
        key=lambda s: -s[2],
    )
    return shapes, existing, flagged


def _rows_for(keys, selected, result) -> list[tuple]:
    """The publishable `brief_texts` rows one generation earns.

    Validated PER SENTENCE, the same split `smoke._corpus_rows` makes and for
    the same reason: the corpus is keyed by rule and shape, so one bad sentence
    must not discard a good sibling that thousands of buildings share.

    `keys` comes from `keys_for_selection`, the function the route reads with.
    Any other derivation here would let writer and reader drift, and a drifted
    key is a permanent miss that looks exactly like phase 0.
    """
    out: list[tuple] = []
    rules = list(selected)
    record = result.record
    for i, (rule_id, input_key) in enumerate(keys):
        if i >= len(result.context.watch_for):
            break
        assert rule_id == rules[i].id, "keys_for_selection drifted from selected order"
        sentence = result.context.watch_for[i]
        verdicts = validate([sentence], selected_rules=[rules[i]])
        if not is_publishable(verdicts):
            print(f"    SKIP {rule_id}: "
                  + "; ".join(v.detail for v in failures(verdicts)))
            continue
        out.append((rule_id, input_key, sentence,
                    PROMPT_VERSION, record.model))
    return out


async def flush(pending: list[tuple]) -> int:
    """Upsert and clear. Deduplicated by key: two shapes can earn the same row,
    and ON CONFLICT cannot resolve two of them inside one statement."""
    if not pending:
        return 0
    by_key = {(r[0], r[1], r[3]): r for r in pending}
    columns = list(zip(*by_key.values()))
    await _execute(CORPUS_UPSERT, *[list(c) for c in columns])
    n = len(by_key)
    pending.clear()
    return n


async def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--provider", choices=["ollama", "anthropic"], default="ollama")
    p.add_argument("--model", default=None)
    # Counts PROVIDER calls, not shapes. A repair is a second call on the same
    # shape, so a cap equal to the shape count stops short — and stops mid-shape,
    # discarding that shape's work. Budget headroom: ~1.3x observed.
    p.add_argument("--cap", type=int, default=50,
                   help="hard cap on provider calls, repairs included. The full "
                        "corpus is ~3,170 shapes, so allow ~4,200")
    p.add_argument("--limit", type=int, default=None,
                   help="only the N highest-coverage shapes")
    p.add_argument("--flush-every", type=int, default=25)
    p.add_argument("--dry-run", action="store_true",
                   help="plan and cost only; no model, no key, no spend")
    p.add_argument("--force", action="store_true",
                   help="regenerate shapes whose rows already exist")
    args = p.parse_args()

    conn = await asyncpg.connect(
        os.environ["DATABASE_URL"].split("?")[0],
        server_settings={"statement_timeout": "300000"},
    )
    try:
        shapes, existing, flagged = await plan(conn)
    finally:
        await conn.close()

    todo = shapes if args.force else [
        s for s in shapes if not set(s[0]) <= existing
    ]
    if args.limit:
        todo = todo[:args.limit]

    all_rows = {k for s in shapes for k in s[0]}
    print(f"prompt version    : {PROMPT_VERSION}")
    print(f"buildings flagging: {flagged:,}")
    print(f"distinct shapes   : {len(shapes):,}")
    print(f"distinct rows     : {len(all_rows):,}  ({len(existing):,} already present)")
    print(f"shapes to run     : {len(todo):,}")
    if todo:
        print(f"top shape covers  : {todo[0][2]:,} buildings")
    # $0.00209/call measured over the validated calls in data/brief_calls.jsonl.
    print(f"estimated cost    : ${len(todo) * 0.00209:,.2f}\n")

    if args.dry_run:
        print("dry run — nothing generated.")
        return 0
    if not todo:
        print("corpus is complete at this prompt version.")
        return 0

    from services.briefs.generate import BriefGenerationFailed, generate_context_line
    from services.briefs.providers import (
        AnthropicProvider, CallCap, CallCapExceeded, OllamaProvider,
    )

    cap = CallCap(limit=args.cap)
    provider = (
        OllamaProvider(model=args.model or "llama3.1:8b", cap=cap)
        if args.provider == "ollama"
        else AnthropicProvider(model=args.model or "claude-haiku-4-5", cap=cap)
    )

    pending: list[tuple] = []
    written = failed = 0
    cost = 0.0

    for n, (keys, (row, selected), covers) in enumerate(todo, 1):
        label = ", ".join(rid for rid, _ in keys)
        print(f"[{n}/{len(todo)}] {label}  ({covers:,} buildings)")
        try:
            result = await generate_context_line(
                dict(row), selected, provider,
                building_id=row["bin"], city="nyc",
            )
        except CallCapExceeded as e:
            # Raised before dispatch, so this shape cost nothing. Stop cleanly
            # and keep what is already generated — the run is resumable, so a
            # cap is a pause rather than a failure.
            print(f"\n[cap] {e}")
            break
        except BriefGenerationFailed as e:
            cost += e.record.cost_usd or 0.0
            failed += 1
            print(f"    FAILED {e.record.validation_result}: {e}")
            continue

        cost += result.record.cost_usd or 0.0
        pending += _rows_for(keys, selected, result)
        if n % args.flush_every == 0:
            written += await flush(pending)
            print(f"    ... {written:,} rows written, ${cost:,.2f} spent")

    written += await flush(pending)
    print(f"\n{written:,} rows written · {cap.used} calls · {failed} failed "
          f"· ${cost:,.2f}")
    print("The API caches briefs for an hour and Next caches the fetch for a "
          "day — restart the API and rm -rf .next before reading a page.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
