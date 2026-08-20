"""`sf_brief_signals` — the precomputed inputs to SF's brief rules.

The SF counterpart of `cities/nyc/signals.py`, and the same arrangement: the SQL
is GENERATED from the taxonomy rather than hand-written, so the view's category
lists cannot drift away from the file the rules and the page read. NYC learned
that the hard way; SF inherits the guard for free.

Regenerate with:

    cd api && ../.venv/bin/python -m services.briefs.cities.sf.signals

`tests/test_briefs_signals_sql.py` fails if the checked-in migration and this
generator disagree.

Two differences from NYC worth holding in mind:

**Grain.** A row is one `mapblklot` — a PARCEL, which can carry more than one
building. Every reader-facing string reached from here says "property", not
"building"; see `CityBriefConfig.subject_noun`.

**Direction of evidence.** NYC's spine is the inspector's finding (open class C),
with tenant complaints suppressed when they duplicate it. SF inverts: the 311
subtypes are cleanly categorized and map onto Health Code §581(b), while
`nov_category_description` is 52.7% code-section labels rather than conditions.
So the complaint signals carry the brief, and only three NOV categories — the
three that name a condition — contribute at all.
"""

from pathlib import Path

from services.briefs.cities import SF
from services.briefs.cities.sf import classifier
from services.briefs.sql import sql_array
from services.briefs.taxonomy import groups, minor_categories

# Complaints older than this describe a building's history rather than what a
# prospective tenant would meet. Same window as NYC, and the same reasoning: a
# lifetime total is the right input for a card and the wrong one for a rule that
# says what to expect this winter.
COMPLAINT_WINDOW_YEARS = 5

# `nov_category_description` values are stored lowercase. The taxonomy holds them
# uppercased because `group_of_violation_category` uppercases before lookup, so
# they are lowered again on the way into SQL rather than either side changing to
# accommodate the other.
VIOLATION_GROUPS = (
    "fire_safety",
    "lead_paint",
    "smoke_detectors",
    "security_locks",
    "sanitation",
)

MIGRATION_PATH = (
    Path(__file__).resolve().parents[5]
    / "ingest" / "migration" / "migrate_sf_brief_signals.sql"
)


def complaint_signals() -> list[tuple[str, str, list[str]]]:
    """(signal name, group key, subtypes) for every group, in taxonomy order.

    Derived, never listed by hand: a group added to `taxonomy.json` becomes a
    column here automatically, and the rule that reads it fails loudly through
    `MissingSignalError` if the view was not regenerated. The alternative — two
    hand-maintained lists — is exactly the drift the generated SQL exists to
    prevent.

    A group with NO subtypes is skipped rather than given an always-zero column.
    That is a real case: `interior_surfaces` is a condition DBI writes about
    constantly and 311 has no category for, so it is violations-only.
    """
    return [
        (f"{group}_complaints", group, subtypes)
        for group in groups(SF)
        if (subtypes := minor_categories(group, SF))
    ]


def violation_signals() -> list[tuple[str, list[str]]]:
    """(signal name, NOV categories) for the categories naming one condition."""
    out = []
    for group in VIOLATION_GROUPS:
        categories = [c.lower() for c in groups(SF)[group].get("violation_categories", ())]
        if categories:
            out.append((f"open_{group}_violations", categories))
    return out


def classified_violation_signals() -> list[str]:
    """`open_<group>_violations` for every group the NOV classifier can assign.

    Replaces the earlier per-group `violation_patterns`, which tested each group
    independently and so let one row count toward several. One ordered table now
    assigns ONE group per row, which is both easier to reason about and what the
    hand-labelled evaluation measures — 98% over 114 rows, 99% held out.

    A group reachable by the classifier but with no rule reading it is caught by
    the signals/rules parity test rather than silently costing a column.
    """
    return [f"open_{group}_violations" for group in classifier.groups()]


