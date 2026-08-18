"""Tests for the deterministic half of the Building Brief.

Everything here runs without a database or an API call, which is the point:
rule selection, taxonomy resolution, prompt assembly, and the confidence note
are all pure functions of a signals dict.
"""

from datetime import date

import pytest

from services.briefs import (
    confidence, corpus, prompt, rules, schema, taxonomy, validate,
)


# --------------------------------------------------------------------------
# Taxonomy — complaint vocabulary
# --------------------------------------------------------------------------

def test_taxonomy_loads_and_is_well_formed():
    groups = taxonomy.groups()
    assert groups, "taxonomy is empty"
    for key, spec in groups.items():
        assert spec["label"], f"{key} has no label"
        assert spec["description"], f"{key} has no description"
        assert spec["minor_categories"], f"{key} has no categories"


@pytest.mark.parametrize(
    "minor_category,expected_group",
    [
        # Unambiguous members.
        ("MOLD", "mold_pests_sanitation"),
        ("PESTS", "mold_pests_sanitation"),
        ("HEAT RELATED", "heating_hot_water"),
        # The three categories that appear in two groups. The frontend resolves
        # them by last-write-wins via Object.fromEntries; Python must agree, or
        # the brief and the card above it will attribute the same complaint to
        # different groups.
        ("MAINTENANCE", "building_maintenance_operations"),
        ("LINE OF TRAVEL", "elevator_accessibility"),
        ("SKYLIGHT", "outdoor_structural"),
    ],
)
def test_duplicate_categories_resolve_last_write_wins(minor_category, expected_group):
    assert taxonomy.group_of(minor_category) == expected_group


def test_group_of_handles_missing_and_case():
    assert taxonomy.group_of(None) is None
    assert taxonomy.group_of("NOT A REAL CATEGORY") is None
    assert taxonomy.group_of("mold") == "mold_pests_sanitation"


# --------------------------------------------------------------------------
# Taxonomy — violation vocabulary and hazard areas
# --------------------------------------------------------------------------

def test_violation_categories_map_to_real_groups():
    all_groups = set(taxonomy.groups())
    for category, group in taxonomy.violation_category_to_group().items():
        assert group in all_groups, f"{category} maps to unknown group {group}"


def test_violation_and_complaint_vocabularies_stay_separate():
    """Two different HPD vocabularies for the same concerns; neither is the other."""
    violation = set(taxonomy.violation_category_to_group())
    complaint = set(taxonomy.minor_to_group())
    assert "HEAT AND HOT WATER" in violation
    assert "HEAT RELATED" in complaint
    assert "HEAT AND HOT WATER" not in complaint


def test_hazard_areas_use_page_vocabulary_not_hpd_strings():
    labels = taxonomy.describe_violation_categories(
        ["HEAT AND HOT WATER", "EXTERMINATION & RODENT ERADICATION"]
    )
    assert labels == ["Heat / hot water", "Mold & pests"]


def test_hazard_areas_preserve_significance_order_and_dedupe():
    labels = taxonomy.describe_violation_categories(
        ["MAINTENANCE", "PAINTING", "HEAT AND HOT WATER"]
    )
    assert labels == ["Bldg maintenance", "Heat / hot water"]


def test_admin_categories_are_not_offered_as_hazard_areas():
    """"Admin" is a chart legend for paperwork, not something a renter inspects.

    BIN 1061891's top open class C category is RETIRED; surfacing that as an
    area to check crowds out one the reader could actually look at.
    """
    assert taxonomy.describe_violation_categories(["RETIRED"]) == []
    assert taxonomy.describe_violation_categories(
        ["RETIRED", "MAINTENANCE", "HEAT AND HOT WATER"]
    ) == ["Bldg maintenance", "Heat / hot water"]


def test_unmapped_categories_are_dropped_not_guessed():
    assert taxonomy.describe_violation_categories(["LEAD-BASED PAINT"]) == []
    assert taxonomy.describe_violation_categories(None) == []


def test_hazard_areas_carry_the_authored_sentence_not_just_the_label():
    """A group label is a chart legend; the sentence is what makes it concrete.

    "Electrical" gives a model nothing to point at, so it invents the detail.
    The authored tooltip already contains the nouns.
    """
    areas = taxonomy.describe_hazard_areas(["ARTIFICIAL LIGHTING"])
    assert len(areas) == 1
    assert areas[0].startswith("Electrical — ")
    assert "lighting" in areas[0].lower()


def test_hazard_area_sentences_match_the_chart_tooltips_exactly():
    """Brief and chart must describe a category identically; both read this map."""
    tips = taxonomy.violation_category_tooltips()
    assert len(tips) == 48
    assert taxonomy.violation_category_tooltip("HEAT AND HOT WATER") == tips[
        "HEAT AND HOT WATER"
    ]
    areas = taxonomy.describe_hazard_areas(["HEAT AND HOT WATER"])
    assert areas[0].endswith(tips["HEAT AND HOT WATER"])


def test_hazard_areas_dedupe_by_group_keeping_the_most_common_category():
    areas = taxonomy.describe_hazard_areas(
        ["MAINTENANCE", "PAINTING", "HEAT AND HOT WATER"]
    )
    assert len(areas) == 2
    assert areas[0].startswith("Bldg maintenance — ")
    assert areas[1].startswith("Heat / hot water — ")


def test_every_group_that_can_be_a_hazard_area_declares_a_prose_label():
    """The chart legend is not a sentence. `prose_label` is the expansion used
    in running text; without one a group falls back to its lowercased label and
    "bldg maintenance" or "safety & fire" lands mid-clause."""
    for group, spec in taxonomy.groups().items():
        if spec.get("violation_categories"):
            assert spec.get("prose_label"), f"{group} has no prose_label"
            assert spec["prose_label"] == spec["prose_label"].lower()
            assert "&" not in spec["prose_label"], group
            assert "/" not in spec["prose_label"], group


def test_prose_labels_expand_the_chart_label_rather_than_renaming_it():
    """One page, one name per group — the expansion has to stay recognisable.

    "Bldg maintenance" -> "building maintenance" connects on sight. The failure
    this guards is reaching for the raw HPD category instead: the card says
    "Safety & fire" and EGRESS would be a second name for the same group.
    """
    assert taxonomy.prose_label("building_maintenance_operations") == "building maintenance"
    assert taxonomy.prose_label("safety_fire") == "fire safety"
    assert taxonomy.prose_label("heating_hot_water") == "heat and hot water"


def test_prose_areas_select_and_order_exactly_like_the_labels():
    """Same dedupe, same admin exclusion, same significance order.

    If these diverge, the sentence, the layer-1 labels, and what the model is
    shown describe different sets on the same building.
    """
    cats = ["MAINTENANCE", "HEAT AND HOT WATER", "RETIRED", "PAINTING", "EGRESS"]
    prose = taxonomy.describe_hazard_areas_prose(cats)
    labels = taxonomy.describe_violation_categories(cats)
    assert len(prose) == len(labels) == 3
    assert prose == ["building maintenance", "heat and hot water", "fire safety"]


@pytest.mark.parametrize("items,expected", [
    ([], ""),
    (["heat and hot water"], "heat and hot water"),
    (["a", "b"], "a and b"),
    # Serial comma is load-bearing: entries contain their own "and", so the
    # plain two-item join rendered "mold and pests and building maintenance".
    (["mold and pests", "building maintenance"],
     "mold and pests, and building maintenance"),
    (["building maintenance", "heat and hot water"],
     "building maintenance, and heat and hot water"),
    (["building maintenance", "heat and hot water", "fire safety"],
     "building maintenance, heat and hot water, and fire safety"),
])
def test_join_prose(items, expected):
    assert taxonomy.join_prose(items) == expected


def test_admin_categories_are_excluded_from_hazard_area_sentences_too():
    assert taxonomy.describe_hazard_areas(["RETIRED"]) == []


# --------------------------------------------------------------------------
# Rules
# --------------------------------------------------------------------------

def _signals(**overrides):
    """A building with nothing wrong, so each test opts in to one condition."""
    base = {
        "open_class_c_violations": 0,
        "heat_hot_water_complaints": 0,
        "mold_complaints": 0,
        "pest_complaints": 0,
        "lead_paint_violations": 0,
        "smoke_co_detector_violations": 0,
        # None = the class C rule never fired, so nothing can be superseded.
        # Tests exercising suppression pass a list of raw HPD violation
        # categories here, not taxonomy group names.
        "open_class_c_categories": None,
    }
    base.update(overrides)
    return base


