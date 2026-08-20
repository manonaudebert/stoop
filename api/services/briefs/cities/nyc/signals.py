"""The signal definitions every consumer of the Building Brief shares.

There are three consumers — `smoke.py` (inline queries against real buildings),
the `hpd_brief_signals` materialized view (what the page reads), and the API
route that serves it. They must agree exactly: a rule that fires in one and not
another is a brief that contradicts the page it sits on.

So the category lists live here once, and the view's SQL is *generated* from
them by `render_migration()` rather than hand-written. Inlining these arrays as
SQL literals in a migration would fork the definition away from
`renter-facing-groups.json` and quietly undo the heat alignment the first time
someone edits the JSON. `test_briefs_signals_sql.py` regenerates the checked-in
migration and fails if it has drifted.

Imports nothing heavier than the taxonomy — see the note in `__init__.py` about
keeping the Anthropic SDK off the deterministic path.
"""

from pathlib import Path

from services.briefs.schema import HAZARD_AREA_LIMIT
from services.briefs.sql import sql_array as _sql_array
from services.briefs.taxonomy import minor_categories

# Complaint minor-categories behind the mold and pest rules. Named explicitly
# rather than taken from the mold_pests_sanitation taxonomy group, which also
# contains RUBBISH, ODOR, and UNSANITARY CONDITION — real complaints, but not
# what the HPD guidance for mold or pests is about. That narrowing is safe
# because the rule text makes a narrower claim than the card does: "Tenants here
# have reported mold" against a card labelled "Mold & pests". Different label,
# different number, no contradiction.
MOLD_CATEGORIES = ["MOLD"]
PEST_CATEGORIES = ["PESTS", "VERMIN"]

# Heat is the opposite case and must NOT be narrowed. The rule says "problems
# with heat or hot water" and the building page shows a "Heat / hot water" card
# — same label, so they have to be the same number. Read from the shared
# taxonomy so they cannot drift.
#
# This replaced `major_category = 'HEAT/HOT WATER'`, which looked more faithful
# to HPD but disagreed with the card: RADIATOR (36,162 complaints over five
# years) and BOILER sit in other majors while being squarely inside the
# renter-facing heat group. Measured over 4,000 random buildings, the two
# definitions produced a different count on 263 of them — 21% of the buildings
# where the rule fires — and every one of those would have printed a number next
# to a card showing a different one.
#
# Verified 2026-08-11, because filtering on minor_category alone looks unsafe
# for the two generic-sounding names: APARTMENT ONLY (1,007,982 rows) and ENTIRE
# BUILDING (1,895,894) occur under HEAT/HOT WATER and under no other major, so
# there is no contamination. RADIATOR genuinely spans three majors (PLUMBING,
# PAINT/PLASTER, HEATING) — but `MINOR_TO_GROUP` on the frontend keys on
# minor_category with no major qualifier either, so the card counts all three
# the same way. Matching the card is the point; do not "fix" this by adding a
# major_category filter here alone.
HEAT_CATEGORIES = minor_categories("heating_hot_water")

# Violation categories behind the detector rule. One signal, because the source
# gives one section of guidance for both devices.
DETECTOR_CATEGORIES = ["SMOKE DETECTING DEVICES", "CARBON MONOXIDE DETECTING DEVICES"]

# Lead-paint violations filed under order numbers HPD has since retired.
#
# `hpd_order_numbers.category` is 'RETIRED' for these, which describes the ORDER
# NUMBER — the legal provision was repealed — and says nothing about whether the
# violation was corrected. `current_status` on them is still NOV SENT OUT / NOT
# COMPLIED WITH, and their short_description is literally
# "REPEALED: LEAD - BASED PAINT". They are open lead-paint violations wearing an
# administrative label.
#
# Filtering on `category = 'LEAD-BASED PAINT'` alone therefore missed 18,895
# open class C lead violations — 22% of all of them — leaving **2,421 buildings
# with open lead paint and no lead paint item**, while those same rows inflated
# the abstract class C count and were dropped from hazard areas as admin. Wrong
# twice on the same rows, and in the direction that costs a renter most: the
# lead rule is the one that matters to anyone with a child under six.
#
# Not a legacy cleanup — order 614 was issued 2,211 times in 2020 and 1,716 in
# 2021, and those NOVs carry same-year inspection dates, so they are live
# findings filed under an old order number, not re-keyed history.
#
# Pinned as an explicit list rather than `short_description ILIKE '%LEAD%'`:
# the pattern is what found them, but a scan of free text is not a definition,
# and it would silently absorb any future order whose wording happens to match.
# 606 and 607 carry zero open violations today and are included anyway — they
# are the same repealed provision, and a list that omits them invites the next
# reader to wonder whether the omission meant something. Re-derive with:
#
#   SELECT order_number FROM hpd_order_numbers
#   WHERE category = 'RETIRED' AND short_description ILIKE '%LEAD%';
RETIRED_LEAD_ORDER_NUMBERS = ["555", "606", "607", "610", "611", "612", "614"]

