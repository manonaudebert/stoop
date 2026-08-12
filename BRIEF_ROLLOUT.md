# Building Brief — rollout, cost, and open decisions

Companion to [`AI_METHODOLOGY.md`](AI_METHODOLOGY.md). That document covers how
the Building Brief is *built* and why the architecture is shaped the way it is.
This one covers what it costs to run, how it reaches the frontend, and which
decisions are still open.

Status: **phase 0 ships — the rules-only brief renders on every HPD building
page.** No corpus has been generated. The prompt has now been verified against
`claude-haiku-4-5` — 10 calls, $0.02 — so the cost figures below are measured on
the real model rather than extrapolated from Ollama.

Branch: `building-brief` (not pushed). Companion memory: the Building Brief
entry in the project memory index.

---

## Start here

**State: phase 0 is live and phase 1 has not started.** The brief on the page
today is 100% authored and cited — six rules, zero generated text, no model in
the request path. That is why it could ship before the validator exists: there
is nothing in it to hallucinate.

**Next step: phase 1**, in the order the open decisions block each other:

1. **Verify the prompt on Haiku** (open decision 5). ✅ **Done 2026-08-12** —
   two runs of five calls, `brief-v5` then `brief-v6`, all ten returning `ok`
   with no repairs and no refusals. Total spend **$0.02**. The run also
   corrected the cost model: see *Cost* below.
2. **Land the first validator check** (open decision 3). ✅ **Done 2026-08-12**
   — `vague_quantifiers` and `rights_language`, both lexical hard fails, both
   already observed failing on real output. `is_publishable` now has something
   to gate on, and `smoke.py --with-model` prints the verdicts, so step 1's five
   calls report whether their output would have published rather than leaving it
   to be eyeballed.
3. **`brief_texts` table and the corpus.** Table, key and read path landed
   2026-08-12; **the corpus itself has not been generated** and needs step 1
   first. `migrate_brief_texts.sql` is written and NOT yet applied to prod. The
   route joins the table already: with it empty, every `watch_for` comes back
   null and the page renders exactly as it does today.

`watch_for` renders in layer 1 beside the authored `brief_line`, carrying the
AI-assisted label. That gives phase 1 a per-rule kill-switch for free: if the
generated sentence for a rule is not clearly better than the authored line next
to it, that rule's corpus simply does not ship. No fallback logic to write.

### What is live, all on prod

| | |
|---|---|
| `hpd_brief_signals` | materialized view, 310,400 rows, applied 2026-08-11 |
| `GET /hpd/building/{bin}/brief` | watch items, citations, hazard areas, confidence note |
| Refresh | `sync_all.py::_refresh_all_views`, after both summary views |
| `BuildingBrief.tsx` | two-layer rendering, after the Severity card |
| Tests | 308, offline, no database and no API key |

Verified against real pages rather than only tests: BIN 2003187 (suppression
plus three layer-1 lines), BIN 3096715 (three items with citations), BIN 1000041
(the one-line empty state).

**Every phase 0 decision is settled**: display cap 5, empty state is one muted
line, rules run server-side, no numbers in layer 1, suppression on by default.
The reasoning for each is under *Open decisions* and *Frontend rollout*.

### What exists

All under `api/services/briefs/`:

| File | |
|---|---|
| `rules.yaml` | the six rules — `brief_line`, `condition`, `why_it_matters`, `action`, sources, suppression group. Config, not code; most product changes happen here |
| `rules.py` | predicate evaluation, priority + `rank_by` ordering, class C suppression, display cap |
| `signals.py` | the shared category lists and the generator for the view's SQL |
| `taxonomy.py` | the three HPD vocabularies and the renter-facing labels |
| `confidence.py` | the computed caveat (thin record / stale record) |
| `prompt.py` | what the model is allowed to see. It gets no numbers |
| `schema.py` | `GeneratedContext` — `watch_for: list[str]`, max 2, nothing else |
| `generate.py` | retry vs repair vs fatal, token accounting, call cap |
| `validate.py` | the publish gate — two lexical checks, both hard fails |
| `corpus.py` | the structured `input_key` a stored sentence is looked up by |
| `smoke.py` | signals in, brief out. Also `--check-view` |
| `golden.yaml` | hand-reviewed cases, failing outputs kept verbatim |

