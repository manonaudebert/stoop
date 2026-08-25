# stoop — building research for renters

A web app that helps renters research a building's complaint and violation history
before signing a lease or during a tenancy dispute. It now covers **two cities**:

- **New York City** — DOB complaints, HPD housing-maintenance violations, and HPD
  tenant complaints, from NYC Open Data
- **San Francisco** — DBI Notices of Violation and 311 housing complaints, from
  DataSF

Data is ingested into a Neon (serverless PostgreSQL) database, served by a FastAPI
backend, and visualized in a Next.js + Mapbox frontend. Each building page also
carries a **Building Brief** — a mostly-authored, lightly AI-assisted plain-language
summary of what the records mean for a tenant.

## What it does

- **Search** any building by address or ID (BIN in NYC, block-lot in SF)
- **Map view** — buildings clustered and color-coded by complaint/violation activity
- **Building detail pages** — timelines, category breakdowns, and neighborhood
  comparisons for each dataset
- **Size-normalized scoring** — weighted by severity and recency, then divided by
  estimated building scale so a 200-unit tower is compared fairly against a 4-unit
  brownstone, and percentile-ranked against neighborhood peers
- **Building Brief** — per-building summary; deterministic authored rules plus, on
  NYC HPD pages, one AI-generated sentence per flagged issue, labelled as
  AI-assisted (see [`AI_METHODOLOGY.md`](AI_METHODOLOGY.md))
- **Leaderboards** — worst-offender buildings per dataset and city
- **Weekly sync** — pulls new data automatically; SF does a full monthly true-up

## Tech stack

| Layer    | Technology                                        |
|----------|---------------------------------------------------|
| Database | Neon (serverless PostgreSQL)                      |
| Ingest   | Python — httpx, asyncpg, pandas, shapely          |
| API      | FastAPI, asyncpg, Pydantic v2                     |
| Brief AI | Anthropic `claude-haiku-4-5` (NYC corpus only)    |
| Frontend | Next.js App Router, TypeScript, Tailwind          |
| Map      | Mapbox GL JS                                       |
| Charts   | Recharts                                           |

## Documentation

| Doc | Covers |
|---|---|
| [`RUNBOOK.md`](RUNBOOK.md) | Full command reference — setup, both servers, tests, brief corpus, migrations, caching gotchas |
| [`METRICS.md`](METRICS.md) | Every computed metric: percentile methodologies, time windows, decay weights, which views power which cards |
| [`AI_METHODOLOGY.md`](AI_METHODOLOGY.md) | The Building Brief — what is authored vs. AI-generated, and why SF runs no model |
| [`BRIEF_ROLLOUT.md`](BRIEF_ROLLOUT.md) | Brief corpus generation, cost, and rollout state |
| [`SF_EXPANSION_PLAN.md`](SF_EXPANSION_PLAN.md) | SF datasets, EAS crosswalk, parcel grain, severity map |
| [`SF_BRIEF_MIGRATION.md`](SF_BRIEF_MIGRATION.md) | SF brief signals migration |

## Repository structure