def test_rules_file_loads_with_unique_ids():
    rule_list, document = rules.load_rules()
    assert rule_list
    assert document
    assert len(rule_list) == len({r.id for r in rule_list})


def test_every_rule_signal_is_supplied_by_the_default_payload():
    """Guards the plumbing: a rule referencing an unsupplied signal raises."""
    for rule in rules.load_rules()[0]:
        rules.evaluate(rule.when, _signals())  # must not raise


def test_clean_building_gets_no_rules():
    assert rules.select_rules(_signals()) == []


def test_single_condition_fires_its_rule():
    selected = rules.select_rules(_signals(mold_complaints=3))
    assert [r.id for r in selected] == ["mold"]


def test_selection_is_priority_ordered_and_capped():
    """All six rules fire; the cap keeps the highest-priority ones.

    The cap is 3 as of 2026-08-14, matching MAX_WATCH_ITEMS so that every item
    shown carries a generated line. Both priority-5 peers (mold, pests) and
    smoke_co_detectors are truncated here.
    """
    selected = rules.select_rules(
        _signals(
            open_class_c_violations=4,
            heat_hot_water_complaints=9,
            mold_complaints=2,
            pest_complaints=7,
            lead_paint_violations=1,
            smoke_co_detector_violations=3,
        )
    )
    assert [r.id for r in selected] == [
        "open_class_c", "heat_hot_water", "lead_paint",
    ]


def test_the_two_caps_stay_equal():
    """Every item the page shows must be able to carry a generated line.

    These are separate constants in separate modules — the display cap in
    rules.py, the generation cap in schema.py — and nothing but this test makes
    them agree. If they drift apart, either an item renders with a permanently
    absent "worth checking" line (display > generation) or the corpus pays for
    sentences no page will ever show (generation > display).
    """
    import inspect
    default = inspect.signature(rules.select_rules).parameters["max_items"].default
    assert default == schema.MAX_WATCH_ITEMS


def test_truncation_drops_the_lowest_priority_peer_first():
    """Within a priority, `rank_by` decides who survives the cap, not authoring
    order. Pests (7 complaints) outranks mold (2), so mold goes first."""
    selected = rules.select_rules(
        _signals(mold_complaints=2, pest_complaints=7),
        max_items=1,
    )
    assert [r.id for r in selected] == ["pests"]


def test_detector_rule_sits_between_lead_paint_and_the_complaint_rules():
    """An inspector's finding outranks a tenant's report; lead outranks both."""
    by_id = {r.id: r for r in rules.load_rules()[0]}
    assert by_id["lead_paint"].priority < by_id["smoke_co_detectors"].priority
    assert by_id["smoke_co_detectors"].priority < by_id["mold"].priority
    assert by_id["smoke_co_detectors"].priority < by_id["pests"].priority


def test_detector_rule_fires_at_threshold_and_is_silent_below_it():
    assert rules.select_rules(_signals(smoke_co_detector_violations=0)) == []
    fired = rules.select_rules(_signals(smoke_co_detector_violations=1))
    assert [r.id for r in fired] == ["smoke_co_detectors"]


def test_detector_rule_states_shared_responsibility():
    """Unlike every other rule, part of this obligation is the tenant's.

    Writing it as a pure owner failure would misinform a reader about who has
    to act — the source is explicit that a tenant who removed a detector or let
    its battery die has to put it right.
    """
    rule = next(r for r in rules.load_rules()[0] if r.id == "smoke_co_detectors")
    text = (rule.why_it_matters + " " + rule.action).lower()
    assert "tenant" in text
    assert rule.source == "p.6"


def test_detector_rule_asserts_no_unit_count_threshold():
    """The source scopes the requirement by unit count; the schema has none.

    Same omission as the mold >10-unit clause: an unevaluable condition is left
    unstated rather than asserted.
    """
    rule = next(r for r in rules.load_rules()[0] if r.id == "smoke_co_detectors")
    text = (rule.condition + rule.why_it_matters + rule.action).lower()
    for claim in ["three or more", "3 or more", "two-family", "owner occupied"]:
        assert claim not in text, f"detector rule asserts unevaluable scope: {claim!r}"


def test_peers_are_ordered_by_magnitude_not_file_position():
    """The inversion this tie-break exists to prevent.

    A single mold complaint must not outrank dozens of pest complaints just
    because mold is authored first in rules.yaml.
    """
    worse_pests = rules.select_rules(_signals(mold_complaints=2, pest_complaints=40))
    assert [r.id for r in worse_pests] == ["pests", "mold"]

    worse_mold = rules.select_rules(_signals(mold_complaints=40, pest_complaints=2))
    assert [r.id for r in worse_mold] == ["mold", "pests"]


def test_a_single_complaint_is_below_the_floor_for_both_peers():
    """One complaint in five years is an incident, not a building condition."""
    assert rules.select_rules(_signals(mold_complaints=1, pest_complaints=1)) == []
    assert rules.select_rules(_signals(mold_complaints=1)) == []
    assert rules.select_rules(_signals(pest_complaints=1)) == []


def test_heat_keeps_a_zero_floor_while_the_peers_do_not():
    """A deliberate asymmetry, documented in rules.yaml above the heat rule.

    Heat has a bright-line legal minimum and seasonal urgency; one complaint is
    already evidence the line was crossed. Mold and pests need a floor because
    one complaint cannot separate an incident from a building condition.
    """
    by_id = {r.id: r for r in rules.load_rules()[0]}
    assert by_id["heat_hot_water"].when["value"] == 0
    assert by_id["mold"].when["value"] == 1
    assert by_id["pests"].when["value"] == 1


def test_peer_thresholds_stay_symmetric():
    """An asymmetric floor between peers is the ranking they exist to disclaim.

    Pinned as a test because the two `when` values live 30 lines apart in
    rules.yaml and nothing else would catch one of them moving alone.
    """
    by_id = {r.id: r for r in rules.load_rules()[0]}
    peers = [by_id["mold"], by_id["pests"]]
    # Looked up by id, not by priority number: the tier they sit in has moved
    # once already (4 -> 5, when the detector rule was inserted above them) and
    # a hardcoded number turns that into a spurious failure.
    assert len({r.priority for r in peers}) == 1
    assert len({r.when["value"] for r in peers}) == 1
    assert len({r.when["op"] for r in peers}) == 1


def test_both_peers_are_shown_when_both_apply():
    """Sharing a priority orders them; it does not make them exclusive."""
    selected = rules.select_rules(_signals(mold_complaints=3, pest_complaints=5))
    assert {r.id for r in selected} == {"mold", "pests"}


def test_peers_sharing_a_priority_must_declare_a_tiebreak():
    rule_list, _ = rules.load_rules()
    by_priority: dict[int, list] = {}
    for rule in rule_list:
        by_priority.setdefault(rule.priority, []).append(rule)
    for priority, group in by_priority.items():
        if len(group) > 1:
            assert all(r.rank_by for r in group), (
                f"priority {priority} is shared without rank_by"
            )


def test_rank_by_signal_must_be_supplied():
    """A rank_by naming a signal nobody supplies fails loudly, like `when` does.

    Tested directly on rank_value: today every rank_by signal is also named in
    that rule's `when`, so going through select_rules would raise from the
    predicate and prove nothing about the ranking path.
    """
    pests = next(r for r in rules.load_rules()[0] if r.id == "pests")
    assert pests.rank_by == "pest_complaints"
    with pytest.raises(rules.MissingSignalError):
        pests.rank_value({"mold_complaints": 2})


def test_selection_is_deterministic():
    signals = _signals(mold_complaints=2, pest_complaints=2)
    assert rules.select_rules(signals) == rules.select_rules(signals)


def test_equal_peer_magnitudes_still_order_totally():
    """Equal counts must not leave the order up to dict/file happenstance."""
    signals = _signals(mold_complaints=4, pest_complaints=4)
    assert [r.id for r in rules.select_rules(signals)] == ["mold", "pests"]


def test_lead_paint_fires_on_the_violation_alone():
    """Regression: the construction-year conjunction used to suppress this.

    An open lead violation is HPD's own finding that lead was present. Gating it
    behind a year proxy suppressed 714 of 15,484 buildings with open lead
    violations (4.6%) — 426 genuinely post-1960, and 288 absent from the
    `buildings` table, where the year resolved to None and the rule silently
    declined to fire.
    """
    assert "lead_paint" in [
        r.id for r in rules.select_rules(_signals(lead_paint_violations=5))
    ]
    assert "lead_paint" not in [
        r.id for r in rules.select_rules(_signals(lead_paint_violations=0))
    ]


