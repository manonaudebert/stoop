from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCHEMA = (ROOT / "schema.sql").read_text()
MIGRATION = (
    ROOT / "ingest" / "migration" / "migrate_sf_nov_complete_records.sql"
).read_text()


def _summary_section(sql: str) -> str:
    start = sql.index("-- ── sf_violations_summary")
    end = sql.index("DROP MATERIALIZED VIEW IF EXISTS sf_brief_signals", start)
    return sql[start:end].strip()


def test_migration_uses_the_canonical_summary_definition():
    schema_start = SCHEMA.index("-- ── sf_violations_summary")
    schema_end = SCHEMA.index("-- ── sf_brief_signals", schema_start)
    assert _summary_section(MIGRATION) == SCHEMA[schema_start:schema_end].strip()


def test_classifier_reads_the_non_housing_description():
    summary = _summary_section(MIGRATION)
    assert "coalesce(v.code_violation_desc, '')" in summary
    assert "fire damage" in summary


def test_unsafe_and_classified_fallbacks_feed_the_shared_tier():
    summary = _summary_section(MIGRATION)
    assert "WHEN LOWER(v.unsafe_building) = 'y' THEN 'A'" in summary
    assert "'fire_safety', 'smoke_detectors', 'lead_paint', 'heat_hot_water'" in summary
    assert "CASE t.tier\n                WHEN 'A' THEN 15.0" in summary


def test_fire_and_lead_counts_use_the_classified_fallback():
    summary = _summary_section(MIGRATION)
    assert "t.condition_group = 'fire_safety'" in summary
    assert "t.condition_group = 'lead_paint'" in summary


def test_dependent_signals_view_is_dropped_before_the_summary():
    assert MIGRATION.index("DROP MATERIALIZED VIEW IF EXISTS sf_brief_signals") < (
        MIGRATION.index("DROP MATERIALIZED VIEW IF EXISTS sf_violations_summary")
    )
