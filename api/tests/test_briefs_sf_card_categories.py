"""The card's condition buckets — `cities/sf/card_categories`.

Offline, like the brief classifier's tests: no database, and the rows asserted
on are DBI phrasings taken from the 5-year corpus during authoring.

Two things are being protected here, and only one of them is accuracy:

  1. **The card can never contradict the brief.** The brief's classifier runs
     first and wins outright, so a row it calls `mold` is `mold` on the card.
     Several tests below exist only to hold that ordering in place.
  2. **Narrative is never a category.** 32% of DBI's corpus is inspector notes
     and nuisance boilerplate. The old card charted those as `building section`
     — 97.4% of them carry that label or a blank — which is how a building whose
     real problem was peeling paint could show "building section" on top.
"""

import re

import pytest

from services.briefs.cities.sf import card_categories, classifier


# ── the two engines ──────────────────────────────────────────────────────────

def test_no_pattern_uses_a_python_word_boundary():
    """`\\b` is BACKSPACE in Postgres. POSIX spells the boundary `\\y`.

    Same trap as nov_patterns.yaml, and just as silent: the Python engine would
    match and the SQL one would not, so the card would disagree with the tests.
    """
    for group, pattern in card_categories.rules():
        assert r"\b" not in pattern, f"{group} uses \\b; write \\y"
    for pattern in card_categories.narrative_patterns():
        assert r"\b" not in pattern, f"narrative pattern uses \\b; write \\y"


def test_every_pattern_compiles_in_python_after_translation():
    for group, pattern in card_categories.rules():
        re.compile(pattern.replace(r"\y", r"\b"))
    for pattern in card_categories.narrative_patterns():
        re.compile(pattern.replace(r"\y", r"\b"))


def test_sql_case_preserves_rule_order():
    """First-match-wins in Python is a CASE cascade in SQL, or it is nothing.

    Anchored on each rule's PATTERN, not on `THEN '<group>'`: two card rules
    reuse a taxonomy group, and the brief's CASE — embedded above them — emits
    that same `THEN` clause first.
    """
    sql = card_categories.render_sql_case()
    positions = [
        sql.index(f"t.card_txt ~ '{pattern.replace(chr(39), chr(39) * 2)}'")
        for _group, pattern in card_categories.rules()
    ]
    assert positions == sorted(positions)


def test_sql_case_evaluates_the_brief_classifier_first():
    """The ordering that makes card/brief agreement structural, not reviewed."""
    sql = card_categories.render_sql_case()
    brief_arm = sql.index("t.txt")
    first_card_rule = sql.index("t.card_txt ~")
    assert brief_arm < first_card_rule


def test_sql_case_guards_short_text_like_python_does():
    assert f"length(t.card_txt) < {classifier.MIN_TEXT_LENGTH}" in card_categories.render_sql_case()


def test_sql_text_expression_strips_narrative_after_the_brief_advisory():
    sql = card_categories.render_sql_text_expression()
    for pattern in classifier.advisory_patterns():
        assert pattern.replace("'", "''") in sql
    for pattern in card_categories.narrative_patterns():
        assert pattern.replace("'", "''") in sql


# ── the brief always wins ────────────────────────────────────────────────────

@pytest.mark.parametrize("text,expected", [
    ("smoke detector missing (1001b) provide smoke detector", "smoke_detectors"),
    ("repair damaged ceilings (1001b,h,o hc)",                "interior_surfaces"),
    ("mold and mildew observed in the bathroom (1001b)",      "mold"),
])
def test_a_row_the_brief_classifies_keeps_the_brief_label(text, expected):
    assert classifier.classify(text, None) == expected
    assert card_categories.classify(text, None) == expected


def test_card_rules_only_see_what_the_brief_declined():
    """A card pattern that also matches a brief-labelled row must not win.

    `\\yboilers?\\y` would happily match a heat notice; it never gets the chance,
    because the brief arm resolves first.
    """
    text = "lack of heat (701 hc) the boiler was not operating at time of inspection"
    assert classifier.classify(text, None) == "heat_hot_water"
    assert card_categories.classify(text, None) == "heat_hot_water"


# ── narrative is never a category ────────────────────────────────────────────

