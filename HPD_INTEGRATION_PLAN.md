# HPD Data Integration Plan

This document covers what was done to integrate HPD Violations and serves as the
step-by-step template for integrating HPD Complaints.

---

## Part 1 — What we did: HPD Violations (wvxf-dwi5)

### Context
HPD Violations are **inspector-issued** notices. An inspector visits a building and
formally cites a violation of the Housing Maintenance Code. Each row is one violation,
classified A (Emergency) / B (Hazardous) / C (Non-hazardous) / I (Informational).
~10.9M rows. Joins to `buildings` via `BIN`.

### 1. Ingest pipeline

#### Config (`ingest/config.py`)
- `HPD_VIOLATIONS_API` — Socrata JSON endpoint
- `HPD_VIOLATIONS_CSV_URL` — full CSV download URL
- `HPD_COLUMN_MAP` — CSV header → DB column (41 raw columns → 21 stored)
- `HPD_JSON_COLUMN_MAP` — Socrata JSON field name → DB column (API returns lowercase)
- `HPD_DB_COLUMNS` — canonical ordered list used for all DB operations

#### Schema (`schema.sql`)
| Object | Purpose |
|---|---|
| `hpd_violations` table | 21 columns incl. `violation_id` (PK), `bin`, `violation_class`, `violation_status`, `rent_impairing`, `nov_issued_date`, `order_number`, `apartment`, `lat/lon` |
| `hpd_order_numbers` table | Lookup: order_number → full_description, category, short_description, md_pd |
| `hpd_building_summary` mat. view | Pre-aggregated per-BIN counts (open, class A, class B, rent-impairing, latest date). Unique index on `bin` for CONCURRENT refresh. |
| `building_summary` (updated) | Added `hpd_agg` CTE → 5 new columns: `hpd_open_violations`, `hpd_class_a/b_violations`, `hpd_rent_impairing`, `hpd_latest_date` |

#### Full-load pipeline
1. `clean_hpd.py` — reads the raw CSV in **200k-row chunks** using `pyarrow.ParquetWriter`
   (streaming write avoids OOM on the 5.6 GB file) → `data/clean/hpd_violations.parquet`
2. `load_hpd.py` — TRUNCATE + `copy_records_to_table` in 50k batches → refreshes
   `hpd_building_summary`, `building_summary`, `nta_stats`
3. `seed_hpd_order_numbers.py` — reads `reference/HPD_Code_Violations_Data_Dictionary.xlsx`,
   strips trailing whitespace and `MD\PD` typo, upserts 415 rows into `hpd_order_numbers`

#### Incremental weekly sync (`sync_hpd.py`)
- State file: `data/.last_sync_hpd`
- **OR filter**: `novissueddate >= since OR currentstatusdate >= since`
  — catches new violations AND status changes on older violations
- 3-day lookback buffer for late-arriving records
- Upserts on `violation_id`; refreshes both materialized views after upsert
- Added to `weekly_sync.sh` after the existing DOB sync

#### Post-migration patch scripts
Because columns were added after the initial migration:
- `migrate_add_order_number.py` — `ALTER TABLE ADD COLUMN order_number TEXT`
- `migrate_add_lat_lon.py` — `ADD COLUMN latitude DOUBLE PRECISION, longitude DOUBLE PRECISION`
- `migrate_null_dummy_bins.py` — `UPDATE SET bin = NULL WHERE bin IN ('1000000', '0', ...)`
- `patch_order_number.py` — reads 2 CSV columns (`usecols`) + UPDATEs existing rows + patches parquet
- `patch_lat_lon.py` — same pattern for lat/lon

### 2. Frontend & API

#### Backend
| File | What changed |
|---|---|
| `api/schemas.py` | Added `HpdViolationResponse`, `HpdBuildingSummaryResponse`, `HpdBuildingDetailResponse`, `ViolationClassBreakdownItem` |
| `api/routes/hpd.py` | 5 new endpoints: `/hpd/map/clusters`, `/hpd/building/search`, `/hpd/building/{bin}`, `/hpd/building/{bin}/timeline`, `/hpd/building/{bin}/breakdown` |
| `api/main.py` | Registered HPD router |

