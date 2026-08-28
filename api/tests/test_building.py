"""
Tests for the DOB building routes (/building/*).

Covers:
  - Unit tests for _normalize and _search_patterns (address search helpers)
  - API shape + correctness tests for key building endpoints
  - 404 handling for unknown BINs / missing NTA data
"""
from datetime import date

import pytest

from routes.building import _normalize, _search_patterns
from database import get_db
from main import app
from tests.conftest import MockRow, MockResult, make_mock_db, db_override


# ---------------------------------------------------------------------------
# Shared mock data
# ---------------------------------------------------------------------------

SAMPLE_BIN = "1099042"

BUILDING_SUMMARY_ROW = {
    "bin": SAMPLE_BIN,
    "address": "123 TEST ST",
    "zip_code": "10001",
    "borough": "MANHATTAN",
    "latitude": 40.7128,
    "longitude": -74.0060,
    "total_complaints": 10,
    "open_complaints": 3,
    "closed_complaints": 7,
    "priority_a_complaints": 2,
    "priority_ab_complaints": 5,
    "priority_ab_2yr": 3,
    "open_priority_a_complaints": 1,
    "open_priority_b_complaints": 2,
    "no_access_count_5yr": 0,
    "closed_5yr_complaints": 4,
    "first_complaint_date": date(2015, 1, 1),
    "latest_complaint_date": date(2024, 6, 1),
    "construction_year": "1960",
    "nta_code": "MN2501",
    "nta_name": "Hudson Yards",
    "risk_level": "High",
    "serious_rate": 0.4,
    "serious_rate_percentile": 70.0,
    # DB stores "worsening" / "improving" / "stable"; the frontend maps these to arrows
    "trend_direction": "worsening",
    "recent_complaint_count": 4,
    "prior_complaint_count": 3,
    "normalized_percentile": 75.0,
    "normalized_serious_rate_percentile": 68.0,
}

UNIFIED_SEARCH_ROW = {
    "bin": SAMPLE_BIN,
    "address": "123 TEST ST",
    "borough": "MANHATTAN",
    "zip_code": "10001",
    "nta_code": "MN2501",
    "latitude": 40.7128,
    "longitude": -74.0060,
    "dob_risk_level": "High",
    "dob_total": 10,
    "dob_open": 3,
    "dob_priority_a": 2,
    "hpd_risk_level": "Moderate",
    "hpd_total": 8,
    "hpd_open": 2,
    "hpd_open_emergency": 1,
}

COMPLAINT_ROW = {
    "id": 1,
    "complaint_number": "99001",
    "status": "Open",
    "date_entered": date(2024, 3, 10),
    "address": "123 TEST ST",
    "zip_code": "10001",
    "bin": SAMPLE_BIN,
    "community_board": "4",
    "complaint_category": "15",
    "category_description": "Elevator",
    "category_priority": "B",
    "unit": "2F",
    "disposition_date": None,
    "disposition_code": None,
    "disposition_description": None,
    "inspection_date": None,
    "borough": "MANHATTAN",
}

TIMELINE_ROW = {"month": "2024-03", "count": 3}

BREAKDOWN_ROW = {
    "category": "15",
    "description": "Elevator",
    "priority": "B",
    "count": 5,
}

NEIGHBORHOOD_BUILDING_ROW = {
    "nta_code": "MN2501",
    "nta_name": "Hudson Yards",
    "nta_type": 2,
    "normalized_percentile": 75.0,
}

NEIGHBORHOOD_STATS_ROW = {
    "building_count": 120,
    "nta_type": 2,
    "median_serious_rate": 0.3,
}


# ---------------------------------------------------------------------------
# Unit tests: _normalize
# ---------------------------------------------------------------------------

class TestNormalize:
    def test_uppercases_input(self):
        # _normalize uppercases and strips ordinals, so "14th" → "14"
        assert _normalize("west 14th st") == "WEST 14 ST"

    def test_strips_ordinal_st(self):
        assert _normalize("81st Street") == "81 STREET"

    def test_strips_ordinal_nd(self):
        assert _normalize("2nd Ave") == "2 AVE"

    def test_strips_ordinal_rd(self):
        assert _normalize("3rd Ave") == "3 AVE"

    def test_strips_ordinal_th(self):
        assert _normalize("14th Street") == "14 STREET"

    def test_preserves_non_ordinal_numbers(self):
        assert _normalize("123 Main St") == "123 MAIN ST"

    def test_strips_leading_trailing_whitespace(self):
        assert _normalize("  Park Ave  ") == "PARK AVE"


