"""
Tests for the SF routes (/sf/*).

Covers:
  - Map clusters: bbox vs. citywide paths, risk compositing, null-coord skip
  - Building search: EAS ILIKE hit + trgm fallback
  - Building detail: combined complaints + violations, 404 handling
  - Leaderboard shape + neighborhood filter
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
    "severe_complaints_5yr":  4,
    "serious_complaints_5yr": 6,
    "minor_complaints_5yr":   2,
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
    "open_severe_violations":  2,
    "open_serious_violations": 2,
    "open_minor_violations":   1,
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
    "complaint_number":          "202500001",
    "item_sequence_number":      "1",
    "mapblklot":                 SAMPLE_MAPBLKLOT,
    "status":                    "active",
    "receiving_division":        "Housing Inspection Services",
    "assigned_division":         "Housing Inspection Services",
    "nov_category_description":  "fire section",
    "item":                      "smoke detectors (1006 hc)",
    "nov_item_description":      "install smoke detectors in all sleeping rooms",
    "code_violation_desc":       None,
    "work_without_permit":       None,
    "additional_work_beyond_permit": None,
    "expired_permit":            None,
    "cancelled_permit":          None,
    "unsafe_building":           None,
    "date_filed":                date(2025, 10, 15),
    "neighborhood":              "Financial District/South Beach",
    "location_lat":              37.7900,
    "location_lon":              -122.3960,
}

# One row of the unified FULL OUTER JOIN projection used by /sf/map/clusters.
SF_CLUSTER_ROW = {
    "mapblklot":              SAMPLE_MAPBLKLOT,
    "address":                "123 MARKET ST",
    "neighborhood":           "Financial District/South Beach",
    "latitude":               37.7900,
    "longitude":              -122.3960,
    "total_complaints":       45,
    "complaints_5yr":         20,
    "severe_complaints_5yr":  4,
    "complaints_density_pct": 72.0,
    "complaints_risk_level":  "Moderate",
    "latest_complaint_date":  date(2025, 11, 1),
    "total_violations":       20,
    "open_violations":        5,
    "violations_density_pct": 65.0,
    "violations_risk_level":  "Very high",
}


class TestSfMapClusters:
    @pytest.mark.asyncio
    async def test_bbox_path_returns_geojson(self, client):
        # zoom >= CLUSTER_MAX_ZOOM (13) uses the single bbox query.
        mock_db = make_mock_db(MockResult([MockRow(SF_CLUSTER_ROW)]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        resp = await client.get(
            "/sf/map/clusters",
            params={"west": -122.5, "south": 37.7, "east": -122.3,
                    "north": 37.8, "zoom": 15},
        )
        app.dependency_overrides.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert data["type"] == "FeatureCollection"
        assert len(data["features"]) == 1
        feat = data["features"][0]
        assert feat["geometry"]["coordinates"] == [-122.3960, 37.7900]
        props = feat["properties"]
        assert props["mapblklot"] == SAMPLE_MAPBLKLOT
        assert props["complaints_present"] == 1
        assert props["complaints_5yr"] == 20
        assert props["severe_complaints_5yr"] == 4
        assert props["violations_present"] == 1
        # Composite risk picks the more severe of the two domains.
        assert props["risk_level"] == "Very high"

    @pytest.mark.asyncio
    async def test_citywide_path_low_zoom(self, client):
        # zoom < CLUSTER_MAX_ZOOM uses the deterministic per-neighborhood sample.
        mock_db = make_mock_db(MockResult([MockRow(SF_CLUSTER_ROW)]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        resp = await client.get(
            "/sf/map/clusters",
            params={"west": -122.5, "south": 37.7, "east": -122.3,
                    "north": 37.8, "zoom": 10},
        )
        app.dependency_overrides.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert len(data["features"]) == 1

    @pytest.mark.asyncio
    async def test_null_coordinates_are_skipped(self, client):
        no_coords = {**SF_CLUSTER_ROW, "latitude": None, "longitude": None}
        mock_db = make_mock_db(MockResult([MockRow(no_coords)]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        resp = await client.get(
            "/sf/map/clusters",
            params={"west": -122.5, "south": 37.7, "east": -122.3,
                    "north": 37.8, "zoom": 15},
        )
        app.dependency_overrides.clear()

        assert resp.status_code == 200
        assert resp.json()["features"] == []


class TestSfBuildingSearch:
    @pytest.mark.asyncio
    async def test_ilike_hit_returns_summaries(self, client):
        # ILIKE match on the EAS corpus, joined to both summary views.
        search_row = {
            **SF_COMPLAINTS_SUMMARY_ROW,
            "complaints_risk_level": SF_COMPLAINTS_SUMMARY_ROW["risk_level"],
            **{k: SF_VIOLATIONS_SUMMARY_ROW[k]
               for k in SF_VIOLATIONS_SUMMARY_ROW
               if k not in SF_COMPLAINTS_SUMMARY_ROW},
            "violations_risk_level": SF_VIOLATIONS_SUMMARY_ROW["risk_level"],
        }
        mock_db = make_mock_db(MockResult([MockRow(search_row)]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        resp = await client.get("/sf/building/search", params={"q": "123 Market St"})
        app.dependency_overrides.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["mapblklot"] == SAMPLE_MAPBLKLOT
        assert data[0]["address"] == "123 MARKET ST"

    @pytest.mark.asyncio
    async def test_trgm_fallback_when_ilike_empty(self, client):
        # First (ILIKE) query returns nothing → route runs the trgm fallback query.
        search_row = {
            **SF_COMPLAINTS_SUMMARY_ROW,
            "complaints_risk_level": SF_COMPLAINTS_SUMMARY_ROW["risk_level"],
            **{k: SF_VIOLATIONS_SUMMARY_ROW[k]
               for k in SF_VIOLATIONS_SUMMARY_ROW
               if k not in SF_COMPLAINTS_SUMMARY_ROW},
            "violations_risk_level": SF_VIOLATIONS_SUMMARY_ROW["risk_level"],
        }
        mock_db = make_mock_db(
            MockResult([]),                        # ILIKE → no hits
            MockResult([MockRow(search_row)]),     # trgm fallback → one hit
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        resp = await client.get("/sf/building/search", params={"q": "markt"})
        app.dependency_overrides.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["mapblklot"] == SAMPLE_MAPBLKLOT

    @pytest.mark.asyncio
    async def test_no_matches_returns_empty_list(self, client):
        mock_db = make_mock_db(
            MockResult([]),   # ILIKE → nothing
            MockResult([]),   # trgm fallback → nothing
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        resp = await client.get("/sf/building/search", params={"q": "zzzzz"})
        app.dependency_overrides.clear()

        assert resp.status_code == 200
        assert resp.json() == []


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
        assert data["violations"][0]["display_category"] == "fire section"
        assert data["violations"][0]["display_description"] == (
            "install smoke detectors in all sleeping rooms"
        )

    @pytest.mark.asyncio
    async def test_non_housing_violation_uses_code_description(self, client):
        non_housing_row = {
            **SF_NOV_ROW,
            "row_id": "ROW002",
            "complaint_number": "202307791",
            "item_sequence_number": None,
            "receiving_division": "Building Inspection Division",
            "assigned_division": "Building Inspection Division",
            "nov_category_description": None,
            "item": None,
            "nov_item_description": "   ",
            "code_violation_desc": "  Observed fire damage to unit 1 M.  ",
            "unsafe_building": "Y",
        }
        mock_db = make_mock_db(
            MockResult([MockRow(SF_COMPLAINTS_SUMMARY_ROW)]),
            MockResult([MockRow(SF_VIOLATIONS_SUMMARY_ROW)]),
            MockResult(scalar_value=1),
            MockResult([MockRow(non_housing_row)]),
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        resp = await client.get(f"/sf/building/{SAMPLE_MAPBLKLOT}?show=violations")
        app.dependency_overrides.clear()

        assert resp.status_code == 200
        violation = resp.json()["violations"][0]
        assert violation["condition_group"] == "fire_safety"
        assert violation["display_category"] == "Fire safety"
        assert violation["display_description"] == "Observed fire damage to unit 1 M."

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
        """Condition buckets, not DBI's `nov_category_description`.

        The route labels each bucket through `card_categories`, so the assertion
        is that a renter-facing name and its tooltip came back — the whole reason
        the card stopped reading "building section".
        """
        mock_db = make_mock_db(
            MockResult([
                MockRow({"grp": "fire_safety", "count": 4, "open_count": 2}),
            ]),
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        resp = await client.get(f"/sf/building/{SAMPLE_MAPBLKLOT}/violations-breakdown")
        app.dependency_overrides.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert data[0]["group"] == "fire_safety"
        assert data[0]["category"] == "Fire safety"
        assert data[0]["description"]
        assert data[0]["open_count"] == 2

    @pytest.mark.asyncio
    async def test_violations_breakdown_unclassified_sorts_last(self, client):
        """The unnamed bucket never leads the card, however large.

        It is routinely the biggest — 32% of DBI's corpus is inspector narrative
        — and the page renders it as a footnote below the bars, so its position
        in this list is what keeps it out of the chart.
        """
        mock_db = make_mock_db(
            MockResult([
                MockRow({"grp": "unclassified", "count": 9, "open_count": 0}),
                MockRow({"grp": "mold",         "count": 2, "open_count": 1}),
            ]),
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        resp = await client.get(f"/sf/building/{SAMPLE_MAPBLKLOT}/violations-breakdown")
        app.dependency_overrides.clear()

        data = resp.json()
        assert [r["group"] for r in data] == ["mold", "unclassified"]
        assert data[1]["category"] == "Notices naming no specific condition"
