# NYC Building Complaints

A web app that helps NYC renters research building complaint and violation histories. Data comes from the [NYC Open Data DOB Complaints](https://data.cityofnewyork.us/resource/eabe-havv.json) dataset, ingested into a Neon (serverless PostgreSQL) database, served by a FastAPI backend, and visualized in a Next.js + Mapbox frontend.

## What it does

- **Search** any NYC building by address or BIN (Building Identification Number)
- **Map view** — buildings clustered and color-coded by open complaint count
- **Building detail page** — complaint history timeline, priority breakdown, A–F risk score, and neighborhood percentile ranking
- **Weekly sync** — automatically pulls new complaints from NYC Open Data every Sunday

## Tech stack

| Layer    | Technology                                        |
|----------|---------------------------------------------------|
| Database | Neon (serverless PostgreSQL)                      |
| Ingest   | Python — pandas, httpx, asyncpg                   |
| API      | FastAPI, SQLAlchemy (async), Pydantic v2          |
| Frontend | Next.js 16 App Router, TypeScript, Tailwind CSS   |
| Map      | Mapbox GL JS                                      |
| Charts   | Recharts                                          |

## Repository structure

```
nycb/
├── nyc-violations/
│   ├── .env                    # DATABASE_URL (Neon connection string)
│   ├── schema.sql              # Full database schema
│   │
│   ├── ingest/                 # Python data pipeline
│   │   ├── config.py           # Dataset URLs, column maps, borough normalisation
│   │   ├── download.py         # Bulk CSV download from NYC Open Data
│   │   ├── clean.py            # Normalise, deduplicate, validate coordinates
│   │   ├── load.py             # asyncpg COPY bulk insert into Neon
│   │   ├── sync.py             # Incremental weekly sync via Socrata API
│   │   ├── aggregate.py        # REFRESH MATERIALIZED VIEW building_summary
│   │   ├── fetch_buildings.py  # Fetch building centroids from NYC footprints dataset
│   │   ├── enrich_nta.py       # Enrich buildings with NTA (neighbourhood) codes
│   │   ├── seed_categories.py  # Seed complaint_categories lookup table
│   │   └── seed_disposition_codes.py  # Seed complaint_disposition_codes lookup
│   │
│   ├── api/                    # FastAPI backend
│   │   ├── main.py             # App entrypoint, CORS, router registration
│   │   ├── database.py         # Async SQLAlchemy engine → Neon
│   │   ├── schemas.py          # Pydantic response models
│   │   └── cache.py            # In-process TTL cache (no Redis needed)
│   │
│   ├── frontend/               # Next.js app
│   │   └── app/
│   │       ├── page.tsx        # Landing: map + search
│   │       ├── leaderboard/    # Worst-offender buildings list
│   │       └── building/[bin]/ # Building detail page
│   │
│   └── data/
│       └── sync.log            # Rolling log of all sync runs
│
├── weekly_sync.sh              # Shell wrapper for the sync script
├── weekly_sync.plist           # macOS launchd job (runs every Sunday at 2am)
└── WEEKLY_SYNC.md              # Sync setup and tuning docs
```

## Database schema

Three core tables plus two materialized views:

- **`complaints`** — one row per DOB complaint (source: [eabe-havv](https://data.cityofnewyork.us/Housing-Development/DOB-Complaints-Received/eabe-havv))
- **`buildings`** — centroids from the NYC building footprints dataset, enriched with NTA codes
- **`complaint_categories`** — priority-coded lookup (A/B/C/D) from DOB complaint category list
- **`complaint_disposition_codes`** — lookup for disposition code descriptions
- **`building_summary`** (materialized view) — per-building aggregates: total/open/closed counts, priority breakdown, exponential decay score, trend direction, and neighbourhood percentile ranking
- **`nta_stats`** (materialized view) — NTA-level score distribution for neighbourhood context

## Local dev setup

### Prerequisites

- Python 3.11+
- Node.js 20+
- A [Neon](https://neon.tech) project with the schema applied (`schema.sql`)
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
cd nyc-violations/ingest
pip install -r requirements.txt

python seed_categories.py          # seed complaint category lookup
python seed_disposition_codes.py   # seed disposition code lookup
python fetch_buildings.py          # load building centroids
python enrich_nta.py               # add NTA codes to buildings
python download.py                 # download complaints CSV
python clean.py                    # normalise and validate
python load.py                     # bulk insert into Neon
python aggregate.py                # refresh materialized views
```

### Run the API

```bash
cd nyc-violations/api
pip install -r requirements.txt
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

| Method | Path | Description |
|--------|------|-------------|
| GET | `/building/search?q=` | Search by address or BIN |
| GET | `/building/{bin}` | Building summary + first page of complaints |
| GET | `/building/{bin}/complaints` | All complaints, filterable by status/category/year |
| GET | `/building/{bin}/timeline` | Complaint counts by month for charts |
| GET | `/map/clusters?bbox=` | GeoJSON of buildings in a bounding box |
| GET | `/map/heatmap?borough=` | Complaint counts per NTA for choropleth |
| GET | `/health` | Health check |

## Weekly sync

The sync script pulls new DOB complaints incrementally from the Socrata API and upserts them into the database.

**Run manually:**
```bash
cd nyc-violations/ingest
source ../.venv/bin/activate
python sync.py
```

**Automated (macOS launchd — every Sunday at 2am):**
```bash
cp weekly_sync.plist ~/Library/LaunchAgents/com.nycd.weekly-sync.plist
launchctl load ~/Library/LaunchAgents/com.nycd.weekly-sync.plist
```

See [WEEKLY_SYNC.md](WEEKLY_SYNC.md) for full setup, tuning, and reset instructions.

## Building risk score

Each building gets a numeric score (0–100) computed in the `building_summary` materialized view using an exponential decay formula:

- Priority A complaints: weight 15 (most severe)
- Priority B complaints: weight 8
- Priority C complaints: weight 3
- Priority D complaints: weight 1
- Complaints from the last 2 years: full weight
- Complaints from 2–5 years ago: 50% weight
- Older complaints: 25% weight

The score is then ranked within each NTA against residential peers to produce a neighbourhood percentile and risk level (Very low → Very high).