@pytest.mark.parametrize("text", [
    "inspector comments",
    "inspectors comment",
    "inspector's comments",
    "inspector comments important note: due to the nature of this violation, this property will be reinspected",
    "inspector comments due to the violations noted, this property constitutes a nuisance",
    "inspector comments violations cited herein constitute a nuisance pursuant to section 1001",
    "inspector comments nuisance (401(2) (1001(d) hc)",
    "inspectors comment violations cited are located in the common areas only.",
    "inspector comments see dbi nov.",
])
def test_narrative_alone_names_no_condition(text):
    """These are the top of DBI's unmatched rows — 4,728 for the first alone.

    The brief's advisory list misses them by a word: its pattern is `inspector
    comments regarding.*` and DBI mostly writes the bare phrase.
    """
    assert card_categories.classify(text, None) is None


def test_the_mojibake_apostrophe_is_stripped_too():
    """DBI's export renders the apostrophe as `¿` on some rows.

    81 rows of `it is the property owner¿s responsibility` survived the brief's
    `owner'?s` pattern for exactly this reason.
    """
    assert card_categories.classify(
        "inspector comments it is the property owner¿s responsibility to be present", None,
    ) is None


def test_an_inspector_email_never_reaches_a_matcher():
    assert card_categories.classify(
        "inspector comments contact inspector mar via email at wai.mar@sfgov.org", None,
    ) is None


def test_narrative_riding_along_with_a_condition_keeps_the_condition():
    """The strip must remove the note, not the finding it was attached to."""
    assert card_categories.classify(
        "inspector comments repair damaged ceilings (1001b,h,o hc)", None,
    ) == "interior_surfaces"


# ── the buckets the card adds ────────────────────────────────────────────────

@pytest.mark.parametrize("text,expected", [
    # ~811 rows, the largest real condition the brief table cannot name.
    ("provide shutoff tool for gas utility shutoff (712 hc) post enclosed gas meter instructional diagram in a public area.", "gas_shutoff"),
    # ~377 rows of §327 SFEBC work-practice orders.
    ("protect the ground 1001d, k sfhc , 327.4.2.1 sfebc any person performing exterior work", "lead_work_practices"),
    ("provide containment and barrier systems 1001d, k sfhc, 327.4.2 sfebc", "lead_work_practices"),
    # ~215 rows of DBI's catch-all citation.
    ("general dilapidation or improper maintenance (1001 (b)(13)) at time of inspection", "general_disrepair"),
    # ~115 rows that are heat and hot water by any tenant's reading.
    ("provide apt. house or hotel water heated to min. 105 degrees f. (41 degrees c.)", "heat_hot_water"),
    ("remove heat timeclock (1001(b6,13) hc) the san francisco heat ordinance was updated", "heat_hot_water"),
    # ~103 rows of painting orders with no peeling named.
    ("paint (1001b,1301 hc) paint the prepped exterior surfaces.", "peeling_paint"),
    # ~76 rows.
    ("work without permit (106a, 108a sfbc) building permit required (301 hc)", "permits"),
    ("bid permits (301 sfhc, 106a sfbc) repairs cited in this notice may require a building permit", "permits"),
    # ~71 rows.
    ("post the boilers current annual permit to operate (cmc 1024, chap 1 sched. 1-m sfbc)", "heating_equipment"),
    # ~23 rows.
    ("provide access for routine inspection of common areas (303hc)", "access"),
])
def test_card_buckets_from_the_measured_corpus(text, expected):
    assert card_categories.classify(text, None) == expected


def test_lead_work_practices_is_not_lead_paint():
    """§327 containment orders say how work was DONE, not that lead was found.

    The brief reserves `lead_paint` for an explicit abatement order — an early
    version keyed on the advisory instead and produced 1,953 lead flags against
    DBI's own 72. The card must not reopen that by another name, so these rows
    get their own bucket whose label says "work practices".
    """
    text = "provide signage 1001d, k sfhc , 327.5.4 sfebc at the time of inspection there was no signage"
    assert card_categories.classify(text, None) == "lead_work_practices"
    assert card_categories.classify(text, None) != "lead_paint"
    assert "work practices" in card_categories.label("lead_work_practices").lower()


# ── every bucket can be rendered ─────────────────────────────────────────────

