# Runbook

Every command needed to set the project up, run it, test it, and generate the
Building Brief corpus. `README.md` covers what the project *is* and how the data
loads; this covers what you type.

Every command below assumes the repo root is `~/Projects/stoop`. **Do not move
it under `~/Documents`, `~/Desktop`, or anywhere else iCloud syncs** — see
*Blocked, not slow*.

---

## Setup

### Python version matters

The system `python3` is 3.14, and `pydantic-core` has no wheel for it — a plain
`python3 -m venv` fails to install with a Rust build error about PyO3. Build the
venv on **3.13** (or 3.12, which the Dockerfile uses):

```bash
cd ~/Projects/stoop
/opt/homebrew/bin/python3.13 -m venv .venv
```

### Dependencies

Three requirements files, and which you need depends on what you are doing.

```bash
# serving the API — this is also what api/Dockerfile installs
.venv/bin/pip install -r api/requirements.txt

# + tests. Pulls in ingest and briefs, because the api suite imports the
# sync modules to collect. This is the one to install for normal dev.
.venv/bin/pip install -r api/requirements-dev.txt

# + generating brief text (the Anthropic SDK). Batch only, never served.
.venv/bin/pip install -r api/requirements-briefs.txt
```

```bash
cd frontend && npm ci && cd ..
```

### Environment

`.env` at the repo root. The keys that matter here:

| Key | Used by |
|---|---|
| `DATABASE_URL` | everything |
| `INTERNAL_API_SECRET` | the API rejects requests without a matching `X-Internal-Key` |
| `ANTHROPIC_API_KEY` | `--provider anthropic` only |

---

## Run it

Two terminals. **Backend:**

```bash
cd ~/Projects/stoop/api && ../.venv/bin/python -m uvicorn main:app --reload --port 8000
```

**Frontend:**

```bash
cd ~/Projects/stoop/frontend && npm run dev
```

Then `http://localhost:3000`. API docs at `http://localhost:8000/docs`.

### Hitting the API directly

Every route except `/health` needs the internal key, or you get
`{"detail":"Unauthorized"}`:

```bash
KEY=$(grep -E '^INTERNAL_API_SECRET=' ~/Projects/stoop/.env | head -1 | cut -d= -f2-)
curl -s -H "X-Internal-Key: $KEY" \
  "http://localhost:8000/hpd/building/1013795/brief" | python3 -m json.tool
```

### When the page will not show your change

**Three caches, and they hide each other.** This has cost more time than any
other thing in this project.

| Layer | Lifetime | Cleared by |
|---|---|---|
| API in-process dict (`api/cache.py`) | 1 hour | restarting uvicorn |
| Next Data Cache (`lib/api.ts`, `revalidate: DAY`) | 24 hours | `rm -rf .next` |
| `load_rules()` `@lru_cache` | process lifetime | restarting uvicorn |

Neither cache invalidates on a database write, so a row you just generated will
not appear until both are cleared:

```bash
# restart the API, then
cd ~/Projects/stoop/frontend && rm -rf .next && npm run dev
```

A browser hard-refresh does nothing for either — both are server-side. Check the
API directly (above) before believing the HTML.

---

## Tests

```bash
cd ~/Projects/stoop/api && ../.venv/bin/python -m pytest tests/ -v
cd ~/Projects/stoop/frontend && npx tsc --noEmit
```

361 tests, offline — no database and no API key needed.

---

## Building Brief

The feature's own doc is `BRIEF_ROLLOUT.md`; this is just the commands.

### Look at one building, free

No model, no key, no cost. Prints the signals, the exact prompt, and the brief
as the page renders it.

```bash
cd ~/Projects/stoop/api && ../.venv/bin/python -m services.briefs.smoke \
  --bin 1013795 --signals

# add --prompt to print the system prompt too
```

### Generate for one building

`--write` upserts into `brief_texts`, so re-running regenerates in place.

```bash
cd ~/Projects/stoop/api && ../.venv/bin/python -m services.briefs.smoke \
  --with-model --provider anthropic --bin 1013795 --write
```

**Do not add `--reset` for a single building** — it deletes every row at the
current prompt version, not just this one's. It is for prompt iteration.

### Generate the whole corpus

`build_corpus.py` walks distinct *prompt shapes*, not buildings. 133,247 NYC
buildings collapse to 3,169 shapes covering 909 rows, so a per-building run
would pay for the same sentence thousands of times.

```bash
cd ~/Projects/stoop/api

# plan and price it. No model, no key, no spend.
../.venv/bin/python -m services.briefs.build_corpus --dry-run

# the real thing, ~$7, highest-coverage shapes first
../.venv/bin/python -m services.briefs.build_corpus --provider anthropic --cap 4200

# just the 25 shapes covering the most buildings
../.venv/bin/python -m services.briefs.build_corpus \
  --provider anthropic --limit 25 --cap 40
```

**`--cap` counts provider calls, not shapes.** A repair is a second call on the
same shape, and hitting the cap mid-shape discards that shape's work. Allow
~1.3x the shape count.

