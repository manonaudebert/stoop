"""The NOV condition classifier — accuracy, and the two-engine equivalence.

Offline: the labelled corpus is checked into `data/sf_nov_labels/`, so none of
this needs a database.

**Why the equivalence matters most.** One pattern table has two implementations:
Python (`classify`) and generated SQL (`render_sql_case`). Only the SQL runs on
the site; only the Python is measured against hand labels. If they diverge, every
accuracy number here becomes a claim about code that never executes in
production. The dialect difference is the live hazard — POSIX spells a word
boundary `\\y` while Python spells it `\\b`, and Postgres reads `\\b` as
BACKSPACE, so a stray `\\b` in the pattern file would match nothing in the view
and match correctly in the tests. Verified equal on all 29,712 active rows when
this landed; the checks below are what keep it that way offline.

**Accuracy, for the record.** 98% over 114 hand-labelled rows, 99% on the 70 held
out during tuning. The labels are Manon's; `nov_patterns.yaml` records which
ordering decisions came from which disagreement.
"""

import csv
import re
from pathlib import Path

import pytest

from services.briefs.cities.sf import classifier, signals

LABELS = Path(__file__).resolve().parents[2] / "data" / "sf_nov_labels"


def _rows(split: str):
    """Labelled rows as (text, truth) for one split of the canonical corpus.

    `labels_final.csv` is the ground truth, and it is derived rather than raw:
    `ambiguous.csv` and `holdout_fixed.csv` are the reviewer's working sheets,
    and several labels were superseded by decisions taken after those were saved
    (a bare lead warning is peeling_paint, missing insulation is the envelope,
    and so on). Each row records the BASIS for its label, so the corpus explains
    itself without the conversation that produced it. The working sheets are left
    untouched as provenance.
    """
    path = LABELS / "labels_final.csv"
    if not path.exists():  # pragma: no cover - corpus is checked in
        pytest.skip("labels_final.csv not present")
    return [
        (row["text"], row["label"])
        for row in csv.DictReader(path.open())
        if row["split"] == split
    ]


# ── the two engines must agree ───────────────────────────────────────────────

def test_no_pattern_uses_a_python_word_boundary():
    """`\\b` is a word boundary in Python and a BACKSPACE in Postgres.

    A pattern containing one would pass every Python test here and silently
    match nothing in the view. This is the single most dangerous typo available
    in that file, so it is checked directly rather than inferred.
    """
    for group, pattern in classifier.rules():
        assert "\\b" not in pattern, (
            f"{group} uses \\b; POSIX wants \\y (Postgres reads \\b as backspace)"
        )
    for pattern in classifier.advisory_patterns():
        assert "\\b" not in pattern, "advisory pattern uses \\b; POSIX wants \\y"


def test_every_pattern_compiles_in_python_after_translation():
    for group, pattern in classifier.rules():
        try:
            re.compile(classifier._to_python(pattern))
        except re.error as e:  # pragma: no cover
            pytest.fail(f"{group}: {e}")


def test_sql_case_preserves_rule_order():
    """A CASE cascade IS first-match-wins, which is why the two agree at all.

    Reordering the file must reorder the SQL, or the site silently classifies
    differently from every measurement in this suite.
    """
    sql = classifier.render_sql_case()
    positions = [sql.index(f"THEN '{group}'") for group, _ in classifier.rules()]
    # not strictly increasing: a group may legitimately appear twice, but each
    # occurrence must appear in the same order as the table
    assert positions == sorted(positions) or len(set(positions)) < len(positions)
    first_seen = [sql.index(f"THEN '{g}'") for g in classifier.groups()]
    assert first_seen == sorted(first_seen), "SQL CASE order diverged from the table"


def test_sql_case_guards_short_text_like_python_does():
    """Without this the engines disagree on every row the advisory strip emptied."""
    assert f"length(t.txt) < {classifier.MIN_TEXT_LENGTH}" in classifier.render_sql_case()


def test_advisory_strip_is_applied_before_matching_in_sql():
    """The lead advisory must not be able to decide a label in either engine."""
    expr = classifier.render_sql_text_expression()
    assert expr.count("regexp_replace") == len(classifier.advisory_patterns())
    assert "disturbing lead based paint" in expr
    assert "v.code_violation_desc" in expr


