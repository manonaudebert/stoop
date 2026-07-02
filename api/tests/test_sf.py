"""
Tests for the SF routes (/sf/*).

Covers:
  - Building detail: combined complaints + violations, 404 handling
  - Leaderboard shape
  - Timeline endpoints
  - Breakdown endpoints
"""
from datetime import date

import pytest

from database import get_db
from main import app
from tests.conftest import MockRow, MockResult, make_mock_db, db_override


SAMPLE_MAPBLKLOT = "0001001"

SF_COMPLAINTS_SUMMARY_ROW = {
    "mapblklot":              SAMPLE_MAPBLKLOT,
    "address":                "123 MARKET ST",
    "neighborhood":           "Financial District/South Beach",
    "latitude":               37.7900,
    "longitude":              -122.3960,
    "total_complaints":       45,
    "recent_complaint_count": 12,
    "prior_complaint_count":  8,
    "trend_direction":        "worsening",
    "heat_complaints":        5,
    "lead_complaints":        1,
    "pest_complaints":        3,
    "latest_complaint_date":  date(2025, 11, 1),
    "complaints_density_pct": 72.0,
    "risk_level":             "High",
}

SF_VIOLATIONS_SUMMARY_ROW = {
    "mapblklot":              SAMPLE_MAPBLKLOT,
    "address":                "123 MARKET ST",
    "neighborhood":           "Financial District/South Beach",
    "latitude":               37.7900,
    "longitude":              -122.3960,
    "total_violations":       20,
    "open_violations":        5,
    "open_lead_violations":   1,
    "open_fire_violations":   0,
    "latest_violation_date":  date(2025, 10, 15),
    "violations_density_pct": 65.0,
    "risk_level":             "Moderate",
}

SF_COMPLAINT_ROW = {
    "service_request_id": "SR001",
    "service_name":        "Residential Building",
    "service_subtype":     "heat_lack_of_heat",
    "address":             "123 MARKET ST",
    "requested_datetime":  "2025-11-01T10:00:00+00:00",
    "status_description":  "Resolved",
}

SF_NOV_ROW = {
    "row_id":                    "ROW001",
    "mapblklot":                 SAMPLE_MAPBLKLOT,
    "status":                    "active",
    "nov_category_description":  "fire section",
    "item":                      "smoke detectors (1006 hc)",
    "nov_item_description":      "install smoke detectors in all sleeping rooms",
    "date_filed":                date(2025, 10, 15),
    "neighborhood":              "Financial District/South Beach",
    "location_lat":              37.7900,
    "location_lon":              -122.3960,
}