Tests: `test_briefs_rules.py` (engine), `test_briefs_route.py` (the API seam),
`test_briefs_signals_sql.py` (view/JSON drift).

### To see current output

```bash
cd api
../.venv/bin/python -m pytest tests/ -q
../.venv/bin/python -m services.briefs.smoke --bin 2003187 --signals
../.venv/bin/python -m services.briefs.smoke --limit 200 --check-view
```

All free and local. `--with-model` needs Ollama with `qwen3:8b` pulled.

**Do not** run `--provider anthropic` casually — it is the only path that spends
money, and it is step 1 above, capped at five calls.

**When a rendered page disagrees with rules.yaml, suspect a cache before a bug.**
`load_rules()` is `@lru_cache`d for the life of the API process, and Next serves
cached renders. Check the API directly — `/api/proxy/hpd/building/<bin>/brief` —
before believing the HTML.

---

## Cost

### Measured, not estimated

From `data/brief_calls.jsonl`, the 5 paid generations at
`PROMPT_VERSION = brief-v6`:

| | |
|---|---|
| Average input | **1,702 tokens** |
| Average output | **65 tokens** |
| Cost per call on `claude-haiku-4-5` | **$0.00203** |

**These replace figures measured on Ollama, which were 55% too low.** The old
row said 1,102 input tokens and $0.00131/call, taken from local `qwen3:8b`
runs. Haiku tokenizes the same prompt to ~1,700 — `qwen3:8b` counts ~1,062 for
byte-identical input. Nothing about the prompt grew; the tokenizers simply
differ, and a token count is not portable between them. **Never price a corpus
off local telemetry** — run `count_tokens`, or a handful of real calls, against
the model that will actually generate it.

An earlier estimate in this project put the corpus at ~$295. That was computed
against the v1 prompt and is superseded — v1 asked for a summary, concerns, and
a confidence note from a full metrics dump. The prompt has both grown (more
instruction) and shrunk (no metrics dump), and the corpus size assumption
changed. Recompute from telemetry rather than trusting any figure in an older
document.

### The two levers

| Approach | Calls | Cost |
|---|---|---|
| Naive — one per eligible NYC building | 463,913 | $940 |
| Skip zero-flag buildings | 242,858 | $492 |
| **Deduplicate identical prompts** | ~11,850 | **$24** |
| Dedup + Batch API (50%) | ~11,850 | **$12** |

Recomputed 2026-08-12 at the measured Haiku rate. The conclusion is unchanged
and the argument for dedup is unaffected — a 39× reduction either way.

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
robust to the estimate being wrong — at 25,000 distinct prompts it is $51. Identical text across buildings is *correct*
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
why-it-matters and action text, page citations, and the confidence note are
computed or authored. That is the majority of the brief, and it can
ship with zero AI spend, no corpus, and no dependency on the validator.

### Where the rule engine runs — decided 2026-08-11

An earlier version of this doc said phase 0 needed **no backend work**, since
all seven signals come from fetches the page already makes. That was true of the
*signals* and false of the *rules*: `rules.yaml`, the predicate evaluator, the
ordering and the cap are all Python. Rendering on the page meant either porting
them to TypeScript or adding an endpoint.

**Decided: endpoint.** Three reasons, in the order they mattered:

1. **Phase 1 needs materialized signals regardless** — the live query is ~2.5s.
   So the endpoint does not add infrastructure, it front-loads infrastructure
   already committed to. Sequencing question, not a waste question.
2. **The corpus is keyed on a hash of the rendered prompt.** A TypeScript rule
   engine would also have to reproduce `prompt.py` byte-for-byte to compute the
   lookup key. A stray space means a permanent hash miss, which silently falls
   back to phase-0 rendering and looks completely fine.
3. **The validator would otherwise check a selection the reader never sees.**
   The designed check set includes *rule-id subset*, which runs against Python's
   `select_rules`. With selection in TypeScript, drift stops being a maintenance
   annoyance and becomes text validated against one rule set and displayed
   against another.

The deciding variable was how long phase 0 would run alone. Answer: phase 1
follows immediately, so a TypeScript port would have been churn with a known
demolition date.