def test_classifies_non_housing_code_violation_description():
    assert classifier.classify(
        None,
        None,
        "Observed fire damage to unit 1 M, with smoke and water damage above.",
    ) == "fire_safety"


# ── the lead rule, which is the one that caused real harm ────────────────────

def test_a_lead_warning_alone_is_never_lead_paint():
    """SF presumes all peeling paint contains lead, so the warning rides along on
    every paint order and says nothing about a finding. Keying on it labelled
    1,953 rows lead_paint against DBI's own 72 in `lead section`."""
    for text in (
        "lead hazard warning",
        "lead warning.",
        "lead hazard warning (327.4.2 sfbc)",
        "work that disturbs lead based paint is also regulated by the epa",
    ):
        assert classifier.classify(text, "") == "peeling_paint", text


def test_lead_paint_requires_an_explicit_order():
    assert classifier.classify(
        "restrict access 1001d, k sfhc, 327.4.1 sfebc establish a regulated work "
        "area that restricts access to only those qualified to handle lead paint", ""
    ) == "lead_paint"


def test_advisory_boilerplate_alone_names_no_condition():
    assert classifier.classify("inspector comments", "") is None
    assert classifier.classify(
        "it is the property owner's responsibility to be present", ""
    ) is None


# ── ordering decisions, each traceable to a labelled disagreement ────────────

@pytest.mark.parametrize("text,expected", [
    # the SURFACE outranks the paint on it: the paint is incidental to the repair
    ("repair damaged ceilings (1001b,h,o hc) at time of inspection, leak damage "
     "was observed", "interior_surfaces"),
    # paint as the SUBJECT outranks weathering
    ("weather proofing on stucco and siding (703)(1001(d)(h)(1301) sfhc there was "
     "peeling paint noted at the exterior", "peeling_paint"),
    # the leading phrase beats a supporting section number cited alongside it
    ("repair stairs and provide 604 affidavit for all exterior appendages "
     "604, 908, 1001b13 sfhc", "floors_stairs"),
    # the SOURCE of water damage is plumbing; the surface it damaged is not
    ("repair source of water damage (703,1001f hc) once source of water damage "
     "is located", "plumbing"),
    # a kitchen appliance, not refuse
    ("repair garbage disposal (1001-f hc) in kitchen", "plumbing"),
    # the envelope, not the heating plant
    ("provide insulation to walls (1001 hc) there is no insulation to units "
     "above causing cold air to enter unit", "weather_windows"),
    ("provide adequate lighting (504g hc) repair exterior lights", "ventilation_light"),
    ("maintain central alarm system (908, 909 hc)", "smoke_detectors"),
])
def test_ordering_precedents(text, expected):
    assert classifier.classify(text, "") == expected


# ── accuracy against the hand-labelled corpus ────────────────────────────────

def _accuracy(rows) -> float:
    ok = sum(1 for text, truth in rows if (classifier.classify(text, "") or "none") == truth)
    return ok / len(rows)


def test_accuracy_on_the_held_out_set_does_not_regress():
    """70 rows never used to tune the ordering. The trustworthy number."""
    rows = _rows("holdout")
    accuracy = _accuracy(rows)
    assert accuracy >= 0.90, f"held-out accuracy fell to {accuracy:.0%}"


def test_accuracy_on_the_tuned_set_does_not_regress():
    rows = _rows("ambiguous")
    accuracy = _accuracy(rows)
    assert accuracy >= 0.90, f"tuned-set accuracy fell to {accuracy:.0%}"


# ── the classifier and the view agree about which columns exist ──────────────

def test_every_classifier_group_becomes_a_signal_column():
    expected = {f"open_{g}_violations" for g in classifier.groups()}
    assert set(signals.classified_violation_signals()) == expected


def test_classifier_groups_all_exist_in_the_taxonomy():
    """A label with no group is a column no rule can meaningfully read."""
    from services.briefs import taxonomy
    from services.briefs.cities import SF

    known = set(taxonomy.groups(SF))
    unknown = set(classifier.groups()) - known
    assert not unknown, f"classifier assigns groups the taxonomy does not define: {unknown}"
