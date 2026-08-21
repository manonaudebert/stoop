# Metric Definitions

This document describes every computed metric used on building detail pages and in
neighborhood comparisons. **Update this file whenever methodology changes in a SQL
migration.**

The tenant-facing explanation of this methodology lives at `/methodology` (NYC) and
`/sf/methodology` (SF); those pages toggle by city and share a generic "About" section.
Keep their prose in sync with the definitions here.

---

## DOB building page (`building_summary` materialized view)

Source table: `complaints` (NYC Dept. of Buildings — dataset `eabe-havv`)

### All-time aggregates (never windowed)

| Column | Definition |
|---|---|
| `total_complaints` | Count of every complaint on record |
| `open_complaints` | Complaints with `status = 'ACTIVE'` |
| `closed_complaints` | Complaints with `status = 'CLOSED'` |
| `priority_a_complaints` | Complaints in category priority A (imminent safety risk) |
| `priority_ab_complaints` | Complaints in category priority A or B |
| `first_complaint_date` | Earliest complaint date on record |
| `latest_complaint_date` | Most recent complaint date on record |

These are intentionally all-time — they represent the full paper trail and are shown
as raw counts on the stats row, not used for peer comparisons.

### Trend window (2-year vs. prior 3-year)

| Column | Definition |
|---|---|
| `recent_complaint_count` | Complaints filed in the last 2 years |
| `prior_complaint_count` | Complaints filed between 2 and 5 years ago |
| `priority_ab_2yr` | Priority A or B complaints filed in the last 2 years |
| `trend_direction` | `improving` / `worsening` / `stable`, based on annualised rate difference (threshold: ±1/yr) |

### 10-year window metrics (peer comparison)

Both metrics below use a **hard 10-year cutoff** so buildings with long histories are
compared on the same time horizon as newer buildings. This matches the HPD methodology
introduced in `migrate_density_10yr_window.sql`.

#### `serious_rate`

Priority A+B complaints per year, last 10 years only.

```
serious_rate = COUNT(priority IN A,B AND date >= now - 10yr)
               / GREATEST(LEAST(years_on_record, 10), 1)
```

Denominator is capped at 10 and floored at 1 to handle buildings with very short
histories.

#### `weighted_complaint_sum`

Decay-weighted count of all complaint types, last 10 years only.

```
weight = priority_weight × recency_weight

priority_weight:  A=15, B=8, C=3, other=1
recency_weight:   ≤2yr ago → 1.00
                  ≤5yr ago → 0.50
                  ≤10yr ago → 0.25
                  >10yr ago → 0 (excluded)
```

### Percentiles (within NTA, residential buildings only)

All percentiles are computed with `PERCENT_RANK()` partitioned by `nta_code` and
restricted to `nta_type = 0` (residential neighbourhoods).

| Column | Ranked by | Used on |
|---|---|---|
| `serious_rate_percentile` | `serious_rate` ASC | DOB Severity card |
| `normalized_percentile` | `weighted_complaint_sum / building_volume` ASC | DOB Rank card, map `risk_level` |
| `normalized_serious_rate_percentile` | `serious_rate / building_volume` ASC | DOB Severity card (size-normalised rate) |

`normalized_serious_rate_percentile` combines the rate-per-year focus of `serious_rate_percentile`
with size normalization: `serious_rate / estimated_scale × 10000`, ranked by `PERCENT_RANK()`
within the NTA. Buildings without footprint/height data get NULL (same as `normalized_percentile`).

`nta_stats` also stores `median_serious_rate` (the NTA-level median `serious_rate` across
residential peers), exposed via the `/building/{bin}/neighborhood` endpoint and displayed
in the Severity card as `(med. X.X/yr)` for sanity-checking the percentile.

A building at the **100th percentile** has the *most* serious complaints / worst
score relative to its NTA peers.

---

## HPD building page

HPD data comes from two separate materialized views, both defined in
`migrate_density_10yr_window.sql`.

### `hpd_building_summary` — violations

Source table: `hpd_violations` (HPD Housing Maintenance Code Violations)

#### `weighted_violation_sum` and `violations_density_pct`

Same decay weights and 10-year hard cutoff as DOB:

```
priority_weight:  Class C=15, Class B=8, Class A=3, other=1
recency_weight:   ≤2yr → 1.00 | ≤5yr → 0.50 | ≤10yr → 0.25 | >10yr → 0
```