Map clusters queries `hpd_building_summary` (not raw table) — avoids live GROUP BY on 10M rows.
HPD risk tiers mapped to DOB-compatible `risk_level` strings so `Map.tsx` coloring works unchanged.

#### Frontend
| File | What changed |
|---|---|
| `lib/types.ts` | Added `HpdViolation`, `HpdBuildingSummary`, `HpdBuildingDetail`, `ViolationClassBreakdownItem` |
| `lib/api.ts` | Added `searchHpdBuildings`, `getHpdBuilding`, `getHpdTimeline`, `getHpdBreakdown` |
| `components/Map.tsx` | Added `clustersUrl` prop (default: DOB endpoint) — one-line change |
| `components/SearchBar.tsx` | Added `searchUrl` prop; handles both DOB and HPD result shapes |
| `components/HpdBuildingSidebar.tsx` | Map click card — shows open violations, class A, tier label, links to `/hpd/building/{bin}` |
| `components/HpdMapWrapper.tsx` | Full HPD map: Emergency/Hazardous/Non-hazardous/Resolved legend + NTA filter |
| `components/ViolationTimeline.tsx` | Area chart over `nov_issued_date` |
| `components/ViolationBreakdown.tsx` | Vertical bar chart by class A/B/C/I (total vs open) |
| `components/ViolationCategoryBreakdown.tsx` | Horizontal bar chart, top 10 categories, total only, strips legal code prefixes |
| `components/ViolationDescription.tsx` | Client component: short description + hover tooltip showing full `nov_description` |
| `app/hpd/page.tsx` | HPD map page at `/hpd` |
| `app/hpd/building/[bin]/page.tsx` | Full building detail: KPIs, timeline, class chart, category chart, filterable violation log |
| `components/MapWrapper.tsx` | Added "HPD violations" nav link |

---

## Part 2 — To do: HPD Complaints (ygpa-z7cr)

### Context
HPD Complaints are **citizen-filed** reports. A tenant calls 311 or files online to report
a condition. Each row is one **Problem** (a single complaint can contain multiple problems,
grouped by `complaint_id`). ~14.1M rows. Joins to `buildings` via `BIN`.

This is directly comparable to the existing DOB complaints but for **habitability/maintenance**
rather than construction/permits. Together, violations + complaints tell the full story:
complaints show what tenants are experiencing, violations show what inspectors confirmed.

### Dataset details
- **Socrata ID**: `ygpa-z7cr`
- **API endpoint**: `https://data.cityofnewyork.us/resource/ygpa-z7cr.json`
- **CSV download**: `https://data.cityofnewyork.us/api/views/ygpa-z7cr/rows.csv?accessType=DOWNLOAD`
- **Primary key**: `problem_id` (unique per problem row)
- **Parent key**: `complaint_id` (groups problems into one complaint)
- **Sync date anchor**: `received_date` (new complaints) OR `problem_status_date` (status updates)

### Columns to store (24 of 33)

| DB column | Source field | Notes |
|---|---|---|
| `problem_id` | `problem_id` | PK |
| `complaint_id` | `complaint_id` | Groups problems |
| `bin` | `bin` | Join key to buildings |
| `borough` | `borough` | |
| `house_number` | `house_number` | |
| `street_name` | `street_name` | |
| `zip_code` | `post_code` | |
| `apartment` | `apartment` | |
| `unit_type` | `unit_type` | Public hall, apartment, etc. |
| `space_type` | `space_type` | Kitchen, bathroom, etc. |
| `type` | `type` | Problem type code |
| `major_category` | `major_category` | HEAT, PLUMBING, PAINT/PLASTER, etc. |
| `minor_category` | `minor_category` | More specific subcategory |
| `problem_code` | `problem_code` | Specific code |
| `complaint_status` | `complaint_status` | Open / Close |
| `complaint_status_date` | `complaint_status_date` | |
| `problem_status` | `problem_status` | Inspection outcome |
| `problem_status_date` | `problem_status_date` | Sync update anchor |
| `status_description` | `status_description` | |
| `received_date` | `received_date` | Sync issue date anchor |
| `latitude` | `latitude` | Sparse; use buildings table for BIN-matched rows |
| `longitude` | `longitude` | Same |
| `community_board` | `community_board` | |
| `bbl` | `bbl` | |

