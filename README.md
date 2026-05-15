# Tenement — NYC Building Research

A web app that helps NYC renters research building complaint and violation histories before signing a lease. Data comes from NYC Open Data (DOB and HPD), ingested into a Neon (serverless PostgreSQL) database, served by a FastAPI backend, and visualized in a Next.js + Mapbox frontend.

## What it does

- **Search** any NYC building by address or BIN (Building Identification Number)
- **Map view** — buildings clustered and color-coded by complaint activity
- **Building detail pages** — DOB complaints, HPD violations, and HPD tenant complaints, each with timelines, category breakdowns, and neighborhood comparisons
- **Size-normalized scoring** — complaints and violations weighted by severity and recency, then divided by estimated building scale so a 200-unit tower is compared fairly against a 4-unit brownstone
- **Weekly sync** — automatically pulls new data from NYC Open Data every Sunday

## Tech stack

| Layer    | Technology                                        |
|----------|---------------------------------------------------|
| Database | Neon (serverless PostgreSQL)                      |
| Ingest   | Python — httpx, asyncpg, shapely                  |
| API      | FastAPI, asyncpg, Pydantic v2                     |
| Frontend | Next.js App Router, TypeScript                    |
| Map      | Mapbox GL JS                                      |
| Charts   | Recharts                                          |

## Repository structure

```
nycb/
├── nyc-violations/
│   ├── .env                         # DATABASE_URL (copy from .env.example)
│   ├── schema.sql                   # Full database schema + materialized views
│   ├── migrate_add_normalization.sql # Migration: adds footprint/height columns + rebuilds views
│   │
│   ├── ingest/                      # Python data pipeline
│   │   ├── config.py                # Dataset URLs, column maps, borough normalisation
│   │   ├── fetch_buildings.py       # Building centroids, footprint area, roof height
│   │   ├── enrich_nta.py            # Point-in-polygon NTA assignment via shapely STRtree
│   │   ├── download.py              # Bulk CSV download (DOB complaints)
│   │   ├── clean.py                 # Normalise, deduplicate, validate
│   │   ├── load.py                  # asyncpg bulk insert (DOB complaints)
│   │   ├── sync.py                  # Incremental weekly sync (DOB complaints)
│   │   ├── sync_hpd.py              # Incremental weekly sync (HPD violations)
│   │   ├── sync_hpd_complaints.py   # Incremental weekly sync (HPD complaints)
│   │   ├── aggregate.py             # REFRESH all materialized views
│   │   ├── seed_categories.py       # Seed DOB complaint category lookup
│   │   └── seed_disposition_codes.py
│   │
│   ├── api/                         # FastAPI backend
│   │   ├── main.py
│   │   ├── database.py
│   │   ├── schemas.py
│   │   ├── cache.py
│   │   └── routes/
│   │       ├── building.py          # DOB complaint endpoints
│   │       ├── hpd.py               # HPD violation endpoints
│   │       ├── hpd_complaints.py    # HPD tenant complaint endpoints
│   │       └── map.py               # Map cluster / heatmap endpoints
│   │
│   └── frontend/                    # Next.js app
│       └── app/
│           ├── page.tsx             # Landing: map + search
│           ├── leaderboard/         # Worst-offender buildings list
│           ├── building/[bin]/      # DOB complaint detail page
│           ├── hpd/building/[bin]/  # HPD violation detail page
│           ├── hpd-complaints/building/[bin]/  # HPD complaint detail page
│           ├── hpd-overview/building/[bin]/    # Combined HPD overview
│           └── methodology/         # How scores are calculated
│
├── weekly_sync.sh                   # Shell wrapper for all sync scripts
├── weekly_sync.plist                # macOS launchd job (every Sunday at 2am)
└── WEEKLY_SYNC.md                   # Sync setup and tuning docs
```

## Database schema

### Tables

| Table | Source | Description |
|---|---|---|
| `complaints` | DOB eabe-havv | One row per DOB complaint |
| `hpd_violations` | HPD wvxf-dwi5 | One row per HPD housing maintenance violation |
| `hpd_complaints` | HPD ygpa-z7cr | One row per HPD tenant complaint problem |
| `buildings` | DCP 5zhs-2jue | Building centroids, footprint area, roof height, NTA |
| `complaint_categories` | DOB PDF | Priority-coded lookup (A/B/C/D) |
| `complaint_disposition_codes` | DOB | Disposition code descriptions |
| `hpd_order_numbers` | HPD | Violation order number descriptions |

### Materialized views