`violations_density_pct` is size-normalised before ranking:

```
weighted_violations_density = weighted_violation_sum / building_volume
violations_density_pct      = PERCENT_RANK() on density within NTA
```

`building_volume = footprint_area × max(height_roof / 12, 1)`. Buildings without
footprint or height data fall back to `complaints_raw_pct` (see below).

### `hpd_complaints_building_summary` — complaints

Source table: `hpd_complaints` (HPD Housing Maintenance Code Complaints — `ygpa-z7cr`)

Same weighting and 10-year cutoff applied to `received_date`.

| Column | Definition |
|---|---|
| `total_complaints` | Count of every complaint on record |
| `open_complaints` | Complaints with `complaint_status = 'Open'` |
| `open_emergency_complaints` | EMERGENCY or IMMEDIATE EMERGENCY complaints currently open |
| `heat_complaints` | Complaints with `major_category = 'HEAT/HOT WATER'` (all-time) |
| `recent_complaint_count` | Complaints filed in the last 2 years |
| `prior_complaint_count` | Complaints filed between 2 and 5 years ago |
| `recent_emergency_count` | EMERGENCY + IMMEDIATE EMERGENCY complaints filed in the last 2 years (regardless of status) |
| `trend_direction` | `improving` / `worsening` / `stable`, same ±1/yr threshold as DOB |
| `complaints_density_pct` | Size-normalised density percentile within NTA |
| `complaints_raw_pct` | Raw weighted-sum percentile — fallback when no building volume data |

`recent_emergency_count` captures the full emergency complaint history in the window, not just currently-open ones. It was added in `migrate_hpd_complaints_add_emergency_2yr.sql`.

The HPD page displays both `violations_density_pct` and `complaints_density_pct`
side by side in the Rank viz.

### Top categories / top groups cards (live queries, with 5yr / all-time toggle)

The two "top categories" cards on the HPD building page are **not** read from the
summary materialized views. They are live `GROUP BY` queries against the base tables,
each with a **5-year / all-time toggle** (default: 5 years). Because they run against
the base tables with a runtime date filter, adding or changing the toggle requires no
migration.

| Card | Endpoint | 5-year window | All-time |
|---|---|---|---|
| Top violation categories | `/hpd/building/{bin}/breakdown-recent` (5yr) and `/hpd/building/{bin}/breakdown` (all-time) | `nov_issued_date >= NOW() - INTERVAL '5 years'` | no date filter |
| Top complaint groups | `/hpd-complaints/building/{bin}/minor-breakdown?years=` | `years=5` (default) → `received_date >= NOW() - INTERVAL '5 years'` | `years` falsy → no date filter |

The violations card toggles between two separate endpoints; the complaints card toggles
via the `years` query param on a single endpoint. Per the renter-facing design principle,
the **5-year window is the default** — all-time skews toward buildings with long histories.

---

## Leaderboard pages

Both leaderboards (`/dob/leaderboard` and `/hpd/leaderboard`) rank buildings by complaint
activity in the **last 2 years** — not all-time totals — so the list reflects current
conditions rather than accumulated history. Buildings need at least 10 total complaints
to appear.

### DOB leaderboard (`/dob/leaderboard`)

Source: `building_summary` materialized view. Restricted to `nta_type = 0`
(residential neighbourhoods only — same as percentile comparisons).

| Sort key | Column | Direction |
|---|---|---|
| Primary | `recent_complaint_count` | DESC |
| Tiebreaker | `priority_ab_2yr` | DESC |

Displayed columns: last-2yr count (big), serious-2yr (`priority_ab_2yr`), trend arrow.

### HPD complaints leaderboard (`/hpd/leaderboard`)

Source: `hpd_complaints_building_summary` materialized view. No `nta_type` filter
(the HPD complaints view does not carry that field).

| Sort key | Column | Direction |
|---|---|---|
| Primary | `recent_complaint_count` | DESC |
| Tiebreaker | `recent_emergency_count` | DESC |

Displayed columns: last-2yr count (big), emergency-2yr (`recent_emergency_count`), trend arrow.

`recent_emergency_count` counts both EMERGENCY and IMMEDIATE EMERGENCY complaints filed in the
last 2 years regardless of current status — a more complete picture of urgent activity than
`open_emergency_complaints`, which only reflects currently-unresolved cases.

