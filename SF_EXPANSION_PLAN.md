# SF Expansion Plan — `/sf` section

Plan for adding a San Francisco section to Stoop, comparable to the existing NYC
experience. Built as a **parallel section** (`sf_*` tables, views, routes, pages)
that reuses the NYC *methodology* and *components* — not a refactor of the NYC side.

Status: **planning** (not yet built). All datasets below verified against the live
DataSF Socrata API.

---

## Guiding decisions

- **Parallel section.** The site isn't city-namespaced today (`/dob`, `/hpd`,
  `/hpd-complaints`). `/sf` gets its own tables/views/routes/pages; NYC untouched.
- **Two domains at launch** (mirroring two of the three NYC panes):
  - **SF Housing Complaints** — 311 Residential Building, both service-name variants (clean categories) ← the strong one
  - **SF Building Violations** — DBI Notices of Violation (`nbtm-fbw5`)
  - DOB-construction analog deferred to a later phase (weaker SF signal).
- **Search is EAS-backed and grain-agnostic.** The renter searches an address;
  EAS resolves it to *both* `parcel_number` and `eas_baseid`, so the detail-page
  grain can be chosen (and changed) without touching search.
- **Grain for v1: parcel (`mapblklot`)**, with `eas_baseid` (true building) as a
  later upgrade. Decision deferred — does not gate search (EAS resolves to both keys).
  **Measured (EAS, 210,608 parcels): 86.3% are 1 parcel = 1 building; 13.7% hold >1
  building** (9.1% have 2, 2.5% have 3, 2.1% have 4+; max 741). So parcel grain is
  identical to building grain for ~6 of 7 buildings; for the other 1 in 7 it lumps
  co-lot structures together. Worth upgrading to `eas_baseid` eventually (multi-building
  lots skew larger/denser), but not a launch blocker.

---

## Datasets needed (all DataSF / Socrata — reuse the NYC fetch mechanism)

| # | Dataset | ID | Role | Key fields |
|---|---|---|---|---|
| 1 | **Parcels** | `acdm-wktn` | Geometry hub — neighborhood, centroid | `mapblklot`, `blklot`, `shape`, `analysis_neighborhood` |
| 2 | **Building Footprints** | `ynuv-fyni` | Size normalization (area × height) | `mblr` (=`"SF"`+mapblklot), `hgt_median_m`, `shape` |
| 3 | **311 Cases** (filter: `service_name IN ('Residential Building Request','Residential Building')`) | `vw6y-z8j6` | Habitability complaints — clean categories | `service_subtype`, `address`, `point_geom`, `requested_datetime`, `status_description` |

**⚠ 311 filter must include BOTH service names** — they are sequential, not parallel:
`Residential Building Request` ran 2010 → 2024-06-11, then `Residential Building` took
over 2024-06-13 → present. Filtering only the first drops everything after June 2024
(empty recent-trend window). Combined: ~34,317 rows, 2010→present.

**Excluded: `General Request - BUILDING INSPECTION`** (17k rows). Considered and
rejected — its only subtypes are process types (`complaint`, `request_for_service`,
`customer_callback`, `compliment`…) with no habitability category to severity-weight; it
mixes in non-complaints; and it's retired old-schema (also ends 2024-06-11). Volume
without signal — the SF 311 analog of the DBI free-text problem.
| 4 | **DBI Notices of Violation** | `nbtm-fbw5` | Enforcement / violations (the HPD-violations analog) | `block`, `lot`, `status` (active/not active), `nov_category_description`, `date_filed`, `neighborhoods_analysis_boundaries`, `location` |
| 5 | **EAS Addresses** | `ramy-di5m` | **Search index + join crosswalk** | `address`, `parcel_number`, `eas_baseid`, `lat`/`long`, `nhood` |
| 6 | *(optional)* DBI Complaints | `gm2e-bten` | Complaint-of-record intake; links to NOVs by `complaint_number` | `parcel_number`, `complaint_description`, `status` |
| 7 | *(not for v1)* Building Inspections | `vckc-dh2h` | Inspection-event log; see note | `eas_baseid`, `reference_number`, `inspection_description` |

