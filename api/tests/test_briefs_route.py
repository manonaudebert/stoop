"""Route tests for /hpd/building/{bin}/brief — the deterministic Building Brief.

The rule engine itself is covered offline in test_briefs_rules.py. What is
tested here is the seam: that the route reads the view's columns into exactly
the signal keys the rules expect, that authored text reaches the response
unmodified, and that the three states of `hazard_areas` survive serialization.
"""

import pytest
from datetime import date

from main import app
from database import get_db
from services.briefs import rules as rules_mod
from services.briefs.smoke import to_signals
from cache import cache_clear
from tests.conftest import MockRow, MockResult, make_mock_db, db_override

SAMPLE_BIN = "1099042"

# One row of hpd_brief_signals. Values chosen so that several rules fire and
# the class C rule is among them.
SIGNALS_ROW = {
    "open_class_c_violations": 12,
    "lead_paint_violations": 3,
    "smoke_co_detector_violations": 2,
    # Real HPD violation category strings. "HEAT & HOT WATER" (ampersand) is
    # NOT one — it maps to no taxonomy group, so it would silently exercise
    # neither the hazard-area labels nor suppression.
    "open_class_c_categories": ["MAINTENANCE", "PAINTING"],
    "mold_complaints": 4,
    "pest_complaints": 9,
    "heat_hot_water_complaints": 21,
    "hpd_record_count": 260,
    "latest_hpd_activity": date(2026, 5, 1),
}

QUIET_ROW = {**SIGNALS_ROW, **{
    "open_class_c_violations": 0,
    "lead_paint_violations": 0,
    "smoke_co_detector_violations": 0,
    "open_class_c_categories": None,
    "mold_complaints": 0,
    "pest_complaints": 0,
    "heat_hot_water_complaints": 0,
}}


async def _get(client, row: dict | None):
    # Clear first: the route caches on `hpd_brief:{bin}` and every call here
    # uses the same BIN, so a second _get in one test would otherwise return the
    # FIRST response. Tests that compare two briefs would then be comparing a
    # response to itself and passing regardless of the route's behaviour.
    cache_clear()
    mock_db = make_mock_db(MockResult([MockRow(row)] if row else []))
    app.dependency_overrides[get_db] = db_override(mock_db)
    try:
        return await client.get(f"/hpd/building/{SAMPLE_BIN}/brief")
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_brief_returns_watch_items_for_a_flagged_building(client):
    resp = await _get(client, SIGNALS_ROW)
    assert resp.status_code == 200
    data = resp.json()
    assert data["bin"] == SAMPLE_BIN
    assert data["no_flags"] is False
    assert len(data["watch_items"]) >= 1


@pytest.mark.asyncio
async def test_display_cap_is_enforced_by_the_route(client):
    """All six rules fire on SIGNALS_ROW; the response must honour the cap."""
    resp = await _get(client, SIGNALS_ROW)
    assert len(resp.json()["watch_items"]) <= 5


@pytest.mark.asyncio
async def test_watch_item_text_is_verbatim_from_rules_yaml(client):
    """The renter-facing sentences must survive the route unmodified.

    This is the property that lets phase 0 ship without a validator: nothing in
    a watch item was generated, so there is nothing to check for hallucination.
    A route that reformatted this text would quietly break that guarantee.
    """
    resp = await _get(client, SIGNALS_ROW)
    by_id = {r.id: r for r in rules_mod.load_rules()[0]}
    for item in resp.json()["watch_items"]:
        rule = by_id[item["rule_id"]]
        assert item["condition"] == rule.condition
        assert item["why_it_matters"] == rule.why_it_matters
        assert item["action"] == rule.action


@pytest.mark.asyncio
async def test_every_item_cites_the_primary_source_document_first(client):
    resp = await _get(client, SIGNALS_ROW)
    document = rules_mod.load_rules()[1]
    for item in resp.json()["watch_items"]:
        assert item["citations"], item["rule_id"]
        assert item["citations"][0]["label"].startswith(document)


@pytest.mark.asyncio
async def test_a_claim_from_another_document_carries_its_own_citation(client):
    """The class C item takes its correction deadlines from HPD's
    penalties-and-fees page, not from the ABCs PDF.

    Citing only the PDF would put a real claim behind a reference that does not
    support it — which is worse than no citation, because it looks checkable and
    fails when checked. Pinned because the tempting simplification is to collapse
    citations back to one string per item.
    """
    resp = await _get(client, SIGNALS_ROW)
    item = next(i for i in resp.json()["watch_items"] if i["rule_id"] == "open_class_c")
    assert len(item["citations"]) == 2
    secondary = item["citations"][1]
    assert secondary["url"].startswith("https://www.nyc.gov/")
    # When an item cites two documents, each must say what it backs — otherwise
    # the reader cannot tell which claim to check where.
    assert all(c["covers"] for c in item["citations"])


def test_single_source_rules_do_not_carry_a_redundant_covers_clause():
    """"— violation classes" is only meaningful next to a second source."""
    rules, document = rules_mod.load_rules()
    for rule in rules:
        if not rule.additional_sources:
            assert rule.covers is None, rule.id
            assert len(rule.citations(document)) == 1