### Trend arrow (both leaderboards)

Both leaderboards show the same `trend_direction` arrow (`↑` worsening / `→` stable / `↓` improving).
The algorithm is identical: compare the annualised rate of the last 2 years
(`recent_complaint_count / 2`) against the prior 3-year window (`prior_complaint_count / 3`).
A difference of more than ±1 complaint per year crosses the threshold.

### SF leaderboard (`/sf/leaderboard`)

Source: `sf_housing_complaints_summary` (left-joined to `sf_violations_summary` for the
open-violations column). Ranks parcels by recent 311 activity.

| Sort key | Column | Direction |
|---|---|---|
| Primary | `recent_complaint_count` (last 2 yr) | DESC |

Eligibility: `recent_complaint_count > 0 AND total_complaints >= 5`, optionally filtered
by `neighborhood`. Displayed columns: last-2yr complaints (big), open DBI violations
(`status = active`), trend arrow. Same `trend_direction` algorithm as the NYC leaderboards.

---

## SF building page (`/sf/building/{mapblklot}`)

San Francisco is a **parallel section** that reuses the NYC methodology (severity-weighted,
recency-decayed, size-normalized, neighborhood-percentile-ranked) with SF sources. Grain is
the **parcel** (`mapblklot`), not the individual building; ~86% of parcels are 1:1 with a
building. Two panes mirror two of the three NYC panes.

Views: `sf_housing_complaints_summary` (311 reports; analog of
`hpd_complaints_building_summary`) and `sf_violations_summary` (DBI Notices of Violation;
analog of `hpd_building_summary`). Both are parcel-grained materialized views defined in
`ingest/migration/migrate_add_sf.sql` (complaints view later revised by
`migrate_sf_severity_5yr.sql`; and mirrored in `schema.sql`).

### Severity weights (analog of HPD class)

Two locked severity maps, both on the 15 / 8 / 3 scale (severe / serious / minor); the
authoritative lists live in `SF_EXPANSION_PLAN.md` and the view `CASE` expressions.

- **311 `service_subtype`** — e.g. `heat_lack_of_heat`, `paint_lead_violating_safe_practices`,
  fire/smoke items = 15; pests, mold, plumbing, broken doors/windows = 8; general maintenance,
  peeling paint, garbage, noise = 3. Regulatory subtypes (illegal construction/guest-room,
  visitor-policy) = **0** (excluded from risk). Unknown subtypes default to 3.
- **DBI NOV `nov_category_description`** — `fire section`, `smoke detection section`,
  `lead section` = 15; `building`, `plumbing and electrical`, `interior surfaces`,
  `sanitation`, `security requirements` sections = 8; everything else (incl. blank) = 3.

### Recency decay, scale, and density

Same shape as NYC: each record's severity weight is multiplied by a recency factor
(`1.00` ≤2 yr, `0.50` 2–5 yr, `0.25` 5–10 yr; older contributes 0) and summed to
`weighted_complaint_sum` / `weighted_violation_sum`.

`estimated_scale` = parcel footprint area (`SUM` over footprints) × height
(`MAX(hgt_median_m)`, floored at 1 m). Density = `weighted_sum / estimated_scale × 1000`.
**Footprint fallback**: when a parcel has no footprint linkage, density falls back to the
raw `weighted_sum` (unitless but orderable) so every building still participates in the
neighborhood percentile instead of being forced to `Very low`.

### Neighborhood percentile & risk level

`PERCENT_RANK()` over density, **partitioned by `analysis_neighborhood`** (replaces NYC's
`nta_code`; no residential-type filter — SF neighborhoods are already residential-weighted).
Risk floors are tuned to SF volume: complaints `total_complaints < 2` and violations
`total_violations < 3` → `Very low` before the percentile ranks them (SF averages ~3.1
complaints/building, so the NYC floor of 5 would flatten most buildings). Otherwise the
same percentile cutoffs as NYC: `<15` Very low, `<40` Low, `<70` Moderate, `<90` High,
else Very high.

### Panes and dropped NYC cards

- **311 complaints pane** = what tenants *reported* (volume, category, recency, trend).
  No `open_complaints` KPI — 311 auto-closes (~0.9% open); the open signal lives on the
  violations pane instead. No `rent_impairing` — no SF equivalent field.