# ---------------------------------------------------------------------------
# Unit tests: _search_patterns
# ---------------------------------------------------------------------------

class TestSearchPatterns:
    def test_returns_list_of_ilike_patterns(self):
        patterns = _search_patterns("park ave")
        assert all(p.startswith("%") and p.endswith("%") for p in patterns)

    def test_includes_normalized_form(self):
        """81st → 81 should appear in the patterns."""
        patterns = _search_patterns("west 81st")
        normalized_present = any("81" in p and "ST" not in p.split("81")[1][:3] for p in patterns)
        assert normalized_present

    def test_adds_direction_variant_west_to_w(self):
        """'WEST' in the normalized form should generate a '%W ...' variant."""
        patterns = _search_patterns("West 14th")
        values = [p.strip("%") for p in patterns]
        has_west = any("WEST" in v for v in values)
        has_w = any(v.startswith("W ") or " W " in v for v in values)
        assert has_west and has_w

    def test_adds_direction_variant_w_to_west(self):
        """Abbreviated 'W' should expand to 'WEST' as a variant."""
        patterns = _search_patterns("W 125th St")
        values = [p.strip("%") for p in patterns]
        assert any("WEST" in v for v in values)

    def test_no_duplicate_patterns(self):
        """Patterns should not contain exact duplicates."""
        patterns = _search_patterns("Park Ave")
        assert len(patterns) == len(set(patterns))


# ---------------------------------------------------------------------------
# API tests: GET /building/{bin}
# ---------------------------------------------------------------------------

