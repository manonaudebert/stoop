"""Tests for the deterministic half of the Building Brief.

Everything here runs without a database or an API call, which is the point:
rule selection, taxonomy resolution, prompt assembly, and the confidence note
are all pure functions of a signals dict.
"""

from datetime import date

import pytest

from services.briefs import confidence, prompt, rules, schema, taxonomy, validate


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
    """All six rules fire; the cap of 4 keeps the four highest-priority ones.

    Both priority-5 peers are truncated here, which is the cost of inserting the
    detector rule above them.
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
        "open_class_c", "heat_hot_water", "lead_paint", "smoke_co_detectors",
    ]


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
        assert "construction_year" not in (rule.magnitude or "")


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
# Magnitude — the counts the thresholds used to throw away
# --------------------------------------------------------------------------

def test_every_rule_carries_a_magnitude():
    """Without it, a condition reads identically at two complaints and at 200."""
    for rule in rules.load_rules()[0]:
        assert rule.magnitude, f"{rule.id} has no magnitude template"


def test_magnitude_renders_from_the_signal_the_rule_fired_on():
    mold = next(r for r in rules.load_rules()[0] if r.id == "mold")
    assert mold.magnitude_text(_signals(mold_complaints=58)) == (
        "58 complaints in the last five years"
    )


def test_magnitude_states_the_windows_that_actually_differ():
    """Violations are open-right-now; complaints are a five-year window.

    One shared phrase would be false for one of them, so each rule states its
    own. Pinned because the two are easy to unify by accident.
    """
    by_id = {r.id: r for r in rules.load_rules()[0]}
    assert "currently open" in by_id["open_class_c"].magnitude
    assert "currently open" in by_id["lead_paint"].magnitude
    for rid in ("heat_hot_water", "mold", "pests"):
        assert "last five years" in by_id[rid].magnitude, rid


def test_magnitude_with_a_missing_signal_raises_rather_than_printing_braces():
    mold = next(r for r in rules.load_rules()[0] if r.id == "mold")
    with pytest.raises(rules.MissingSignalError):
        mold.magnitude_text({"pest_complaints": 3})


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
    body = _context(conditions=["First thing.", "Second thing.", "Third thing."])
    assert "Issue 1: First thing." in body
    assert "Issue 2: Second thing." in body
    # The third is shown so the model knows the record is larger, but explicitly
    # excluded from watch_for — otherwise it writes a sentence for it.
    assert "Issue 3" not in body
    assert "do NOT write a" in body
    assert "Third thing." in body


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
    """
    body = _context(percentile=31.3, conditions=["Something."])
    assert "31" not in body
    assert "Standing" not in body
    assert "fewer violations" not in body


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
    assert "Do not name an area not listed here" in body


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
    with pytest.raises(Exception):
        schema.GeneratedContext(watch_for=["a", "b", "c"])
    assert len(schema.GeneratedContext(watch_for=["a", "b"]).watch_for) == 2


def test_each_watch_sentence_is_length_capped():
    """Per-item, not just the list — one 5,000-char entry is the failure mode."""
    with pytest.raises(Exception):
        schema.GeneratedContext(watch_for=["x" * (schema.MAX_WATCH_FOR + 1)])
    assert schema.GeneratedContext(watch_for=["x" * schema.MAX_WATCH_FOR]).watch_for


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