- **Complaint severity card** (replaces the old fixed Heat/Lead/Pest "Reported issues"
  card). Shows the count of Tier A (`severe_complaints_5yr`), Tier B (`serious_complaints_5yr`),
  and Tier C (`minor_complaints_5yr`) complaints **in the last 5 years**, labeled "Last 5 years"
  top-right. Fixed named categories (heat/lead/pest) were mostly three zeros on SF's sparse
  data (median 1 complaint/building); pooling all subtypes into severity tiers lights up an
  alarming row for ~67% of buildings that have any 5yr complaint. Weight-0 regulatory tier
  (`X`) is excluded from all three counts. Buildings with no complaints in the window show an
  empty-state line ("No complaints reported in the last 5 years") rather than 0/0/0 — a clean
  recent history is itself informative. The tier tag is computed once in the view's `tagged`
  CTE and shared with `weighted_complaint_sum` (single source of truth for the A/B/C map).
- **DBI violations pane** = what's *unresolved*. `open_violations` = rows with
  `status = active`; `open_lead_violations` / `open_fire_violations` filter that by category.
- **Open violations card** breakdown shows the `open_violations` headline split into severity
  tiers: Tier A (`open_severe_violations`), Tier B (`open_serious_violations`), and Tier C
  (`open_minor_violations`) — each `status = active` filtered by tier. Every NOV is tier A/B/C
  (no weight-0 tier as in complaints), so the three counts sum exactly to `open_violations`.
  These replaced the fixed Fire/Lead rows, which were mostly zeros on SF's sparse data. The
  tier tag is computed once in the view's `tagged` CTE and shared with `weighted_violation_sum`
  (single source of truth for the A/B/C map): fire / smoke detection / lead section = A,
  building / plumbing & electrical / interior surfaces / sanitation / security = B, else = C.
  Revised by `migrate_sf_violation_tiers.sql`.

### Top categories / timelines (live queries)

`/complaints-breakdown` and `/violations-breakdown` mirror the NYC breakdown cards with the
same 5-year / all-time (`years=0`) window toggle. Timelines are monthly `COUNT(*)` from the
raw `sf_311_housing` / `sf_dbi_nov` tables.

**`/violations-breakdown` does NOT group by `nov_category_description`.** It groups by
CONDITION, read out of the notice text by `api/services/briefs/cities/sf/card_categories.py`,
which composes two ordered pattern tables:

1. `nov_patterns.yaml` — the brief's classifier, evaluated first and winning outright, so the
   card and the Building Brief can never label the same row differently.
2. `nov_card_patterns.yaml` — card-only buckets for DBI's non-habitability space
   (`gas_shutoff`, `lead_work_practices`, `general_disrepair`, `heating_equipment`, `permits`,
   `access`), plus rules routing water-heater-temperature and heat-timeclock rows into
   `heat_hot_water` and painting orders into `peeling_paint`.

Neither table adds a column to `sf_brief_signals`; card buckets are display-only, so widening
them costs no materialized-view recompute. `test_card_buckets_cost_no_signal_column` enforces
that.

Measured over NOVs filed in the last 5 years: **45.0%** classify under the brief table, **32.1%**
have no text left after the advisory strip, **22.9%** carry text the brief table has no rule for
(the card table covers the top of that tail). Rows naming no condition are returned as a single
`unclassified` bucket, sorted last, and the page renders it as a footnote rather than a bar —
97.4% of them carry `building section`, `other section` or a blank, which is why the previous
category-based card was substantially charting inspector narrative as violations.

### Sync cadence (affects `open_violations` freshness)

SF syncs on two schedules (see `.github/workflows/`):

- **Weekly** (`weekly_sync.yml`, Sun 06:00 UTC → `sync_all.py`): incremental — 311 by
  `:updated_at`, DBI NOV by `date_filed`.
- **Monthly** (`monthly_sf_full.yml`, 15th 15:00 UTC → `sync_sf.py --full`): full NOV
  re-pull. DataSF republishes NOV **wholesale**, so an incremental `date_filed` pass only
  catches newly-*filed* violations — a status flip (e.g. `active` → `not active`) on an
  *older* NOV is invisible to the weekly job. The monthly full refresh trues up
  `open_violations` / `status`. So a resolved older violation can read as still-open for up
  to ~a month. (See memory `reference_datasf_nov_wholesale_republish.md`.)

---

### `hpd_brief_signals` — Building Brief rule inputs