### The signals view, and why its SQL is generated

`hpd_brief_signals` is one row per building carrying the seven rule signals plus
the two confidence inputs and the class C hazard categories. It exists because
computing them inline takes ~2.5s per building against an 11M-row table — fine
for a smoke run, impossible for a page render.

**The migration is generated, not hand-written.** `signals.py::render_migration`
emits `ingest/migration/migrate_hpd_brief_signals.sql`, reading the complaint
categories from `renter-facing-groups.json` through the shared taxonomy. Inlining
those arrays as SQL literals would fork the heat definition away from the JSON
the building page's "Heat / hot water" card reads, which is the exact bug the
taxonomy alignment fixed — and it would fork silently. `test_briefs_signals_sql.py`
regenerates the file and fails if it drifts, if `schema.sql` drifts from either,
or if the heat list stops equalling the taxonomy group. Verified by removing
`RADIATOR` from the JSON and watching the suite go red.

The view and `smoke.py` deliberately do NOT share a query: smoke computes from
the base tables, so a smoke run can catch the view being wrong. `--check-view`
compares them per building and is the only thing that surfaces a stale refresh —
a stale view renders confidently wrong numbers with no visible symptom.

**Heat's minor-categories were re-verified when the view was built**, because
filtering on `minor_category` alone looks unsafe for two generic-sounding names.
`APARTMENT ONLY` (1,007,982 rows) and `ENTIRE BUILDING` (1,895,894) occur under
`HEAT/HOT WATER` and no other major, so there is no contamination. `RADIATOR`
genuinely spans PLUMBING, PAINT/PLASTER and HEATING — but `MINOR_TO_GROUP` on
the frontend also keys on minor alone, so the card counts all three the same
way. Matching the card is the point. Do not "fix" this by adding a
`major_category` filter to the backend alone.

**Route shape worth knowing:** a BIN with no row in the view is not a special
case and not a 404. It feeds all-zero signals through the identical path, so it
comes back `no_flags` like any other quiet building — and picks up
`confidence.py`'s zero-record branch, which an early return had been skipping.
`has_records` splits the two empty states for the frontend so it never has to
match the note's wording.

### Phase 0 — rules only, no model

Building page renders the watch items. ~52% of buildings get content; the rest
show the one-line empty state (never a hidden section).

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

### Phase 0.5 — two-layer rendering and overlap suppression (2026-08-11)

The first rendering put the full authored block on the page for every item. It
is legally careful and cited, which is exactly what makes it long, and the page
already carries every count in cards above it. Two changes followed.

**Two layers.** Layer 1 is one authored line per item (`brief_line` in
rules.yaml, ≤16 words), plus for the class C item the bare group labels of its
hazard areas. Layer 2 is the full block — condition, why_it_matters, hazard
areas with their authored sentences, action, citation — verbatim behind a
native `<details>`. Server component, no client JS, and the expanded text stays
findable by in-page search.

**No numbers anywhere — `magnitude` removed 2026-08-12.** It was a per-rule
count template ("46 currently open"), already unrendered on the page after a
chip was tried and cut. It is now gone from rules.yaml, the `Rule` dataclass,
the API response, the TypeScript type, and the smoke output, so the brief shows
no counts at all.

The justification had retired twice over and the field had not: the counts sit
in cards inches away on the same page, and suppression now encodes severity
structurally — a condition an inspector confirmed replaces the complaint rule
entirely rather than out-numbering it. A field kept alive by its own comment
explaining why nothing reads it is the drift those comments exist to prevent.

`rank_by` is a different field and stays — it orders priority peers by the
signal that decides which is the bigger problem, and is never displayed. Two
tests pin the absence: no `magnitude` key in rules.yaml, and no unrendered `{}`
template in any authored string.

**The class C condition names the building's hazard areas — added 2026-08-12.**
"Conditions that HPD classifies as immediately hazardous are currently open on
this building's record" names no observable thing, which is the same gap the
model's hazard-area block exists to close; it is now closed for the reader too:

    ...on this building's record, including issues related to mold and pests,
    and building maintenance.

