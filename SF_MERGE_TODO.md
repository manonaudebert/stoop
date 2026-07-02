# SF merge — remaining tasks

Follow-up work for merging the `/sf` section to mainline. The **DB/cost (A1–A4)** and
**backend refactor (B1–B3)** passes are already done (single-query map clusters,
schema.sql views, consolidated `migrate_add_sf.sql`, METRICS.md SF section, de-duped
search SQL, shared `RISK_COLORS`, reused NYC search normalization).

What's left is **frontend parity** — making the SF pages match the NYC building pages so
the experience is seamless — plus one larger optional reuse refactor. Reference files:
`frontend/app/sf/building/[id]/page.tsx` (SF) vs `frontend/app/hpd/building/[bin]/page.tsx`
(NYC gold standard).

---

## C1 — Link `/sf` from navigation — ✅ DONE (superseded by a city switcher)
Rather than a one-off nav link, added an inline **NYC / SF** toggle (`components/CityToggle.tsx`,
dark + light variants) that makes city a first-class dimension. Wired into both map headers
(`UnifiedMapWrapper`, `SfMapWrapper` — replaced the old "SF" badge + redundant "NYC" link) and
all leaderboard headers (`hpd`/`dob` above the dataset toggle, `sf` at the top). Map context
switches map↔map (`/` ↔ `/sf/map`); leaderboard context switches board↔board
(`/hpd/leaderboard` ↔ `/sf/leaderboard`). Methodology intentionally left off the toggle — see
follow-up below.

## C2 — Rich "no records" empty state — ✅ DONE
Backend now falls back to the EAS corpus (`sf_addresses`) when both summary views are empty,
returning a zero-record shell instead of 404 (`api/routes/sf.py`); genuine 404 only when EAS
has never heard of the parcel. Frontend renders the NYC-style hero + "No records on file" body
(`sf/building/[id]/page.tsx`). Tests updated: `test_404_when_parcel_unknown_to_eas`,
`test_zero_records_but_eas_resolves_returns_shell`.

## C3 — Mobile card view for the record log — ✅ DONE (SF-only scope)
`RecordLog` gained an optional `renderCard` prop → dual table (`log-table-wrap`) + card
(`log-cards-wrap`) rendering; omitting it keeps the table on all breakpoints (backward
compatible). SF page provides `ComplaintCard` / `NovCard`. NYC logs were **not** retrofitted
onto the shared component (kept blast radius small) — still open as a reuse follow-up.

## C4 — Log filter pills — ✅ DONE (status filter)
Added Open/Closed status filter to the SF violation log: `vst` query param → server-side
`WHERE LOWER(status) = 'active'` split (matches `sf_violations_summary.open_violations`),
threaded through `getSfBuilding`, rendered via `RecordLog`'s new `filters` slot. Category
filter not added (optional). Test: `test_violations_open_status_filter`.

## C5 — Extract shared rank-copy helpers — ✅ DONE
Extracted `pctHeadline` / `pctPhrase` / `pctSub` to `frontend/lib/rankCopy.ts`; both building
pages import them. Drift resolved: `pctHeadline` now rounds `primary` (SF's correct behavior);
`pctSub`'s city-specific missing-data message + trailing note are passed as options.

## C6 — Add `loading.tsx` for SF routes — ✅ DONE
Added `frontend/app/sf/leaderboard/loading.tsx` and `frontend/app/sf/building/[id]/loading.tsx`
(same skeletons as hpd/dob).

## Follow-ups surfaced during this pass
- **SF methodology page.** `/methodology` is NYC-only (NYC dataset links + percentile windows).
  The city toggle deliberately omits methodology until an SF methodology page exists — writing
  it (DBI/EAS sources, locked severity map) would let the toggle cover it too.
- **NYC logs on shared `RecordLog`.** C3 added card support but only SF uses it; retrofitting
  the NYC violation/complaint logs is the remaining DRY win.

## C7 — (Optional, larger/riskier) Sidebar + map-wrapper reuse
`SfBuildingSidebar` / `SfMapWrapper` (~488 lines) largely re-implement
`CombinedBuildingSidebar` / `UnifiedMapWrapper` (~672 lines). Real reuse is possible but the
SF lens model differs (complaints/violations lens vs DOB/HPD lens), so this is higher-risk.
Only attempt after C1–C6 land and tests are green.

---

## Map cluster caching — approved, NEXT (clusters only)
**Goal:** toggling NYC↔SF and reloading the map should be cheap/fast. Today the map cluster
fetches go through `frontend/app/api/proxy/[...path]/route.ts`, which returns **no
`Cache-Control`**, so nothing between the browser and the backend caches them — every load hits
the serverless function → backend (which does cache in an in-process LRU, 24h TTL).

**Setup:** deployed on **Vercel** (Edge Network CDN) with the domain fronted by **Cloudflare**.

**Plan (scoped to the cluster GET endpoints only — leave building-detail/search `no-store`):**
- Emit tiered cache headers on cluster responses: `Cache-Control` (browser),
  `Vercel-CDN-Cache-Control` (Vercel Edge), `CDN-Cache-Control` (Cloudflare).
- Cluster endpoints to cover: `map/unified/clusters`, `map/heatmap`, `sf/map/clusters`
  (confirm exact proxied paths).
- **Data refreshes only ~weekly**, so cache **aggressively**: long edge `s-maxage` (a day+)
  plus `stale-while-revalidate`; short browser `max-age`. No need for short TTLs.
- **Cache-bust on sync:** because data is weekly, a long TTL risks showing week-old (or older)
  clusters. Add a versioned cache key / purge step tied to the weekly sync so fresh data shows
  promptly. (Decide mechanism: query-param version bumped at sync, or a Cloudflare purge.)
- **Cloudflare caveat:** Cloudflare does **not** cache `/api/proxy/*` by default (only static
  extensions). Lighting up the Cloudflare tier needs a **Cache Rule** in the dashboard; browser
  + Vercel Edge tiers work from the headers alone.

## Before merging
- Run backend tests: `cd api && ../.venv/bin/python -m pytest tests/ -v` (currently 95 pass).
- Build the frontend to catch type errors from the shared-component refactors.
- Migration: `ingest/migration/migrate_add_sf.sql` is the single consolidated file — run it
  branch → prod → cleanup per the Neon workflow before/at merge (commands were provided when
  it was consolidated; ask if you need them re-printed).
- These pages read Next.js APIs that differ from stock — check `node_modules/next/dist/docs/`
  per `frontend/AGENTS.md` before writing frontend code.
