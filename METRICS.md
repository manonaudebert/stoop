# Metric Definitions

This document describes every computed metric used on building detail pages and in
neighborhood comparisons. **Update this file whenever methodology changes in a SQL
migration.**

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

---

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