**Why `nbtm-fbw5` over `gm2e-bten` for violations:** 513,816 rows; `status` is a clean
`active` (29,658) / `not active` (484,158) split → direct open-violations metric;
`nov_category_description` gives ~11 structured code-section categories (mappable to
severity, like HPD class); neighborhood + point geometry are built in (no spatial join);
88% is Housing Inspection Services (habitability-focused). `gm2e-bten` is the upstream
complaint record — kept optional for cross-referencing only.

**Why not `vckc-dh2h` (`COMPLAINT INVESTIG`) as a complaints source:** it's an
inspection-*event* log with no problem/category/severity field (just "an investigation
happened"), so it can't feed the risk score; counting it double-counts (many visits per
complaint); and its `reference_number` is a recent-window range that didn't match a 2018
NOV in testing, so it's not a reliable crosswalk either. EAS is the better `eas_baseid`
source. Excluded from v1.

---

## Data processing

### Raw tables (`schema.sql`)
`sf_parcels`, `sf_footprints`, `sf_311_housing`, `sf_dbi_nov`, `sf_addresses`.
Each gets a `config.py`-style column map + a `download.py`-style fetcher (reuse the
Socrata client; only URLs and column maps change).

### Join topology — EAS is the hub
- **Search / address resolution:** `sf_addresses` (EAS) is the corpus. Every address
  in SF, including buildings with **zero** complaints (enables a confident "no records
  found" empty state). Indexed with `pg_trgm` for prefix/autocomplete. Each row carries
  both `parcel_number` and `eas_baseid`.
- **311 → key:** join `311.address` → EAS by normalized address (strip the
  `", SAN FRANCISCO, CA, <zip>"` tail; match `address_number` + `street_name` +
  `street_type`). Fall back to PostGIS point-in-polygon (`ST_Contains(parcel.shape,
  311.point)`) for unmatched rows.
- **DBI NOV → key:** `block || lot` → parcel directly. Neighborhood and point geometry
  are already on the row, so **no spatial join needed** for the violations domain
  (only 311 needs the EAS/spatial step).
- **Footprints → parcel:** `replace(mblr,'SF','')`, strip trailing condo letter →
  `mapblklot`.
- **311 ↔ NOV do NOT share a join key.** NOV `complaint_number` is a DBI complaint #;
  311 `service_request_id` is a separate namespace. The two domains unify at the
  parcel/building level (like HPD complaints ↔ HPD violations in NYC), not directly.
  A complaint→violation link exists only by regex-parsing the DBI complaint # out of
  311's free-text `status_notes` (inconsistent formats, partial coverage) — a v2
  nice-to-have, not required for NYC parity.

### Normalization (the SF-specific work)
1. **`mapblklot` folding** — join on the physical lot, not `blklot`, so condo unit-lots
   collapse to one building (`blklot 0692258` → `mapblklot 0692030`).
2. **`mblr` parsing** for footprints (above).
3. **Address normalization** for the 311→EAS join (above); collapse EAS unit rows to
   base address for the building picker.
4. **311 category casing fold** — subtypes appear in two casings
   (`Building - Heat_Lack_of_Heat` and `heat_lack_of_heat`); lowercase + strip
   `Building - ` prefix to merge.
5. **Bad-date filter** — `nbtm-fbw5` has garbage `date_filed` values (min = year 0200);
   floor at a sane date (e.g. ≥ 1980) before the recency-decay weighting.
6. **Severity maps** — two of them (311 subtypes + NOV categories), see below.

### Materialized views (mirror NYC, parcel-grained)
- `sf_housing_complaints_summary` ← mirrors `hpd_complaints_building_summary`
- `sf_violations_summary` ← mirrors `hpd_building_summary`
- Reuse recency-decay weighting + footprint×height `estimated_scale` (aggregate
  footprints to parcel: `SUM(area)`, `MAX(height)`) + `PERCENT_RANK()` percentiles.
  Only change vs NYC: partition by `analysis_neighborhood` (replaces `nta_code`) and
  the severity weights below.
- **Display address comes from EAS, not parcels.** Parcels (`acdm-wktn`) have a
  centroid + neighborhood but condos lack an address range, so use the EAS address for
  the building label and parcel `centroid_latitude/longitude` for map placement.
- **No "open complaints" KPI for the 311 domain.** Verified: ~0.9% of 311 housing cases
  are "Open" (they auto-close on referral to DBI). The open-problem signal lives in the
  NOV domain (`status = active`, 29,658 rows). So: 311 = what tenants *reported*
  (volume, category, recency, trend); NOV = what's *unresolved* (open status). Drop the
  open-count card on the complaints pane; keep it on the violations pane.

### Orchestration
New `sync_sf.py` paralleling `sync_all.py` (fetch → upsert → address/spatial join →
refresh views). Add to `weekly_sync.sh`.

---

## Locked severity map — 311 Residential Building `service_subtype`

SF analog of `COMPLAINT_CATEGORIES` in `config.py`. Weights match the existing
`hpd_complaints_building_summary` scheme (severe 15 / serious 8 / minor 3).
✦ = tenant headliner surfaced on KPI cards.

### Tier A — severe / immediately hazardous (weight 15)
`heat_lack_of_heat` ✦heat · `hot_water_lack_of_hot_water` ✦heat ·
`paint_lead_violating_safe_practices` ✦lead · `blocked_exit_common_areas` ·
`fire_hazard` · `elevators_no_working_elevator_7_or_more_stories` ·
`electrical_hazardous_condition` · `fire_alarm_system` ·
`smoke_detectors_missing_broken_unit_interior` · `fire_extinguishers_missing_expired` ·
`fire_sprinkler_system` · `smoke_detectors_missing_broken_common_areas`

### Tier B — serious / hazardous (weight 8)
`infestation_rodent_insect` ✦pests · `mold_and_mildew` ✦mold ·
`plumbing_broken_leaking` · `infestation_bed_bugs` ✦pests · `elevators_everthing_else` ·
`doors_windows_broken_defective` · `bathroom` · `ventilation_inadequate_or_none` ·
`security_inadequately_secured_perimeter` · `deck_stairs_handrails` ·
`light_wells_dirty_flooded`

### Tier C — minor / quality-of-life (weight 3)
`general_maintenance_not_in_list_above` · `inadequately_maintained_building_exterior` ·
`paint_peeling` · `garbage_receptacles` · `clutter_hoarder_unit_interior_storage` ·
`electrical_non_hazard` · `second_hand_smoke` · `noise_caused_by_building_systems` ·
`kitchen_community` · `mail_service_delivery_problem`

### Excluded from the risk score (weight 0 — regulatory, not building condition)
`illegal_construction_no_permit_exceeds_permit_scope` (1,057) ·
`illegal_guest_room_conversions` (230) · `visitor_policy_violations` (159)

These are permitting / zoning / lease-policy enforcement, not habitability hazards that
affect a tenant's living conditions, so they do not contribute to the weighted risk
score or `risk_level`. They may still be displayed on the building detail page as
context, but with weight 0. Drop the 1-row `building -` junk value.

**Remaining re-tiering calls (kept as drafted unless revisited):** `mold_and_mildew`
(B, not A); `electrical_non_hazard` (C, per the data's own "non_hazard" label); the
large opaque `general_maintenance_not_in_list_above` bucket (3,563 rows, C).

---

## Severity map — DBI NOV `nov_category_description` (violations domain)

Second severity map, for `sf_violations_summary` (analog of HPD violation class). Same
15/8/3 weights. ~11 code-section categories; ~32% of rows are blank/"other section" and
default to minor.

- **Tier A (15):** `fire section` · `smoke detection section` · `lead section` ✦lead
- **Tier B (8):** `building section` · `plumbing and electrical section` ·
  `interior surfaces section` · `sanitation section` ✦pests/health ·
  `security requirements section`
- **Tier C (3):** `other section` · `hco` · `(blank)`

Note: "building section" (138k, structural) defaults to B; revisit if its
`nov_item_description` free text warrants finer tiers later.

---

## API layer
New `api/routes/sf.py` (`prefix="/sf"`) exposing the same shapes as `map.py` /
`hpd_complaints.py`: `/sf/map/clusters`, `/sf/leaderboard`, `/sf/building/{id}`,
`/sf/search` (EAS-backed). Register in `main.py`. Reuse `cache.py`, `limiter.py`,
`database.py` unchanged. Add per-route tests with `make_mock_db(...)`.

## Frontend
New `frontend/app/sf/` mirroring `dob/`: `sf/page.tsx` (map), `sf/leaderboard/`,
`sf/building/[id]/`. Reuse the existing `Map`, leaderboard, KPI-card, timeline
components (city-agnostic; only API base path + id param change). Add SF to nav and
the methodology page.

## Docs (per CLAUDE.md)
- Update `schema.sql` with new tables/views.
- Update `METRICS.md` with SF methodology (neighborhood peer group, severity map, grain).
- Test SF migrations on a Neon branch before prod (migration-workflow rule).

---

## Effort summary

| Area | Reuse | New |
|---|---|---|
| Fetch/ingest | Socrata client, upsert pattern | 5 column maps, EAS crosswalk, address/spatial join, mapblklot/mblr normalization |
| Metrics | All weighting/percentile SQL | swap partition col + severity map |
| API | cache, limiter, db, route shapes | `sf.py`, EAS search, tests |
| Frontend | all components | `/sf` pages, nav, methodology |

**New dependencies/risks:** PostGIS (fallback 311 join only); 311→EAS address
normalization; severity-map judgment calls; parcel-vs-building grain (deferred,
non-blocking thanks to EAS-backed search).

---

## Final review — does this reproduce the NYC endpoint?

Every input the NYC materialized views consume has a verified SF source:

| NYC metric ingredient | SF Housing Complaints (311) | SF Building Violations (NOV) |
|---|---|---|
| Total counts | ✓ row counts | ✓ row counts |
| Open counts | ✗ N/A — 311 auto-closes (~0.9% open); open signal comes from NOV instead | ✓ `status` active/not active |
| Severity tiers (A/B/C) | ✓ locked 311 map | ✓ NOV category map |
| Recency-decay weighting | ✓ `requested_datetime` | ✓ `date_filed` (filter bad dates) |
| Size normalization (footprint×height) | ✓ via parcel→footprint join | ✓ via parcel→footprint join |
| Neighborhood percentile | ✓ `analysis_neighborhood` | ✓ `neighborhoods_analysis_boundaries` |
| Trend (recent vs prior) | ✓ dated | ✓ dated |
| Map lat/long | ✓ parcel centroid (`acdm-wktn`) | ✓ parcel centroid / `location` |
| Address search | ✓ EAS (`ramy-di5m`) | ✓ EAS (`ramy-di5m`) |
| Risk level + map colors | ✓ same percentile→risk_level logic, reused colors | ✓ same |

**Two NYC cards don't port to the 311 complaints pane:**
- `rent_impairing` — no SF equivalent field anywhere; drop it (or revisit a proxy later).
- `open_complaints` — 311 auto-closes (~0.9% open); the open-problem signal moves to the
  NOV violations pane (`status = active`). Not a loss of signal, just a relocation.

Everything else — total counts, severity breakdown, recency-weighted density,
size-normalized neighborhood percentile, risk level + map colors, trend, leaderboard,
building detail — reproduces cleanly across both panes.

**Verdict:** the plan is data-complete and faithfully mirrors the NYC endpoint, with two
panes that divide the work sensibly (311 = reported problems; NOV = unresolved
violations). The only genuinely new machinery vs. the NYC pipeline is the EAS-backed
search + the 311→EAS address join; everything else is the existing methodology with
swapped source columns. **Two data-handling rules are load-bearing and must not be
missed:** (1) the 311 filter includes both service-name variants, and (2) the NOV
bad-date floor. Both are documented above.