`areas_clause` in rules.yaml carries the phrasing (product copy belongs there),
and code fills `{areas}` from the taxonomy in open-count order. Three things
this is NOT: it is not a count (`magnitude` was deleted the same day — this says
*what* is open, never *how much*); it is not model output; and it is not a
rewrite of the authored sentence, which survives as a literal prefix with only
its period moved. The route test pins exactly that.

**It needed a third naming form, and that is the interesting part.** The raw HPD
categories are jargon and, worse, a second name for a group the page already
names — the card says "Safety & fire", the raw category is `EGRESS`. The chart
labels are legends built for a constrained axis and read badly mid-clause
("bldg maintenance", "heat / hot water"). So the taxonomy JSON grew
`prose_label`: an *expansion* of the same name, never a different one, which is
what keeps the one-page-one-vocabulary rule intact. A test pins that every group
carrying violation categories declares one.

**The two-item join was wrong and only a rendered page showed it.** "heat and
hot water" is a single area, so the ordinary "X and Y" join produced "mold and
pests and building maintenance". `join_prose` now uses the serial comma whenever
any entry contains its own "and". Renaming the areas to avoid it was the wrong
fix — it would have reintroduced the second-name problem to dodge a punctuation
one.

**`PROMPT_VERSION` is unaffected.** The model is still shown the plain authored
`condition`; the areas reach it through its own block, with the tooltips that
make them concrete. Composing them into the sentence the model sees would only
invite it to read the list back. The verified `brief-v6` corpus key still holds.

**`brief_line` may compress the cited text but never extend it.** It inherits
its rule's citation, so at fifteen words the temptation to add practical advice
is strongest exactly where attribution is weakest. "Ask how last winter went",
"check under the sinks", "ask the current tenants" are all good renter instincts
and none are in the ABCs of Housing; none of them shipped. Where the source
offers nothing concrete enough to compress, omit the field and fall back to
`condition`.

**A factual correction to the class C text, found by reading the rendered
page.** It said "most must be corrected within 24 hours of the owner being
notified". HPD's correction timeline is not uniform: heat and hot water carry no
grace period, self-closing doors 14 days, and lead paint, window guards, mold
and mice/cockroaches/rats 21 days; only "all other class C" is 24 hours. The
carve-outs are among the most common class C categories there are — three of
them have their own rules in this file — so the claim was false on exactly the
buildings most likely to display it.

The replacement also restores a distinction the old text lost: these are the
windows past which civil penalties can be sought in Housing Court, measured from
date of service, not a promise the condition is fixed by then.

Two things this says about the process. The correct 14-day figure was already
sitting in a comment eleven lines below the wrong text, in the deferred
self-closing-doors note — so the file contradicted itself and nothing caught it.
And no test can catch this class of error: the suite pins that authored text
reaches the page *verbatim*, which is worth having and is orthogonal to whether
the text is true. Page citations are the only real defence.

