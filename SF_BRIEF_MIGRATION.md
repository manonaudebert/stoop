# SF Building Brief — migration handoff

Everything needed to apply `sf_brief_signals` and see the SF brief render, written
so a fresh session can pick it up cold. **Nothing here has touched a database
yet.** The code is committed; the view does not exist in any environment.

Companions: `SF_BRIEF_HANDOFF.md` (why the feature is shaped this way),
`METRICS.md` (what every signal means), `BRIEF_ROLLOUT.md` (the NYC feature).

---

## State

Branch **`sf-building-brief`**, four commits off `main` at `176087b`, not pushed.

```
f1c7ca4  docs: record SF brief methodology and two corrections
3520da3  feat(sf): add the SF Building Brief
76cd6f4  feat(briefs): make watch_for authorable, and label it by row
c247633  refactor(briefs): put the Building Brief on a city registry
```

Separately: branch **`domain-stoopcity`** is pushed and open as
[PR #5](https://github.com/manonaudebert/stoop/pull/5) — an unrelated
`stoopnyc.org` → `stoopcity.org` rename. `sf-building-brief` does NOT carry it,
so anything deployed from this branch before that merges still emits the old
domain in its OG metadata.

**Verified green on the committed tree:** 419 tests, offline, ~0.9s; `tsc
--noEmit` clean; the generated SQL parses and plans against prod.

### What is built

| | |
|---|---|
| `api/services/briefs/cities/` | `CityBriefConfig` registry; NYC moved onto it, SF added |
| `cities/sf/rules.yaml` | 16 authored rules, each cited |
| `cities/sf/taxonomy.json` | complete partition of all 37 DataSF subtypes |
| `cities/sf/nov_patterns.yaml` | the NOV text classifier, as config |
| `cities/sf/classifier.py` | one table, two engines (Python + generated SQL) |
| `cities/sf/signals.py` | generates `migrate_sf_brief_signals.sql` |
| `GET /sf/building/{mapblklot}/brief` | in `api/routes/sf.py` |
| `frontend/app/sf/building/[id]/page.tsx` | renders `<BuildingBrief>` after the Severity card |
| `data/sf_nov_labels/labels_final.csv` | 114 hand-labelled rows, basis recorded per row |

**No model anywhere in SF's path.** Every string, `watch_for` included, is
authored and cited. The page must never show the AI-assisted label for SF —
`watch_for_source` is `"authored"` on every SF item, and a test asserts it.

---

## The migration

One file: `ingest/migration/migrate_sf_brief_signals.sql`. Safely re-runnable —
it `DROP`s first, so it will not fail on the unique index a second time.

**Test on a Neon branch before prod. Never point `.env` at anything but prod.**

```bash
# 1 ── branch from prod data
neonctl branches create --org-id org-restless-sun-47417782 \
  --name sf-brief-signals --output json
neonctl connection-string sf-brief-signals \
  --org-id org-restless-sun-47417782 --output json     # export as $BRANCH_URL

# 2 ── apply, and TIME it. This is the number that decides the prod window.
time psql "$BRANCH_URL" -f ingest/migration/migrate_sf_brief_signals.sql

# 3 ── sanity checks
psql "$BRANCH_URL" -c "SELECT count(*) FROM sf_brief_signals;"           # expect 46,260
psql "$BRANCH_URL" -c "SELECT count(*) FROM sf_brief_signals
                       WHERE open_interior_surfaces_violations > 0;"     # expect ~597
psql "$BRANCH_URL" -c "SELECT count(*) FROM sf_brief_signals
                       WHERE open_lead_paint_violations > 0;"            # expect ~153, NOT thousands

# 4 ── run the app against the branch, never overwriting prod .env
echo "DATABASE_URL=$BRANCH_URL" > .env.branch

# 5 ── prod, then clean up
psql "$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)" \
  -f ingest/migration/migrate_sf_brief_signals.sql
neonctl branches delete sf-brief-signals --org-id org-restless-sun-47417782
```

Check 3's lead count is the one worth reading carefully. If it comes back in the
thousands, the classifier's lead rule has regressed — see *The lead rule* below.

### Cost and timing, measured

Measured against prod 2026-08-19, read-only:

| | |
|---|---|
| full view build | ~39 s |
| of which the classifier regex | **~6.3 s** |
| rows the regex touches | **29,957** — active violations only, via `idx_sf_dbi_nov_status` |
| same rows, no regex | 0.06 s |

An earlier note in conversation said "a regex cascade over 516k rows". That was
wrong: the `labelled` CTE filters `status = 'active'` before the LATERAL, so the
regex never sees the other 486k.

**This cost is paid once per sync, not per request.** The page reads
`sf_brief_signals` through a unique index — a single-row lookup, unaffected. At a
daily sync it is roughly 0.011 compute-hours/day, and it piggybacks on a compute
already awake for the other two SF refreshes.

If it ever needs to be cheaper, the cheapest win is collapsing the seven
`regexp_replace` advisory passes into one alternation. **Do not** precompute the
label onto `sf_dbi_nov` at ingest: DBI republishes every row wholesale on each
publish, so that recomputes 516k rows instead of 30k.

The real operational cost is the one-off `DROP` + `CREATE`, during which the API
serves a missing view. Step 2's timing is what tells you how long that is.

### After it is applied

`ingest/sync_sf.py::_refresh_sf_views` already refreshes `sf_brief_signals`,
after both summary views (it reads them). Nothing else to wire.

No API restart needed — the route picks up the view automatically.

---

## Verify end to end

```bash
cd api && ../.venv/bin/python -m pytest tests/ -v          # 419, offline
cd api && ../.venv/bin/python -m services.briefs.cities.sf.signals   # regenerates; must be a no-op
cd api && ../.venv/bin/python -m services.briefs.smoke --bin 2003187 --signals   # NYC unchanged
```

Then check three SF parcels on the running app: one flagging several conditions,
one flagging a single condition, one with no records (the empty state). Confirm:

- the viewing line renders **without** the AI-assisted label on SF
- it renders **with** the label on NYC (BIN 2003187)
- copy says "property", never "building" — a mapblklot is a PARCEL and can carry
  several buildings

**The NYC regression to watch:** the 903-row corpus at `brief-v11` must still
resolve after the registry refactor. It did when this was built — all three
corpus keys for BIN 2003187 hit — but re-check if anything touches `corpus.py`
or `taxonomy.py`.

---

## Things a fresh session should not have to rediscover

**The lead rule is the most consequential decision in the classifier.**
`lead_paint` fires only on an explicit abatement or containment order. It does
NOT fire on lead warnings, because San Francisco *presumes* all peeling paint and
its substrate contains lead — so that language rides along on every paint order
and says nothing about whether lead was found. An early version keyed on it and
labelled 1,953 rows `lead_paint` against DBI's own 72 in `lead section`. A false
lead flag alarms a reader far more than it protects them. Bare warnings resolve
to `peeling_paint` instead.

**One pattern table, two engines.** The classifier runs in Python (tests,
evaluation) and as generated SQL (the site). They were verified identical on all
29,957 active rows. The live hazard is dialect: POSIX spells a word boundary
`\y`, Python spells it `\b`, and **Postgres reads `\b` as BACKSPACE** — a stray
`\b` would match nothing in the view while passing every Python test. A test
asserts no pattern contains one.

**Accuracy is 98% over 114 hand-labelled rows, 99% on the 70 held out.** The
corpus is checked in. Most of the ordering came from labelled disagreements, not
from reasoning — `nov_patterns.yaml` records which decision came from which.

**Coverage is 13.1%** (6,075 of 46,260 parcels), against a 13.3% ceiling for
anything violations-led. NYC's is ~52%, and the gap is structural: NYC's spine is
`open_class_c` at ~43% of buildings and SF has no equivalent, because its
violation categories name code sections rather than conditions.

**Do not reintroduce a `> 1` complaint floor.** It was tried and removed: NYC's
reasoning at a tenth of NYC's volume, and it suppressed 77% of properties where a
tenant reported mold. The brief says tenants *reported* a condition, which one
complaint supports exactly.

---

## Still open

- **Elevators.** 388 parcels, 181 at `>1` — larger than heat — and no gathered
  source covers them, so no rule ships. The highest-value next step is finding
  one (SF Housing Code elevator provisions, or CA Civil Code). `amlegal.com` is
  Cloudflare-protected, so it needs browser automation, not a fetch.
- **The scanned sf.gov habitability checklist** is still untranscribed.
- **`RIGHTS_PATTERNS` in `validate.py`** lacks the California remedy terms
  (repair and deduct, small claims, Rent Board). Harmless while SF has no model,
  a trap the moment it does.
- **`brief_texts` has no `city` column.** Nothing needs it in phase 0. It becomes
  load-bearing the moment SF generates anything, because rules named `mold` and
  `pests` exist in both cities and would silently overwrite NYC's corpus.
- **A logistic-regression classifier** was scoped and not built. The argument for
  it: every remaining error is an ordering artifact, and a linear model weighs
  terms instead of needing hand-tuned precedence. The blocker was training
  labels, and the answer is that ~13k rows carry an explicit Housing Code section
  that can supervise it for free.