One row per building, generated by `api/services/briefs/signals.py::render_migration`
into `migrate_hpd_brief_signals.sql`. Do not hand-edit either the migration or
this view's body in `schema.sql`; a test fails on drift between the three.

The category lists come from the shared renter-facing taxonomy
(`frontend/lib/renter-facing-groups.json`), so the brief and the cards on the
same page always count a group the same way. Complaint signals use a **5-year
window**; violation signals are **open right now** (a violation issued a decade
ago can still be open, which is what the reader needs to know).

| Signal | Definition |
|---|---|
| `open_class_c_violations` | Open, `violation_class = 'C'` |
| `lead_paint_violations` | Open, **and** (`order_number.category = 'LEAD-BASED PAINT'` **OR** `order_number IN (555, 606, 607, 610, 611, 612, 614)`) — see below |
| `smoke_co_detector_violations` | Open, category in SMOKE / CARBON MONOXIDE DETECTING DEVICES |
| `open_class_c_categories` | Top 3 categories on open class C, `ORDER BY count DESC, category` |
| `mold_complaints` / `pest_complaints` | 5yr, minor categories MOLD / PESTS, VERMIN |
| `heat_hot_water_complaints` | 5yr, the taxonomy's `heating_hot_water` minor categories (equals the "Heat / hot water" card, and so includes RADIATOR and BOILER) |

**Lead paint counts retired order numbers — changed 2026-08-12.**
`hpd_order_numbers.category = 'RETIRED'` describes the *order number*: the legal
provision was repealed. It says nothing about whether the violation was
corrected — `current_status` on these rows is still `NOV SENT OUT` or
`NOT COMPLIED WITH`, and the short description reads `REPEALED: LEAD - BASED
PAINT`. Filtering on the `LEAD-BASED PAINT` category alone therefore missed
**18,895 open lead violations, 22% of the total**, leaving **2,421 buildings
with open lead paint and no lead paint item on the brief**.

Measured over `hpd_violations`: 15,478 → 17,899 buildings carry an open lead
violation under the new predicate. In `hpd_brief_signals` the after-count is
**17,582**, because the view covers only buildings present in
`hpd_building_summary ∪ hpd_complaints_building_summary` — those with an HPD
page. The 317-building difference is open lead violations on BINs with no page
at all (dummy BINs and buildings missing from both summaries); that is a
pre-existing coverage gap, not an effect of this change. Applied to prod
2026-08-12.

These are not purely historical: order 614 was issued 2,211 times in 2020 and
1,716 in 2021, with same-year inspection dates, so they are live findings filed
under a legacy order number.

The seven orders are pinned as an explicit list in `signals.py`, not matched
with `short_description ILIKE '%LEAD%'` — the pattern is how they were found,
but a free-text scan is not a definition. `open_class_c_violations` deliberately
still counts them: they are genuine immediately-hazardous conditions.

### SF Building Brief (`sf_brief_signals` materialized view)

The SF analog of `hpd_brief_signals`, and the same arrangement: the SQL is
GENERATED from the city's taxonomy by
`api/services/briefs/cities/sf/signals.py`, so the view's category lists cannot
drift from the file the rules read. Regenerate with:

```bash
cd api && ../.venv/bin/python -m services.briefs.cities.sf.signals
```

**Grain is the parcel.** One row per `mapblklot`, which can carry several
buildings. Every reader-facing string reached from this view says "property"
rather than "building" — see `CityBriefConfig.subject_noun`.

**Universe.** `sf_violations_summary UNION sf_housing_complaints_summary`
(46,260 parcels). A parcel can have complaints and no violations and still
render a page, so a brief must exist for both.

**Windows.** Complaint signals use a **5-year** window on
`requested_datetime`; the two confidence inputs (`sf_record_count`,
`latest_sf_activity`) are all-time, because a record is not thin because it is
old.

**Complaint signals** — one per rule, named for the statutory element rather
than the raw DataSF subtype. The grouping lives in
`api/services/briefs/cities/sf/taxonomy.json`, which is a complete partition of
all 37 observed `service_subtype` values: 26 grouped into 15 rules, 11
explicitly excluded with a recorded reason.

**Violation signals** — `open_<group>_violations`, one per condition group,
counted from `sf_dbi_nov` where `status = 'active'`.