# Every violation category the lead/detector aggregate needs to scan. Kept as a
# single filter so that pass walks a building's open violations once rather than
# once per signal. RETIRED joins the scan because the lead orders above live
# under it — the signal itself still narrows by order number, so no other
# retired violation is counted.
VIOLATION_CATEGORIES_SCANNED = ["LEAD-BASED PAINT", "RETIRED", *DETECTOR_CATEGORIES]

# The complaint window every complaint-driven rule uses. Stated once because the
# rules used to disagree: mold and pests were windowed here while heat was read
# from `hpd_complaints_building_summary.heat_complaints`, which carries NO date
# filter at all. Measured on 3,000 random buildings, that fired the heat rule on
# 46.5% of them versus 31.0% within five years — 15.5% of all buildings were
# being told about heat complaints whose most recent entry was over five years
# old, some of them single complaints from the early 2000s. The view column is
# still correct for the pages that want a lifetime total; it is the wrong input
# for a rule that tells a prospective tenant what to expect this winter.
COMPLAINT_WINDOW_YEARS = 5

# This module sits two levels deeper than it used to (services/briefs/ ->
# services/briefs/cities/nyc/), so the walk to the repo root is parents[5].
MIGRATION_PATH = (
    Path(__file__).resolve().parents[5]
    / "ingest" / "migration" / "migrate_hpd_brief_signals.sql"
)


def _view_body() -> str:
    """Everything after `CREATE MATERIALIZED VIEW <name> AS`, ending in `;`.

    Shared verbatim by the migration and by `schema.sql`, which differ only in
    their `CREATE` line — the migration drops and recreates, the canonical
    schema is idempotent. Keeping one body means the two cannot disagree about
    what the view actually computes, which is the only part that matters.
    """
    return f"""\
WITH bins AS (
    -- Every building with an HPD page. Violations and complaints do not cover
    -- the same set: a building can have complaints and no violations, and the
    -- page renders for both, so a brief must exist for both.
    SELECT bin FROM hpd_building_summary
    UNION
    SELECT bin FROM hpd_complaints_building_summary
),
viol AS (
    SELECT
        v.bin,
        COUNT(*) FILTER (
            WHERE v.violation_status = 'Open' AND v.violation_class = 'C'
        )                                                   AS open_class_c_violations,
        -- Two predicates, not one: the current LEAD-BASED PAINT category, plus
        -- the repealed order numbers whose category is RETIRED but whose
        -- violations are open lead paint. See RETIRED_LEAD_ORDER_NUMBERS —
        -- 22% of open lead violations live under the second branch.
        COUNT(*) FILTER (
            WHERE v.violation_status = 'Open'
              AND (
                o.category = 'LEAD-BASED PAINT'
                OR v.order_number = ANY({_sql_array(RETIRED_LEAD_ORDER_NUMBERS)})
              )
        )                                                   AS lead_paint_violations,
        -- Smoke and CO in one signal: the source treats them as one section and
        -- the guidance is identical. Neither category carries any open class C
        -- violations, so this cannot be folded into the class C signal.
        COUNT(*) FILTER (
            WHERE v.violation_status = 'Open'
              AND o.category = ANY({_sql_array(DETECTOR_CATEGORIES)})
        )                                                   AS smoke_co_detector_violations
    FROM hpd_violations v
    -- LEFT, not INNER: a violation whose order number is missing from
    -- hpd_order_numbers still counts toward the class C signal, which does not
    -- depend on the category at all.
    LEFT JOIN hpd_order_numbers o ON v.order_number = o.order_number
    WHERE v.bin IS NOT NULL
    GROUP BY v.bin
),
hazard AS (
    -- The categories behind this building's OPEN class C violations, most
    -- common first. Without these the class C rule is the only abstract one in
    -- the set: "conditions HPD classifies as immediately hazardous" names no
    -- observable thing, and a model asked for something concrete anyway
    -- invented nouns that traced to nothing in its input.
    --
    -- Three states must stay distinct downstream and this view preserves them:
    -- a non-empty array, an empty array (flagged, nothing describable — 4.6% of
    -- class C buildings), and NULL (not flagged at all). Collapsing the empty
    -- array into NULL restores the invented-nouns bug.
    SELECT bin, array_agg(category ORDER BY n DESC, category) AS open_class_c_categories
    FROM (
        SELECT
            v.bin, o.category, COUNT(*) AS n,
            ROW_NUMBER() OVER (
                PARTITION BY v.bin ORDER BY COUNT(*) DESC, o.category
            ) AS rn
        FROM hpd_violations v
        JOIN hpd_order_numbers o ON v.order_number = o.order_number
        WHERE v.violation_status = 'Open'
          AND v.violation_class = 'C'
          AND v.bin IS NOT NULL
          AND o.category IS NOT NULL
        GROUP BY v.bin, o.category
    ) ranked
    WHERE rn <= {HAZARD_AREA_LIMIT}
    GROUP BY bin
),
comp AS (
    SELECT
        c.bin,
        COUNT(*) FILTER (
            WHERE c.minor_category = ANY({_sql_array(MOLD_CATEGORIES)})
        )                                                   AS mold_complaints,
        COUNT(*) FILTER (
            WHERE c.minor_category = ANY({_sql_array(PEST_CATEGORIES)})
        )                                                   AS pest_complaints,
        -- Grouped by the shared taxonomy, NOT by major_category. See the note
        -- on HEAT_CATEGORIES in signals.py before changing this.
        COUNT(*) FILTER (
            WHERE c.minor_category = ANY({_sql_array(HEAT_CATEGORIES)})
        )                                                   AS heat_hot_water_complaints
    FROM hpd_complaints c
    WHERE c.bin IS NOT NULL
      AND c.received_date >= CURRENT_DATE - INTERVAL '{COMPLAINT_WINDOW_YEARS} years'
    GROUP BY c.bin
)
SELECT
    b.bin,
    COALESCE(viol.open_class_c_violations, 0)       AS open_class_c_violations,
    COALESCE(viol.lead_paint_violations, 0)         AS lead_paint_violations,
    COALESCE(viol.smoke_co_detector_violations, 0)  AS smoke_co_detector_violations,
    -- Deliberately NOT coalesced to an empty array: NULL means "class C never
    -- fired", [] means "fired, nothing describable". Three states, not two.
    hazard.open_class_c_categories,
    COALESCE(comp.mold_complaints, 0)               AS mold_complaints,
    COALESCE(comp.pest_complaints, 0)               AS pest_complaints,
    COALESCE(comp.heat_hot_water_complaints, 0)     AS heat_hot_water_complaints,
    -- The two confidence.py inputs. Read off the existing summary views rather
    -- than recomputed, so "thin record" and "stale record" mean exactly what
    -- they mean everywhere else on the site. Both are all-time on purpose: a
    -- record is not thin because it is old.
    COALESCE(hv.total_violations, 0)
        + COALESCE(hc.total_complaints, 0)          AS hpd_record_count,
    GREATEST(hv.latest_violation_date, hc.latest_complaint_date) AS latest_hpd_activity
FROM bins b
LEFT JOIN viol   ON viol.bin   = b.bin
LEFT JOIN hazard ON hazard.bin = b.bin
LEFT JOIN comp   ON comp.bin   = b.bin
LEFT JOIN hpd_building_summary hv            ON hv.bin = b.bin
LEFT JOIN hpd_complaints_building_summary hc ON hc.bin = b.bin;
"""


