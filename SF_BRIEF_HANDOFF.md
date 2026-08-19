# SF Building Brief — handoff

Notes for building the Building Brief for San Francisco, written straight after
finishing the NYC one. `BRIEF_ROLLOUT.md` is the NYC feature doc and the
architecture reference; `SF_EXPANSION_PLAN.md` is the SF data plan. **This file
only covers what is different, what transfers, and what will bite.**

Read *The blocker* first. It is not a coding problem and it gates everything.

---

## Sources — the blocker is mostly resolved

Every NYC rule quotes HPD's *ABCs of Housing 2024*, with the page recorded in
`source:`. That one document is what makes the feature defensible: the model
never writes advice, and every actionable claim is traceable to a page.

**There is a direct equivalent, and it is better than expected.** Checked
against the live documents 2026-08-18.

### Primary: California Tenants (DRE, 2024)

> *California Tenants: A Guide to Residential Tenants' and Landlords' Rights and
> Responsibilities*, 2024 Edition. **California Department of Real Estate**,
> Business, Consumer Services and Housing Agency.

147 pages, plain-language, tenant-facing, with internal page numbers it uses for
its own cross-references ("see pages 47-50"). It has a real text layer, so
quoting is copy-paste rather than transcription. This is the ABCs analog and
should be the primary `source_document`.

**Cite the DRE original, not a mirror.** The Berkeley SLS copy is a hosted PDF
of a state publication; the citation should name the Department of Real Estate,
and the URL should point at the state's own copy so it survives a mirror moving.

**It is STATE, not city.** Everything in it is true in San Francisco, but it
carries nothing SF-specific — rent board jurisdiction, local ordinances, SF's
own inspection process. It mentions San Francisco exactly once. Expect to pair
it with a city source per rule, using `additional_sources` with a `covers`
clause, exactly as the NYC class C rule cites the ABCs for violation classes and
HPD's penalties page for correction deadlines.

### The statutory habitability list is close to a ready-made rules table

Pages 47–48 enumerate what makes a unit legally uninhabitable. It reads almost
like a rule set someone already wrote for us:

- Effective waterproofing and weather protection, unbroken windows and doors
- Plumbing in good working order, hot and cold running water
- Gas facilities in good working order
- **Heating facilities in good working order**
- Electrical system, lighting and wiring, in good working order
- Clean and sanitary, **free from debris, filth, rubbish, garbage, rodents and
  vermin**
- **Safe fire or emergency exits**; stairs, hallways and exits kept litter-free
- Operable dead bolt locks on main entry doors, locking devices on windows
- **Working smoke detectors in all bedrooms**, and in common stairwells of
  apartment complexes; **carbon monoxide detectors** wherever there are
  fossil-fuel appliances or an attached garage
- A locking mailbox for each unit

Mold gets its own treatment: the guide names mold conditions the landlord has
notice of, affecting livability or health, as a separate way the implied
warranty is violated.

Note what this list gives you that NYC's did not: it is **statutory**, so
"substantially lacks X" is a bright line rather than an editorial judgement
about severity. It also carries an explicit floor — the warranty is not violated
"merely because the rental unit is not in perfect, aesthetically pleasing
condition", nor by minor code violations that stand alone. That sentence is
worth quoting somewhere in the UI; it is the SF equivalent of the caveat the NYC
empty state carries.

### City sources for the SF-specific half

- **Keeping your building free of vermin** (sf.gov). Concrete and checkable:
  seal gaps over ¼ inch, garbage containers that do not overflow, stored piles
  elevated 6 inches from the ground and 6 inches from any wall. Names shared
  owner/tenant responsibility for bed bugs, and that owners must respond to bed
  bug complaints by hiring a licensed pest control operator. Good backing for a
  pests rule, and unusually specific for `action` text.
- **Residential habitability / property owner maintenance checklist** (sf.gov).
  **Scanned, no text layer** — five pages of images. Usable as a source but it
  must be read by eye and transcribed, and any quote needs checking against the
  image rather than a copy-paste.
