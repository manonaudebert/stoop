"""The generated migration must match its generator, and both must match the JSON.

These are offline tests — no database. They guard the one thing a materialized
view makes easy to get wrong: the view's category lists silently drifting away
from `renter-facing-groups.json`, which is what the building page renders from.
A drift here is invisible in every test that does not compare the two, and it
shows up on the site as a brief whose number contradicts the card beside it.
"""

import re

import pytest

from services.briefs import signals
from services.briefs.taxonomy import minor_categories


def test_checked_in_migration_matches_the_generator():
    """Regenerate and compare. Fails if someone hand-edited the SQL.

    Fix by running: cd api && ../.venv/bin/python -m services.briefs.signals
    """
    on_disk = signals.MIGRATION_PATH.read_text()
    assert on_disk == signals.render_migration(), (
        "ingest/migration/migrate_hpd_brief_signals.sql is out of date. "
        "Regenerate it: cd api && ../.venv/bin/python -m services.briefs.signals"
    )


def _sql_array_contents(sql: str, column: str) -> list[str]:
    """The values of the ARRAY[...] literal feeding `AS <column>` in the SQL.

    Searches BACKWARD from the alias: the array sits inside the FILTER clause,
    which comes before the alias it names. Looking forward instead picks up the
    next column's array and quietly compares the wrong two lists.
    """
    alias = re.search(rf"AS\s+{re.escape(column)}\b", sql)
    assert alias, f"no `AS {column}` in the generated SQL"
    head = sql[:alias.start()]
    literals = re.findall(r"ARRAY\[(.*?)\]", head, re.S)
    assert literals, f"no ARRAY[...] precedes `AS {column}`"
    return re.findall(r"'((?:[^']|'')*)'", literals[-1])


def test_view_heat_categories_equal_the_taxonomy_group():
    """Heat must be EXACTLY the renter-facing group — the card uses that label.

    Equality, not containment. This is the relationship the heat alignment
    established and the one a well-meaning `major_category` filter would break.
    """
    sql = signals.render_migration()
    in_sql = _sql_array_contents(sql, "heat_hot_water_complaints")
    assert sorted(in_sql) == sorted(minor_categories("heating_hot_water"))
    assert sorted(signals.HEAT_CATEGORIES) == sorted(minor_categories("heating_hot_water"))


@pytest.mark.parametrize(
    "column, constant",
    [
        ("mold_complaints", signals.MOLD_CATEGORIES),
        ("pest_complaints", signals.PEST_CATEGORIES),
    ],
)
def test_view_complaint_categories_match_their_constants(column, constant):
    sql = signals.render_migration()
    assert sorted(_sql_array_contents(sql, column)) == sorted(constant)


@pytest.mark.parametrize("column, constant", [
    ("smoke_co_detector_violations", signals.DETECTOR_CATEGORIES),
])
def test_view_violation_categories_match_their_constants(column, constant):
    sql = signals.render_migration()
    assert sorted(_sql_array_contents(sql, column)) == sorted(constant)


def test_mold_and_pests_stay_a_strict_subset_of_their_group():
    """The opposite relationship from heat, and deliberately so.

    The card says "Mold & pests" and also counts RUBBISH, ODOR and UNSANITARY
    CONDITION; the rules say "tenants here have reported mold". A narrower claim
    may carry a narrower number. Pinned so the next person who notices the
    asymmetry with heat finds the reasoning instead of "fixing" it.
    """
    group = set(minor_categories("mold_pests_sanitation"))
    rules_use = set(signals.MOLD_CATEGORIES) | set(signals.PEST_CATEGORIES)
    assert rules_use < group


def test_view_windows_complaints_to_the_shared_constant():
    sql = signals.render_migration()
    assert f"INTERVAL '{signals.COMPLAINT_WINDOW_YEARS} years'" in sql
    # The violation signals are point-in-time and must NOT be windowed: a
    # violation issued a decade ago that is still open is still open.
    assert "open_class_c_violations" in sql
    viol_block = sql[sql.index("viol AS ("):sql.index("hazard AS (")]
    assert "INTERVAL" not in viol_block


def test_hazard_areas_are_not_coalesced_to_an_empty_array():
    """Three distinct states — [labels], [] and NULL — must survive the view.

    Collapsing [] into NULL restores the invented-nouns bug: the class C rule
    goes back to naming no observable thing, and the model fills the silence.
    """
    sql = signals.render_migration()
    select_tail = sql[sql.index("SELECT\n    b.bin,"):]
    hazard_line = next(
        l for l in select_tail.splitlines() if "open_class_c_categories" in l
    )
    assert "COALESCE" not in hazard_line


def test_migration_declares_itself_generated():
    """The header is load-bearing — it is what stops a hand-edit."""
    assert signals.render_migration().startswith("-- GENERATED FILE")


def test_schema_sql_carries_the_same_view_body():
    """CLAUDE.md requires schema.sql to match any migration that changes a view.

    Only the CREATE line legitimately differs (the migration drops and
    recreates, schema.sql is idempotent), so the body is compared verbatim. If
    this fails, re-insert `render_schema_section()` rather than hand-patching —
    a hand-patched schema.sql is how the canonical schema starts lying.
    """
    schema = (signals.MIGRATION_PATH.parents[2] / "schema.sql").read_text()
    assert signals._view_body() in schema, (
        "schema.sql has drifted from services/briefs/signals.py::_view_body"
    )


def test_schema_and_migration_differ_only_in_their_create_line():
    """Pins the one difference, so a second one cannot appear unnoticed."""
    migration_only = set(signals.render_migration().splitlines())
    schema_only = set(signals.render_schema_section().splitlines())
    shared_body = set(signals._view_body().splitlines())
    for line in shared_body:
        assert line in migration_only and line in schema_only