def test_lead_paint_condition_makes_no_claim_about_building_age():
    """With the year check gone, the condition may no longer assert pre-1960.

    The background stays in why_it_matters, where it is context about lead paint
    generally rather than a claim about this building.
    """
    rule = next(r for r in rules.load_rules()[0] if r.id == "lead_paint")
    assert "1960" not in rule.condition
    assert "predates" not in rule.condition.lower()
    assert "1960" in rule.why_it_matters


def test_no_rule_depends_on_construction_year():
    """It was the only consumer; dropping it also removed a join gap."""
    import json
    for rule in rules.load_rules()[0]:
        assert "construction_year" not in json.dumps(rule.when)


def test_none_signal_is_not_treated_as_zero_or_as_a_hit():
    """Unmeasured is not the same as measured-zero, and must not crash."""
    unknown = _signals(lead_paint_violations=None)
    assert "lead_paint" not in [r.id for r in rules.select_rules(unknown)]


def test_unknown_signal_raises_rather_than_silently_disabling_a_rule():
    incomplete = _signals()
    del incomplete["mold_complaints"]
    with pytest.raises(rules.MissingSignalError):
        rules.select_rules(incomplete)


def test_rule_text_is_stripped_of_yaml_folding_artifacts():
    for rule in rules.load_rules()[0]:
        for field in (rule.condition, rule.why_it_matters, rule.action):
            assert "\n" not in field
            assert "  " not in field


def _signal_names(predicate) -> set[str]:
    """Every signal a `when` predicate reads, including nested all/any branches."""
    if "signal" in predicate:
        return {predicate["signal"]}
    names: set[str] = set()
    for key in ("all", "any"):
        for sub in predicate.get(key, ()):
            names |= _signal_names(sub)
    return names


def _is_complaint_rule(rule) -> bool:
    return any(s.endswith("_complaints") for s in _signal_names(rule.when))


def test_complaint_rules_state_the_window_they_actually_count():
    """Every complaint-driven rule names its window, and names the real one.

    The complaint signals are windowed (`signals.COMPLAINT_WINDOW_YEARS`) while
    the violation signals are not — they filter on `violation_status = 'Open'`
    with no date bound at all. So "Tenants here have reported mold" was true of
    a complaint filed within five years and read as true of one filed twenty
    years ago, which is the reading a renter would take.

    The number is prose in rules.yaml and an integer in signals.py, and prose
    cannot import. This is the join: change the constant without rewriting the
    text and the sentence becomes a false statement about our own data, silently
    and on every building the rule fires on. Fail loudly instead.

    Keyed off the signal name rather than a hardcoded id list so a new
    complaint rule is covered the day it is added.
    """
    from services.briefs.signals import COMPLAINT_WINDOW_YEARS

    # Spelled, not a numeral: `test_brief_line_carries_no_digits` bans digits
    # from layer 1 so the cards keep sole ownership of every count. A window is
    # not a count, but "5" next to "Mold reported" reads as one at a glance,
    # which is the confusion that guard exists to prevent. The word satisfies
    # both. Mapped rather than hardcoded so the constant stays the source.
    words = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 10: "ten"}
    assert COMPLAINT_WINDOW_YEARS in words, (
        f"no spelled form for a {COMPLAINT_WINDOW_YEARS}-year window — add one, "
        "and rewrite the complaint rules in rules.yaml to match"
    )
    window = f"in the last {words[COMPLAINT_WINDOW_YEARS]} years"
    complaint_rules = [r for r in rules.load_rules()[0] if _is_complaint_rule(r)]
    assert complaint_rules, "no complaint-driven rules found — has `when` changed shape?"
    for rule in complaint_rules:
        for field in ("brief_line", "condition"):
            text = getattr(rule, field) or ""
            assert window in text, (
                f"{rule.id}.{field} does not state the {COMPLAINT_WINDOW_YEARS}-year "
                f"complaint window: {text!r}"
            )


def test_violation_rules_do_not_claim_a_window_they_do_not_apply():
    """The mirror of the test above, and the reason it is keyed on the signal.

    Violation rules count OPEN violations regardless of age — a class C issued
    in 1965 and never corrected still counts. Copying the window phrasing onto
    them to make the headlines look uniform would assert a filter the SQL does
    not apply.
    """
    for rule in rules.load_rules()[0]:
        if _is_complaint_rule(rule):
            continue
        for field in ("brief_line", "condition"):
            text = (getattr(rule, field) or "").lower()
            assert "in the last" not in text, (
                f"{rule.id}.{field} claims a time window, but its signal is not "
                f"date-filtered: {text!r}"
            )


def test_no_hpd_jargon_leaks_into_rule_conditions():
    """Generated and authored text alike must avoid inspector shorthand.

    `action` and `why_it_matters` may define a term in context; `condition` is
    the one-line summary and should stand alone.
    """
    banned = ["class a", "class b", "class c", "rent-impairing", "nov "]
    for rule in rules.load_rules()[0]:
        lowered = rule.condition.lower()
        for term in banned:
            assert term not in lowered, f"{rule.id} condition contains {term!r}"


def test_authored_action_text_is_never_generated():
    """Structural guarantee: advice reaches the page from rules.yaml, verbatim.

    If this ever fails, the citation on every watch item has become a lie.
    """
    rule_list, document = rules.load_rules()
    for rule in rule_list:
        assert rule.action, f"{rule.id} has no authored action"
        assert rule.source, f"{rule.id} has no page citation"
        assert document in rule.cite(document)


# --------------------------------------------------------------------------
# No counts anywhere
# --------------------------------------------------------------------------

def test_no_rule_carries_a_count_template():
    """`magnitude` was removed 2026-08-12 — the brief shows no numbers at all.

    The cards on the same page own every count, and suppression encodes severity
    structurally. Pinned as a field-absence check because the tempting way to
    reintroduce a number is to add it back to rules.yaml, where nothing else
    would object.
    """
    import yaml
    with rules.RULES_PATH.open() as f:
        spec = yaml.safe_load(f)
    for rule in spec["rules"]:
        assert "magnitude" not in rule, f"{rule['id']} reintroduced a count template"
    assert not hasattr(rules.load_rules()[0][0], "magnitude")


def test_authored_text_carries_no_bare_counts():
    """Digits are still legal in authored copy — "68°F", "October 1", "14 days"
    are all cited figures. What must not come back is a rendered count of this
    building's own records."""
    for rule in rules.load_rules()[0]:
        for field in (rule.brief_line or "", rule.condition, rule.why_it_matters,
                      rule.action):
            assert "{" not in field, f"{rule.id}: unrendered template in {field!r}"


# --------------------------------------------------------------------------
# Confidence note
# --------------------------------------------------------------------------

TODAY = date(2026, 8, 8)


def test_healthy_record_gets_no_note():
    assert confidence.confidence_note(42, date(2026, 5, 1), TODAY) is None


def test_thin_record_is_flagged():
    note = confidence.confidence_note(2, date(2026, 5, 1), TODAY)
    assert note and "2 HPD records" in note


def test_single_record_is_not_pluralized():
    note = confidence.confidence_note(1, date(2026, 5, 1), TODAY)
    assert note and "1 HPD record on file" in note


def test_stale_record_is_flagged_with_the_year():
    note = confidence.confidence_note(60, date(2019, 4, 2), TODAY)
    assert note and "2019" in note


def test_thinness_takes_precedence_over_staleness():
    note = confidence.confidence_note(1, date(2005, 1, 1), TODAY)
    assert note and "1 HPD record" in note


def test_missing_inputs_are_provisional_not_confident():
    assert confidence.confidence_note(None, TODAY, TODAY) is not None
    assert confidence.confidence_note(0, None, TODAY) is not None
    assert confidence.confidence_note(60, None, TODAY) is not None


# --------------------------------------------------------------------------
# Prompt — what the model is allowed to see
# --------------------------------------------------------------------------

def _context(percentile=50.0, conditions=(), **kw):
    return prompt.render_context(
        percentile=percentile, conditions=list(conditions), **kw
    )


def test_severity_language_is_gated_on_the_percentile():
    assert prompt.severity_language_allowed(70.0)
    assert prompt.severity_language_allowed(99.0)
    assert not prompt.severity_language_allowed(69.9)
    assert not prompt.severity_language_allowed(31.3)
    assert not prompt.severity_language_allowed(None)