```
stoop/
├── .env                         # DATABASE_URL, SOCRATA_APP_TOKEN (copy from .env.example)
├── schema.sql                   # Full database schema + materialized views
├── weekly_sync.sh               # Shell wrapper for the sync scripts
│
├── ingest/                      # Python data pipeline
│   ├── config.py                # NYC dataset URLs, column maps, borough normalisation
│   ├── sf_config.py             # SF (DataSF) dataset URLs and column maps
│   ├── fetch_buildings.py       # NYC building centroids, footprint area, roof height
│   ├── enrich_nta.py            # Point-in-polygon NTA assignment via shapely STRtree
│   ├── download.py / clean.py / load.py            # DOB complaints (bulk)
│   ├── clean_hpd.py / load_hpd.py                   # HPD violations
│   ├── clean_hpd_complaints.py / load_hpd_complaints.py / fetch_and_load_hpd_complaints.py
│   ├── sync.py / sync_hpd.py / sync_hpd_complaints.py   # Incremental NYC syncs
│   ├── sync_sf.py               # SF sync (incremental; --full for monthly true-up)
│   ├── sync_all.py              # Orchestrates all city syncs + view refresh
│   ├── aggregate.py             # REFRESH all materialized views
│   ├── seed_categories.py / seed_disposition_codes.py / seed_hpd_order_numbers.py
│   └── migration/               # Plain-SQL migrations (git history = what's applied)
│
├── api/                         # FastAPI backend
│   ├── main.py, database.py, schemas.py, cache.py, limiter.py, observability.py
│   ├── routes/
│   │   ├── building.py          # DOB complaint endpoints          (/building)
│   │   ├── hpd.py               # HPD violation endpoints          (/hpd)
│   │   ├── hpd_complaints.py    # HPD tenant complaint endpoints   (/hpd-complaints)
│   │   ├── map.py               # Map cluster / heatmap endpoints  (/map)
│   │   └── sf.py                # All San Francisco endpoints      (/sf)
│   └── services/briefs/         # Building Brief engine
│       ├── generate.py, build_corpus.py, rules.py, validate.py, ...
│       └── cities/{nyc,sf}/     # Per-city rules.yaml, signals, taxonomy
│
└── frontend/                    # Next.js app
    └── app/
        ├── page.tsx             # Landing: unified map + search
        ├── methodology/         # How scores are calculated
        ├── dob/                 # DOB complaints: building/[bin] + leaderboard
        ├── hpd/                 # HPD violations: building/[bin] + leaderboard
        ├── hpd-complaints/      # HPD tenant complaints: building/[bin]
        ├── sf/                  # San Francisco: building/[id], map, leaderboard, methodology
        └── api/                 # Route handlers: proxy, event
```

## Database schema

### Tables

| Table | Source | Description |
|---|---|---|
| `complaints` | DOB eabe-havv | One row per DOB complaint |
| `hpd_violations` | HPD wvxf-dwi5 | One row per HPD housing-maintenance violation |
| `hpd_complaints` | HPD ygpa-z7cr | One row per HPD tenant complaint problem |
| `buildings` | DCP 5zhs-2jue | NYC building centroids, footprint area, roof height, NTA |
| `complaint_categories` | DOB PDF | Priority-coded lookup (A/B/C/D) |
| `complaint_disposition_codes` | DOB | Disposition code descriptions |
| `hpd_order_numbers` | HPD | Violation order number descriptions |
| `sf_parcels` | DataSF acdm-wktn | SF parcel geometry / block-lot |
| `sf_footprints` | DataSF ynuv-fyni | SF building footprints |
| `sf_addresses` | DataSF ramy-di5m | SF address ↔ parcel crosswalk |
| `sf_311_housing` | DataSF vw6y-z8j6 | SF 311 housing complaints |
| `sf_dbi_nov` | DataSF nbtm-fbw5 | SF DBI Notices of Violation |
| `brief_texts` | generated | AI-assisted brief sentences, keyed by building |
| `users`, `api_events` | app | Auth and request telemetry |

### Materialized views

| View | Description |
|---|---|
| `building_summary` | DOB aggregates: score, trend, percentile, + HPD rollup counts |
| `hpd_building_summary` | HPD violation aggregates: weighted score, estimated scale, density percentile |
| `hpd_complaints_building_summary` | HPD complaint aggregates: weighted score, estimated scale, density percentile |
| `hpd_brief_signals` | Per-building signals that drive the NYC Building Brief rules |
| `nta_stats` | NTA-level score distributions for neighbourhood context |
| `sf_violations_summary` | SF DBI NOV aggregates: weighted score, scale, percentile |
| `sf_housing_complaints_summary` | SF 311 housing aggregates: weighted score, scale, percentile |
| `sf_brief_signals` | Per-parcel signals that drive the SF Building Brief rules |

## Local dev setup

**See [`RUNBOOK.md`](RUNBOOK.md) for the full command reference** — setup, running
both servers, tests, the Building Brief corpus, migrations, and the caching gotchas
that make a change look like it did not apply. The essentials:

### Prerequisites

- Python 3.11–3.13. **Not 3.14**: `pydantic-core` has no wheel for it yet and the
  venv fails to build