**It is resumable with no state file.** A shape whose rows already exist at the
current `PROMPT_VERSION` is skipped, so a run that dies or caps out is restarted
by running the same command again. `--force` regenerates regardless.

### Free iteration with Ollama

Ollama is the *default* provider; `--provider anthropic` is what opts into
spending.

```bash
ollama serve          # or just launch Ollama.app
ollama pull llama3.1:8b   # the default in providers.py
ollama list

cd ~/Projects/stoop/api && ../.venv/bin/python -m services.briefs.smoke \
  --with-model --model qwen3:8b --bin 1013795
```

Local structured-output reliability is weaker than the API's — expect more
repairs. Never price a corpus off local telemetry: `qwen3:8b` counts ~1,062
input tokens where Haiku counts ~1,702 for byte-identical input.

**Keep providers out of one corpus.** `brief_texts.model` records which model
wrote each row; a mixed corpus makes "who wrote this" a per-row question. Clear
the version before a real run:

```bash
psql "$(grep -E '^DATABASE_URL=' ~/Projects/stoop/.env | head -1 | cut -d= -f2-)" \
  -c "DELETE FROM brief_texts WHERE prompt_version = 'brief-v8';"
```

### Inspecting the corpus

```bash
psql "$(grep -E '^DATABASE_URL=' ~/Projects/stoop/.env | head -1 | cut -d= -f2-)" \
  -c "SELECT prompt_version, rule_id, model, left(watch_for,60) FROM brief_texts ORDER BY prompt_version, rule_id;"
```

---

## Migrations

Plain SQL in `ingest/migration/`, no framework — git history is the record of
what has been applied. Test on a Neon branch before prod.

```bash
psql "$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)" \
  -f ingest/migration/migrate_<name>.sql
```

Read `DATABASE_URL` exactly that way. `export $(grep DATABASE_URL .env | xargs)`
also matches commented-out lines and the unquoted `&` in the connection string
gets mangled by the shell.

Running a migration twice errors on `CREATE UNIQUE INDEX` — that is a safe
signal it was already applied. Migrations that `DROP / CREATE MATERIALIZED VIEW`
take a few minutes and serve stale data meanwhile; no restart needed. Always
update `schema.sql` and `METRICS.md` to match.

---

## Deploying the API

Railway builds `api/Dockerfile` with **BuildKit**. The build context is the
whole repo, not `api/` — `services/briefs/taxonomy.py` reads
`frontend/lib/renter-facing-groups.json` at import time, and `routes/hpd.py`
imports it, so an image built from `api/` alone crashes on startup with
`FileNotFoundError` before uvicorn binds a port.

Railway settings (**Settings → Source**, not the Build tab):

| Setting | Value |
| --- | --- |
| Root Directory | `/` (empty) |
| Dockerfile Path | `api/Dockerfile` |
| Watch Paths | `api/**`, `frontend/lib/renter-facing-groups.json` |

The image mirrors the repo layout (`/app/api`, `/app/frontend/lib`) so the
parent-walk in `taxonomy.py` resolves the same number of levels up in the
container as in a checkout. `.dockerignore` lives at the repo root for the same
reason — Docker reads only the one at the context root, so rules under `api/`
are silently ignored.

Verify a build locally before pushing:

```bash
docker build -f api/Dockerfile -t stoop-api .
docker run --rm -e DATABASE_URL=postgresql://fake:fake@localhost/fakedb stoop-api
```

`tests/test_dockerfile_taxonomy.py` replays the path arithmetic offline and
fails if WORKDIR, the COPY destinations, or `TAXONOMY_PATH` stop agreeing.

---

## Observability

Three sinks, one event shape. Nothing here can slow down or break a request:
every write is queued and drained by a background task, and every failure path
degrades to a log line.

**stdout → Railway.** Every request is one JSON line: `request_id`, `method`,
`route` (the template, never the raw path), `status`, `duration_ms`, `ip`, `ua`.
INFO under 400, WARNING for 4xx, ERROR for 5xx. `/health` is skipped so
Railway's healthcheck does not drown out real traffic. Railway's log explorer
parses the JSON, so you can filter on `level` or `status` directly.

**`api_events` → Neon.** The durable half, because the platform log tails are
short-retention buffers. Only faults (`status >= 400`), searches, page views and
client errors are stored — successful 200s stay in stdout. Pruned to 90 days by
the weekly sync workflow. Query it directly:

```sql
-- what is failing, by route
SELECT date_trunc('day', ts) d, route, status, count(*)
FROM api_events
WHERE status >= 400 AND NOT internal AND ts > NOW() - INTERVAL '7 days'
GROUP BY 1,2,3 ORDER BY 4 DESC;

-- searches that found nothing: the clearest proxy for a data gap
SELECT query, count(*) FROM api_events
WHERE kind='search' AND result_count = 0 AND NOT internal AND NOT is_bot
  AND ts > NOW() - INTERVAL '30 days'
GROUP BY 1 ORDER BY 2 DESC LIMIT 50;

-- most-viewed buildings
SELECT meta->>'building' bin, count(*) FROM api_events
WHERE kind='pageview' AND NOT internal AND NOT is_bot
  AND ts > NOW() - INTERVAL '30 days'
GROUP BY 1 ORDER BY 2 DESC LIMIT 25;
```