- **CDPH mold page** (cdph.ca.gov). **JavaScript-rendered**, so it cannot be
  fetched as text with curl. State rather than city, and the DRE guide already
  covers mold as a habitability matter. Treat as background, not a citation,
  unless a rule needs a health claim the DRE guide does not make.

### Consequences for `validate.py`

`RIGHTS_PATTERNS` was written against NYC remedies and will not catch the
California ones. The guide's own vocabulary, by frequency: **repair and deduct**
(19), **rent withholding** (12), **small claims** (12), **code enforcement**
(3), abandonment. `rent withholding` is already banned; the rest are not, and
"the repair and deduct remedy" is exactly the sort of actionable legal claim
generated text must never make. Add these before generating anything.

---

## Schema decision to make before writing a single row

`brief_texts` has **no city column**:

```
rule_id, input_key, watch_for, prompt_version, model, validated_at
PRIMARY KEY (rule_id, input_key, prompt_version)
```

Two SF rules named `mold` and `pests` would collide with NYC's outright — same
key, different city, last writer wins, and the failure is invisible because a
corpus hit looks identical whenever it was written.

Pick one, in this order of preference:

1. **Add `city` to the table and the primary key.** Cleanest. Requires a
   migration and touching `keys_for_selection`, the route lookup, and
   `build_corpus`. Do it before the SF corpus exists, never after.
2. **Prefix SF rule ids** (`sf_mold`). No migration, but it puts a namespace
   inside an identifier and every future reader has to know why.

`CallRecord` already carries `city`, so telemetry is ready either way.

---

## What transfers unchanged

The generation and validation layers are genuinely city-agnostic:

| Module | Reuse |
|---|---|
| `generate.py` | As is. Retry/repair/fatal split, entry-count enforcement |
| `providers.py` | As is |
| `telemetry.py` | As is, including `DropRecord` |
| `validate.py` | Nearly. See the 311 note below |
| `schema.py` | Constants are generic; `MULTI_SENTENCE_RULE_ID` names a NYC rule |
| `corpus.py` | Key construction is generic; `HAZARD_AREA_RULE_ID` names a NYC rule |
| `build_corpus.py` | Structure transfers; every query is NYC-specific |

Two constants name `open_class_c` directly — `prompt.HAZARD_AREA_RULE_ID` and
`schema.MULTI_SENTENCE_RULE_ID`. If SF has a rule whose single condition covers
several distinct hazard areas (likely — see *Severity tiers* below), these need
to become per-city rather than module constants.

**`validate.py` mostly works**, and conveniently SF also uses 311, so the
rights-language patterns still apply. Check before reusing:

- `RIGHTS_PATTERNS` names Housing Court and rent withholding. SF's remedies
  differ (Rent Board petitions, rent escrow), so the patterns need SF terms
  added or they will let SF-specific rights language through.
- `topic_terms` are per rule in `rules.yaml`, so they come free with new rules.
- `check_echoes_example` reads `prompt.GOOD_EXAMPLES`. Keep them out of the
  apartment domain — see *Lessons* below.

---

## The data side

SF has the tables and two summary views already:

```
sf_dbi_nov              516,064   violations   (DBI notices of violation)
sf_311_housing           35,118   complaints   (311 residential building)
sf_parcels              163,272
sf_violations_summary            matview
sf_housing_complaints_summary    matview
```

You need an **`sf_brief_signals`** matview, the analog of `hpd_brief_signals`:
one row per building, one column per signal a rule reads. Copy the NYC pattern,
including that its SQL is **generated** and pinned to the constants in
`signals.py` by `tests/test_briefs_signals_sql.py`. That test is what stops the
view and the rules drifting apart, and it earned its place in NYC.

Three grain differences that will bite:

- **SF is parcel-grained (`mapblklot`), NYC is building-grained (`bin`).** One
  parcel can hold several buildings. `building_id` in telemetry and the brief
  route both assume one identifier; that is fine, but the *reader* should not be
  told "this building" about a parcel with three on it.
- **NOV data is republished wholesale.** DBI re-inserts all rows each publish,
  so `:updated_at` is useless and `date_filed` is the incremental key. Already
  documented, but it means "open violation" needs care: confirm SF's status
  field is as reliable as HPD's `violation_status`.