class TestGetBuilding:
    async def test_happy_path_returns_200_with_expected_shape(self, client):
        mock_db = make_mock_db(
            MockResult([MockRow(BUILDING_SUMMARY_ROW)]),   # summary query
            MockResult(scalar_value=1),                    # count query
            MockResult([MockRow(COMPLAINT_ROW)]),          # complaints query
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/building/{SAMPLE_BIN}")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        data = resp.json()

        # Core identity fields
        assert data["bin"] == SAMPLE_BIN
        assert data["address"] == "123 TEST ST"
        assert data["borough"] == "MANHATTAN"

        # Pagination envelope
        assert data["page"] == 1
        assert data["page_size"] == 50
        assert data["total_count"] == 1

        # Complaints list
        assert len(data["complaints"]) == 1
        complaint = data["complaints"][0]
        assert complaint["complaint_number"] == "99001"
        assert complaint["status"] == "Open"

    async def test_returns_404_for_unknown_bin(self, client):
        # Route makes two queries when summary is missing: first building_summary,
        # then a fallback against the buildings table (added for HPD-only buildings).
        # Both must return empty to reach the 404 branch.
        mock_db = make_mock_db(MockResult([]), MockResult([]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get("/building/0000000")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 404

    async def test_complaint_metrics_are_correct(self, client):
        mock_db = make_mock_db(
            MockResult([MockRow(BUILDING_SUMMARY_ROW)]),
            MockResult(scalar_value=10),
            MockResult([]),
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/building/{SAMPLE_BIN}")
        finally:
            app.dependency_overrides.pop(get_db, None)

        data = resp.json()
        assert data["total_complaints"] == 10
        assert data["open_complaints"] == 3
        assert data["priority_a_complaints"] == 2
        assert data["normalized_percentile"] == 75.0

    async def test_hpd_only_building_returns_zero_complaint_stub(self, client):
        # building_summary has no row (no DOB complaints), but buildings table does.
        # Route should return 200 with zero-complaint stub rather than 404.
        fallback_row = {
            "bin": SAMPLE_BIN,
            "address": "123 TEST ST",
            "zip_code": "10001",
            "borough": "MANHATTAN",
            "latitude": 40.7128,
            "longitude": -74.0060,
            "nta_code": "MN2501",
            "nta_name": "Hudson Yards",
            "construction_year": "1980",
        }
        mock_db = make_mock_db(
            MockResult([]),                     # building_summary: miss
            MockResult([MockRow(fallback_row)]), # buildings table: hit
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/building/{SAMPLE_BIN}")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        data = resp.json()
        assert data["bin"] == SAMPLE_BIN
        assert data["total_complaints"] == 0
        assert data["open_complaints"] == 0
        assert data["complaints"] == []

    async def test_status_filter_is_forwarded(self, client):
        mock_db = make_mock_db(
            MockResult([MockRow(BUILDING_SUMMARY_ROW)]),
            MockResult(scalar_value=1),
            MockResult([MockRow({**COMPLAINT_ROW, "status": "Open"})]),
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/building/{SAMPLE_BIN}?status=Open")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        data = resp.json()
        assert data["complaints"][0]["status"] == "Open"


# ---------------------------------------------------------------------------
# API tests: GET /building/{bin}/timeline
# ---------------------------------------------------------------------------

class TestGetTimeline:
    async def test_returns_list_of_timeline_points(self, client):
        rows = [
            MockRow({"month": "2023-11", "count": 2}),
            MockRow({"month": "2024-03", "count": 3}),
        ]
        mock_db = make_mock_db(MockResult(rows))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/building/{SAMPLE_BIN}/timeline")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 2
        assert data[0] == {"month": "2023-11", "count": 2}
        assert data[1] == {"month": "2024-03", "count": 3}

    async def test_returns_empty_list_for_no_history(self, client):
        mock_db = make_mock_db(MockResult([]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/building/{SAMPLE_BIN}/timeline")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        assert resp.json() == []


# ---------------------------------------------------------------------------
# API tests: GET /building/{bin}/breakdown
# ---------------------------------------------------------------------------

class TestGetBreakdown:
    async def test_returns_category_breakdown(self, client):
        rows = [
            MockRow({"category": "15", "description": "Elevator", "priority": "B", "count": 5}),
            MockRow({"category": "01", "description": "Heating", "priority": "A", "count": 3}),
        ]
        mock_db = make_mock_db(MockResult(rows))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/building/{SAMPLE_BIN}/breakdown")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert data[0]["category"] == "15"
        assert data[0]["count"] == 5
        assert data[1]["category"] == "01"

    async def test_breakdown_with_years_filter(self, client):
        mock_db = make_mock_db(MockResult([MockRow(BREAKDOWN_ROW)]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/building/{SAMPLE_BIN}/breakdown?years=5")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        data = resp.json()
        assert data[0]["count"] == 5


# ---------------------------------------------------------------------------
# API tests: GET /building/{bin}/neighborhood
# ---------------------------------------------------------------------------

class TestGetNeighborhood:
    async def test_returns_nta_stats(self, client):
        mock_db = make_mock_db(
            MockResult([MockRow(NEIGHBORHOOD_BUILDING_ROW)]),  # building NTA query
            MockResult([MockRow(NEIGHBORHOOD_STATS_ROW)]),     # nta_stats query
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/building/{SAMPLE_BIN}/neighborhood")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        data = resp.json()
        assert data["nta_code"] == "MN2501"
        assert data["nta_name"] == "Hudson Yards"
        assert data["nta_percentile"] == 75.0
        assert data["building_count"] == 120
        assert data["median_serious_rate"] == pytest.approx(0.3)

    async def test_returns_404_when_building_has_no_nta(self, client):
        # Building row exists but nta_code is None
        row_no_nta = {**NEIGHBORHOOD_BUILDING_ROW, "nta_code": None}
        mock_db = make_mock_db(MockResult([MockRow(row_no_nta)]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/building/{SAMPLE_BIN}/neighborhood")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 404

    async def test_returns_404_when_building_not_found(self, client):
        mock_db = make_mock_db(MockResult([]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/building/0000000/neighborhood")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# API tests: GET /building/leaderboard-recent
# ---------------------------------------------------------------------------

# Minimal leaderboard row — only columns the query SELECTs (others use Pydantic defaults)
LEADERBOARD_ROW = {
    "bin": SAMPLE_BIN,
    "address": "123 TEST ST",
    "zip_code": "10001",
    "borough": "MANHATTAN",
    "latitude": 40.7128,
    "longitude": -74.0060,
    "total_complaints": 20,
    "open_complaints": 5,
    "closed_complaints": 15,
    "priority_a_complaints": 3,
    "priority_ab_complaints": 8,
    "priority_ab_2yr": 4,
    "open_priority_a_complaints": 1,
    "open_priority_b_complaints": 2,
    "first_complaint_date": date(2015, 1, 1),
    "latest_complaint_date": date(2024, 6, 1),
    "recent_complaint_count": 6,
    "prior_complaint_count": 4,
    "trend_direction": "worsening",
    "risk_level": "High",
    "nta_code": "MN2501",
    "nta_name": "Hudson Yards",
    "normalized_percentile": 82.0,
}


# ---------------------------------------------------------------------------
# API tests: GET /building/search
# ---------------------------------------------------------------------------

class TestSearchBuildings:
    async def test_exact_match_returns_results(self, client):
        mock_db = make_mock_db(MockResult([MockRow(UNIFIED_SEARCH_ROW)]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get("/building/search?q=123+TEST+ST")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["address"] == "123 TEST ST"
        assert data[0]["dob_risk_level"] == "High"
        assert data[0]["hpd_risk_level"] == "Moderate"

    async def test_fuzzy_fallback_when_ilike_returns_nothing(self, client):
        # Phase 1 (ILIKE) returns nothing; phase 2 (trigram) finds a match.
        mock_db = make_mock_db(
            MockResult([]),
            MockResult([MockRow(UNIFIED_SEARCH_ROW)]),
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get("/building/search?q=brodway")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["bin"] == SAMPLE_BIN
        assert data[0]["dob_total"] == 10
        assert data[0]["hpd_total"] == 8

    async def test_empty_when_both_phases_miss(self, client):
        mock_db = make_mock_db(MockResult([]), MockResult([]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get("/building/search?q=zzzzzzz")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        assert resp.json() == []

    async def test_hpd_only_result_is_returned(self, client):
        row = MockRow({
            **UNIFIED_SEARCH_ROW,
            "dob_risk_level": None,
            "dob_total": None,
            "dob_open": None,
            "dob_priority_a": None,
        })
        mock_db = make_mock_db(MockResult([row]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get("/building/search?q=123+TEST+ST")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["dob_risk_level"] is None
        assert data[0]["hpd_risk_level"] == "Moderate"


class TestGetLeaderboardRecent:
    async def test_returns_ranked_list(self, client):
        rows = [
            MockRow({**LEADERBOARD_ROW, "bin": "1000001", "recent_complaint_count": 8}),
            MockRow({**LEADERBOARD_ROW, "bin": "1000002", "recent_complaint_count": 6}),
        ]
        mock_db = make_mock_db(MockResult(rows))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get("/building/leaderboard-recent")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 2
        # First row has higher recent_complaint_count — leaderboard is ordered DESC
        assert data[0]["recent_complaint_count"] == 8
        assert data[1]["recent_complaint_count"] == 6

    async def test_includes_trend_and_priority_fields(self, client):
        mock_db = make_mock_db(MockResult([MockRow(LEADERBOARD_ROW)]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get("/building/leaderboard-recent")
        finally:
            app.dependency_overrides.pop(get_db, None)

        data = resp.json()
        assert len(data) == 1
        row = data[0]
        assert row["trend_direction"] == "worsening"
        assert row["priority_ab_2yr"] == 4
        assert row["normalized_percentile"] == pytest.approx(82.0)

    async def test_returns_empty_list_when_no_results(self, client):
        mock_db = make_mock_db(MockResult([]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get("/building/leaderboard-recent")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        assert resp.json() == []

    async def test_borough_filter_is_accepted(self, client):
        rows = [MockRow({**LEADERBOARD_ROW, "borough": "BROOKLYN"})]
        mock_db = make_mock_db(MockResult(rows))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get("/building/leaderboard-recent?borough=Brooklyn")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["borough"] == "BROOKLYN"