```sql
-- one row per day, one column per series: the shape you graph.
-- swap day for hour as traffic grows; --csv pipes it straight out.
SELECT date_trunc('day', ts)::date AS day,
       count(*) FILTER (WHERE kind='pageview')                   AS pageviews,
       count(*) FILTER (WHERE kind='search')                     AS searches,
       count(*) FILTER (WHERE kind='search' AND result_count=0)  AS empty_searches,
       count(*) FILTER (WHERE status >= 500)                     AS server_errors,
       count(*) FILTER (WHERE status BETWEEN 400 AND 499)        AS client_errors
FROM api_events WHERE NOT internal AND NOT is_bot
GROUP BY 1 ORDER BY 1;
```

Bucketing is only trustworthy because `ts` is stamped when the event happens,
not by the column's `DEFAULT NOW()` — that is transaction time, so every row in
a flush batch would share the flush timestamp and land in the wrong bucket.

### Reading the stdout logs

They are JSON lines so you never have to regex them, but uvicorn's own plaintext
lines are interleaved and bare `jq` dies on the first one. `fromjson? // empty`
skips them:

```bash
# every fault
jq -R 'fromjson? // empty' <log> \
  | jq -r 'select(.level=="WARNING" or .level=="ERROR")
           | "\(.ts) \(.level) \(.route // .msg) \(.status // "")"'

# count by route + status
jq -R 'fromjson? // empty' <log> \
  | jq -r 'select(.status) | "\(.status) \(.route)"' | sort | uniq -c | sort -rn

# slowest requests
jq -R 'fromjson? // empty' <log> \
  | jq -r 'select(.duration_ms) | "\(.duration_ms) \(.route)"' | sort -rn | head -20
```

Live: `uvicorn … | jq -R 'fromjson? // empty' | jq -c 'select(.status >= 400)'`.

On Railway, don't grep at all — it parses these lines into attributes, so
`level`, `status`, `route`, `request_id` and `duration_ms` are filterable fields.

### What `internal` does not cover

`?dev=1` tags page views (via `/api/event`) and client-side search and map calls
(via `/api/proxy`), because both forward the `stoop_dev` cookie. It does **not**
tag 4xx/5xx from server-rendered pages: the server-side branch of `lib/api.ts`
sends only `X-Internal-Key`, and forwarding the cookie would mean calling
`cookies()` in page components, which opts them out of static rendering and
kills the Data Cache that lets Neon scale to zero. So `WHERE NOT internal` is
reliable for the user metrics and only partial for error dashboards.

**Email → Resend.** 5xx only, throttled to one per exception-type + route per
15 minutes. Off unless `RESEND_API_KEY` and `ALERT_EMAIL` are both set.
Deliberately not SMS: an app-level alert cannot fire when the app is what is
down — point an external uptime pinger at `/health` for that.

### Why page views need a browser beacon

`frontend/lib/api.ts` caches server-side reads for a day so Neon can autosuspend,
so the second person to open a building page within 24h produces **zero** API
requests. Request logs therefore cannot count page views. `PageBeacon` posts
from the browser to `/api/event`, which forwards to the API with the internal
key. Search activity needs no beacon: the client path is `cache: 'no-store'`.

### Correlating one error across all three

The API mints `X-Request-Id` and echoes it on every response; the proxy forwards
it; `lib/api.ts` folds it into `ApiError`'s message. On a server render Next
replaces that message with an opaque digest, so `instrumentation.ts`'s
`onRequestError` — which still sees the original — pairs the two, and the 500
screen shows the digest. Given either handle:

```sql
SELECT * FROM api_events WHERE request_id = '<id>';
```

### Excluding your own traffic

Visit any page with `?dev=1` once. The root `proxy.ts` sets a year-long
`stoop_dev` cookie, the API proxy forwards it as `X-Stoop-Internal: 1`, and rows
are stamped `internal = true` — tagged rather than dropped, so your own sessions
stay queryable on purpose. `?dev=0` clears it. Crawlers are tagged `is_bot` from
the user-agent. Every dashboard query should carry
`WHERE NOT internal AND NOT is_bot`.

---

## Blocked, not slow

If `pytest`, `tsc`, `git` or `rsync` hang at **0% CPU** with `fileproviderd`
pegged at 100%, the repo is under an iCloud-synced folder and the files have
been evicted. Reading a dataless file blocks until it downloads. The repo was
moved to `~/Projects` on 2026-08-13 for exactly this reason. A `.venv` or
`node_modules` under a synced folder will reproduce it.

Stale `* 2` files (`schema 2.py`) are iCloud conflict copies. Verify which is
newer before deleting.
