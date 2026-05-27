# NYC Violations — Project Guide

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
