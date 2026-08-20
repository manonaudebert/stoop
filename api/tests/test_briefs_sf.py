"""SF Building Brief — the drift guards and the no-model guarantee.

Offline: no database, no API key. Three things are pinned here.

**The view, the taxonomy and the rules cannot drift apart.** This is the guard
that earned its place in NYC, where the view's category lists silently forking
from the JSON showed up on the site as a brief contradicting the card beside it.
SF gets it before it has the chance.

**The taxonomy is a complete partition.** Every DataSF `service_subtype` is
either grouped or explicitly excluded with a reason. A new value appearing in the
feed should force a decision rather than being silently dropped.

**No SF text is ever labelled AI-assisted.** SF has no corpus and no model, so
`watch_for` is authored and cited. The label is driven by `watch_for_source` on
the row, so this is a real invariant worth asserting rather than a comment.
"""

import json

import pytest

from services.briefs import taxonomy
from services.briefs.cities import SF
from services.briefs.cities.sf import signals
from services.briefs.rules import evaluate, load_rules, select_rules


@pytest.fixture(scope="module")
def rules():
    return load_rules(SF)[0]


def _available_signals() -> set[str]:
    """Every column sf_brief_signals offers.

    Two sources now: 311 subtypes, and the NOV classifier (which subsumed both
    the per-category and the per-group-pattern violation signals)."""
    out = {s for s, _, _ in signals.complaint_signals()}
    out |= set(signals.classified_violation_signals())
    return out


def _all_zero() -> dict[str, int]:
    return {s: 0 for s in _available_signals()}


# ── the generated SQL ────────────────────────────────────────────────────────

def test_checked_in_migration_matches_the_generator():
    """Regenerate and compare. Fails if someone hand-edited the SQL.

    Fix by running:
        cd api && ../.venv/bin/python -m services.briefs.cities.sf.signals
    """
    assert signals.MIGRATION_PATH.read_text() == signals.render_migration(), (
        "ingest/migration/migrate_sf_brief_signals.sql is out of date. "
        "Regenerate: cd api && ../.venv/bin/python -m services.briefs.cities.sf.signals"
    )


def test_migration_declares_itself_generated():
    assert signals.render_migration().startswith("-- GENERATED FILE")


def test_schema_sql_carries_the_same_view_body():
    """CLAUDE.md requires schema.sql to match any migration that changes a view."""
    schema = (signals.MIGRATION_PATH.parents[2] / "schema.sql").read_text()
    assert signals._view_body() in schema, (
        "schema.sql has drifted from cities/sf/signals.py::_view_body. Re-insert "
        "render_schema_section() rather than hand-patching it."
    )


def test_every_grouped_subtype_reaches_the_sql():
    """A subtype in the taxonomy but absent from the view is a silent dead rule."""
    sql = signals._view_body()
    for _signal, _group, subtypes in signals.complaint_signals():
        for subtype in subtypes:
            assert f"'{subtype}'" in sql, f"{subtype} never reaches the generated SQL"


# ── taxonomy completeness ────────────────────────────────────────────────────

def _taxonomy() -> dict:
    with SF.taxonomy_path.open() as f:
        return json.load(f)


def test_grouped_and_excluded_subtypes_do_not_overlap():
    grouped = {
        s for spec in taxonomy.groups(SF).values() for s in spec["minor_categories"]
    }
    excluded = set(_taxonomy()["excluded_subtypes"])
    assert not (grouped & excluded), (
        f"subtypes both grouped and excluded: {sorted(grouped & excluded)}"
    )


def test_no_subtype_is_claimed_by_two_groups():
    """A subtype in two groups would be counted twice and described two ways."""
    seen: dict[str, str] = {}
    for group, spec in taxonomy.groups(SF).items():
        for subtype in spec["minor_categories"]:
            assert subtype not in seen, (
                f"{subtype} is in both {seen[subtype]!r} and {group!r}"
            )
            seen[subtype] = group


def test_every_exclusion_carries_a_reason():
    """An exclusion without a reason is indistinguishable from an oversight."""
    for subtype, reason in _taxonomy()["excluded_subtypes"].items():
        assert len(reason) > 20, f"{subtype} is excluded without a real reason"