def test_low_percentile_context_carries_the_language_constraint():
    """At the 31st percentile, "high" must be forbidden — the original v1 bug."""
    body = _context(percentile=31.3)
    assert "Language constraint" in body
    assert '"high"' in body and '"severe"' in body


def test_high_percentile_context_omits_the_language_constraint():
    assert "Language constraint" not in _context(percentile=95.0)


def test_unknown_percentile_still_forbids_severity_language():
    """Unmeasured is not permission — the same rule as None signals in rules.py."""
    assert "Language constraint" in _context(percentile=None)


def test_no_conditions_is_stated_explicitly_not_omitted():
    """~2 in 5 buildings flag nothing; silence would read to a model as clean."""
    body = _context(conditions=[])
    assert "none" in body
    assert "must not say or imply" in body
    assert "empty watch_for list" in body


def test_conditions_are_passed_through_verbatim():
    body = _context(conditions=["Tenants here have reported mold."])
    assert "Tenants here have reported mold." in body


def test_issues_are_numbered_so_the_positional_contract_is_explicit():
    """All three are numbered now that MAX_WATCH_ITEMS is 3.

    `select_rules` caps at the same 3, so in production there is never a
    remainder to list unnumbered — the trailing "other conditions" block only
    renders if a caller passes more conditions than the cap, which the route
    does not do. See test_conditions_beyond_the_cap_are_shown_but_excluded.
    """
    body = _context(conditions=["First thing.", "Second thing.", "Third thing."])
    assert "Issue 1: First thing." in body
    assert "Issue 2: Second thing." in body
    assert "Issue 3: Third thing." in body


def test_conditions_beyond_the_cap_are_shown_but_excluded():
    """A condition past MAX_WATCH_ITEMS is still named, so the model knows the
    record is larger than the issues it is writing for, but is explicitly
    excluded from watch_for — otherwise it writes a sentence for it."""
    body = _context(conditions=[
        "First thing.", "Second thing.", "Third thing.", "Fourth thing.",
    ])
    assert "Issue 3: Third thing." in body
    assert "Issue 4" not in body
    assert "do NOT write a" in body
    assert "Fourth thing." in body


def test_prompt_never_contains_hpd_jargon():
    """The other half of the v1 bug. "class C" must not reach the model."""
    banned = ["class a", "class b", "class c", "rent-impairing", "percentile"]
    selected = rules.select_rules(
        _signals(open_class_c_violations=9, heat_hot_water_complaints=4,
                 mold_complaints=3, pest_complaints=2)
    )
    body = _context(
        percentile=95.0, conditions=[r.condition for r in selected]
    ).lower()
    system = prompt.SYSTEM.lower()
    for term in banned:
        assert term not in body, f"user turn leaks {term!r}"
        assert term not in system, f"system prompt leaks {term!r}"


def test_prompt_forbids_the_model_restating_rights_guidance():
    """The line this feature must not cross.

    `watch_for` says what to look at. What a tenant is *entitled* to stays in
    rules.yaml, quoted from HPD with a page citation, because a paraphrased
    legal entitlement is wrong in a way a reader can act on.
    """
    system = prompt.SYSTEM.lower()
    assert "never state a legal right" in system
    assert "311" in system, "must name 311 explicitly as off-limits to the model"
    assert "rent withholding" in system


def test_prompt_forbids_describing_the_building_as_a_whole():
    """context_line was removed in v5; nothing generated may re-acquire its job."""
    assert "Do not describe the building as a whole" in prompt.SYSTEM


def test_no_percentile_or_standing_reaches_the_model():
    """The model is not told how the building ranks, so it cannot misstate it.

    This is what removing context_line bought: the field that made a claim about
    the building as a whole is gone, and so is the input that fed it.

    Matched on word boundaries rather than as a bare substring. The task block
    legitimately contains digits now ("311 complaint", "15 minutes", "30
    words"), and `"31" in body` was true because of "311" — a false positive
    that would have hidden a real leak just as easily as it invented this one.
    """
    import re
    body = _context(percentile=31.3, conditions=["Something."])
    assert "31.3" not in body
    assert not re.search(r"\b31\b", body)
    assert "Standing" not in body
    assert "fewer violations" not in body


def test_only_the_task_blocks_own_digits_reach_the_model():
    """The digits that ARE in the prompt are static task text and issue
    numbers, never building data. Pinned so a future edit cannot smuggle a
    count in behind them."""
    import re
    body = _context(
        percentile=88.0,
        conditions=["Tenants here have reported mold.", "Something else."],
    )
    task_digits = {"311", "15", "30"}
    issue_numbers = {str(i) for i in range(1, schema.MAX_WATCH_ITEMS + 1)}
    assert set(re.findall(r"\d+", body)) <= task_digits | issue_numbers


def test_build_messages_reads_only_the_fields_the_prompt_needs():
    messages = prompt.build_messages(
        {
            "hpd_violations_percentile": 95.0,
            "nta_name": "Mount Hope",
            # Everything below must stay out of the prompt entirely.
            "open_class_c_violations": 137,
            "open_violations": 616,
            "address": "530 WEST 144 STREET",
        },
        ["Tenants here have reported mold."],
    )
    assert len(messages) == 1 and messages[0]["role"] == "user"
    body = messages[0]["content"]
    assert "137" not in body and "616" not in body and "530 WEST" not in body


# --------------------------------------------------------------------------
# Hazard areas in the prompt
# --------------------------------------------------------------------------

def test_hazard_areas_reach_the_prompt_when_present():
    body = _context(
        percentile=10.5,
        conditions=["Conditions that HPD classifies as immediately hazardous..."],
        hazard_areas=[
            "Bldg maintenance — Broken fixtures.", "Heat / hot water — No heat.",
        ],
        hazard_issue_index=0,
    )
    assert "Bldg maintenance — Broken fixtures." in body
    assert "Heat / hot water — No heat." in body
    assert "Do not name an area that is not listed here" in body


def test_prompt_tells_the_model_to_use_the_most_common_area_first():
    """The list is ordered by open count descending; the prompt must say so.

    "Most common first" alone left the choice open, and the model took the most
    writable area rather than the largest. The fall-through is deliberate: some
    categories are real but not inspectable, and a sentence about the biggest
    area is worth nothing if the reader cannot act on it.
    """
    body = _context(
        conditions=["Hazardous conditions are open."],
        hazard_areas=["Bldg maintenance — Broken fixtures."],
        hazard_issue_index=0,
    )
    assert "the first being the one this building has most of" in body
    assert "Base the Issue 1 sentence on the FIRST area" in body
    assert "only if the first names nothing a reader can look at" in body


def test_only_one_rule_can_ever_carry_two_sentences():
    """Two modules name this rule and they must not drift.

    `prompt.HAZARD_AREA_RULE_ID` decides which issue is ASKED for two sentences;
    `schema.MULTI_SENTENCE_RULE_ID` decides which is ALLOWED two. They live
    apart because prompt.py imports schema.py and not the reverse, so the
    constant cannot simply be shared. If they diverge, every class C sentence is
    requested at two sentences and then hard-failed at the one-sentence budget —
    a total outage of the only rule that has hazard areas, produced by editing
    one string.

    The priority assertion guards the other half of the claim: issue 2 is always
    a single sentence, which is only true while the paired rule outranks every
    other rule and therefore never lands in position 2.
    """
    assert schema.MULTI_SENTENCE_RULE_ID == prompt.HAZARD_AREA_RULE_ID

    loaded = rules.load_rules()[0]
    paired = [r for r in loaded if r.id == schema.MULTI_SENTENCE_RULE_ID]
    assert len(paired) == 1, "the paired rule is not in rules.yaml"
    others = [r for r in loaded if r.id != schema.MULTI_SENTENCE_RULE_ID]
    assert all(paired[0].priority < r.priority for r in others), (
        "the paired rule no longer outranks every other rule, so it can appear "
        "as issue 2 — where a two-sentence entry is neither asked for nor capped"
    )


def test_the_sentence_count_asked_for_matches_the_areas_shown():
    """The bug this replaced: three areas listed, two sentences asked for.

    The model answered the list rather than the instruction and returned three
    entries for one issue, which `generate.py` then had to reconcile against an
    issue count — and, before the pairing fix, reconciled by sliding later
    sentences onto the wrong rules. 1,722 of 2,785 paired shapes showed three
    areas, so this was the majority case, not an edge.
    """
    for n in (2, 3):
        body = _context(
            conditions=["Hazardous conditions are open."],
            hazard_areas=[f"Area {i} — Something." for i in range(n)],
            hazard_issue_index=0,
        )
        word = {2: "TWO", 3: "THREE"}[n]
        assert f"Write {word} sentences for Issue 1" in body, n
        # And never asks for a count the list cannot support.
        for other in {"TWO", "THREE"} - {word}:
            assert f"Write {other} sentences" not in body, n