@pytest.mark.asyncio
async def test_hazard_areas_only_on_the_class_c_item(client):
    """None vs [] vs [labels] must stay three distinct states through JSON.

    Collapsing them restores the invented-nouns bug in phase 1, where this field
    is what gives the class C rule something concrete to point at.
    """
    resp = await _get(client, SIGNALS_ROW)
    for item in resp.json()["watch_items"]:
        if item["rule_id"] == "open_class_c":
            assert isinstance(item["hazard_areas"], list)
        else:
            assert item["hazard_areas"] is None


@pytest.mark.asyncio
async def test_zero_flag_building_is_a_valid_empty_brief(client):
    """48% of buildings. Not an error, and not a hidden section."""
    resp = await _get(client, QUIET_ROW)
    assert resp.status_code == 200
    data = resp.json()
    assert data["watch_items"] == []
    assert data["no_flags"] is True


@pytest.mark.asyncio
async def test_building_missing_from_the_view_is_not_a_404(client):
    """A BIN with no HPD record at all still renders a page, so it still
    needs a brief — an empty one, not an error."""
    resp = await _get(client, None)
    assert resp.status_code == 200
    assert resp.json()["no_flags"] is True
    assert resp.json()["watch_items"] == []


@pytest.mark.asyncio
async def test_missing_row_is_treated_exactly_like_a_zero_flag_building(client):
    """No row in the view and all-zero signals must be the same code path.

    An earlier version short-circuited on the missing row and returned before
    computing a confidence note, so the building with the LEAST HPD history was
    the only one rendering no caveat at all — while a building with zero flags
    but a real record got one. This pins the two responses equal apart from the
    note, which SHOULD differ: one has no records on file, the other has records
    that simply flagged nothing.
    """
    missing = (await _get(client, None)).json()
    zero_row = {**QUIET_ROW, "hpd_record_count": 0, "latest_hpd_activity": None}
    empty = (await _get(client, zero_row)).json()

    assert missing["watch_items"] == empty["watch_items"] == []
    assert missing["no_flags"] == empty["no_flags"] is True
    # Both have a zero record count, so both get the same authored caveat.
    assert missing["confidence_note"] == empty["confidence_note"]
    assert "no HPD records on file" in missing["confidence_note"]
    assert missing["has_records"] == empty["has_records"] is False


@pytest.mark.asyncio
async def test_has_records_splits_the_two_empty_states(client):
    """A building with records that flagged nothing is NOT an empty building.

    The frontend renders a different sentence for each, and must not have to
    match confidence_note's wording to tell them apart.
    """
    with_records = (await _get(client, QUIET_ROW)).json()
    assert with_records["no_flags"] is True
    assert with_records["has_records"] is True

    no_records = (await _get(client, None)).json()
    assert no_records["no_flags"] is True
    assert no_records["has_records"] is False


@pytest.mark.asyncio
async def test_confidence_note_is_independent_of_watch_items(client):
    """A building can flag nothing and still warrant "we have little on this".

    Pinned because the tempting simplification — skip the note when no rules
    fire — removes it from exactly the buildings whose emptiness most needs
    explaining.
    """
    thin = {**QUIET_ROW, "hpd_record_count": 1}
    resp = await _get(client, thin)
    data = resp.json()
    assert data["no_flags"] is True
    assert data["confidence_note"]


def test_route_signal_keys_match_smoke_to_signals():
    """The route and smoke.py must build the same signal dict.

    smoke.py is where every measurement in BRIEF_ROLLOUT.md came from; the route
    is what renters see. A key present in one and not the other is a rule that
    fires in the measurements and never on the site, or the reverse — and
    neither shows up as an error, because rules.yaml only reads what it needs.
    """
    smoke_keys = set(to_signals({
        **SIGNALS_ROW,
        "total_violations": 1, "total_complaints": 1,
        "latest_violation_date": date(2026, 5, 1),
        "latest_complaint_date": None,
    }))
    # Mirrors the dict built in routes/hpd.py::get_hpd_building_brief.
    route_keys = {
        "open_class_c_violations", "heat_hot_water_complaints",
        "mold_complaints", "pest_complaints", "lead_paint_violations",
        "smoke_co_detector_violations", "hpd_record_count",
        "latest_hpd_activity",
        # Not a `when` predicate input — read by the class C suppression layer.
        "open_class_c_categories",
    }
    assert route_keys == smoke_keys


@pytest.mark.asyncio
async def test_brief_line_is_verbatim_from_rules_yaml(client):
    """Layer 1 is authored too, and carries the same verbatim guarantee.

    It is the line most readers will see and the only one many will read, so it
    is the LAST place a paraphrase should be allowed to creep in.
    """
    resp = await _get(client, SIGNALS_ROW)
    by_id = {r.id: r for r in rules_mod.load_rules()[0]}
    for item in resp.json()["watch_items"]:
        assert item["brief_line"] == by_id[item["rule_id"]].brief_line


def test_every_rule_authors_a_brief_line_and_keeps_it_short():
    """A missing brief_line is legal (falls back to `condition`), but a rule
    that has one must keep it to roughly one line — the whole point of layer 1.
    """
    for rule in rules_mod.load_rules()[0]:
        assert rule.brief_line, f"{rule.id} has no brief_line"
        words = len(rule.brief_line.split())
        assert words <= 16, f"{rule.id} brief_line is {words} words: {rule.brief_line}"


def test_brief_line_carries_no_digits():
    """No numbers in layer 1 — the cards on the same page own every count."""
    for rule in rules_mod.load_rules()[0]:
        assert not any(c.isdigit() for c in rule.brief_line), rule.id