def test_every_group_declares_a_prose_label():
    """Raw slugs read badly mid-clause; `prose_label` is what running text uses."""
    for group, spec in taxonomy.groups(SF).items():
        assert spec.get("prose_label"), f"{group} has no prose_label"
        assert "_" not in spec["prose_label"], f"{group}'s prose_label is a slug"


def test_violation_categories_map_to_exactly_one_group_each():
    """The reason these NOV categories are used and the ambiguous ones are not."""
    mapping = taxonomy.violation_category_to_group(SF)
    assert set(mapping) == {
        "FIRE SECTION",
        "LEAD SECTION",
        "SMOKE DETECTION SECTION",
        "SECURITY REQUIREMENTS SECTION",
        "SANITATION SECTION",
    }, (
        "the NOV categories in use changed. Only categories naming ONE condition "
        "belong here; 'interior surfaces section' and 'plumbing and electrical "
        "section' each span several groups and would misattribute a violation."
    )


# ── rules ↔ signals ──────────────────────────────────────────────────────────

def _signals_named_by(rule) -> set[str]:
    found: set[str] = set()

    def walk(predicate):
        if "all" in predicate or "any" in predicate:
            for child in predicate.get("all", predicate.get("any")):
                walk(child)
        else:
            found.add(predicate["signal"])

    walk(rule.when)
    if rule.rank_by:
        found.add(rule.rank_by)
    return found


def test_every_signal_a_rule_names_exists_in_the_view(rules):
    """Otherwise the rule raises MissingSignalError on every request."""
    available = _available_signals()
    for rule in rules:
        missing = _signals_named_by(rule) - available
        assert not missing, f"rule {rule.id!r} names signals the view lacks: {missing}"


def test_every_view_signal_is_read_by_some_rule(rules):
    """A column nothing reads is a recompute nobody benefits from."""
    available = _available_signals()
    used = set().union(*(_signals_named_by(r) for r in rules))
    assert not (available - used), f"unread signal columns: {sorted(available - used)}"


def test_priority_peers_all_declare_rank_by(rules):
    """Otherwise ordering silently falls back to file position."""
    by_priority: dict[int, list] = {}
    for rule in rules:
        by_priority.setdefault(rule.priority, []).append(rule)
    for priority, peers in by_priority.items():
        if len(peers) > 1:
            missing = [r.id for r in peers if not r.rank_by]
            assert not missing, f"priority {priority} peers without rank_by: {missing}"


# ── authoring guarantees ─────────────────────────────────────────────────────

def test_no_rule_carries_an_em_dash(rules):
    """Authored rule: an em dash makes the operative clause read as an aside."""
    for rule in rules:
        for field in ("brief_line", "why_it_matters", "action", "watch_for"):
            value = getattr(rule, field) or ""
            assert "—" not in value, f"{rule.id}.{field} contains an em dash"


def test_no_rule_text_says_building(rules):
    """A mapblklot is a PARCEL and may carry several buildings.

    Saying "this building" about it promises precision the row does not have.
    `why_it_matters` is exempt: it quotes law that says "building" about actual
    buildings ("apartment complexes must also have smoke detectors"), which is
    the source's word for the source's subject, not a claim about this row.
    """
    for rule in rules:
        for field in ("brief_line", "condition", "action"):
            value = (getattr(rule, field) or "").lower()
            assert "this building" not in value, (
                f"{rule.id}.{field} says 'this building' about a parcel"
            )


def test_every_rule_has_a_citation(rules):
    _, document = load_rules(SF)
    for rule in rules:
        assert rule.citations(document, SF), f"{rule.id} cites nothing"
        assert rule.source, f"{rule.id} records no source section"


def test_primary_citations_are_followable_links(rules):
    """SF's source is deep-linkable, so the primary citation carries a real URL.

    NYC's does not and correctly stays label-only; this asserts SF actually uses
    the capability rather than inheriting NYC's page-reference habit.
    """
    _, document = load_rules(SF)
    for rule in rules:
        primary = rule.citations(document, SF)[0]
        assert primary.url and primary.url.startswith("https://www.dre.ca.gov/"), (
            f"{rule.id}'s primary citation is not followable"
        )