def test_the_area_budget_covers_every_area_that_can_be_shown():
    """One sentence per area only works if the budget stretches that far.
    `HAZARD_AREA_LIMIT` caps what SQL supplies; the schema has to match it or a
    building at the limit fails length validation for obeying the prompt."""
    from services.briefs.signals import HAZARD_AREA_LIMIT
    assert schema.MAX_AREA_SENTENCES == HAZARD_AREA_LIMIT
    assert schema.MAX_WATCH_FOR_MULTI == schema.MAX_WATCH_FOR * HAZARD_AREA_LIMIT


def test_two_areas_ask_for_two_sentences_and_one_area_does_not():
    """The v7 change. One area is still one sentence, on purpose.

    A second sentence needs a second thing to be about; asking for one anyway is
    asking the model to pad, and padding a sentence about hazards is how the
    invented nouns got in before the hazard-area block existed.
    """
    two = _context(
        conditions=["Hazardous conditions are open."],
        hazard_areas=[
            "Bldg maintenance — Broken fixtures.", "Heat / hot water — No heat.",
        ],
        hazard_issue_index=0,
    )
    assert "Write TWO sentences for Issue 1" in two
    assert "one for each area listed above, in that order" in two
    # Order must survive into the rendered block — the instruction is useless
    # if the list itself is reordered on the way in.
    assert two.index("Bldg maintenance") < two.index("Heat / hot water")

    one = _context(
        conditions=["Hazardous conditions are open."],
        hazard_areas=["Bldg maintenance — Broken fixtures."],
        hazard_issue_index=0,
    )
    assert "Write TWO sentences" not in one

    # The trailing constraint survives both branches: it is appended after the
    # per-branch instruction, and a string built by concatenation is exactly
    # where a branch quietly loses a clause.
    for body in (one, two):
        assert "Do not name an area that is not listed here" in body


def test_hazard_area_order_is_carried_through_from_the_categories():
    """End to end: raw HPD categories in significance order, prompt out.

    The SQL sorts by open count (`ORDER BY n DESC, category`) and every layer
    below preserves that. A dedupe or a set anywhere in between would silently
    reorder the list the model is told to read in order.
    """
    body = _context(
        conditions=["Hazardous conditions are open."],
        hazard_areas=prompt.hazard_areas_for({
            "open_class_c_violations": 12,
            "open_class_c_categories": [
                "MAINTENANCE", "HEAT AND HOT WATER", "EGRESS",
            ],
        }),
        hazard_issue_index=0,
    )
    assert (
        body.index("Bldg maintenance")
        < body.index("Heat / hot water")
        < body.index("Safety & fire")
    )


def test_hazard_areas_bind_to_their_own_issue_only():
    """Rendered flat, the areas constrained every sentence.

    Observed: issue 2 was lead paint and the model wrote about heat, because the
    area list read as a global constraint. Nesting scopes it.
    """
    body = _context(
        conditions=["Hazardous conditions are open.", "Lead paint is on record."],
        hazard_areas=["Heat / hot water — No heat."],
        hazard_issue_index=0,
    )
    assert "Issue 1 covers these areas" in body
    assert "do not let this list constrain your sentence for any other issue" in body
    assert body.index("Heat / hot water — No heat.") < body.index("Issue 2:")


def test_hazard_areas_attach_by_rule_id_not_by_position():
    by_id = {r.id: r for r in rules.load_rules()[0]}
    assert prompt.hazard_issue_index([by_id["open_class_c"], by_id["mold"]]) == 0
    assert prompt.hazard_issue_index([by_id["mold"], by_id["open_class_c"]]) == 1
    assert prompt.hazard_issue_index([by_id["mold"]]) is None


def test_hazard_areas_distinguishes_empty_from_absent():
    """[] and None are different states and must render differently.

    [] means class C is flagged but nothing observable is known — 4.6% of class
    C buildings. Collapsing it into None restores the silence that produced the
    invented nouns.
    """
    flagged_no_areas = _context(
        conditions=["Something abstract."], hazard_areas=[], hazard_issue_index=0,
    )
    assert "No area is recorded for Issue 1" in flagged_no_areas
    assert "Do not guess" in flagged_no_areas

    not_flagged = _context(conditions=["Something abstract."], hazard_areas=None)
    assert "No area is recorded" not in not_flagged
    assert "most common first" not in not_flagged


def test_hazard_areas_for_keys_off_class_c_not_off_the_categories():
    """The no-categories state must still render, so it cannot key off them."""
    assert prompt.hazard_areas_for({"open_class_c_violations": 0}) is None
    assert prompt.hazard_areas_for(
        {"open_class_c_violations": 12, "open_class_c_categories": None}
    ) == []
    assert prompt.hazard_areas_for(
        {"open_class_c_violations": 12, "open_class_c_categories": ["RETIRED"]}
    ) == []
    heat = prompt.hazard_areas_for(
        {"open_class_c_violations": 12, "open_class_c_categories": ["HEAT AND HOT WATER"]}
    )
    assert len(heat) == 1 and heat[0].startswith("Heat / hot water — ")


# --------------------------------------------------------------------------
# Output schema
# --------------------------------------------------------------------------

def test_watch_for_defaults_to_empty_not_none():
    """Empty list, not None — the field is always a list so callers can iterate."""
    assert schema.GeneratedContext().watch_for == []


def test_watch_for_caps_the_number_of_sentences():
    """Bound to the constant, not a literal — this test pinned 2 and had to be
    rewritten when the cap moved to 3."""
    at_cap = ["s"] * schema.MAX_WATCH_ITEMS
    assert len(schema.GeneratedContext(watch_for=at_cap).watch_for) == \
        schema.MAX_WATCH_ITEMS
    with pytest.raises(Exception):
        schema.GeneratedContext(watch_for=at_cap + ["one too many"])


def test_each_watch_sentence_is_length_capped():
    """Per-item, not just the list — one 5,000-char entry is the failure mode.

    The schema holds the LOOSER paired cap because it cannot see which rule an
    entry answers. The tighter per-rule budget is check_length's job, pinned
    below.
    """
    with pytest.raises(Exception):
        schema.GeneratedContext(watch_for=["x" * (schema.MAX_WATCH_FOR_MULTI + 1)])
    assert schema.GeneratedContext(
        watch_for=["x" * schema.MAX_WATCH_FOR_MULTI]
    ).watch_for