def render_migration() -> str:
    """The full text of `migrate_hpd_brief_signals.sql`.

    Regenerate with:

        cd api && ../.venv/bin/python -m services.briefs.cities.nyc.signals
    """
    return f"""\
-- GENERATED FILE — do not edit by hand.
--
-- Written by `api/services/briefs/cities/nyc/signals.py::render_migration`, which reads
-- the complaint categories from `frontend/lib/renter-facing-groups.json` via
-- the shared taxonomy. Editing this file directly forks the heat definition
-- away from the building page's "Heat / hot water" card, which is the exact
-- bug the taxonomy alignment fixed.
--
-- To change it: edit `cities/nyc/signals.py` (or the JSON), then regenerate with
--     cd api && ../.venv/bin/python -m services.briefs.cities.nyc.signals
-- `tests/test_briefs_signals_sql.py` fails if this file and the generator
-- disagree, and if `schema.sql` has drifted from either.
--
-- The seven signals behind the Building Brief's rules, one row per building.
-- `smoke.py` computes these inline against the base tables, which takes ~2.5s
-- per building — fine for a smoke run, far too slow for a page render. This
-- view is the same computation, precomputed.
--
-- Unlike most migrations here, this one is safely re-runnable: the DROP clears
-- the way, so it does not fail on the unique index the second time.

DROP MATERIALIZED VIEW IF EXISTS hpd_brief_signals;

CREATE MATERIALIZED VIEW hpd_brief_signals AS
{_view_body()}
-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY, and the route looks up
-- by bin.
CREATE UNIQUE INDEX hpd_brief_signals_bin_idx ON hpd_brief_signals (bin);
"""


def render_schema_section() -> str:
    """The `schema.sql` form: idempotent, no DROP.

    `schema.sql` is the canonical schema rather than an applied script, so it
    uses IF NOT EXISTS throughout and must not drop a populated view.
    """
    return f"""\
-- ── hpd_brief_signals ─────────────────────────────────────────────────────────
-- The seven signals behind the Building Brief's rules, one row per building.
-- Generated from `api/services/briefs/cities/nyc/signals.py` — see the note there before
-- editing the category lists, which come from renter-facing-groups.json.

CREATE MATERIALIZED VIEW IF NOT EXISTS hpd_brief_signals AS
{_view_body()}
CREATE UNIQUE INDEX IF NOT EXISTS hpd_brief_signals_bin_idx
    ON hpd_brief_signals (bin);
"""


if __name__ == "__main__":
    MIGRATION_PATH.write_text(render_migration())
    print(f"wrote {MIGRATION_PATH}")
