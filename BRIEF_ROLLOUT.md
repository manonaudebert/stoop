# Building Brief — rollout, cost, and open decisions

Companion to [`AI_METHODOLOGY.md`](AI_METHODOLOGY.md). That document covers how
the Building Brief is *built* and why the architecture is shaped the way it is.
This one covers what it costs to run, how it reaches the frontend, and which
decisions are still open.

Status: **nothing renders on the frontend, no corpus has been generated, no
paid API call has been made.** All numbers below are measured locally against
`qwen3:8b` via Ollama, or computed from real data.

Branch: `building-brief`.

---

## Cost

### Measured, not estimated

From `data/brief_calls.jsonl`, 40 successful local generations at
`PROMPT_VERSION = brief-v5`:

| | |
|---|---|
| Average input | **1,102 tokens** |
| Average output | **42 tokens** |
| Cost per call on `claude-haiku-4-5` | **$0.00131** |

An earlier estimate in this project put the corpus at ~$295. That was computed
against the v1 prompt and is superseded — v1 asked for a summary, concerns, and
a confidence note from a full metrics dump. The prompt has both grown (more
instruction) and shrunk (no metrics dump), and the corpus size assumption
changed. Recompute from telemetry rather than trusting any figure in an older
document.

### The two levers

| Approach | Calls | Cost |
|---|---|---|
| Naive — one per eligible NYC building | 463,913 | $608 |
| Skip zero-flag buildings | 242,858 | $318 |
| **Deduplicate identical prompts** | ~11,850 | **$15.53** |
| Dedup + Batch API (50%) | ~11,850 | **$7.77** |

**Lever 1 — skip zero-flag buildings.** 47.6% of buildings fire no rule, so
`watch_for` is `[]` by construction and there is nothing for the model to write.
`generate_context_line` should not be called at all for them. This is a guard,
not a feature, and it halves the corpus.

**Lever 2 — deduplicate by prompt.** This falls out of a decision made for an
entirely different reason. The prompt contains no counts, no percentile, no
address, no neighborhood — all stripped so the model could not misstate a
number. The consequence is that **the prompt is a pure function of (which rules
fired, which hazard areas, whether severity language is permitted)**. Thousands
of buildings produce a byte-identical prompt, and a byte-identical prompt needs
exactly one generation.

Measured on two random samples:

| Sample | Calls needed | Distinct prompts | Collapse |
|---|---|---|---|
| 3,000 buildings | 1,606 | 559 | 2.9× |
| 12,000 buildings | 6,282 | 1,282 | 4.9× |

Distinct prompts grow sublinearly — fitting the two points gives an exponent of
**0.61**, projecting **~11,850 distinct prompts** across all of NYC. A 39×
reduction against naive.