- **Complaint volume is much lower** — 35k SF against millions in NYC. The
  `> 1` complaint thresholds NYC uses to separate "an incident" from "a building
  condition" may be wrong at this volume. Re-measure; do not port the numbers.

---

## Severity tiers are your taxonomy, but they are not one yet

`SF_EXPANSION_PLAN.md` has a locked severity map over 311 `service_subtype` —
tiers A/B/C with weights. That is the closest thing to NYC's renter-facing
taxonomy and it is a good starting point, but the brief needs something the
weights do not provide:

- **A renter-facing group label and a `prose_label`.** NYC's taxonomy expands
  chart labels for running text ("Bldg maintenance" to "building maintenance")
  because a legend label reads badly mid-clause. SF subtypes are raw slugs
  (`infestation_rodent_insect`) and need the same treatment.
- **A one-sentence description per category.** NYC reuses the 48 tooltips the
  violations chart already had. They are what make a hazard area concrete
  enough for the model to point at — without them it invents plausible nouns.
- **An "immediately hazardous" analog.** NYC's class C is the spine of the
  brief. Tier A is the obvious equivalent, but confirm it behaves like one:
  class C fires on ~43% of NYC buildings, which is what makes the hazard-area
  machinery worth having.

The tiers are also weighted for a risk *score*, which is a different job from
naming a hazard for a reader. Expect to keep both and not conflate them.

---

## Lessons worth not re-learning

Full detail in `BRIEF_ROLLOUT.md`; these are the ones that cost the most.

**The corpus is keyed by input shape, not by building.** 310,400 NYC buildings
collapse to 3,169 prompts filling 909 rows, because the prompt contains no
counts, no percentile, no address. Preserve that property in SF or the cost
model collapses. It is also what makes the corpus small enough to read.

**Count, do not project.** The NYC corpus was estimated at ~11,850 prompts from
a two-point power-law fit for months. Enumerating every building gave 3,169 —
the fit was off 3.7× because the samples had not saturated. The census took
minutes.

**Examples in the prompt must be out of domain.** A model returned the worked
example verbatim as its answer. Worse, an in-domain example makes the failure
unmeasurable — you cannot tell an echo from the model independently reaching
the obvious answer — and it false-positives on the rule it shadows (a genuine
lead-paint sentence scored 0.83 against a lead-paint example). NYC's examples
are about buying a used car for this reason. Keep that.

**Read the drops before believing the drop rate.** The first review run
quarantined 8.3% of sentences; 14 of 17 were false positives on "within a few
seconds", a duration in an instruction rather than an invented count. The check
was removing more good sentences than bad. Real rate after the fix: 0.5%.

**A prompt that asks for two incompatible things gets obeyed literally.** The
prompt listed three hazard areas while asking for two sentences; the model wrote
three entries, and the surplus silently shifted sentences onto the wrong rules.
Check constants that must agree actually agree, and pin it with a test.

**Validation runs after the call is logged.** `validation_result: "ok"` means
schema-valid, not publishable. `DropRecord` exists because a dropped row and a
row that was never generated are indistinguishable in the database.

**Migrate and read in the same change.** A route that reads a new optional table
must ship with the migration that creates it. Shipping the read path first took
the brief off ~52% of NYC pages, and an empty table and a missing table are not
the same state.

---

## Suggested order

1. ~~Settle the source document.~~ Primary is the DRE guide; pair it per
   rule with an sf.gov page for anything city-specific. Still to do:
   transcribe the scanned SF checklist, and add the California remedy
   terms to `RIGHTS_PATTERNS`.
2. Decide the `brief_texts` city key, and migrate if so.
3. Build the SF taxonomy: group, `prose_label`, one-sentence description.
4. Author 3–5 rules against the source. Fewer and cited beats more and vague.
5. Generate `sf_brief_signals` + the parity test.
6. Route, then phase 0 render — authored only, no model. **Ship and stop here
   if you want.** NYC treats phase 0 as a complete product.
7. Only then: prompt, corpus run, validation calibration.

Steps 1–6 involve no model at all, and are most of the work.
