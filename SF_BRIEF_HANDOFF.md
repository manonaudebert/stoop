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

### Prefer the HTML guidebook over the PDF for citations

The same content is published as HTML chapters at
`dre.ca.gov/publications/ResourceGuidebook/`, and that form is better for us:

- **Canonical.** It is the publisher's own site, not a hosted copy.
- **Deep-linkable.** Chapters carry named anchors per subsection
  (`gb09_dealingwith.html#uninhabitable`, `gb05_lookingfor.html#inspect`), so a
  `Citation.url` points at the exact passage. `rules.py` renders web sources as
  real links, on the principle that a citation nobody can follow is decoration.
- **The page-number problem disappears.** NYC's `source: "p.6"` was a page ref,
  and page numbers are no longer rendered anyway — `source` is now purely the
  authoring record. A section anchor serves that better than a page.

Relevant chapters: `gb05_lookingfor` (inspecting, applications), `gb08_living`,
`gb09_dealingwith` (habitability, repairs, remedies), `gb10_movingout`.

**Caution: the HTML and the PDF do not share footnote numbering** — the same
habitability sentence is footnote 190 in the 2024 PDF and 198 in the HTML. They
are probably different editions. Pick one as `source_document` and stay on it;
do not cite them interchangeably or quote from one and cite the other.

### The thing that may remove the model from this feature

`gb05_lookingfor.html#inspect` — **"Inspecting before you rent"** — is a
state-published, citable checklist of what to look for at a viewing:

> Cracks or holes in the floor, walls, or ceiling · Signs of leaking water or
> water damage; dry or wet spots, flaking, bubbling, or a damp or moldy smell ·
> The presence of mold, which may appear as dark spots on a wall or floor ·
> Signs of rust in water appearing near the faucet · Leaks in bathroom or
> kitchen fixtures · Windows and doors that do not open all the way or fail to
> shut securely · Inadequate lighting or insufficient electrical outlets ·
> Inadequate heating or air conditioning · Inadequate ventilation or offensive
> odors · Defects in electrical wiring and fixtures · Signs of insects, vermin,
> or rodents · Inadequate trash and garbage receptacles · Chipping paint,
> especially in older buildings

**Read that against why `watch_for` exists in NYC.** The entire generated field
was built because the ABCs of Housing contains no viewing checklist. The
authoring rule is that a `brief_line` may compress cited text and never extend
it, and good instincts — "check under the sinks", "ask how last winter went" —
were cut precisely because they are not in the source. A model was brought in to
write the one thing the citable source could not supply.

**SF's source supplies it.** Each of those bullets maps onto a rule:

| Rule | Authored viewing line, from the checklist |
|---|---|
| mold | dark spots on a wall or floor; damp or mouldy smell; flaking or bubbling |
| pests | signs of insects, vermin, or rodents; trash receptacles |
| heat | inadequate heating; ventilation |
| lead / paint | chipping paint, especially in older buildings |
| electrical | defects in wiring and fixtures; insufficient outlets |

So the honest question for SF is not "how do we run the corpus" but **"do we
need generated text at all?"** An authored, cited viewing line is strictly
better than a generated one on every axis that matters here: it is checkable, it
is free, it needs no corpus, no prompt version, no five validators, and no
"AI-assisted" label. The NYC machinery exists to solve a problem SF may not
have.

Where a model could still earn its place: the checklist is generic, and the
brief knows *which* condition was flagged on *this* building. Sharpening a
generic bullet into a building-specific one is a real but much smaller job than
NYC's — and worth deciding deliberately rather than by momentum, because
everything downstream (corpus table, prompt versioning, drop telemetry,
validation calibration) exists only to serve generated text.

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

### SF Health Code Article 11 — the signal and the citation are the same taxonomy

`codelibrary.amlegal.com/codes/san_francisco/latest/sf_health/0-0-0-1890`
(Article 11: Nuisances, version 2026 S-96). **§581(b) declares specific
conditions to be public health nuisances**, and they line up with the 311
`service_subtype` values already in `sf_311_housing`:

| 311 subtype | rows | Health Code |
|---|---|---|
| `infestation_rodent_insect` | 5,456 | §581(b)(7) pest harborage or infestation |
| `mold_and_mildew` | 3,369 | §581(b)(6) visible or demonstrable mold or mildew |
| `infestation_bed_bugs` | 1,569 | §581(b)(8) noxious insect harborage; also Article 11A |
| `garbage_receptacles` | 1,056 | §581(b)(1) accumulation of filth, garbage |
| `paint_lead_violating_safe_practices` | 857 | §581(b)(10) lead hazards |

This is a better position than NYC has. There, the signal comes from HPD data and
the citation comes from a separate tenant guide, and keeping them aligned is
manual. Here **the complaint category and the legal basis are the same
taxonomy** — a mold complaint is a complaint about the thing §581(b)(6) names.
Each complaint rule can cite the specific subsection its own signal is derived
from.

Two clauses worth using directly:

- **§581(b)(6)** makes *visible or otherwise demonstrable* mold a nuisance in
  its own right. That is a firmer basis than the DRE guide's framing, which
  requires the landlord to have notice and the mold to affect livability.
- **§581(b)(10)**: *"any paint, whether interior or exterior, found on buildings
  and other structures built before 1979 is presumed to be lead-based paint"*, a
  rebuttable presumption, with "children" defined as up to 72 months. NYC's lead
  rule once used construction year < 1960 as a risk proxy and it was **removed**
  for gating the direct evidence. SF's 1979 line is different in kind: it is a
  legal presumption, not a proxy, so a rule may lean on it — but re-read that
  NYC note before reintroducing any year test.