class TestSfBuildingDetail:
    @pytest.mark.asyncio
    async def test_returns_combined_data(self, client):
        mock_db = make_mock_db(
            # complaints summary
            MockResult([MockRow(SF_COMPLAINTS_SUMMARY_ROW)]),
            # violations summary
            MockResult([MockRow(SF_VIOLATIONS_SUMMARY_ROW)]),
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        resp = await client.get(f"/sf/building/{SAMPLE_MAPBLKLOT}")
        app.dependency_overrides.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert data["mapblklot"] == SAMPLE_MAPBLKLOT
        assert data["address"] == "123 MARKET ST"
        assert data["total_complaints"] == 45
        assert data["open_violations"] == 5
        assert data["complaints_risk_level"] == "High"
        assert data["violations_risk_level"] == "Moderate"

    @pytest.mark.asyncio
    async def test_404_when_parcel_unknown_to_eas(self, client):
        mock_db = make_mock_db(
            MockResult([]),  # complaints summary empty
            MockResult([]),  # violations summary empty
            MockResult([]),  # EAS address corpus empty → genuine 404
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        resp = await client.get("/sf/building/9999999")
        app.dependency_overrides.clear()

        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_zero_records_but_eas_resolves_returns_shell(self, client):
        # EAS resolves the address, so a parcel with no complaints/violations is
        # a valid clean-building page, not a 404.
        mock_db = make_mock_db(
            MockResult([]),  # complaints summary empty
            MockResult([]),  # violations summary empty
            MockResult([MockRow({
                "mapblklot": SAMPLE_MAPBLKLOT,
                "address": "500 CLEAN ST",
                "neighborhood": "Mission",
                "latitude": 37.75,
                "longitude": -122.41,
            })]),
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        resp = await client.get(f"/sf/building/{SAMPLE_MAPBLKLOT}")
        app.dependency_overrides.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert data["address"] == "500 CLEAN ST"
        assert data["total_complaints"] == 0
        assert data["total_violations"] == 0
        assert data["complaints"] == []
        assert data["violations"] == []

    @pytest.mark.asyncio
    async def test_works_with_only_violations(self, client):
        mock_db = make_mock_db(
            MockResult([]),                                 # no complaints
            MockResult([MockRow(SF_VIOLATIONS_SUMMARY_ROW)]),  # violations only
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        resp = await client.get(f"/sf/building/{SAMPLE_MAPBLKLOT}")
        app.dependency_overrides.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert data["total_complaints"] == 0
        assert data["total_violations"] == 20
        assert data["violations_risk_level"] == "Moderate"

    @pytest.mark.asyncio
    async def test_show_complaints_fetches_raw_records(self, client):
        mock_db = make_mock_db(
            MockResult([MockRow(SF_COMPLAINTS_SUMMARY_ROW)]),  # complaints summary
            MockResult([MockRow(SF_VIOLATIONS_SUMMARY_ROW)]),  # violations summary
            MockResult(scalar_value=1),                        # COUNT(*)
            MockResult([MockRow(SF_COMPLAINT_ROW)]),           # raw complaints
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        resp = await client.get(f"/sf/building/{SAMPLE_MAPBLKLOT}?show=complaints")
        app.dependency_overrides.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert data["complaints_total_count"] == 1
        assert len(data["complaints"]) == 1
        assert data["complaints"][0]["service_subtype"] == "heat_lack_of_heat"

    @pytest.mark.asyncio
    async def test_show_violations_fetches_raw_records(self, client):
        mock_db = make_mock_db(
            MockResult([MockRow(SF_COMPLAINTS_SUMMARY_ROW)]),  # complaints summary
            MockResult([MockRow(SF_VIOLATIONS_SUMMARY_ROW)]),  # violations summary
            MockResult(scalar_value=1),                        # COUNT(*)
            MockResult([MockRow(SF_NOV_ROW)]),                 # raw violations
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        resp = await client.get(f"/sf/building/{SAMPLE_MAPBLKLOT}?show=violations")
        app.dependency_overrides.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert data["violations_total_count"] == 1
        assert len(data["violations"]) == 1
        assert data["violations"][0]["nov_category_description"] == "fire section"

    @pytest.mark.asyncio
    async def test_violations_open_status_filter(self, client):
        mock_db = make_mock_db(
            MockResult([MockRow(SF_COMPLAINTS_SUMMARY_ROW)]),  # complaints summary
            MockResult([MockRow(SF_VIOLATIONS_SUMMARY_ROW)]),  # violations summary
            MockResult(scalar_value=1),                        # filtered COUNT(*)
            MockResult([MockRow(SF_NOV_ROW)]),                 # filtered raw violations
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        resp = await client.get(f"/sf/building/{SAMPLE_MAPBLKLOT}?show=violations&vst=Open")
        app.dependency_overrides.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert data["violations_total_count"] == 1


class TestSfLeaderboard:
    @pytest.mark.asyncio
    async def test_returns_list_of_summaries(self, client):
        mock_db = make_mock_db(
            MockResult([
                MockRow({
                    **SF_COMPLAINTS_SUMMARY_ROW,
                    "complaints_risk_level": SF_COMPLAINTS_SUMMARY_ROW["risk_level"],
                    **{k: SF_VIOLATIONS_SUMMARY_ROW[k]
                       for k in SF_VIOLATIONS_SUMMARY_ROW if k not in SF_COMPLAINTS_SUMMARY_ROW},
                    "violations_risk_level": SF_VIOLATIONS_SUMMARY_ROW["risk_level"],
                })
            ]),
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        resp = await client.get("/sf/building/leaderboard")
        app.dependency_overrides.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert data[0]["mapblklot"] == SAMPLE_MAPBLKLOT


class TestSfTimelines:
    @pytest.mark.asyncio
    async def test_complaints_timeline(self, client):
        mock_db = make_mock_db(
            MockResult([MockRow({"month": "2025-01", "count": 3})]),
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        resp = await client.get(f"/sf/building/{SAMPLE_MAPBLKLOT}/complaints-timeline")
        app.dependency_overrides.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert data[0] == {"month": "2025-01", "count": 3}

    @pytest.mark.asyncio
    async def test_violations_timeline(self, client):
        mock_db = make_mock_db(
            MockResult([MockRow({"month": "2024-06", "count": 2})]),
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        resp = await client.get(f"/sf/building/{SAMPLE_MAPBLKLOT}/violations-timeline")
        app.dependency_overrides.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert data[0] == {"month": "2024-06", "count": 2}


class TestSfBreakdowns:
    @pytest.mark.asyncio
    async def test_complaints_breakdown(self, client):
        mock_db = make_mock_db(
            MockResult([
                MockRow({"subtype": "heat_lack_of_heat", "count": 5}),
                MockRow({"subtype": "mold_and_mildew",   "count": 3}),
            ]),
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        resp = await client.get(f"/sf/building/{SAMPLE_MAPBLKLOT}/complaints-breakdown")
        app.dependency_overrides.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert data[0]["subtype"] == "heat_lack_of_heat"
        assert data[0]["count"] == 5

    @pytest.mark.asyncio
    async def test_violations_breakdown(self, client):
        mock_db = make_mock_db(
            MockResult([
                MockRow({"category": "fire section", "count": 4, "open_count": 2}),
            ]),
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        resp = await client.get(f"/sf/building/{SAMPLE_MAPBLKLOT}/violations-breakdown")
        app.dependency_overrides.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert data[0]["category"] == "fire section"
        assert data[0]["open_count"] == 2
