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
| `recent_complaint_count` | Complaints in the last 2 years |
| `prior_complaint_count` | Complaints between 2 and 5 years ago |
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
| `complaints_density_pct` | Size-normalised density percentile within NTA |
| `complaints_raw_pct` | Raw weighted-sum percentile — fallback when no building volume data |

The HPD page displays both `violations_density_pct` and `complaints_density_pct`
side by side in the Rank viz.

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