**Skip**: `block`, `lot`, `council_district`, `census_tract`, `nta`, `unique_key`,
`problem_duplicate_flag`, `complaint_anonymous_flag`

### Step 1 — Ingest pipeline

#### 1a. Config (`ingest/config.py`)
Add:
```python
HPD_COMPLAINTS_API     = "https://data.cityofnewyork.us/resource/ygpa-z7cr.json"
HPD_COMPLAINTS_CSV_URL = "https://data.cityofnewyork.us/api/views/ygpa-z7cr/rows.csv?accessType=DOWNLOAD"
HPD_COMPLAINTS_COLUMN_MAP  = { ... }   # CSV header → DB column
HPD_COMPLAINTS_JSON_COLUMN_MAP = { ... }  # Socrata JSON field → DB column
HPD_COMPLAINTS_DB_COLUMNS = [ ... ]
```

Note: Socrata JSON field names match the column table above (already snake_case).
`post_code` → `zip_code` is the only rename needed.

#### 1b. Schema (`schema.sql`)

**New table `hpd_complaints`:**
```sql
CREATE TABLE IF NOT EXISTS hpd_complaints (
    problem_id           TEXT PRIMARY KEY,
    complaint_id         TEXT,
    bin                  TEXT,
    borough              TEXT,
    house_number         TEXT,
    street_name          TEXT,
    zip_code             TEXT,
    apartment            TEXT,
    unit_type            TEXT,
    space_type           TEXT,
    type                 TEXT,
    major_category       TEXT,
    minor_category       TEXT,
    problem_code         TEXT,
    complaint_status     TEXT,
    complaint_status_date DATE,
    problem_status       TEXT,
    problem_status_date  DATE,
    status_description   TEXT,
    received_date        DATE,
    latitude             DOUBLE PRECISION,
    longitude            DOUBLE PRECISION,
    community_board      TEXT,
    bbl                  TEXT,
    created_at           TIMESTAMPTZ DEFAULT NOW()
);
```
Indexes: `bin`, `received_date`, `problem_status_date`, `complaint_status`, `major_category`

**New mat. view `hpd_complaints_building_summary`** — mirrors `hpd_building_summary`:
```sql
SELECT bin,
    MAX(b.latitude), MAX(b.longitude), MAX(b.borough), ...
    COUNT(*)                                                       AS total_complaints,
    COUNT(*) FILTER (WHERE complaint_status = 'Open')              AS open_complaints,
    COUNT(*) FILTER (WHERE major_category = 'HEAT/HOT WATER')      AS heat_complaints,
    MAX(received_date)                                             AS latest_complaint_date
FROM hpd_complaints c JOIN buildings b ON c.bin = b.bin
WHERE c.bin IS NOT NULL GROUP BY c.bin
```
Note: no class A/B/C/I — use `major_category` as the severity proxy.
Define a "severity tier" similar to violations: HEAT/HOT WATER and ELEVATOR as highest.

**Update `building_summary`** — add an `hpd_complaints_agg` CTE and columns:
`hpd_open_complaints`, `hpd_heat_complaints`, `hpd_latest_complaint_date`

#### 1c. Full-load pipeline
- `clean_hpd_complaints.py` — chunked 200k-row parquet writer (14.1M rows, ~1.5x violations size)
- `load_hpd_complaints.py` — TRUNCATE + copy_records_to_table + refresh both summary views
- No lookup table needed — categories are inline in the data

#### 1d. Incremental sync (`sync_hpd_complaints.py`)
OR filter: `received_date >= since OR problem_status_date >= since`
- New complaints surfaced by `received_date`
- Status updates (complaint resolved) surfaced by `problem_status_date`
- Same 3-day lookback buffer as violations sync
- State file: `data/.last_sync_hpd_complaints`
- Add to `weekly_sync.sh` after `sync_hpd.py`

#### 1e. Migration script (`migrate_add_hpd_complaints.sql` + `.py` runner)
Same pattern as `migrate_add_hpd.sql` / `migrate_add_hpd.py`.

### Step 2 — API

**New file `api/routes/hpd_complaints.py`** — 5 endpoints, mirror of `hpd.py`:

