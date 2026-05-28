"""
Tests for the HPD violations routes (/hpd/*).

Covers:
  - Unit tests for _hpd_risk_tier (all four tier outcomes)
  - API shape + correctness tests for the building detail endpoint
  - 404 handling and sub-resource endpoints (timeline, open-ages, breakdown)
"""
from datetime import date

import pytest

from routes.hpd import _hpd_risk_tier
from database import get_db
from main import app
from tests.conftest import MockRow, MockResult, make_mock_db, db_override


# ---------------------------------------------------------------------------
# Shared mock data
# ---------------------------------------------------------------------------

SAMPLE_BIN = "1099042"

HPD_SUMMARY_ROW = {
    "bin": SAMPLE_BIN,
    "address": "123 TEST ST",
    "zip_code": "10001",
    "borough": "MANHATTAN",
    "latitude": 40.7128,
    "longitude": -74.0060,
    "nta_code": "MN2501",
    "nta_name": "Hudson Yards",
    "total_violations": 15,
    "open_violations": 5,
    "class_a_violations": 2,
    "class_b_violations": 3,
    "rent_impairing_count": 1,
    "latest_violation_date": date(2024, 5, 20),
    "violations_density_pct": 60.0,
}

HPD_VIOLATION_ROW = {
    "violation_id": "V001",
    "bin": SAMPLE_BIN,
    "apartment": "3B",
    "violation_class": "C",
    "nov_issued_date": date(2023, 8, 1),
    "current_status": "Open",
    "current_status_date": date(2024, 1, 1),
    "violation_status": "Open",
    "rent_impairing": "Y",
    "nov_description": "HEAT NOT PROVIDED",
    "order_number": "123",
    "order_category": "Heat",
    "order_short_description": "Provide heat",
    "inspection_date": None,
    "approved_date": None,
    "certified_date": None,
}


# ---------------------------------------------------------------------------
# Unit tests: _hpd_risk_tier
# ---------------------------------------------------------------------------

class TestHpdRiskTier:
    def test_resolved_when_no_open_violations(self):
        assert _hpd_risk_tier(class_a=0, class_b=0, open_count=0) == "Resolved"

    def test_emergency_when_class_a_open(self):
        assert _hpd_risk_tier(class_a=1, class_b=0, open_count=3) == "Emergency"

    def test_emergency_takes_priority_over_class_b(self):
        """Class A is always Emergency regardless of Class B count."""
        assert _hpd_risk_tier(class_a=2, class_b=5, open_count=10) == "Emergency"

    def test_hazardous_when_class_b_open_no_class_a(self):
        assert _hpd_risk_tier(class_a=0, class_b=2, open_count=2) == "Hazardous"

    def test_non_hazardous_when_only_class_c_open(self):
        """Open violations but no Class A or B → Non-hazardous."""
        assert _hpd_risk_tier(class_a=0, class_b=0, open_count=4) == "Non-hazardous"

    def test_resolved_overrides_class_counts_when_nothing_open(self):
        """class_a/class_b counts shouldn't matter if open_count is 0."""
        assert _hpd_risk_tier(class_a=5, class_b=5, open_count=0) == "Resolved"


# ---------------------------------------------------------------------------
# API tests: GET /hpd/building/{bin}
# ---------------------------------------------------------------------------