The group is assigned by a **text classifier** over `item` +
`nov_item_description`, defined as an ordered first-match-wins pattern table in
`api/services/briefs/cities/sf/nov_patterns.yaml` and compiled into the view as a
`CASE` cascade. `nov_category_description` is only a fallback, used where the
text names nothing.

This exists because the category field cannot do the job: ten values, and 52.7%
of rows are `building section`, `other section` or blank — a chapter of the code
rather than a condition. The condition itself is in the text, in canonical
phrases DBI reuses ("repair damaged ceilings (1001b,h,o hc)").

Neither text field is ever rendered. They carry inspector names, addresses and
narrative; this is classification only.

**Accuracy: 98% over 114 hand-labelled rows, 99% on the 70 held out** during
tuning. The table is measured, not assumed, and `tests/test_briefs_sf_classifier.py`
fails if either figure regresses.

**The lead rule is the most consequential single decision here.** `lead_paint`
fires only on an explicit abatement or containment order. It does NOT fire on
lead warnings or advisories, because San Francisco *presumes* all peeling paint
and its substrate contains lead — so that language rides along on every paint
order and says nothing about whether lead was found. An early version keyed on it
and labelled 1,953 rows `lead_paint` against DBI's own 72 in `lead section`. Lead
language with no abatement order resolves to `peeling_paint` instead.

**Two engines, one table.** The classifier runs in Python (for tests and offline
evaluation) and as generated SQL (on the site). They were verified to produce
identical labels on all 29,712 active rows. The live hazard is dialect: POSIX
spells a word boundary `\y`, Python spells it `\b`, and Postgres reads `\b` as
BACKSPACE — so a stray `\b` would match nothing in the view while passing every
Python test. A test asserts no pattern contains one.

**Thresholds. Every rule fires at `> 0`** — one report, or one active NOV in a
qualifying category, is enough.

The first version used `> 1` on the four high-volume rules (pests, mold,
plumbing, weather_windows). That floor was NYC's reasoning — one complaint
cannot separate an incident from a building condition — and it does not transfer
to a city with 35k complaints instead of millions. Measured cost of keeping it:

| Rule | fires at `> 1` | fires at `> 0` |
|---|---|---|
| pests | 462 | 1,579 |
| mold | 264 | 1,155 |
| weather_windows | 157 | 960 |
| plumbing | 187 | 768 |
| **whole brief** | **3,267 (7.1%)** | **5,270 (11.4%)** |

It suppressed 77% of the properties where a tenant reported mold. The brief
never claims a condition is ongoing or severe — it says tenants reported it,
which is exactly what one complaint supports — so the floor was protecting a
distinction the rendered copy does not draw.

**Coverage.** 6,075 of 46,260 parcels (**13.1%**) flag at least one rule,
against NYC's ~52%. The remaining gap is structural rather than a tuning
problem: NYC's brief is led by `open_class_c`, which fires on ~43% of buildings,
and SF has no equivalent because its violation categories name code sections
rather than conditions. The ceiling for anything violations-led in SF is the
6,172 parcels (13.3%) that carry any active NOV at all. The empty state states
the record count and says explicitly that nothing crossing a threshold "is not
the same as no problems".

The display cap of 3 truncates something on 391 parcels, 7.4% of those flagged —
close to NYC's 7.1%, so the cap is behaving the same way in both cities.

**Ranking.** `priority` 1–5 is editorial and no source document does it: life
safety and the two bright-line utilities first, then health hazards, building
systems, security and structure, then sanitation. Peers within a priority are
ordered by `rank_by`, the signal deciding which is the bigger problem at that
parcel. Display cap is 3, shared with NYC.

## Cross-cutting rules

- **Residential filter**: percentile comparisons (`serious_rate_percentile`,
  `neighborhood_percentile`, `normalized_percentile`, `violations_density_pct`,
  `complaints_density_pct`) are computed only within `nta_type = 0` neighbourhoods.
  Parks, airports, and industrial zones are excluded; their DOB `risk_level` shows
  as `Not comparable` (triggered by `normalized_percentile IS NULL`).
- **Minimum data threshold**: DOB buildings with fewer than 10 total complaints
  *and* less than 2 years of history are flagged `Insufficient data` and excluded
  from Severity/Rank comparisons.
- **Time windows are for comparisons, not display**: all-time counts
  (`total_complaints`, `priority_ab_complaints`, etc.) are always shown as-is in
  stat cards. The 10-year window only affects the percentile ranking metrics.
