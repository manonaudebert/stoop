# AI Methodology

Companion to [`METRICS.md`](METRICS.md). That document covers how Stoop's risk
scores are computed. This one covers the single AI-generated feature — the
**Building Brief** — and, more importantly, everything about it that is *not*
AI-generated.

For what it costs to run, how it reaches the frontend, and which decisions are
still open, see [`BRIEF_ROLLOUT.md`](BRIEF_ROLLOUT.md).

Status: **phase 0 is live — every HPD building page shows a brief, and none of
it is generated.** What renders today is entirely authored and cited: six rules,
their compact `brief_line`, and the full block behind a disclosure. The model,
the validator and the corpus are phase 1 and are not built. That ordering is the
architecture working as intended — the deterministic layer is the majority of
the product and shipped without waiting on any of them.

---

## The governing question

The architecture is an answer to one question: *how little can the model be
allowed to do?*

The first working version had the model write a summary, a list of concerns, and
a confidence note from a building's computed metrics. It produced this for a
building at the **31st percentile** — better than roughly 69% of its
neighborhood:

> "High number of open violations, especially class C and B."

Two failures in one sentence. It inferred absolute severity ("high") from a
relative rank, and it used HPD jargon ("class C") that means nothing to a
renter. Neither is fixable by prompting alone, because neither is a phrasing
problem — the model had been given four jobs and only one of them was ever
really a language job.

The current design gives it one job: for each of the two most significant
flagged issues, write one sentence naming something a renter can look at or ask
about. It selects nothing, computes nothing, and says nothing about the building
as a whole. Everything else is computed or authored.

That last clause is the most recent narrowing. A `context_line` field described
the building overall, and it was the only generated text that could get the
whole building wrong — which it did, calling a building better than 89% of its
neighborhood "typical", then "typical ... with fewer violations than most" in
one breath. Removing it means every generated sentence now answers one flagged
issue, so every sentence has exactly one record to be checked against.

---

## What is computed vs. generated

| | Source | Generated? |
|---|---|---|
| Every count, percentile, class breakdown, trend | Postgres | No |
| Risk levels and neighborhood rankings | SQL (`PERCENT_RANK()` within NTA) | No |
| Complaint category groupings | Shared renter-facing taxonomy | No |
| "What you can do about it" advice | Rules table, authored from NYC HPD's *ABCs of Housing 2024* with page citations — plus, where a claim is not in that document, the HPD page that carries it | **No** |
| Which of up to 5 pieces of advice apply | Rule predicates over computed signals, ranked by priority then magnitude | No |
| Which advice is redundant and dropped | Class C hazard group overlaps the rule's group — verified supersedes reported | No |
| The compact line the page leads with | Rules table (`brief_line`), compressed from the same cited text | **No** |
| Confidence note | Computed from record count and recency | No |
| One sentence of what to look at, per flagged issue (max 2) | Model | **Yes** |

The rule that makes the rest possible: **the model never computes.** Not because
computation is risky in itself, but because a claim can only be verified against
a source record if the source record is where the claim came from. A number the
model derived has nothing to check it against.

---

## Architecture

```
1. DATA        Postgres. Numbers, percentiles, categories, trends.
                   ↓ signals
2. RULES       Predicates over signals select advice, ranked by priority.
               Authored from HPD guidance with page citations. No model.
                   ↓ selected rules + computed confidence note
3. MODEL       watch_for: list[str]  ← one sentence per flagged issue, max 2.
                                     What to look at. Never a right.
                                     watch_for[i] answers selected_rules[i].
                   ↓ unvalidated
4. VALIDATION  groundedness · severity language · jargon · causal claims
                   ↓ pass → published    fail → quarantined
5. STORAGE     keyed by BIN, with prompt version + source-data hash
                   ↓
6. PAGE        Renders published briefs. No brief → page as it is today.
```

Everything above and below layer 3 runs without a model, and layer 3 produces
two sentences. If the model is unavailable, layers 1–2 still yield a complete set
of watch items with their guidance intact — the generated lines are the only part
that can go missing, and nothing a tenant needs to act on lives there.

### Why advice is selected by rules, not written by the model

An earlier draft had the model emit the advice text with an instruction to
reproduce it verbatim. An instruction cannot enforce that — the model is
producing the string, and a paraphrase of tenant-rights guidance is a failure
with real-world consequences.

A second draft had the model choose which advice applied, returning rule
identifiers rather than prose. That fixed verbatim reproduction, but the
selection itself is a pure function of computed signals: every `when` condition
is a comparison against a number already in the database. There was nothing for
the model to judge.

So selection is deterministic. Two buildings with identical signals get
identical advice, the result is reproducible without an API call, and the rule
ordering is reviewable in a config file rather than inferred from model
behavior. The tradeoff is that priority ordering is now editorial — it ranks
hazard types against each other, which the source document never does.

Where the source gives no basis for that ranking, rules share a priority and
are ordered by the magnitude of their own signal instead. Mold and pests are
peers on this basis: measured over a random 8,000-building sample, ranking them
editorially showed a single mold complaint ahead of dozens of pest complaints on
4.1% of buildings. Ordering peers by count removes that class of error entirely
rather than relocating it.

The display cap is 4, also set from that sample: a cap of 3 truncated an
eligible rule on 10.2% of buildings, 4 on 3.0%, and at 4 the only rule that can
be truncated is the lower-ranked of the two peers.

### Why validation sits outside generation

The generation layer repairs **malformed** output — wrong shape, over length,
missing field — by feeding the validation error back for correction.

It must never repair **ungrounded** output. Asking a model to re-check a number
it invented produces a different invented number with equal confidence. Failures
of fact are quarantined, never retried. This is why generation returns something
explicitly unvalidated and a separate layer decides whether it may be published.