**Which is why a rule can now cite more than one document.** That timeline is
NOT in the ABCs of Housing — it is on HPD's
[penalties and fees page](https://www.nyc.gov/site/hpd/services-and-information/penalties-and-fees.page).
Leaving the item citing only the PDF would have put a real claim behind a
reference that does not support it, which is worse than no citation at all: it
looks checkable and fails when checked.

So `rules.yaml` grew `additional_sources`, and the class C item carries two,
each naming what it backs:

    NYC HPD, ABCs of Housing 2024 (Tenants' Guide), p.11-12 — violation classes
    NYC HPD, Penalties and Fees — correction deadlines            [links out]

Sources with a `url` render as real links; a citation a reader cannot follow is
decoration. `covers` is only populated when a rule cites more than one document,
where the reader needs to know which source to check for which claim — on a
single-source rule it would just restate the item, and a test pins that.

The page was verified at source before citing it, not taken from the screenshot:
WebFetch gets a 403 from nyc.gov, so fetch it with curl and a browser
user-agent, and all six rows parse out of the HTML. Every figure matches.

**Overlap suppression.** A complaint-keyed rule is dropped when its taxonomy
group already appears in `open_class_c_categories`. Found on BIN 2003187: "Mold
& pests" was a class C hazard area *and* the mold and pests complaint rules each
fired standalone — one condition stated three times, with the weakest evidence
getting top billing and the strongest reduced to a sub-bullet. Verified
supersedes reported.

Measured over the same random 8,000-building sample:

| | before | after |
|---|---|---|
| heat_hot_water | 31.1% | 23.1% |
| pests | 14.5% | 6.2% |
| mold | 10.2% | 3.9% |
| cap-5 truncation | 1.76% | **0.09%** |

14.5% of buildings see at least one suppression. Zero-flag stays at 48.1%, which
is the right invariant: suppression can only fire when class C already fired, so
it can never empty a brief. The cap of 5 is now generous — that is fine, it is a
guard rather than a target.

Suppression is declared per rule in rules.yaml, not hardcoded, and
`rules.suppressed_rules()` exposes what was removed so it is inspectable rather
than a silent subtraction. Both mold and pests suppress off the same group
deliberately: the violation taxonomy does not separate them.

**Two things that bit during this change**, worth not repeating:

- **`"HEAT & HOT WATER"` is not an HPD violation category.** The real string is
  `HEAT AND HOT WATER`. A test fixture used the ampersand form, which maps to no
  taxonomy group, so it silently exercised neither hazard-area labels nor
  suppression while appearing to pass.
- **`load_rules()` is `@lru_cache`d, and the dev server caches renders.** After
  editing rules.yaml, a running API keeps the old rules until its process
  restarts, and Next will serve a cached page even once the API is correct. A
  stale page here looks exactly like a bug in the change. Verify against the API
  directly (`/api/proxy/hpd/building/<bin>/brief`) before believing the HTML.

### Phase 1 — generated sentences

Add `watch_for`, stored once per distinct prompt shape rather than per building:

```
brief_texts(
  rule_id        text,             -- the rule this sentence answers
  input_key      text,             -- structured, see below
  watch_for      text,
  prompt_version text,
  model          text,
  validated_at   timestamptz,
  primary key (rule_id, input_key, prompt_version)
)
```

~12,000 rows for all of NYC. A missing key falls back to phase-0 rendering, so a
partial corpus is a normal state rather than a broken one — and, with the
per-rule kill-switch above, a deliberate one.

**Key on structure, not on a hash of the rendered prompt.** The earlier design
used `sha1(user turn)`. It works, but it welds the corpus to the exact bytes of
`prompt.py`'s output: any consumer computing a lookup would have to reproduce
that rendering character-for-character, and a stray space becomes a permanent
miss that silently degrades to phase-0 rendering and looks completely fine. A
structured key — the rule id, its hazard areas, and whether severity language
was permitted — is computable from the same data the page already has, and
`prompt_version` still invalidates the corpus when the wording changes. That
was also part of why rule evaluation lives server-side; see *Where the rule
engine runs*.

**Where `watch_for` renders, decided 2026-08-11.** Generated sentences go in
layer 1, beside or in place of the authored `brief_line` for their rule, and
carry the AI-assisted label. Layer 2 stays fully authored.

The consequence is the cheapest kill-switch this feature will ever have: with a
`brief_line` authored for every rule, `watch_for` has to EARN its slot by being
more concrete than the authored line it sits next to. If Haiku's output for a
given rule is not clearly better, the corpus for that rule simply does not ship
— per rule, with zero rendering change and no fallback logic to write. Keep it.

**What landed 2026-08-12**, leaving only the corpus itself outstanding:

- **The validator gates publishing.** Two checks, both lexical, both
  unconditional hard fails: `vague_quantifiers` and `rights_language`. Chosen
  first because both have been *observed* failing rather than anticipated — "A
  few issues…" opened the first three sentences ever generated, for buildings
  carrying 616, 473 and 552 open violations. The remaining designed checks
  (numeric, categorical, absence, causal, absolute-severity, rule-id subset) are
  still unimplemented; they need the record behind a sentence, which is why
  every check is handed the rule its sentence answers rather than prose alone.

  A hard fail costs a rule its corpus entry, so both checks are written to avoid
  false positives on the sentences the field exists for. "Ask the landlord who is
  responsible for pest treatment" must pass — `responsible for` was tried in the
  obligation pattern and cut for exactly that sentence. `must`/`required` fail
  only when attached to a party, because "you must look closely" is advice, not
  an entitlement.

  The banned-quantifier list is pinned by test to also appear in `prompt.SYSTEM`:
  a word that hard-fails but was never in the prompt quarantines output for a
  constraint the model could not have known. When they drift, the prompt is what
  gets updated.

- **`brief_texts` exists as a migration** (`migrate_brief_texts.sql`, not yet
  applied) and the route reads it. `corpus.py::input_key` builds the structured
  key; `keys_for_selection` looks up only the top `MAX_WATCH_ITEMS` rules,
  because only those were ever generated. A zero-flag building makes no corpus
  query at all — half the site, on its hottest route.

  Two things the key had to get right that the design sketch did not name.
  **The severity segment needs the percentile, which `hpd_brief_signals` does not
  carry** — the route joins `hpd_building_summary` for it rather than adding a
  column, since the rules never read it and a new column costs a full recompute.
  **Hazard areas key on `group:CATEGORY`, not on the group**, because
  `describe_hazard_areas` pairs a group label with the *specific* category's
  authored sentence: two buildings resolving to the same group can be shown
  different text, and one corpus row would serve one of them the sentence written
  from the other's condition.

**Still outstanding: the corpus.** Nothing has been generated, so every
`watch_for` is null and the page is byte-identical to phase 0. Generating it
needs step 1 first, and the frontend has no rendering for the field yet — that
change is where the AI-assisted label gets designed.

The signals are already materialized (`hpd_brief_signals`), so the ~2.5s live
query that used to block this is no longer in the way.

---

## Open decisions

Ordered by what blocks what. Each says what it would take to settle it.

### 1. Empty-state copy for zero-flag buildings — SETTLED 2026-08-11

Renders as **one line of muted text, not a card** — visually close to hidden so
it does not eat the top of half the site's building pages, but the qualifier
stays on the page:

> Nothing here crossed the thresholds we flag — which is not the same as no
> problems. Full violation and complaint history below.

The reasoning against hiding the section entirely is below; it is the argument
that decided it, and it is not the house rule.

### 1b. The original framing, kept because the argument matters

47.6% of buildings fire no rule. That is the single most common state on the
site and the least designed. The brief must not imply the building is
problem-free: nothing crossing a threshold is not the same as nothing being
wrong, and these are not empty buildings (median 9 HPD records, median
percentile ~31).

The house rule is *empty state over hiding* — show a "no records" message rather
than dropping the section. Needs copy, not code.

**Why hiding the section is the wrong answer here**, beyond the house rule:
hiding does not remove the message, it removes the qualifier. A renter
comparing two buildings sees the section on one and not the other and reads the
absence as "this one is fine" — the exact misreading, now unlabelled and so
impossible to correct. At 48% that inference gets made on half of all page
views. The cost hiding avoids is real, though (an empty card above the charts on
half the site), which points at a one-line treatment rather than a card: no
border, no heading, muted — visually close to hidden, qualifier still on the
page.

### 2. Display cap — SETTLED 2026-08-11, raised 4 → 5

Re-measured over a fresh random 8,000-building sample with all six rules in
place. The suspicion was right: adding `smoke_co_detectors` above the complaint
rules nearly doubled truncation, and mold and pests absorbed all of it.

| Cap | Buildings truncated | Rules lost |
|---|---|---|
| 3 | 10.61% | pests 641 · mold 544 · detectors 245 |
| 4 (was) | 5.50% | mold 330 · pests 251 |
| **5 (now)** | **1.76%** | mold 101 · pests 40 |
| 6 | 0% | — |

Raised to 5, not dropped. Six rules is a hard upper bound today, so a cap of 6
would be a no-op — but the cap is what stops the *next* authored rule from
silently lengthening every brief, so it stays as a guard and moves deliberately.

Layout impact is small either way: 90.6% of buildings show three items or
fewer, and the list only reaches five on 5.5% of them.

Base rates from the same sample, useful on their own:

| Rule | Fires on |
|---|---|
| `open_class_c` | 36.4% |
| `heat_hot_water` | 31.1% |
| `smoke_co_detectors` | 21.8% |
| `pests` | 14.5% |
| `mold` | 10.2% |
| `lead_paint` | 6.5% |

Zero-flag buildings came in at **48.1%**, confirming the 47.6% figure the cost
model rests on.

### 3. Which validator check lands first — SETTLED 2026-08-12

**Vague quantifiers and rights language**, both lexical, both unconditional hard
fails. They were the cheapest to write and the only two in the designed set that
had already been *seen* failing rather than reasoned about.

The per-issue `watch_for` shape is what made them writable: each sentence is
answerable to one flagged rule, so a check runs against a single record rather
than against prose. That is also why the check signature takes the rule and not
just the sentence — the rest of the designed set (numeric, categorical, absence
claims) needs the record, and a signature that only saw text could never grow
one.

Still unimplemented, in `AI_METHODOLOGY.md`'s order: numeric claims, categorical
claims, absence claims, causal language, absolute-severity adjectives, rule-id
subset. None of them block the corpus the way an empty registry did.

### 4. Whether SF gets briefs — not blocking

SF has its own datasets, no authored rules, and no equivalent of the ABCs of
Housing to cite. The citation discipline is the product's spine, so this is a
sourcing question before it is an engineering one.

### 5. Prompt tuning against Haiku — SETTLED 2026-08-12

Tuning stopped deliberately after three rounds on `qwen3:8b`. Structural
properties hold everywhere — no invented numbers, no jargon, no rights language
— but style instructions land unevenly on an 8B model. The corpus will be
generated by `claude-haiku-4-5`, so verify there before tuning further:

```bash
cd api && ../.venv/bin/python -m services.briefs.smoke \
    --with-model --provider anthropic --limit 5 --cap 5
```

Five calls, well under a cent. The call cap raises *before* dispatch, so hitting
it costs nothing.

**Run 2026-08-12 — SETTLED.** Two rounds of five calls, `brief-v5` then
`brief-v6`, all ten `ok`: no repairs, no refusals, no truncation, no dropped
`watch_for`. $0.02 total. The run prints validator verdicts alongside each
sentence, so it answered both questions at once.

**One bug surfaced on the first paid call, and only there:** `output_config`
carried `effort: "low"`, which is an Opus-tier parameter. Haiku rejects it with
a 400 — *"This model does not support the effort parameter"* — rather than
ignoring it. It had never been exercised because the dev loop runs against
Ollama, whose provider takes no `effort` at all. `AnthropicProvider(effort=...)`
now defaults to `None` and the key is omitted unless set. The same shape of gap
is worth expecting anywhere the free path and the paid path differ.

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
- **`smoke.py`'s stratified sample is at most six buildings, at any `--limit`.**
  `DISTINCT ON (width_bucket(..., 0, 100, 5))` has six buckets, so `--limit 200`
  against it silently checks six and reports success. `--check-view` samples
  randomly for exactly this reason.
- **The route caches on `hpd_brief:{bin}`, and tests share a BIN.** Two `_get`
  calls in one test returned the same response, so a test comparing two briefs
  was comparing a response to itself and passing unconditionally. The helper
  clears the cache first.
- **`tsc --noEmit` passing does not mean `next build` passes.** Observed again
  here: tsc exited 0 on a component referencing a field absent from the TS
  interface; the build rejected it. Verify with `npm run build`.
- **Capture the build's real exit code.** `npm run build | tail` reports
  *tail's* status, so a failed build looks like a pass. Redirect to a file and
  echo `$?` instead.
- **Server fetches sit in Next's Data Cache for a DAY** (`revalidate` in
  `lib/api.ts`). Change the API's response shape and the page keeps reading
  yesterday's payload — which is how a missing field took down an entire
  building page, not just the brief. Components rendering API lists should guard
  the shape they did not expect; a server test is the right place to pin that
  the field is really always sent.
- **`.next/cache` is NOT where the dev Data Cache lives in Next 16.** A stale
  entry survived in `.next/dev/` through several restarts and made a correct
  change look broken. `rm -rf .next` is the one that works. Related: a `next dev`
  process can survive `pkill -f "next dev"` and keep repopulating the cache —
  check `ps` before concluding the clear worked.
- **Always check the API before the HTML.** Three separate times this session a
  "bug" was a cache: `load_rules()` is `@lru_cache`d per API process, and Next
  caches both renders and fetches. `/api/proxy/hpd/building/<bin>/brief` bypasses
  the page path and answers "is this the code or the cache" in one call.
