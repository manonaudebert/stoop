"""
Tests for the HPD complaints routes (/hpd-complaints/*).

Covers:
  - Unit tests for _complaint_risk_tier (all three tier outcomes)
  - API shape + correctness tests for the building detail endpoint
  - 404 handling and sub-resource endpoints (timeline, breakdown)
"""
from datetime import date

import pytest

from routes.hpd_complaints import _complaint_risk_tier
from database import get_db
from main import app
from tests.conftest import MockRow, MockResult, make_mock_db, db_override


# ---------------------------------------------------------------------------
# Shared mock data
# ---------------------------------------------------------------------------

SAMPLE_BIN = "1099042"

HPD_COMPLAINT_SUMMARY_ROW = {
    "bin": SAMPLE_BIN,
    "address": "123 TEST ST",
    "zip_code": "10001",
    "borough": "MANHATTAN",
    "latitude": 40.7128,
    "longitude": -74.0060,
    "nta_code": "MN2501",
    "nta_name": "Hudson Yards",
    "total_complaints": 8,
    "open_complaints": 2,
    "open_emergency_complaints": 1,
    "heat_complaints": 3,
    "latest_complaint_date": date(2024, 4, 15),
    "complaints_density_pct": 55.0,
    "risk_level": "Moderate",
}

HPD_COMPLAINT_ROW = {
    "problem_id": "P001",
    "complaint_id": "C001",
    "bin": SAMPLE_BIN,
    "apartment": "2A",
    "unit_type": "APARTMENT",
    "space_type": "BATHROOM",
    "type": "EMERGENCY",
    "major_category": "PLUMBING",
    "minor_category": "WATER SUPPLY",
    "complaint_status": "Open",
    "complaint_status_date": date(2024, 4, 15),
    "problem_status": "Open",
    "problem_status_date": date(2024, 4, 15),
    "status_description": "The condition is still open.",
    "received_date": date(2024, 4, 10),
}


# ---------------------------------------------------------------------------
# Unit tests: _complaint_risk_tier
# ---------------------------------------------------------------------------

class TestComplaintRiskTier:
    def test_resolved_when_nothing_open(self):
        assert _complaint_risk_tier(open_emergency=0, open_count=0) == "Resolved"

    def test_emergency_when_open_emergency_present(self):
        assert _complaint_risk_tier(open_emergency=1, open_count=1) == "Emergency"

    def test_emergency_regardless_of_total_open_count(self):
        assert _complaint_risk_tier(open_emergency=3, open_count=10) == "Emergency"

    def test_active_when_open_but_no_emergency(self):
        assert _complaint_risk_tier(open_emergency=0, open_count=5) == "Active"

    def test_active_with_single_open_complaint(self):
        assert _complaint_risk_tier(open_emergency=0, open_count=1) == "Active"


# ---------------------------------------------------------------------------
# API tests: GET /hpd-complaints/building/{bin}
# ---------------------------------------------------------------------------

class TestGetHpdComplaintBuilding:
    async def test_happy_path_returns_200_with_expected_shape(self, client):
        mock_db = make_mock_db(
            MockResult([MockRow(HPD_COMPLAINT_SUMMARY_ROW)]),  # summary query
            MockResult(scalar_value=1),                         # count query
            MockResult([MockRow(HPD_COMPLAINT_ROW)]),           # complaints query
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/hpd-complaints/building/{SAMPLE_BIN}")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        data = resp.json()

        assert data["bin"] == SAMPLE_BIN
        assert data["total_complaints"] == 8
        assert data["open_complaints"] == 2
        assert data["open_emergency_complaints"] == 1
        assert data["heat_complaints"] == 3
        assert data["page"] == 1
        assert data["total_count"] == 1

    async def test_risk_tier_computed_from_emergency_count(self, client):
        """With open_emergency_complaints=1, tier must be Emergency."""
        mock_db = make_mock_db(
            MockResult([MockRow(HPD_COMPLAINT_SUMMARY_ROW)]),
            MockResult(scalar_value=0),
            MockResult([]),
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/hpd-complaints/building/{SAMPLE_BIN}")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.json()["complaint_risk_tier"] == "Emergency"

    async def test_resolved_tier_when_nothing_open(self, client):
        resolved_summary = {
            **HPD_COMPLAINT_SUMMARY_ROW,
            "open_complaints": 0,
            "open_emergency_complaints": 0,
        }
        mock_db = make_mock_db(
            MockResult([MockRow(resolved_summary)]),
            MockResult(scalar_value=0),
            MockResult([]),
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/hpd-complaints/building/{SAMPLE_BIN}")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.json()["complaint_risk_tier"] == "Resolved"

    async def test_complaint_fields_are_present(self, client):
        mock_db = make_mock_db(
            MockResult([MockRow(HPD_COMPLAINT_SUMMARY_ROW)]),
            MockResult(scalar_value=1),
            MockResult([MockRow(HPD_COMPLAINT_ROW)]),
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/hpd-complaints/building/{SAMPLE_BIN}")
        finally:
            app.dependency_overrides.pop(get_db, None)

        c = resp.json()["complaints"][0]
        assert c["problem_id"] == "P001"
        assert c["major_category"] == "PLUMBING"
        assert c["type"] == "EMERGENCY"
        assert c["complaint_status"] == "Open"

    async def test_returns_404_for_unknown_bin(self, client):
        mock_db = make_mock_db(MockResult([]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get("/hpd-complaints/building/0000000")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# API tests: GET /hpd-complaints/building/{bin}/timeline
# ---------------------------------------------------------------------------

class TestGetHpdComplaintTimeline:
    async def test_returns_monthly_counts(self, client):
        rows = [
            MockRow({"month": "2023-09", "count": 2}),
            MockRow({"month": "2024-04", "count": 4}),
        ]
        mock_db = make_mock_db(MockResult(rows))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/hpd-complaints/building/{SAMPLE_BIN}/timeline")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        data = resp.json()
        assert data == [{"month": "2023-09", "count": 2}, {"month": "2024-04", "count": 4}]

    async def test_returns_empty_list_for_no_history(self, client):
        mock_db = make_mock_db(MockResult([]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/hpd-complaints/building/{SAMPLE_BIN}/timeline")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        assert resp.json() == []


# ---------------------------------------------------------------------------
# API tests: GET /hpd-complaints/building/{bin}/breakdown
# ---------------------------------------------------------------------------

class TestGetHpdComplaintBreakdown:
    async def test_returns_category_breakdown(self, client):
        rows = [
            MockRow({"type": "EMERGENCY",     "major_category": "PLUMBING", "count": 4, "open_count": 2}),
            MockRow({"type": "NON EMERGENCY", "major_category": "PAINT",    "count": 2, "open_count": 0}),
        ]
        mock_db = make_mock_db(MockResult(rows))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/hpd-complaints/building/{SAMPLE_BIN}/breakdown")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert data[0]["major_category"] == "PLUMBING"
        assert data[0]["count"] == 4
        assert data[0]["open_count"] == 2
        assert data[0]["type"] == "EMERGENCY"