- Node.js 20+
- A [Neon](https://neon.tech) project
- A Mapbox token
- A DataSF app token (`SOCRATA_APP_TOKEN`) for SF ingest

### Environment variables

```bash
# .env
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/nycdb?sslmode=require
SOCRATA_APP_TOKEN=...           # DataSF / NYC Open Data app token

# frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ1...
```

### First-time data load

```bash
cd stoop
python3 -m venv .venv
source .venv/bin/activate
pip install -r ingest/requirements.txt

# Apply schema
psql "$DATABASE_URL" -f schema.sql

cd ingest

# Seed lookups
python seed_categories.py
python seed_disposition_codes.py
python seed_hpd_order_numbers.py

# NYC buildings (centroids, then height + footprint area), then NTA assignment
python fetch_buildings.py
python enrich_nta.py

# NYC data
python download.py && python clean.py && python load.py   # DOB complaints
python sync_hpd.py                                          # HPD violations
python fetch_and_load_hpd_complaints.py                    # HPD tenant complaints

# San Francisco data
python sync_sf.py --full

# Refresh all materialized views
python aggregate.py
```

### Run the API

```bash
cd api
uvicorn main:app --reload --port 8000
```

API docs: `http://localhost:8000/docs`

### Run the frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend: `http://localhost:3000`

## API endpoints

### DOB complaints (`/building`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/building/search?q=` | Search by address or BIN |
| GET | `/building/leaderboard-recent` | Worst-offender DOB buildings |
| GET | `/building/{bin}` | Building summary + complaints |
| GET | `/building/{bin}/timeline` | Complaint counts by month |
| GET | `/building/{bin}/breakdown` | Complaints by category |
| GET | `/building/{bin}/neighborhood` | Neighborhood comparison |

### HPD violations (`/hpd`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/hpd/building/search?q=` | Search by address or BIN |
| GET | `/hpd/map/clusters` | GeoJSON of buildings in a bounding box |
| GET | `/hpd/building/{bin}` | Violation summary |
| GET | `/hpd/building/{bin}/timeline` | Violations by month |
| GET | `/hpd/building/{bin}/open-ages` | Open-violation age buckets |
| GET | `/hpd/building/{bin}/breakdown` | Violations by class/category (all-time) |
| GET | `/hpd/building/{bin}/breakdown-recent` | Same, last-5-year window |
| GET | `/hpd/building/{bin}/brief` | Building Brief |

### HPD tenant complaints (`/hpd-complaints`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/hpd-complaints/building/search?q=` | Search by address or BIN |
| GET | `/hpd-complaints/building/leaderboard-recent` | Worst-offender buildings |
| GET | `/hpd-complaints/map/clusters` | GeoJSON of buildings in a bounding box |
| GET | `/hpd-complaints/building/{bin}` | Complaint summary |
| GET | `/hpd-complaints/building/{bin}/timeline` | Complaints by month |
| GET | `/hpd-complaints/building/{bin}/breakdown` | Complaints by category |
| GET | `/hpd-complaints/building/{bin}/minor-breakdown` | Minor-category breakdown |
| GET | `/hpd-complaints/building/{bin}/type-period-breakdown` | By type and period |
| GET | `/hpd-complaints/building/{bin}/resolution-breakdown` | By resolution outcome |

### San Francisco (`/sf`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/sf/building/search?q=` | Search by address or block-lot |
| GET | `/sf/building/leaderboard` | Worst-offender SF buildings |
| GET | `/sf/map/clusters` | GeoJSON of parcels in a bounding box |
| GET | `/sf/building/{mapblklot}` | Building summary (violations + 311) |
| GET | `/sf/building/{mapblklot}/complaints-timeline` | 311 complaints by month |
| GET | `/sf/building/{mapblklot}/violations-timeline` | DBI NOVs by month |
| GET | `/sf/building/{mapblklot}/complaints-breakdown` | 311 complaints by category |
| GET | `/sf/building/{mapblklot}/violations-breakdown` | DBI NOVs by category |
| GET | `/sf/building/{mapblklot}/brief` | Building Brief |

### Map (`/map`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/map/clusters?bbox=` | GeoJSON of buildings in a bounding box |
| GET | `/map/unified/clusters?bbox=` | Combined DOB + HPD clusters |
| GET | `/map/heatmap?borough=` | Complaint counts per NTA for choropleth |

## Scoring and normalization

Full definitions — time windows, decay weights, percentile methodology, and which
view powers which card — live in [`METRICS.md`](METRICS.md). Summary of the NYC
model below; SF uses the same recency-decayed, size-normalized, neighborhood-
percentile approach with its own severity map (see `METRICS.md`).

### DOB weighted complaint sum

Each complaint contributes a decay-weighted value based on priority and age.
Complaints older than 10 years are excluded entirely.

Priority weights: A (imminent danger) 15, B (active violation) 8,
C (minor/administrative) 3, D (tracking/inspection) 1.

Recency multipliers: ≤ 2 years 1.0×, 2–5 years 0.5×, 5–10 years 0.25×,
> 10 years excluded.

The weighted sum is stored as `weighted_complaint_sum`. A separate metric,
`serious_rate`, counts Priority A+B complaints per year over the same 10-year
window (denominator capped at 10, floored at 1).

### HPD violation weighted score

Same recency multipliers and 10-year cutoff. Class weights: C (immediately
hazardous — lead, mold, heat failure) 15, B (hazardous — 30-day window) 8,
A (non-hazardous — 90-day window) 3, I (informational) 1.

### HPD complaint weighted score

Same recency multipliers and 10-year cutoff. Urgency weights: Immediate Emergency
15, Emergency 8, Non Emergency (and any unlabeled type) 3.

### Size normalization and percentile ranking

Raw counts penalize large buildings. Weighted sums are normalized by estimated
building scale before peer comparison:

```
estimated_scale   = footprint_area × max(height_roof / 12, 1)
complaint_density = weighted_sum / estimated_scale × 10,000
```

Each density is percentile-ranked (`PERCENT_RANK()`) within the building's NTA
among residential peers (`nta_type = 0`), so comparisons are both size-adjusted and
neighborhood-relative. Buildings without footprint or height data fall back to a
raw weighted-sum percentile.

DOB produces two ranked signals: `normalized_percentile` (overall weighted density)
and `normalized_serious_rate_percentile` (serious_rate / scale). The former drives
the map `risk_level`; the latter drives the DOB Severity card.

### Risk level labels (DOB)

`risk_level` is derived from `normalized_percentile`:

| normalized_percentile | risk_level |
|---|---|
| < 15 | Very low |
| 15 – 39 | Low |
| 40 – 69 | Moderate |
| 70 – 89 | High |
| ≥ 90 | Very high |

Special cases: `Insufficient data` (< 10 complaints and < 2 years of history);
`Not comparable` (non-residential NTA or missing footprint/height data).

## Building Brief

Each building page carries a plain-language Building Brief. It is **mostly
authored**: deterministic rules (`api/services/briefs/cities/{nyc,sf}/rules.yaml`)
fire on per-building signals and render cited `brief_line` text. On **NYC HPD pages
only**, one field per flagged issue is AI-generated (`claude-haiku-4-5`),
pre-computed into a corpus (`brief_texts`) and labelled as AI-assisted. **San
Francisco runs no model at all** — every SF string is authored and cited. See
[`AI_METHODOLOGY.md`](AI_METHODOLOGY.md) and [`BRIEF_ROLLOUT.md`](BRIEF_ROLLOUT.md).

## Weekly sync

Production syncs run automatically via GitHub Actions:

- **Weekly** (`.github/workflows/weekly_sync.yml`) — every Sunday at 6am UTC:
  incremental DOB, HPD, HPD-complaints, and SF sync, then view refresh
- **Monthly** (`.github/workflows/monthly_sf_full.yml`) — the 15th at 15:00 UTC:
  SF `--full` true-up, because DataSF's DBI NOV feed republishes all rows each
  cycle so status changes only surface on a full re-pull

`DATABASE_URL` and `SOCRATA_APP_TOKEN` are stored as GitHub secrets.

To run manually:

```bash
cd ingest
source ../.venv/bin/activate
python sync_all.py          # all cities, incremental
python sync_sf.py --full    # SF full true-up
```