def test_only_the_paired_rule_may_spend_the_larger_budget():
    """The gap raising the schema cap opened, and the reason check_length exists.

    Without it, letting the class C issue carry two sentences would have doubled
    the budget for mold, pests, heat and lead paint as well — and 200 characters
    is not a formatting preference, it is what makes a model that starts listing
    findings run out of room.
    """
    # Padded with the rule's own subject word so `on_topic` passes and this
    # test still isolates the length check.
    long_enough_for_two = "mold " * ((schema.MAX_WATCH_FOR + 5) // 5)

    ok = _verdicts(long_enough_for_two, schema.MULTI_SENTENCE_RULE_ID)
    assert validate.is_publishable(ok)

    too_long = _verdicts(long_enough_for_two, "mold")
    assert not validate.is_publishable(too_long)
    assert [v.check for v in validate.failures(too_long)] == ["length"]

    # And the paired rule is not unbounded either.
    over = _verdicts("mold " * ((schema.MAX_WATCH_FOR_MULTI + 5) // 5),
                     schema.MULTI_SENTENCE_RULE_ID)
    assert not validate.is_publishable(over)


def test_schema_forbids_extra_fields():
    """Guards the refactor: the model must not grow `summary` back.

    Nor `context_line`, removed in v5 precisely because it was the one field
    making a claim about the building as a whole.
    """
    with pytest.raises(Exception):
        schema.GeneratedContext(watch_for=["fine"], summary="should not exist")
    with pytest.raises(Exception):
        schema.GeneratedContext(watch_for=["fine"], context_line="removed in v5")


# --------------------------------------------------------------------------
# Validator
# --------------------------------------------------------------------------

def test_empty_verdict_list_is_not_publishable():
    """`all([])` is True, which would green-light everything while no check runs.

    A validator that passes every brief is worse than no validator, because it
    reads as assurance. This must stay true until real checks land.
    """
    assert not validate.is_publishable([])
    assert not validate.is_publishable(validate.validate([], selected_rules=[]))


def test_publishable_requires_every_verdict_to_pass():
    ok = validate.Verdict("x", True, "")
    bad = validate.Verdict("y", False, "")
    assert validate.is_publishable([ok])
    assert not validate.is_publishable([ok, bad])


def _rule(rule_id: str = "mold"):
    return {r.id: r for r in rules.load_rules()[0]}[rule_id]


def _verdicts(sentence: str, rule_id: str = "mold"):
    return validate.validate([sentence], selected_rules=[_rule(rule_id)])


def _failed(sentence: str, check: str, rule_id: str = "mold") -> bool:
    return any(
        v.check == check and not v.passed for v in _verdicts(sentence, rule_id)
    )


def test_a_clean_sentence_is_publishable():
    """The reference pass. Names an observable thing, claims nothing else."""
    verdicts = _verdicts(
        "On a viewing, look at the window sills and the paint around them for "
        "chips or peeling.",
        "lead_paint",
    )
    assert validate.is_publishable(verdicts)
    # Every registered check ran. Derived from CHECKS rather than listed, so
    # adding a check cannot silently leave a sentence unexamined here.
    assert len({v.check for v in verdicts}) == len(validate.CHECKS)


@pytest.mark.parametrize("sentence", [
    # The observed failure, verbatim: this opened the first three sentences ever
    # generated, for buildings carrying 616, 473, and 552 open violations.
    "A few issues appear on this building's record.",
    "Several tenants have reported problems worth asking about.",
    "Ask whether some of the radiators have been serviced.",
    "There are multiple areas worth looking at on a viewing.",
    "Reports here are isolated to one part of the building.",
])
def test_vague_quantifiers_hard_fail(sentence):
    assert _failed(sentence, "vague_quantifiers")
    assert not validate.is_publishable(_verdicts(sentence))


@pytest.mark.parametrize("sentence", [
    # A hard fail costs a rule its corpus entry, so a substring match here is
    # expensive. Every one of these contains a banned quantifier as substring.
    "Ask the neighbors whether something smells damp in the hallway.",
    "Ask how often the boiler is serviced, and whether it sometimes cuts out.",
    "Ask whether the smell is coming from somewhere below the sink.",
])
def test_quantifier_check_is_word_boundaried(sentence):
    assert not _failed(sentence, "vague_quantifiers")


@pytest.mark.parametrize("sentence", [
    # A legal right — the prompt's own bad example.
    "You are entitled to heat between October and May.",
    "Tenants have the right to a habitable apartment.",
    # A remedy or filing channel. rules.yaml says this, with a citation.
    "Call 311 to report a heat outage.",
    "Unresolved conditions can be raised in housing court.",
    "Rent withholding is possible while the condition is open.",
    "You can file a complaint about the condition.",
    # An obligation attributed to a party.
    "The landlord must fix this within the correction period.",
    "The owner is required to inspect for peeling paint.",
    # A deadline, which is cited to HPD's penalties page in rules.yaml and would
    # arrive here with no citation at all.
    "This is legally a hazard and carries a deadline.",
])
def test_rights_language_hard_fails(sentence):
    assert _failed(sentence, "rights_language")


@pytest.mark.parametrize("sentence", [
    # `watch_for` is for what to look at and what to ask. Asking a landlord a
    # question is in scope; only telling the reader what they are OWED is not.
    "Ask the landlord who is responsible for pest treatment.",
    "Ask the super when the building was last treated for mice.",
    "Ask current tenants how the heat held up last winter.",
    "Look under the sinks and around the tub for damp or staining.",
    "Ask the managing agent what happened with the previous repairs.",
])
def test_rights_check_does_not_fire_on_ordinary_questions(sentence):
    assert not _failed(sentence, "rights_language")


# --------------------------------------------------------------------------
# Useless register — the check for sentences that are correct and worthless
# --------------------------------------------------------------------------

def test_the_sentence_this_check_was_written_for_hard_fails():
    """Verbatim from `brief_texts`, where it was published and served.

    17 words, 104 characters: inside every length limit, no banned quantifier,
    no rights claim. It is the exact output the rewritten prompt argues
    against, and before this check nothing could stop it reaching a page.
    """
    sentence = (
        "When visiting, ask the current tenant about their experience with "
        "heat and hot water through the winter."
    )
    assert len(sentence) < validate.MAX_WATCH_FOR
    assert not _failed(sentence, "vague_quantifiers")
    assert not _failed(sentence, "rights_language")
    assert not _failed(sentence, "length")
    assert _failed(sentence, "useless_register")


@pytest.mark.parametrize("sentence", [
    "Ask the super about their experience with the boiler.",
    "Worth asking how last winter went for the current tenants.",
    "Ask the neighbors how the heat has been this year.",
    "Ask whether they find the apartment warm enough.",
    "Once you have moved in, check the radiators each month.",
    "After you sign, look at the window sills for peeling paint.",
])
def test_useless_register_hard_fails(sentence):
    assert _failed(sentence, "useless_register"), sentence


@pytest.mark.parametrize("sentence", [
    # A question is fine when it carries the words to say and asks for a fact.
    "Ask the super when the building was last treated for mice.",
    "Ask the broker what the hot water temperature is at the tap.",
    "Ask the managing agent which apartments had the leak repaired.",
    # Pure observation, the shape the prompt asks for.
    "Run the hot tap and count the seconds before it turns hot.",
    "Look at corners, window sills, and areas around pipes for discoloration.",
    "Check the kitchen cabinets and under the sink for droppings.",
    # "experience" and "how" in innocent positions.
    "Look for water stains, which show how far a past leak spread.",
])
def test_useless_register_does_not_fire_on_good_sentences(sentence):
    """These are hard fails, so a false positive silently costs a rule its whole
    corpus entry — the same reasoning that kept "responsible for" out of the
    rights patterns."""
    assert not _failed(sentence, "useless_register"), sentence


def test_every_published_sentence_would_pass_the_new_check():
    """The other four sentences live in `brief_texts` today and are good. The
    check must not retroactively quarantine work that was already right."""
    good = [
        "On a viewing, inspect window sills, door frames, and interior walls "
        "for paint chips or peeling, especially in kitchens and bathrooms.",
        "Look at corners, window sills, and areas around pipes for "
        "discoloration or visible mold.",
        "Look at window sills, corners, and under the sink for staining, "
        "discoloration, or soft spots in the walls.",
        "Check the kitchen cabinets, under the sink, and behind appliances "
        "for droppings, dead insects, or damage to baseboards.",
    ]
    for sentence in good:
        assert not _failed(sentence, "useless_register"), sentence


# --------------------------------------------------------------------------
# On topic — the only check that holds watch_for[i] to selected_rules[i]
# --------------------------------------------------------------------------

def test_a_sentence_on_the_wrong_rule_hard_fails():
    """The observed misattribution, verbatim from `brief_texts`.

    A heat sentence stored against the detector rule, after the model split a
    paired class C entry into separate list entries and every later sentence
    slid one rule to the left. Nothing else catches it: the sentence is well
    formed, in budget, and carries no banned language. It is simply not about
    detectors.
    """
    heat_sentence = (
        "Turn on the heat and feel whether it warms the radiators or vents; "
        'if it is winter, ask the broker: "Is the heat on right now?"'
    )
    assert _failed(heat_sentence, "on_topic", "smoke_co_detectors")
    # ... and is fine on the rule it was actually written for.
    assert not _failed(heat_sentence, "on_topic", "heat_hot_water")


@pytest.mark.parametrize("rule_id,sentence", [
    ("smoke_co_detectors",
     "Look for a smoke alarm within fifteen feet of the bedroom door."),
    ("lead_paint",
     "Inspect window sills and door frames for paint chips or peeling."),
    ("mold",
     "Look at corners and around pipes for discoloration or visible mold."),
    ("pests",
     "Check under the sink for droppings, dead insects, or gnaw marks."),
    ("heat_hot_water",
     "Run the hot tap and count the seconds before it turns hot."),
])
def test_on_topic_passes_real_sentences(rule_id, sentence):
    """Every sentence in the corpus today, plus the shapes the prompt asks for.
    A hard fail here would cost a rule its entry for being correct."""
    assert not _failed(sentence, "on_topic", rule_id), sentence


def test_class_c_declares_no_topic_terms_and_is_never_checked():
    """Its subject is whichever hazard areas the building has, so any fixed
    vocabulary would hard-fail correct sentences about fire escapes one moment
    and pests the next. It is also the rule that fires most often."""
    by_id = {r.id: r for r in rules.load_rules()[0]}
    assert by_id["open_class_c"].topic_terms == ()
    for sentence in [
        "Check whether the hallway, stairwell, and fire escape are clear.",
        "Look under the sink for droppings.",
        "Run the hot tap and see how long it takes to warm up.",
    ]:
        assert not _failed(sentence, "on_topic", "open_class_c"), sentence


def test_topic_terms_are_matched_as_stems():
    """"discolor" has to catch "discoloration", "exterminat" both
    "exterminate" and "extermination"."""
    assert not _failed("Look for discoloration on the ceiling.", "on_topic", "mold")
    assert not _failed("Ask when extermination last happened.", "on_topic", "pests")


# --------------------------------------------------------------------------
# Echoing the example — the model returning the prompt instead of writing
# --------------------------------------------------------------------------

def test_returning_an_example_verbatim_hard_fails():
    """`qwen3:8b` did exactly this: answered with the GOOD example, a valid
    sentence it had not written, bound for the largest shape in the corpus."""
    for example in prompt.GOOD_EXAMPLES:
        assert validate.echo_score(example) == 1.0
        assert _failed(example, "echoes_example", "heat_hot_water"), example


def test_the_examples_are_out_of_domain():
    """The whole reason this check can work.

    An example naming a hazard the brief also asks about fails twice: an echo
    is indistinguishable from the model independently reaching the obvious
    answer, and a genuine sentence about that hazard scores like an echo. A
    real lead-paint sentence scored 0.83 against an in-domain lead-paint
    example — it would have been hard-failed for being correct.
    """
    apartment_words = {
        "apartment", "building", "radiator", "boiler", "mold", "pest", "paint",
        "detector", "alarm", "stairwell", "hallway", "sill", "tenant",
    }
    for example in prompt.GOOD_EXAMPLES:
        words = set(example.lower().split())
        assert not (words & apartment_words), (
            f"example is in-domain, which makes echoes unmeasurable: {example}"
        )


@pytest.mark.parametrize("sentence", [
    "On a viewing, inspect window sills, door frames, and interior walls for "
    "paint chips or peeling.",
    "Check that stairwell doors close fully and that hallways are clear.",
    "Look at corners, window sills, and areas around pipes for discoloration.",
    "Run the hot tap and count the seconds before it turns hot.",
    "Check the kitchen cabinets and under the sink for droppings.",
])
def test_real_sentences_score_far_below_the_threshold(sentence):
    """Every sentence in the corpus today. The margin is the point: real output
    tops out at 0.10 against out-of-domain examples, so 0.6 is not a fine
    judgement call."""
    assert validate.echo_score(sentence) < 0.2, sentence
    assert not _failed(sentence, "echoes_example", "mold")


def test_banned_quantifiers_are_all_named_in_the_prompt():
    """The prompt asks and the validator enforces; they must ban the same words.

    A word banned here but absent from the prompt is a hard fail the model was
    never warned about — it quarantines output for a constraint it could not
    have known. When these drift, the prompt is what gets updated.
    """
    for quantifier in validate.VAGUE_QUANTIFIERS:
        assert f'"{quantifier}"' in prompt.SYSTEM, (
            f"{quantifier!r} is a hard fail but the prompt never mentions it"
        )


def test_more_sentences_than_rules_is_a_pairing_failure():
    """`zip` would drop the extra and pass — the surplus sentence goes unchecked.

    generate.py truncates this case, so reaching the validator means a corpus
    row was assembled by hand against the wrong rule list.
    """
    verdicts = validate.validate(
        ["Look at the window sills.", "A few issues appear."],
        selected_rules=[_rule("lead_paint")],
    )
    assert not validate.is_publishable(verdicts)
    assert [v.check for v in verdicts] == ["pairing"]


def test_verdicts_name_the_issue_they_judge():
    """Per-claim, not per-brief: a failure has to say which sentence failed."""
    verdicts = validate.validate(
        ["Look at the window sills for peeling paint.",
         "A few damp patches appear on the record."],
        selected_rules=[_rule("lead_paint"), _rule("mold")],
    )
    failed = validate.failures(verdicts)
    assert len(failed) == 1
    assert "issue 2 (mold)" in failed[0].detail
    assert len(verdicts) == len(validate.CHECKS) * 2  # every check × two sentences


# --------------------------------------------------------------------------
# Corpus key
# --------------------------------------------------------------------------

def test_key_ignores_the_building_and_keys_on_the_input_shape():
    """The whole cost model: ~12,000 keys for 464,000 buildings.

    Two buildings differing only in their counts produce the same input to the
    model — the prompt carries no counts — so they must produce one corpus row.
    """
    a = corpus.key_for("mold", categories=["MAINTENANCE"], percentile=12.0)
    b = corpus.key_for("mold", categories=["MAINTENANCE"], percentile=12.0)
    assert a == b


def test_severity_permission_splits_the_key():
    """Below 70 the prompt forbids severity language; above it, allows it.

    Same rule, genuinely different instructions, so genuinely different text.
    Sharing a row would publish text written under one constraint on buildings
    that were never granted it.
    """
    low = corpus.key_for("mold", categories=None, percentile=31.3)
    high = corpus.key_for("mold", categories=None, percentile=95.0)
    assert low != high
    assert "sev=0" in low and "sev=1" in high


def test_hazard_areas_only_enter_the_key_for_the_class_c_rule():
    """They only enter the PROMPT for that rule, so nothing else may key on them.

    Keying every rule on them would fragment the corpus by a value those rules
    were never shown — multiplying the cost for text that cannot differ.
    """
    areas = ["HEAT AND HOT WATER", "PAINTING"]
    assert corpus.key_for("mold", categories=areas, percentile=10.0) == \
        corpus.key_for("mold", categories=None, percentile=10.0)
    assert corpus.key_for("open_class_c", categories=areas, percentile=10.0) != \
        corpus.key_for("open_class_c", categories=None, percentile=10.0)


def test_key_distinguishes_categories_that_share_a_group():
    """The prompt shows a group LABEL with a specific category's sentence.

    Two buildings whose hazard areas resolve to the same group can still be
    shown different text, so the key carries the category and not only the
    group. Collapsing them would serve one building the sentence written from
    another building's condition.
    """
    members: dict[str, list[str]] = {}
    for category, group in taxonomy.violation_category_to_group().items():
        if group not in taxonomy.NON_OBSERVABLE_GROUPS:
            members.setdefault(group, []).append(category)
    shared = next(
        (c for c in members.values()
         if len(c) > 1 and all(taxonomy.violation_category_tooltip(x) for x in c)),
        None,
    )
    assert shared, "no two categories share a group; test is vacuous"
    first, second = shared[0], shared[1]
    assert taxonomy.describe_hazard_areas([first]) != \
        taxonomy.describe_hazard_areas([second])
    assert corpus.key_for("open_class_c", categories=[first], percentile=10.0) != \
        corpus.key_for("open_class_c", categories=[second], percentile=10.0)


def test_hazard_area_keys_stay_parallel_to_the_prose_form():
    """One is what the model is shown, the other is what the row is keyed on.

    They must select and drop the same areas in the same order, or the corpus
    keys on a set that differs from the set the model saw — a silent mis-key
    that renders as a plausible sentence about the wrong hazard.
    """
    categories = ["MAINTENANCE", "PAINTING", "RETIRED", None, "NOT A CATEGORY"]
    assert len(taxonomy.hazard_area_keys(categories)) == \
        len(taxonomy.describe_hazard_areas(categories))
    # RETIRED is administrative — non-observable — and must be dropped by both.
    assert not any("low_priority_admin" in k
                   for k in taxonomy.hazard_area_keys(categories))


def test_hazard_area_order_is_significance_not_alphabetical():
    """The prompt presents them most common first and says to base the sentence
    on one of them, so two orders are two different inputs."""
    a = corpus.key_for(
        "open_class_c", categories=["MAINTENANCE", "PAINTING"], percentile=10.0
    )
    b = corpus.key_for(
        "open_class_c", categories=["PAINTING", "MAINTENANCE"], percentile=10.0
    )
    assert a != b


def test_key_is_readable_rather_than_hashed():
    """A corpus miss degrades silently to phase-0 rendering, so the key has to
    be greppable in a log and comparable by eye against a row in the table."""
    key = corpus.key_for("open_class_c", categories=["PAINTING"], percentile=95.0)
    assert key.startswith("open_class_c|")
    assert "sev=1" in key
    assert "PAINTING" in key


def test_heat_signal_matches_the_page_card_definition():
    """The brief and the "Heat / hot water" card must show the same number.

    Same label on the same page, so a different definition is a visible
    contradiction. This previously used `major_category = 'HEAT/HOT WATER'`,
    which excludes RADIATOR and BOILER — 21% of heat-firing buildings got a
    count that disagreed with the card beside it.
    """
    from services.briefs.smoke import HEAT_CATEGORIES

    assert set(HEAT_CATEGORIES) == set(taxonomy.minor_categories("heating_hot_water"))
    # The two that made the old definition wrong.
    assert "RADIATOR" in HEAT_CATEGORIES
    assert "BOILER" in HEAT_CATEGORIES


def test_mold_and_pest_signals_are_deliberately_narrower_than_their_group():
    """The opposite case, and it is safe because the labels differ.

    The card says "Mold & pests" and includes RUBBISH, ODOR, and UNSANITARY
    CONDITION. The rules say "Tenants here have reported mold" — a narrower
    claim, so a narrower number is not a contradiction.
    """
    from services.briefs.smoke import MOLD_CATEGORIES, PEST_CATEGORIES

    group = set(taxonomy.minor_categories("mold_pests_sanitation"))
    assert set(MOLD_CATEGORIES) | set(PEST_CATEGORIES) < group
    assert "RUBBISH" not in MOLD_CATEGORIES + PEST_CATEGORIES


# ── class C overlap suppression ──────────────────────────────────────────────
#
# Verified supersedes reported: when an inspector has already cited a condition
# as immediately hazardous, a tenant complaint about the same condition is the
# weaker evidence for the same claim, and showing both states one problem twice.

def test_complaint_rule_fires_standalone_when_its_group_is_not_a_class_c_area():
    """Heat complaints with class C areas that are NOT heat — heat still fires."""
    selected = rules.select_rules(_signals(
        open_class_c_violations=37,
        heat_hot_water_complaints=4597,
        open_class_c_categories=["MAINTENANCE", "CLEANING"],
    ))
    assert "heat_hot_water" in [r.id for r in selected]


def test_complaint_rule_is_suppressed_when_its_group_is_a_class_c_area():
    """The same building, but with heat among the class C hazard areas."""
    selected = rules.select_rules(_signals(
        open_class_c_violations=37,
        heat_hot_water_complaints=4597,
        open_class_c_categories=["HEAT AND HOT WATER"],
    ))
    ids = [r.id for r in selected]
    assert "open_class_c" in ids
    assert "heat_hot_water" not in ids


def test_mold_and_pests_both_suppress_off_the_same_group():
    """BIN 2003187, the building this rule was written for.

    Class C areas are EXTERMINATION & RODENT ERADICATION, MAINTENANCE and
    CLEANING. The first and third both map to mold_pests_sanitation, so both
    complaint rules go — while heat, whose group is absent, stays.
    """
    signals = _signals(
        open_class_c_violations=37,
        smoke_co_detector_violations=2,
        mold_complaints=38,
        pest_complaints=143,
        heat_hot_water_complaints=4597,
        open_class_c_categories=[
            "EXTERMINATION & RODENT ERADICATION", "MAINTENANCE", "CLEANING",
        ],
    )
    ids = [r.id for r in rules.select_rules(signals)]
    assert ids == ["open_class_c", "heat_hot_water", "smoke_co_detectors"]
    assert "mold" not in ids and "pests" not in ids


def test_suppressed_rules_reports_what_it_removed():
    """Suppression must be inspectable, not a silent subtraction."""
    signals = _signals(
        open_class_c_violations=37,
        mold_complaints=38,
        pest_complaints=143,
        open_class_c_categories=["EXTERMINATION & RODENT ERADICATION"],
    )
    got = {r.id: group for r, group in rules.suppressed_rules(signals)}
    assert got == {"mold": "mold_pests_sanitation", "pests": "mold_pests_sanitation"}


# --------------------------------------------------------------------------
# Reverse suppression — open_class_c dropped when only lead_paint covers it
# --------------------------------------------------------------------------

def test_open_class_c_is_dropped_when_every_category_is_lead_paint():
    """BIN 4009581's shape: open class C is entirely LEAD-BASED PAINT.

    open_class_c can never name a hazard area here (lead paint has no
    taxonomy group), so it would otherwise sit on the page as a permanently
    abstract duplicate of lead_paint.
    """
    signals = _signals(
        open_class_c_violations=6,
        lead_paint_violations=6,
        open_class_c_categories=["LEAD-BASED PAINT"],
    )
    ids = [r.id for r in rules.select_rules(signals)]
    assert ids == ["lead_paint"]


def test_open_class_c_is_dropped_when_lead_paint_and_retired_mix():
    signals = _signals(
        open_class_c_violations=9,
        lead_paint_violations=6,
        open_class_c_categories=["LEAD-BASED PAINT", "RETIRED"],
    )
    ids = [r.id for r in rules.select_rules(signals)]
    assert ids == ["lead_paint"]


def test_all_retired_with_no_lead_paint_keeps_open_class_c():
    """Purely administrative is abstract, not duplicative — a different,
    already-accepted case. Nothing below it names the same finding, so
    dropping it here would remove the only signal the building has."""
    signals = _signals(
        open_class_c_violations=3,
        open_class_c_categories=["RETIRED"],
    )
    ids = [r.id for r in rules.select_rules(signals)]
    assert ids == ["open_class_c"]


def test_open_class_c_survives_alongside_a_describable_area():
    """Lead paint plus a nameable area: the sentence has something to say, so
    open_class_c is not fully covered by lead_paint and both items stay."""
    signals = _signals(
        open_class_c_violations=9,
        lead_paint_violations=6,
        open_class_c_categories=["LEAD-BASED PAINT", "HEAT AND HOT WATER"],
    )
    ids = [r.id for r in rules.select_rules(signals)]
    assert "open_class_c" in ids
    assert "lead_paint" in ids


def test_class_c_self_suppressed_requires_lead_paint_to_actually_fire():
    """Guard against dropping open_class_c with nothing left to replace it,
    even though the two signals should never disagree in practice."""
    signals = _signals(
        open_class_c_violations=6,
        lead_paint_violations=0,
        open_class_c_categories=["LEAD-BASED PAINT"],
    )
    assert rules.class_c_self_suppressed(signals) is False
    ids = [r.id for r in rules.select_rules(signals)]
    assert ids == ["open_class_c"]


def test_lead_paint_still_never_declares_suppressed_by_class_c_group():
    """The reverse-suppression fix must not touch the forward mechanism: an
    inspector's finding is still never weaker evidence for its own claim."""
    by_id = {r.id: r for r in rules.load_rules()[0]}
    assert by_id["lead_paint"].suppressed_by_class_c_group is None


def test_suppression_needs_the_signal_and_says_so():
    """Suppression only ever REMOVES an item, so failing quiet shows the
    duplicate it exists to prevent. It must raise instead."""
    signals = _signals(mold_complaints=9)
    del signals["open_class_c_categories"]
    with pytest.raises(rules.MissingSignalError):
        rules.select_rules(signals)


def test_a_rule_below_its_threshold_is_not_reported_as_suppressed():
    """Suppression is about overlap, not about eligibility."""
    signals = _signals(
        open_class_c_violations=4,
        mold_complaints=0,
        open_class_c_categories=["EXTERMINATION & RODENT ERADICATION"],
    )
    assert rules.suppressed_rules(signals) == []


def test_only_complaint_keyed_rules_declare_suppression():
    """A class C violation cannot supersede itself, and an inspector's finding
    is never the weaker evidence for its own claim."""
    by_id = {r.id: r for r in rules.load_rules()[0]}
    assert by_id["open_class_c"].suppressed_by_class_c_group is None
    assert by_id["lead_paint"].suppressed_by_class_c_group is None
    assert by_id["smoke_co_detectors"].suppressed_by_class_c_group is None
    assert by_id["mold"].suppressed_by_class_c_group == "mold_pests_sanitation"
    assert by_id["pests"].suppressed_by_class_c_group == "mold_pests_sanitation"
    assert by_id["heat_hot_water"].suppressed_by_class_c_group == "heating_hot_water"


def test_declared_suppression_groups_exist_in_the_taxonomy():
    """A typo'd group name would silently never suppress anything."""
    from services.briefs.taxonomy import groups as taxonomy_groups
    known = set(taxonomy_groups())
    for rule in rules.load_rules()[0]:
        if rule.suppressed_by_class_c_group:
            assert rule.suppressed_by_class_c_group in known, rule.id