---

## Failure handling

Three outcomes, deliberately distinguished:

| Class | Examples | Response |
|---|---|---|
| **Transient** | 429, 529, timeout, connection drop | Retry, exponential backoff with jitter |
| **Invalid** | Unparseable, over length, constraint violation | Repair — feed the error back as a new turn |
| **Fatal** | Refusal, truncation at `max_tokens` | Raise. Both are deterministic; retrying buys an identical failure |

Token usage accumulates across every round trip, so a brief that took two calls
is logged as having cost two.

---

## Spend controls

In place before the first API call, not retrofitted:

- **Hard call cap**, raising *before* dispatch — hitting it costs nothing. There
  are 463,913 eligible NYC buildings; one accidental full-table loop is the
  entire failure mode.
- **Per-call cost accounting** to JSONL: tokens in/out/cached, computed cost,
  latency, attempts, repairs, validation result.
- **Local dev loop.** Prompt iteration runs against a local open-weights model
  (Ollama). Only measured runs touch a paid API.
- **Pre-generation, not on-demand.** Briefs are generated in batches, validated,
  and stored. Serving is a database read. Validation therefore always happens
  before any user sees output.

---

## What the validator checks

*(Designed; `validate.py` exists but its registry is empty. `is_publishable`
returns False on an empty verdict list rather than True, so nothing can be
published while no check runs — `all([])` would otherwise green-light every
brief and read as assurance.)*

The direction-preservation check that briefly lived here was removed with
`context_line`. It asserted that generated text preserved the computed
standing's direction; no generated text describes the building as a whole any
more, so the failure it caught cannot occur.



- **Numeric claims** must match the source record exactly. Not approximately.
- **Categorical claims** must match computed values.
- **Absence claims** ("no heat complaints in two years") verified against data,
  never inferred from a metric's absence from the prompt. Missing metrics are
  omitted from the prompt entirely rather than rendered as zero, so the model
  cannot read silence as a measured zero.
- **Causal language** is a hard fail. The data shows history and correlation.
- **Absolute-severity adjectives** ("high", "poor", "severe") are a hard fail
  when the percentile is below 70. Raw counts and HPD's own class labels remain
  permitted — those are facts on the record, not inferences from rank.
- **Vague quantifiers** ("a few", "several", "some", "a number of") are a hard
  fail unconditionally. This one was found by running the thing: forbidding
  digits in the prompt did not stop the model quantifying, it moved the claim
  into words. The first three sentences generated all opened "A few issues…" for
  buildings carrying 616, 473, and 552 open violations. A wrong digit is at
  least checkable against the record; "a few" is a quantity claim with nothing
  to check it against, which makes it strictly worse than the number it
  replaced.
- **Rule IDs** must be a subset of the eligible set.
- **Rights language in `watch_for`** is a hard fail. That field says what to
  look at; what a tenant is *entitled* to — 311, rent withholding, filing
  deadlines, what an owner is obliged to do — is authored in `rules.yaml` with a
  page citation and must never be paraphrased into generated text. A wrong
  entitlement is the one failure in this feature a reader can act on to their
  own cost.

Verdicts are emitted per claim, not as a single pass/fail, so failures are
diagnosable rather than merely countable.

---

## Known limitations

- **Percentiles are neighborhood-relative and size-normalized.** A large
  building can carry hundreds of open violations and still rank in the bottom
  third of its NTA. Both facts are true and the brief must not collapse them.
- **HPD and DOB are separate regulatory systems** on different scales. The brief
  covers HPD only and does not rank one against the other.
- **`building_summary` exposes no Class C count.** Class C carries the heaviest
  severity weight (15.0 vs. 8.0 for B), so it is reflected in percentiles, but
  open Class C counts are computed separately from `hpd_violations`.
- **No unit count exists anywhere in the schema.** Guidance conditioned on
  building size — such as the mold provisions for buildings over 10 units — is
  omitted rather than asserted on an unevaluable condition.
- **Prompt caching does not currently pay off.** The prompt is well under the
  minimum cacheable prefix, so `cache_control` is a silent no-op.

---

## What we chose not to build

- **A chat interface.** Stoop's value is auditability. A chat surface invites
  questions the data can't answer while implying that it can.
- **Vector search / RAG.** The data is structured and in Postgres. Context
  assembly is a query, not a retrieval problem.
- **An agent loop.** The pipeline is fixed and known in advance.
- **Any LLM framework.** Built from the provider SDK directly.
- **Generated advice.** See above — the highest-consequence text in the feature
  is authored by humans from a cited government source.

---

## Sources

Tenant-facing guidance is quoted from **NYC HPD, *ABCs of Housing 2024,
Tenants' Guide***, with page citations recorded per rule. Claims that could not
be located in the source are not included.

A rule may cite **more than one document**, and one does. The class C item takes
its violation classes from the ABCs guide (p.11-12) and its correction deadlines
from HPD's [penalties and fees
page](https://www.nyc.gov/site/hpd/services-and-information/penalties-and-fees.page),
because that timeline is not in the PDF. Each source names which claims it
backs. This exists because the alternative — citing the PDF for all of it — puts
a real claim behind a reference that does not support it, which is worse than an
uncited claim: it looks checkable and fails when checked.

The same discipline binds the compact `brief_line` that the page leads with. It
inherits its rule's citation, so it may compress the cited text and may not
extend it. Practical advice that is not in a source does not ship, however
sensible it sounds.

**No test can verify that authored text is true.** The suite pins that it
reaches the page verbatim, which is a different property. A wrong claim caught
in review — the class C correction deadline was stated as a flat 24 hours for
months — is caught by a reader following a citation, which only works if the
citation is right.