def _view_body() -> str:
    """Everything after `CREATE MATERIALIZED VIEW <name> AS`, ending in `;`.

    Shared verbatim by the migration and by `schema.sql`, which differ only in
    their `CREATE` line. One body means the two cannot disagree about what the
    view computes.
    """
    comp_columns = ",\n".join(
        f"""        COUNT(*) FILTER (
            WHERE c.service_subtype = ANY({sql_array(subtypes)})
        ){' ' * max(1, 50 - len(signal))}AS {signal}"""
        for signal, _group, subtypes in complaint_signals()
    )
    # Category is the FALLBACK, not the lead: DBI's ten categories are mostly
    # code-section labels, so the text (specific) decides first and the category
    # only catches rows the text could not name.
    category_fallback = {
        group: [c.lower() for c in spec.get("violation_categories", ())]
        for group, spec in groups(SF).items()
        if spec.get("violation_categories")
    }
    viol_columns = ",\n".join(
        f"""        COUNT(*) FILTER (WHERE t.condition_group = '{group}')""" +
        f"""{' ' * max(1, 30 - len(group))}AS open_{group}_violations"""
        for group in classifier.groups()
    )
    comp_select = ",\n".join(
        f"    COALESCE(comp.{signal}, 0){' ' * max(1, 44 - len(signal))}AS {signal}"
        for signal, _g, _s in complaint_signals()
    )
    viol_select = ",\n".join(
        f"    COALESCE(viol.{signal}, 0){' ' * max(1, 44 - len(signal))}AS {signal}"
        for signal in classified_violation_signals()
    )

    classifier_case = classifier.render_sql_case(indent="            ")
    text_expr = classifier.render_sql_text_expression()
    category_case = "\n".join(
        ["            CASE"]
        + [
            f"                WHEN lower(v.nov_category_description) = "
            f"ANY({sql_array(cats)}) THEN '{group}'"
            for group, cats in category_fallback.items()
        ]
        + ["            END"]
    )

    return f"""\
WITH parcels AS (
    -- Every parcel with an SF page. Violations and complaints do not cover the
    -- same set — a parcel can have complaints and no violations, and the page
    -- renders for both — so a brief must exist for both.
    SELECT mapblklot FROM sf_violations_summary
    UNION
    SELECT mapblklot FROM sf_housing_complaints_summary
),
labelled AS (
    -- One condition group per ACTIVE notice of violation, read out of its text.
    --
    -- `nov_category_description` cannot do this job: it has ten values and 52.7%
    -- of rows are `building section`, `other section` or blank, which name a
    -- chapter of the code rather than a condition. The condition itself is in
    -- the text, in a canonical phrase DBI reuses ("repair damaged ceilings
    -- (1001b,h,o hc)"), so the CASE below reads it out. Ordered first-match-wins
    -- and generated from `cities/sf/nov_patterns.yaml` — read that file before
    -- changing the order, and never hand-edit this.
    --
    -- Category is the FALLBACK and only catches rows the text could not name.
    --
    -- NEITHER text field is ever rendered. They carry inspector names, addresses
    -- and narrative; this is classification only.
    --
    -- `status` has exactly two values, 'active' and 'not active'. DBI
    -- republishes every row on each publish, so `date_filed` is the incremental
    -- key and the status column is trued up wholesale — see the ingest notes.
    SELECT
        v.mapblklot,
        COALESCE(
{classifier_case},
{category_case}
        )                                       AS condition_group
    FROM sf_dbi_nov v
    CROSS JOIN LATERAL (SELECT {text_expr} AS txt) t
    WHERE v.mapblklot IS NOT NULL
      AND v.status = 'active'
),
viol AS (
    SELECT
        t.mapblklot,
{viol_columns}
    FROM labelled t
    WHERE t.condition_group IS NOT NULL
    GROUP BY t.mapblklot
),
comp AS (
    SELECT
        c.mapblklot,
{comp_columns}
    FROM sf_311_housing c
    WHERE c.mapblklot IS NOT NULL
      AND c.requested_datetime >= CURRENT_DATE - INTERVAL '{COMPLAINT_WINDOW_YEARS} years'
    GROUP BY c.mapblklot
)
SELECT
    p.mapblklot,
{viol_select},
{comp_select},
    -- The two confidence.py inputs. Read off the existing summary views rather
    -- than recomputed, so "thin record" and "stale record" mean exactly what
    -- they mean everywhere else on the site. Both are all-time on purpose: a
    -- record is not thin because it is old.
    COALESCE(sv.total_violations, 0)
        + COALESCE(sc.total_complaints, 0)          AS sf_record_count,
    GREATEST(sv.latest_violation_date, sc.latest_complaint_date) AS latest_sf_activity
FROM parcels p
LEFT JOIN viol ON viol.mapblklot = p.mapblklot
LEFT JOIN comp ON comp.mapblklot = p.mapblklot
LEFT JOIN sf_violations_summary sv         ON sv.mapblklot = p.mapblklot
LEFT JOIN sf_housing_complaints_summary sc ON sc.mapblklot = p.mapblklot;
"""


def render_migration() -> str:
    """The full text of `migrate_sf_brief_signals.sql`."""
    return f"""\
-- GENERATED FILE — do not edit by hand.
--
-- Written by `api/services/briefs/cities/sf/signals.py::render_migration`,
-- which reads the 311 subtypes and NOV categories from
-- `api/services/briefs/cities/sf/taxonomy.json`. Editing this file directly
-- forks the view away from the taxonomy the rules read, which is the bug the
-- generated SQL exists to prevent.
--
-- To change it: edit `cities/sf/signals.py` (or the JSON), then regenerate with
--     cd api && ../.venv/bin/python -m services.briefs.cities.sf.signals
-- `tests/test_briefs_signals_sql.py` fails if this file and the generator
-- disagree, and if `schema.sql` has drifted from either.
--
-- The signals behind SF's Building Brief rules, one row per PARCEL. A mapblklot
-- can carry more than one building, so copy derived from this view says
-- "property" rather than "building".
--
-- Complaint counts use a {COMPLAINT_WINDOW_YEARS}-year window; the two
-- confidence inputs are all-time on purpose.
--
-- Unlike most migrations here, this one is safely re-runnable: the DROP clears
-- the way, so it does not fail on the unique index the second time.

DROP MATERIALIZED VIEW IF EXISTS sf_brief_signals;

CREATE MATERIALIZED VIEW sf_brief_signals AS
{_view_body()}
-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY, and the route looks up
-- by mapblklot.
CREATE UNIQUE INDEX sf_brief_signals_mapblklot_idx
    ON sf_brief_signals (mapblklot);
"""


def render_schema_section() -> str:
    """The `schema.sql` form: idempotent, no DROP."""
    return f"""\
-- ── sf_brief_signals ─────────────────────────────────────────────────────────
-- The signals behind SF's Building Brief rules, one row per parcel.
-- Generated from `api/services/briefs/cities/sf/signals.py` — see the note
-- there before editing the category lists, which come from that city's
-- taxonomy.json.

CREATE MATERIALIZED VIEW IF NOT EXISTS sf_brief_signals AS
{_view_body()}
CREATE UNIQUE INDEX IF NOT EXISTS sf_brief_signals_mapblklot_idx
    ON sf_brief_signals (mapblklot);
"""


if __name__ == "__main__":
    MIGRATION_PATH.write_text(render_migration())
    print(f"wrote {MIGRATION_PATH}")
