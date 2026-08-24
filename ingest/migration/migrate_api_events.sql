-- Durable telemetry: faults, searches, and page views.
--
-- The platform log tails (Railway, Vercel) are short-retention buffers with
-- weak search — fine for "what broke ten minutes ago", useless for "did search
-- failures go up this month". This table is the queryable half. Every API
-- request is still logged as JSON to stdout; only these rows persist:
--
--   kind='request'   status >= 400 only. Successful 200s stay in stdout —
--                    storing them buys nothing and multiplies write volume.
--   kind='search'    every address lookup, with its result count. A search
--                    returning zero rows is the clearest proxy for a data gap.
--   kind='pageview'  beaconed from the browser, because frontend/lib/api.ts
--                    caches server-side reads for a day (so Neon can suspend),
--                    which means the API never sees most page loads.
--   kind='error'     client-side render failure, carrying the Next digest.
--
-- `internal` tags the maintainer's own traffic (set via the ?dev=1 cookie in
-- frontend/proxy.ts) and `is_bot` tags crawlers by user-agent. Both are
-- tagged rather than dropped so you can query your own sessions deliberately;
-- every dashboard query should carry `WHERE NOT internal AND NOT is_bot`.
--
-- No IP address is stored here. Search terms are addresses, so they persist for
-- the zero-result metric to work at all, but the IP stays in the ephemeral
-- stdout log where it is only ever used for abuse debugging.
--
-- Writes come from api/observability.py: a bounded in-process queue drained by
-- one background task, batched, on its own engine. Pruned to 90 days by the
-- weekly GitHub Action.

CREATE TABLE IF NOT EXISTS api_events (
    id           BIGSERIAL PRIMARY KEY,
    ts           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    kind         TEXT        NOT NULL,   -- request | search | pageview | error
    city         TEXT,                   -- nyc | sf
    route        TEXT,                   -- route template, never a raw path
    status       INT,
    duration_ms  INT,
    request_id   TEXT,                   -- joins stdout, Vercel, and this table
    query        TEXT,                   -- search term (kind='search' only)
    result_count INT,
    internal     BOOLEAN     NOT NULL DEFAULT false,
    is_bot       BOOLEAN     NOT NULL DEFAULT false,
    meta         JSONB
);

CREATE INDEX IF NOT EXISTS api_events_ts_idx      ON api_events(ts DESC);
CREATE INDEX IF NOT EXISTS api_events_kind_ts_idx ON api_events(kind, ts DESC);
CREATE INDEX IF NOT EXISTS api_events_err_idx     ON api_events(ts DESC)
    WHERE status >= 400;

-- The shape every dashboard query has: real traffic only, newest first.
CREATE INDEX IF NOT EXISTS api_events_real_idx    ON api_events(kind, ts DESC)
    WHERE NOT internal AND NOT is_bot;

-- Correlating one user's 500 screen back to its stdout line.
CREATE INDEX IF NOT EXISTS api_events_request_id_idx ON api_events(request_id)
    WHERE request_id IS NOT NULL;