| Endpoint | Query source | Notes |
|---|---|---|
| `GET /hpd-complaints/map/clusters` | `hpd_complaints_building_summary` | Tier by major_category severity or open count |
| `GET /hpd-complaints/building/search` | Same view | Address ILIKE |
| `GET /hpd-complaints/building/{bin}` | View + paginated `hpd_complaints` | Filter by major_category / status |
| `GET /hpd-complaints/building/{bin}/timeline` | `hpd_complaints` | Group by month on `received_date` |
| `GET /hpd-complaints/building/{bin}/breakdown` | `hpd_complaints` | Group by major_category + minor_category, count + open_count |

**`api/schemas.py`** — add:
- `HpdComplaintResponse`
- `HpdComplaintBuildingSummaryResponse`
- `HpdComplaintBuildingDetailResponse`
- `ComplaintCategoryBreakdownItem`

**`api/main.py`** — register router

### Step 3 — Frontend

Reuse all existing HPD Violations components with minimal changes:

| Component | Action |
|---|---|
| `HpdMapWrapper.tsx` | Copy → `HpdComplaintsMapWrapper.tsx`; update legend tiers for major_category severity; point `clustersUrl` at complaints endpoint |
| `HpdBuildingSidebar.tsx` | Copy → `HpdComplaintsSidebar.tsx`; labels: "total complaints", "open", top major_category |
| `ViolationTimeline.tsx` | Reuse as-is — accepts `TimelinePoint[]` |
| `ViolationCategoryBreakdown.tsx` | Reuse — data shape matches |
| `ViolationBreakdown.tsx` | Copy → `ComplaintCategoryBreakdown.tsx`; replace class A/B/C/I with top major categories |
| `ViolationDescription.tsx` | Reuse — accepts short + full text |

**New pages:**
- `app/hpd-complaints/page.tsx` — complaints map at `/hpd-complaints`
- `app/hpd-complaints/building/[bin]/page.tsx` — complaints detail

**Navigation:** Add "HPD Complaints" link in `HpdMapWrapper` nav and cross-links on building detail pages between all three views (DOB / HPD Violations / HPD Complaints).

**`lib/types.ts`** — add `HpdComplaint`, `HpdComplaintBuildingSummary`, `HpdComplaintBuildingDetail`

**`lib/api.ts`** — add `searchHpdComplaints`, `getHpdComplaint`, `getHpdComplaintTimeline`, `getHpdComplaintBreakdown`

### Key differences from violations

| | HPD Violations | HPD Complaints |
|---|---|---|
| Filed by | Inspector (official) | Tenant (citizen) |
| Primary key | `violation_id` | `problem_id` |
| Parent key | — | `complaint_id` |
| Date anchor | `nov_issued_date` | `received_date` |
| Status update anchor | `currentstatusdate` | `problem_status_date` |
| Severity signal | Class A/B/C/I | `major_category` (HEAT, PLUMBING, etc.) |
| Lookup table | `hpd_order_numbers` (415 codes) | Not needed — categories inline |
| Lat/lon coverage | Sparse | Sparse (same) |
| Dummy BIN | `1000000` | Same — null out |
| Size | ~10.9M rows | ~14.1M rows |
| Sync OR clause | `novissueddate OR currentstatusdate` | `received_date OR problem_status_date` |

### Severity tier mapping for map (complaints)
These will be decided later. Use Type for now.

---

## Build order

```
# Ingest
1. Download CSV
2. Update config.py with HPD_COMPLAINTS_* constants
3. Run migrate_add_hpd_complaints.sql via Python runner
4. clean_hpd_complaints.py → hpd_complaints.parquet
5. load_hpd_complaints.py → DB + mat views
6. Add sync_hpd_complaints.py to weekly_sync.sh

# API
7. schemas.py — add 4 HPD Complaints models
8. routes/hpd_complaints.py — 5 endpoints
9. main.py — register router

# Frontend
10. lib/types.ts + lib/api.ts — add types and helpers
11. New map components (copy violations, adapt labels)
12. app/hpd-complaints/page.tsx
13. app/hpd-complaints/building/[bin]/page.tsx
14. Nav updates (cross-links between all three views)
```