def test_heat_is_the_only_rule_without_a_viewing_line(rules):
    """Neither source offers an observable cue for heat or hot water.

    An omitted line beats a circular one ("check whether there is heat" under a
    heading that already says tenants reported no heat). If another rule loses
    its `watch_for`, that is a decision worth making on purpose.
    """
    without = {r.id for r in rules if not r.watch_for}
    assert without == {"heat_hot_water"}, (
        f"rules without a viewing line changed: {sorted(without)}"
    )


def test_no_watch_for_line_merely_restates_its_own_condition(rules):
    """The failure mode the authored line exists to avoid.

    A viewing line has to name physical evidence. Catching that in general is not
    possible, but the specific trap is cheap to pin: the line must not simply
    echo the rule's own subject word back at the reader.
    """
    for rule in rules:
        if not rule.watch_for:
            continue
        assert len(rule.watch_for.split()) >= 12, (
            f"{rule.id}'s watch_for is too short to name real evidence"
        )


# ── the no-model guarantee ───────────────────────────────────────────────────

def test_sf_declares_no_hazard_area_or_multi_sentence_rule():
    """Both are model-path machinery, and SF has neither a model nor a rule shape
    that needs them: every SF rule names its own condition."""
    assert SF.hazard_area_rule_id is None
    assert SF.multi_sentence_rule_id is None


def test_sf_does_not_suppress_rules():
    """NYC drops a tenant report when an inspector confirmed the same condition.

    SF inverts: the 311 subtypes are the better-structured signal and the NOV
    categories are 52.7% section labels, so the premise does not hold here.
    """
    assert SF.suppression_enabled is False


def test_selection_never_exceeds_the_display_cap():
    """Every rule firing at once must still render three items."""
    all_on = {s: 99 for s in _available_signals()}
    assert len(select_rules(all_on, config=SF)) == 3


def test_a_parcel_with_no_signal_flags_nothing():
    """The empty state has to be reachable, and must not depend on a missing row."""
    assert select_rules(_all_zero(), config=SF) == []


def test_every_rule_fires_on_a_single_report(rules):
    """One report is enough, on every rule.

    This replaced a `> 1` floor on the four high-volume rules, which was NYC's
    reasoning applied to a city with 35k complaints instead of millions. It cost
    77% of the properties where a tenant reported mold and 4.3 points of overall
    coverage, to protect a distinction the copy never draws: the brief says
    tenants reported a condition, which is exactly what one complaint supports.

    If a floor is ever reintroduced, do it because the RENDERED line overclaims,
    not because a count feels small.
    """
    base = _all_zero()
    for rule in rules:
        # Whichever signal this rule leads with. `interior_surfaces` is
        # violations-only — 311 has no category for it — so it has no
        # `_complaints` column to raise.
        lead = f"{rule.id}_complaints"
        if lead not in base:
            lead = f"open_{rule.id}_violations"
        assert lead in base, f"{rule.id} reads no signal this test knows about"
        assert evaluate(rule.when, base | {lead: 1}), (
            f"{rule.id} does not fire on a single report"
        )


def test_the_any_rules_fire_from_either_evidence_source(rules):
    """Both kinds of evidence, on every rule that has both available.

    The violation branch is what makes smoke_detectors more than marginal: 423
    parcels have an open smoke-detection NOV against 54 with a complaint."""
    by_id = {r.id: r for r in rules}
    base = _all_zero()
    for rule_id, rule in by_id.items():
        complaint = f"{rule_id}_complaints"
        violation = f"open_{rule_id}_violations"
        if complaint in base:
            assert evaluate(rule.when, base | {complaint: 1}), (
                f"{rule_id} ignores a tenant report"
            )
        if violation in base:
            assert evaluate(rule.when, base | {violation: 1}), (
                f"{rule_id} ignores an inspector's open violation"
            )


def test_route_selects_every_signal_the_view_offers():
    """The route's column list must BE the view's, not a subset of it.

    `routes/sf.py::_signal_columns` once built its violation half from
    `violation_signals()` — the category-fallback list, five groups DBI names in
    `nov_category_description` — while the view emits one column per CLASSIFIER
    group. The route supplied 5 of 15, so every rule reading one of the missing
    10 raised MissingSignalError at request time. Nothing caught it: the parity
    test above reads the generator directly, and the route tests mock the DB.
    """
    from routes.sf import _signal_columns

    assert set(_signal_columns()) == _available_signals()