Caveats worth carrying: this is a two-point power-law fit and could be off by
2×, but even at 25,000 distinct prompts the corpus is $33, so the conclusion is
robust to the estimate being wrong. Identical text across buildings is *correct*
here rather than a bug — `watch_for` says what to look at given a hazard type,
and every building-specific number is rendered by code around it ("674 currently
open"). The authored rule text is already identical across buildings, so this
introduces no new kind of sameness.

### The review bonus

The 8 most common prompts cover **31%** of all buildings needing a brief. A
corpus of ~12k where a hundred entries cover most of the site is small enough to
**hand-review the high-traffic outputs before anything ships**. That is a far
stronger validation position than sampling 200 rows out of 464k, and it was not
available under the naive design.

### Rejected

- **Prompt caching.** `SYSTEM` is ~900 tokens, under Haiku's 4,096-token minimum
  cacheable prefix. `cache_control` is a silent no-op — it returns
  `cache_creation_input_tokens: 0`, not an error. Verify with `count_tokens`
  before assuming otherwise.
- **On-demand generation.** Stops being worth its complexity once the whole
  corpus costs single-digit dollars, and it would put generation and validation
  on the request path.
- **A smaller model.** Haiku is already the floor.

---

## Frontend rollout

### The thing that makes phasing possible

**The deterministic layer needs no model at all.** Watch items, their
why-it-matters and action text, page citations, magnitudes, and the confidence
note are computed or authored. That is the majority of the brief, and it can
ship with zero AI spend, no corpus, and no dependency on the validator.

### Phase 0 — rules only, no model

Building page renders the watch items. ~52% of buildings get content; the rest
show an empty state (never a hidden section). **No backend work required** — all
seven signals are derivable from fetches the page already makes.

Signal parity check against `frontend/app/hpd/building/[bin]/page.tsx`, which
already makes 11 parallel fetches:

| Signal | Available from | Status |
|---|---|---|
| `open_class_c_violations` | `getHpdBreakdown` → `open_count` where class C | ✅ |
| `lead_paint_violations` | same, `category = 'LEAD-BASED PAINT'` | ✅ |
| `smoke_co_detector_violations` | same, the two detector categories | ✅ |
| `open_class_c_categories` (hazard areas) | same, class C rows by `open_count` desc | ✅ |
| `mold_complaints` | `getHpdComplaintMinorBreakdown(bin, 5)` → `MOLD` | ✅ |
| `pest_complaints` | same → `PESTS`, `VERMIN` | ✅ |
| `heat_hot_water_complaints` | same → the `heating_hot_water` group | ✅ |

Note `getHpdBreakdown` is all-time but carries `open_count`, which is what the
rules want: open is point-in-time, and a violation issued a decade ago can still
be open. `getHpdBreakdownRecent` (5yr) is the wrong input for these signals.

### The heat definition — resolved

The backend originally used `major_category = 'HEAT/HOT WATER'`. The page's
"Top complaint groups" card uses the shared taxonomy's `heating_hot_water` group,
and those are not the same set:

| Minor category | 5yr count | In the `HEAT/HOT WATER` major? |
|---|---|---|
| ENTIRE BUILDING | 909,994 | all of them |
| APARTMENT ONLY | 477,480 | all of them |
| RADIATOR | 36,162 | **none** |
| BOILER | 726 | **none** |

The card wins, and the backend changed to match. Two reasons. The card is what
the reader sees, and it is labelled "Heat / hot water" — the same words the rule
uses — so a different number is a visible contradiction on one page. And
RADIATOR and BOILER are obviously heat to a renter, whatever major HPD files
them under.

Measured over 4,000 random buildings: 20 newly fire, none stop firing (the group
is a superset), and **263 buildings — 21% of those where the rule fires — had a
different count** under the old definition. Every one of those would have printed
a number beside a card showing a different one.

`smoke.py` now reads `HEAT_CATEGORIES` from `taxonomy.minor_categories(
"heating_hot_water")` rather than hardcoding it, so the two cannot drift, and a
test pins them equal.

**Mold and pests are the opposite case and stay deliberately narrower** than
their `mold_pests_sanitation` group, which also contains RUBBISH, ODOR, and
UNSANITARY CONDITION. That is safe precisely because the labels differ: the card
says "Mold & pests", the rule says "Tenants here have reported mold". A narrower
claim may carry a narrower number. The test suite pins both relationships — equal
for heat, strict subset for mold and pests — so the reasoning survives the next
person who notices the inconsistency.

### Phase 1 — generated sentences

Add `watch_for`, read by content hash rather than by building:

```
brief_texts(
  input_hash    text primary key,   -- sha1 of the rendered user turn
  watch_for     jsonb,              -- list[str], max 2
  prompt_version text,
  model         text,
  validated_at  timestamptz
)
```

~12,000 rows for all of NYC. A missing hash falls back to phase-0 rendering, so
a partial corpus is a normal state rather than a broken one.

**Blocked on two things that do not exist:**

- **The validator has no checks implemented.** `validate.py` has a registry seam
  and `is_publishable([])` deliberately returns `False`, so nothing can be
  published while the registry is empty. This is a guard, not an oversight —
  `all([])` is `True` and would silently green-light every brief.
- **No storage table and no endpoint.**

The live signal query takes ~2.5s, which is too slow for a page render. Phase 1
needs the signals materialized regardless.

---

## Open decisions

| Decision | Status |
|---|---|
| Heat signal definition | **resolved** — matches the page card, see above |
| Display cap of 4 with 6 rules | **open** — mold/pests now truncate more often; needs a re-measured base rate |
| Which validator checks land first | **open** — nothing publishes until at least one exists |
| Zero-flag empty state copy | **open** — 47.6% of buildings, the most common state and the least designed |
| Whether SF gets briefs | **open** — SF has its own datasets and no rules authored |

---

## Things that cost time, recorded so they cost it once

- **Never read rule base rates off `smoke.py`'s default sample.** It is
  stratified by percentile bucket and takes the *worst* building in each, so
  every rule fires by construction. Use an `ORDER BY random()` dump instead.
- **Importing `services.briefs.generate` drags in the Anthropic SDK.** The
  package `__init__` keeps it lazy on purpose. A helper placed in `generate.py`
  and imported by the deterministic path turned a 1.35s smoke run into minutes.
  Keep prompt-assembly helpers in `prompt.py`.
- **Watch the CPU-vs-wall split before blaming the code.** A test suite that
  normally runs in 1.0s took 1,235s while using 1.7s of CPU — pure I/O
  contention from concurrent local model runs, not a regression.
- **`--with-model` holds a 5.3GB model resident.** Killing the Ollama runner
  makes the next run pay a cold reload.