class TestGetHpdBuilding:
    async def test_happy_path_returns_200_with_expected_shape(self, client):
        mock_db = make_mock_db(
            MockResult([MockRow(HPD_SUMMARY_ROW)]),     # summary query
            MockResult(scalar_value=1),                  # count query
            MockResult([MockRow(HPD_VIOLATION_ROW)]),   # violations query
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/hpd/building/{SAMPLE_BIN}")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        data = resp.json()

        assert data["bin"] == SAMPLE_BIN
        assert data["total_violations"] == 15
        assert data["open_violations"] == 5
        assert data["class_a_violations"] == 2
        assert data["rent_impairing_count"] == 1
        assert data["page"] == 1
        assert data["total_count"] == 1

    async def test_risk_tier_is_computed_from_class_counts(self, client):
        """With class_a=2 and open_violations=5, tier must be Emergency."""
        mock_db = make_mock_db(
            MockResult([MockRow(HPD_SUMMARY_ROW)]),
            MockResult(scalar_value=0),
            MockResult([]),
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/hpd/building/{SAMPLE_BIN}")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.json()["hpd_risk_tier"] == "Emergency"

    async def test_violation_fields_are_present(self, client):
        mock_db = make_mock_db(
            MockResult([MockRow(HPD_SUMMARY_ROW)]),
            MockResult(scalar_value=1),
            MockResult([MockRow(HPD_VIOLATION_ROW)]),
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/hpd/building/{SAMPLE_BIN}")
        finally:
            app.dependency_overrides.pop(get_db, None)

        v = resp.json()["violations"][0]
        assert v["violation_id"] == "V001"
        assert v["violation_class"] == "C"
        assert v["rent_impairing"] == "Y"
        assert v["nov_description"] == "HEAT NOT PROVIDED"

    async def test_returns_404_for_unknown_bin(self, client):
        mock_db = make_mock_db(MockResult([]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get("/hpd/building/0000000")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 404

    async def test_resolved_tier_when_no_open_violations(self, client):
        resolved_summary = {**HPD_SUMMARY_ROW, "class_a_violations": 0, "class_b_violations": 0, "open_violations": 0}
        mock_db = make_mock_db(
            MockResult([MockRow(resolved_summary)]),
            MockResult(scalar_value=0),
            MockResult([]),
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/hpd/building/{SAMPLE_BIN}")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.json()["hpd_risk_tier"] == "Resolved"


# ---------------------------------------------------------------------------
# API tests: GET /hpd/building/{bin}/timeline
# ---------------------------------------------------------------------------

class TestGetHpdTimeline:
    async def test_returns_monthly_counts(self, client):
        rows = [
            MockRow({"month": "2022-01", "count": 1}),
            MockRow({"month": "2023-06", "count": 4}),
        ]
        mock_db = make_mock_db(MockResult(rows))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/hpd/building/{SAMPLE_BIN}/timeline")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        data = resp.json()
        assert data == [{"month": "2022-01", "count": 1}, {"month": "2023-06", "count": 4}]

    async def test_returns_empty_list_for_no_violations(self, client):
        mock_db = make_mock_db(MockResult([]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/hpd/building/{SAMPLE_BIN}/timeline")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        assert resp.json() == []


# ---------------------------------------------------------------------------
# API tests: GET /hpd/building/{bin}/open-ages
# ---------------------------------------------------------------------------

class TestGetHpdOpenAges:
    async def test_returns_age_buckets_in_order(self, client):
        rows = [
            MockRow({"bucket": "<30d",   "count": 1}),
            MockRow({"bucket": "30-90d", "count": 2}),
            MockRow({"bucket": "3yr+",   "count": 5}),
        ]
        mock_db = make_mock_db(MockResult(rows))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/hpd/building/{SAMPLE_BIN}/open-ages")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        data = resp.json()
        buckets = [item["bucket"] for item in data]
        # Should be sorted by the canonical bucket order, not DB order
        assert buckets == ["<30d", "30-90d", "3yr+"]


# ---------------------------------------------------------------------------
# API tests: GET /hpd/building/{bin}/breakdown
# ---------------------------------------------------------------------------

class TestGetHpdBreakdown:
    async def test_returns_violation_class_breakdown(self, client):
        rows = [
            MockRow({"violation_class": "C", "category": "Heat",    "count": 8, "open_count": 4}),
            MockRow({"violation_class": "B", "category": "Plumbing", "count": 3, "open_count": 1}),
        ]
        mock_db = make_mock_db(MockResult(rows))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/hpd/building/{SAMPLE_BIN}/breakdown")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert data[0]["violation_class"] == "C"
        assert data[0]["count"] == 8
        assert data[0]["open_count"] == 4
