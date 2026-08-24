# Stoop — Project Guide

## Project overview

A public-facing tool for exploring HPD violations and complaints for NYC residential buildings. The primary audience is **renters and prospective tenants** researching a building before signing a lease or during a tenancy dispute.

The stack is a FastAPI backend (Python, SQLAlchemy async, PostgreSQL) and a Next.js frontend (TypeScript, server components, inline styles).

## Product philosophy

### Metrics that renters and tenants care about

When adding statistics or analytics for HPD violations, prioritize information that answers questions a real tenant would ask — not just what the data makes easy to compute.

**What renters want to know:**
- Is this building actively deteriorating, or is the history old? → trend over time, recent vs. prior periods
- How long has the landlord left problems unresolved? → open violation ages, average days to close
- Are there hazards that directly affect health or habitability? → Class C violations, lead paint, heat/hot water, mold/pests
- Can I withhold rent if things don't get fixed? → rent-impairing violation count
- Is this building worse than others nearby? → neighborhood percentile ranking
- What are the most common problems here? → top categories (past 5 years, not all-time)

**Design principles:**
- Prefer 5-year windows over all-time counts for "top categories" cards — all-time skews toward buildings with long histories
- Show trend direction (↑/↓/→) alongside raw numbers so a tenant can judge trajectory, not just snapshot
- Where a number is alarming (open Class C, rent-impairing), surface it prominently and explain what it means for the tenant in plain language via tooltips
- Avoid metrics that only make sense to inspectors or policy researchers unless they can be translated into tenant-relevant language

## Metric definitions

All computed metrics — percentile methodologies, time windows, decay weights, and which SQL views power which cards — are documented in [`METRICS.md`](METRICS.md).

**If you change metric methodology in any SQL migration, update `METRICS.md` to match.** This includes: time window changes, weighting adjustments, new percentile columns, or changes to which view a page reads from.

## Tests

Run the backend test suite before committing and flag any failures — do not commit with a broken test unless the failure is explicitly acknowledged:

```bash
cd api && ../.venv/bin/python -m pytest tests/ -v
```

Tests live in `api/tests/`. They use a mock DB (no real database needed). If a route grows a new `db.execute()` call, the corresponding test's `make_mock_db(...)` must supply an extra `MockResult` for it.

## Running migrations

Migrations are plain SQL files in `ingest/migration/`. Run them with `psql` using the `DATABASE_URL` from `.env`:

```bash
! psql "$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)" -f ingest/migration/migrate_<name>.sql
```

Read the value directly rather than `export $(grep DATABASE_URL .env | xargs)`: that pattern also matches commented-out `# DATABASE_URL=` lines (picking up a stale endpoint), and the unquoted URL's `&` (from `?sslmode=require&channel_binding=require`) gets mangled by the shell. The `^DATABASE_URL=` anchor skips comments and the quotes keep `&` literal.

**Notes:**
- There is no migration framework — git history is the record of which migrations have been applied. Running a migration twice will error on the `CREATE UNIQUE INDEX` (no `IF NOT EXISTS`), which is a safe signal that it was already applied.
- Migrations that `DROP / CREATE MATERIALIZED VIEW` do a full recompute and take a few minutes. The API serves stale cache data during that window, then picks up the new view automatically — no restart needed.
- Always update `schema.sql` to match whenever a migration changes a view definition, so the canonical schema stays in sync.

## Changing code

- Minimum change that solves the problem. No drive-by refactors, renames, or reformatting.

## Code style

- Strict types. Don't reach for the escape hatch unless the alternative is genuinely worse.
- Never interpolate values into a query string. Use the language's parameter bindings.
- Handle errors where they can actually be handled. Don't swallow exceptions to make output look clean.
- No docstrings on self-evident functions, no banner comments, no comments narrating the next line.

## Before saying it's done

- **If you changed code, run it.** Build it, execute the script, hit the endpoint, run the test, whatever proves it works.
- **Make the win concrete.** "Login now works with magic links. Try: `npm run dev`, open `/login`." Not "I've made some changes to the auth flow."
- If you couldn't verify, say so: "not tested, no way to run this here."
- If tests fail or output is wrong, show the actual output. "Should work" is not done.

## Errors and debugging

- State cause and fix: "Test fails at `auth.spec.ts:42`: expected 200, got 401. Cause: missing auth header. Fix: add `Authorization: Bearer ${token}`."
- If the cause isn't established, say what you've ruled out and the one thing you'd check next. Never dress a guess as a diagnosis.
- **Debug spiral.** If you've tried two fixes for the same symptom and it's still broken, stop editing code. Name the assumption you haven't tested and ask one diagnostic question.

## Communication

- No preamble, no recap, no closers. Not "Great question", "Let me…", "Sure!", "Hope this helps", "Let me know if you need anything else".
- **Lead with the action.** If the answer is a command, path, or snippet, it goes first. One line of approach counts as the answer. Anything longer is preamble.
- Don't flatter, praise, validate, or agree without a reason. Challenge a wrong assumption directly and say why.
- When I challenge a claim, re-check before you answer. If you were right, hold the position and show the evidence. "You're right" with no new tool call is not an answer. If there's nothing to re-run, say what would settle it.
- If I ask you to explain or walk me through something, or ask a question that plainly needs prose, explain fully. Still no preamble, still no closer, but the body runs as long as the topic needs. Add headers so I can skim back.

## Multi-step work (implementation only)

- More than a couple of steps: numbered list, one bounded action per step, fewest steps that still work. If you're using the todo tool, that *is* the list. Don't also narrate it as prose.
- **Carry state forward.** In work spanning several turns, open with one line: "Schema updated, next is the backfill." That line is state, not a recap, and it's the only summary allowed.
- Estimate duration only when I ask, or when the work is big enough that I might want to stop you. Estimate my time, not your runtime, and give the branch: "5 minutes if the fixture exists, an hour if I have to build one."