| View | Description |
|---|---|
| `building_summary` | DOB aggregates: score, trend, percentile, + HPD rollup counts |
| `hpd_building_summary` | HPD violation aggregates: weighted score, estimated scale, density percentile |
| `hpd_complaints_building_summary` | HPD complaint aggregates: weighted score, estimated scale, density percentile |
| `nta_stats` | NTA-level score distributions for neighbourhood context |

## Local dev setup

### Prerequisites

- Python 3.11+
- Node.js 20+
- A [Neon](https://neon.tech) project
- A Mapbox token

### Environment variables

```bash
# nyc-violations/.env
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/nycdb?sslmode=require

# nyc-violations/frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ1...
```

### First-time data load

```bash
cd nyc-violations
python3 -m venv .venv
source .venv/bin/activate
pip install -r ingest/requirements.txt

# Apply schema
psql $DATABASE_URL -f schema.sql

# Seed lookups
cd ingest
python seed_categories.py
python seed_disposition_codes.py
python seed_hpd_order_numbers.py

# Load buildings (two passes: centroids, then height + footprint area)
python fetch_buildings.py
# Assign NTA codes via point-in-polygon
python enrich_nta.py

# Load DOB complaints
python download.py
python clean.py
python load.py

# Load HPD violations
python sync_hpd.py

# Load HPD tenant complaints
python fetch_and_load_hpd_complaints.py

# Refresh all materialized views
python aggregate.py
```

### Run the API

```bash
cd nyc-violations/api
uvicorn main:app --reload --port 8000
```

API docs: `http://localhost:8000/docs`

### Run the frontend

```bash
cd nyc-violations/frontend
npm install
npm run dev
```

Frontend: `http://localhost:3000`

## API endpoints

### DOB complaints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/building/search?q=` | Search by address or BIN |
| GET | `/building/{bin}` | Building summary + complaints |
| GET | `/building/{bin}/timeline` | Complaint counts by month |

### HPD violations
| Method | Path | Description |
|--------|------|-------------|
| GET | `/hpd/search?q=` | Search by address or BIN |
| GET | `/hpd/building/{bin}` | Violation summary |
| GET | `/hpd/building/{bin}/timeline` | Violations by month |
| GET | `/hpd/building/{bin}/breakdown` | Violations by class/category |

### HPD tenant complaints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/hpd-complaints/building/{bin}` | Complaint summary |
| GET | `/hpd-complaints/building/{bin}/timeline` | Complaints by month |
| GET | `/hpd-complaints/building/{bin}/breakdown` | Complaints by category |

### Map
| Method | Path | Description |
|--------|------|-------------|
| GET | `/map/clusters?bbox=` | GeoJSON of buildings in a bounding box |
| GET | `/map/heatmap?borough=` | Complaint counts per NTA for choropleth |

## Scoring and normalization

### DOB safety score (0–100)

Each building receives a score based on its DOB complaint history:

```
score = 100 × e^(−D / 40)
```

where D is the weighted deduction sum across all complaints:
- Priority A (imminent danger): weight 15
- Priority B (active violation): weight 8
- Priority C (minor/administrative): weight 3
- Priority D (tracking/inspection): weight 1
- Last 2 years: 1.0× · 2–5 years: 0.5× · older: 0.25×

### HPD violation weighted score

HPD violations are scored using the same recency decay:
- Class C (immediately hazardous — lead, mold, heat failure): weight 15
- Class B (hazardous — 30-day correction window): weight 8
- Class A (non-hazardous — 90-day window): weight 3
- Class I (informational): weight 1

### HPD complaint weighted score

HPD tenant complaints use complaint urgency:
- Immediate Emergency: weight 15
- Emergency: weight 8
- Non Emergency: weight 3

### Size normalization

Raw counts penalize large buildings. All weighted scores are normalized by estimated building scale before peer comparison:

```
estimated_scale = footprint_area × max(height_roof / 12, 1)
complaint_density = weighted_score / estimated_scale × 10,000
```

Each density is then percentile-ranked within the building's NTA (residential buildings only), so comparisons are both size-adjusted and neighborhood-relative.

## Weekly sync

```bash
# Run all syncs manually
cd nyc-violations/ingest
source ../.venv/bin/activate
python sync.py               # DOB complaints
python sync_hpd.py           # HPD violations
python sync_hpd_complaints.py # HPD complaints
python aggregate.py          # refresh views
```

See [WEEKLY_SYNC.md](WEEKLY_SYNC.md) for automated launchd setup.