Also worth reading: **Article 11A** (bed bug prevention, treatment, disclosure
and reporting) and **Article 11B** (Healthy Buildings). §609 establishes the
Vector Control and Healthy Housing Inspection Program, which is plausibly the
enforcement path behind some of this 311 data.

**Three cautions.**

1. **It is code, not tenant prose.** The authoring rules require renter-facing
   language with legal terms defined in place. Quoting §581(b)(8)'s list of
   "cockroaches, bed bugs, fleas, scabies, lice, spiders or other arachnids"
   verbatim is accurate and unreadable. Expect to cite the code as the *basis*
   while the prose comes from the DRE guide or sf.gov.
2. **American Legal Publishing disclaims authority** on every page: the posted
   code "may not reflect the most current legislation" and "should not be relied
   upon as the definitive authority". For a citation a reader may act on, link
   the city's official copy where one exists, or at minimum record the version
   (2026 S-96) alongside the section.
3. **The site is Cloudflare-protected.** `curl` and WebFetch both get 403; it
   was read through browser automation. Any tooling that checks citations
   automatically will not be able to reach it.

### Housing Code Chapter 10 — the citation basis for DBI violations

SF Housing Code **§1001** defines a *substandard building*, and it is the legal
basis behind a DBI notice of violation. Its enumerated conditions read like a
rules table, the same way the DRE habitability list does — and being SF's own
code, it is the right citation for anything derived from `sf_dbi_nov`:

- **§1001(b) Inadequate Sanitation and Safety** — lack of hot and cold running
  water; **lack of adequate heating facilities or improper operation**; improper
  ventilation; lack of required electrical illumination; **dampness of habitable
  rooms**; **infestation of insects, vermin or rodents**; general dilapidation;
  inadequate garbage storage and removal
- **§1001(c) Structural Hazards** — deteriorated foundations, floors, walls,
  ceilings, chimneys
- **§1001(e)/(f)/(g)** hazardous wiring, plumbing, mechanical equipment
- **§1001(h) Faulty Weather Protection** — deteriorated or loose plaster,
  ineffective waterproofing, **broken windows or doors**, lack of paint
- **§1001(i) Fire Hazard**, **(m) Inadequate Exit**, **(n) Inadequate Fire
  Protection Equipment**
- **§1001(k) Hazardous or Insanitary Premises** — debris, garbage, rat
  harborages, stagnant water

Note §1001(a) ties this to California Health & Safety Code §17920.3 (State
Housing Law), and §1001(d) folds in nuisance by reference — so the Housing Code,
the Health Code and the DRE guide are describing one overlapping body of law
rather than three unrelated sources.

### The violations data has no usable condition taxonomy

**This is the biggest architectural difference from NYC, and it should be
settled before any rule is written.**

NYC's brief is violation-led. `open_class_c` is priority 1, and its abstractness
("conditions HPD classifies as immediately hazardous") is fixed by naming hazard
*areas* drawn from `hpd_order_numbers.category` — 48 clean categories, each with
an authored one-sentence tooltip. That machinery is why the class C item can
point at something.

SF's violation data cannot do this. Measured on `sf_dbi_nov` (516,064 rows):

| Field | Problem |
|---|---|
| `nov_category_description` | 10 values, and **52.7% of rows** (236,786 of 449,431) are in `building section` or `other section` — section labels, not conditions |
| `nov_item_description` | **287,254 distinct values** over 419,539 rows. Free text, not a category |

The usable half is coarse but real: `fire section` (61,775), `interior surfaces`
(69,737), `plumbing and electrical` (33,213), `security requirements` (18,909),
`smoke detection` (14,825), `sanitation` (12,653), `lead` (1,388).

The free-text field is worse than merely unstructured. Its most common values
are procedural boilerplate, not conditions:

> "it is the property owner's responsibility to be present or direct…" (27,330)
> · "this notice includes violations of the san francisco housing code." ·
> "inspector comments regarding 'follow up' reinspection: i have sche…"

**and it contains inspector names and narrative** ("inspector yee investigated
the complaint at the subject property…"). Never render it, and never put it in a
prompt. It is a free-text operational log that happens to sit in a violations
table.

**Two consequences.**

1. **A violations rule can say that open violations exist, and not what they
   are** — on more than half of them. That is precisely the abstractness NYC's
   `areas_clause` exists to cure, with no equivalent cure available. Consider
   whether a violations rule should fire only for the categories that do name a
   condition, and stay silent on `building`/`other`, rather than producing an
   item that points at nothing.
2. **SF's brief may be complaint-led, inverting NYC.** The 311 side is
   well-categorized and maps cleanly onto Health Code §581(b); the violations
   side is not. In NYC the inspector's finding outranks the tenant's report, and
   suppression encodes that. In SF the better-structured signal is the tenant
   report. Do not port NYC's priority ordering without re-deciding it.

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
7. **Decide whether there is a model at all** — see *The thing that may remove
   the model*. If the authored viewing lines from `gb05#inspect` carry the
   feature, stop here: no corpus, no prompt version, no validators, no
   AI-assisted label.
8. Only if that decision is yes: prompt, corpus run, validation calibration,
   and the `brief_texts` city key from step 2 becomes load-bearing.

Steps 1–6 involve no model at all, and are most of the work. NYC treats phase 0
as a complete product; SF has a better authored source than NYC does, so its
phase 0 is stronger than NYC's phase 0 was.