def test_every_group_has_a_label_and_a_description():
    """A bucket with no label would raise KeyError at request time."""
    for group in card_categories.groups():
        assert card_categories.label(group)
        assert card_categories.description(group)


def test_card_only_groups_never_shadow_a_taxonomy_group():
    """One condition, one name. A key in both files would give it two.

    `heat_hot_water` and `peeling_paint` are reused BY the card rules on
    purpose and must take their wording from taxonomy.json.
    """
    from services.briefs.cities import SF
    from services.briefs.taxonomy import groups as taxonomy_groups

    overlap = set(card_categories.card_only_groups()) & set(taxonomy_groups(SF))
    assert not overlap, f"{overlap} defined in both taxonomy.json and nov_card_patterns.yaml"


def test_card_buckets_cost_no_signal_column():
    """The whole reason this is a second file.

    A group added to nov_patterns.yaml becomes a column in sf_brief_signals and
    forces a materialized-view recompute. Card buckets must stay out of it.
    """
    from services.briefs.cities.sf import signals

    columns = set(signals.classified_violation_signals())
    for group in card_categories.card_only_groups():
        assert f"open_{group}_violations" not in columns


# ── tooltip wording ──────────────────────────────────────────────────────────

def test_overrides_only_reword_groups_that_exist_in_the_taxonomy():
    """An override for an unknown key is a typo that would never be noticed.

    It cannot fail at request time either — `description()` checks the override
    map before the taxonomy — so nothing but this test would catch it.
    """
    from services.briefs.cities import SF
    from services.briefs.taxonomy import groups as taxonomy_groups

    unknown = set(card_categories.description_overrides()) - set(taxonomy_groups(SF))
    assert not unknown, f"{unknown} is overridden but is not a taxonomy group"


def test_overrides_never_touch_a_card_only_group():
    """Card groups define their description inline; two sources would drift."""
    both = set(card_categories.description_overrides()) & set(card_categories.card_only_groups())
    assert not both


def test_the_card_never_renames_a_condition():
    """Only tooltips are overridden. A group's LABEL is its name page-wide.

    A bar reading one thing and the brief below it another would look like two
    different findings about the same building.
    """
    from services.briefs.cities import SF
    from services.briefs.taxonomy import groups as taxonomy_groups

    for group, spec in taxonomy_groups(SF).items():
        if group in card_categories.groups():
            assert card_categories.label(group) == spec["label"]


def test_no_tooltip_speaks_in_the_complaint_voice():
    """"Reported" is a complaint. A Notice of Violation is a FINDING.

    `taxonomy.json` is written for complaint evidence and says "reported in the
    building" for mold and pests. Those sentences are correct where the brief
    uses them and wrong on a card of inspector findings, which is what the
    override block exists for.
    """
    for group in card_categories.groups():
        assert "reported" not in card_categories.description(group).lower(), group


def test_the_two_lead_buckets_do_not_share_a_description():
    """They are adjacent bars, and the distinction between them is the point.

    The taxonomy's `lead_paint` sentence describes work practices almost word
    for word, so without an override a reader meets two bars saying the same
    thing under different names.
    """
    assert (
        card_categories.description("lead_paint")
        != card_categories.description("lead_work_practices")
    )
    assert "abate" in card_categories.description("lead_paint")


def test_every_tooltip_is_one_short_sentence_or_two():
    """A tooltip is read in a hover, not studied. Cap it.

    The pre-override taxonomy sentence for `interior_surfaces` was 139
    characters of subordinate clauses.
    """
    for group in card_categories.groups():
        text = card_categories.description(group)
        assert len(text) <= 150, f"{group} tooltip is {len(text)} chars"
        assert text.endswith("."), f"{group} tooltip needs a full stop — the page appends to it"


def test_no_tooltip_uses_a_dash_as_punctuation():
    """Em and en dashes are out of the card's voice. Write two sentences.

    Also guards the taxonomy-sourced tooltips, which this file does not own: if
    one acquires a dash later, the fix is an entry in `descriptions:`, not an
    edit to the brief's vocabulary.
    """
    from routes.sf import UNCLASSIFIED_DESCRIPTION

    texts = [card_categories.description(g) for g in card_categories.groups()]
    texts.append(UNCLASSIFIED_DESCRIPTION)
    for text in texts:
        assert "—" not in text and "–" not in text, text
