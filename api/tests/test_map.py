"""
Tests for the map routes (/map/clusters and /map/heatmap).

Covers:
  - GeoJSON shape and property correctness for the clusters endpoint
  - Zoomed-in vs zoomed-out DB query paths (CLUSTER_MAX_ZOOM boundary)
  - risk_color lookup including the None/fallback case
  - Heatmap endpoint with and without a borough filter
  - Empty results for both endpoints
"""
import pytest

from database import get_db
from main import app
from routes.map import CLUSTER_MAX_ZOOM, RISK_COLORS
from tests.conftest import MockRow, MockResult, make_mock_db, db_override


# ---------------------------------------------------------------------------
# Shared mock data
# ---------------------------------------------------------------------------

MAP_ROW = {
    "bin": "1099042",
    "address": "123 TEST ST",
    "borough": "Manhattan",
    "zip_code": "10001",
    "total_complaints": 10,
    "open_complaints": 3,
    "priority_a_complaints": 2,
    "risk_level": "High",
    "nta_code": "MN2501",
    "latitude": 40.7128,
    "longitude": -74.0060,
}

BBOX_PARAMS = "west=-74.02&south=40.70&east=-73.98&north=40.73"

HEATMAP_ROW = {
    "zip_code": "10001",
    "total_complaints": 50,
    "open_complaints": 10,
    "priority_a_complaints": 5,
    "building_count": 20,
}


# ---------------------------------------------------------------------------
# Tests: GET /map/clusters — zoomed in (single bbox query)
# ---------------------------------------------------------------------------

class TestGetClustersZoomedIn:
    async def test_returns_geojson_feature_collection(self, client):
        mock_db = make_mock_db(MockResult([MockRow(MAP_ROW)]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            zoom = CLUSTER_MAX_ZOOM  # exactly at the boundary → zoomed-in path
            resp = await client.get(f"/map/clusters?{BBOX_PARAMS}&zoom={zoom}")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        data = resp.json()
        assert data["type"] == "FeatureCollection"
        assert isinstance(data["features"], list)
        assert len(data["features"]) == 1

    async def test_feature_has_correct_geometry_and_properties(self, client):
        mock_db = make_mock_db(MockResult([MockRow(MAP_ROW)]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/map/clusters?{BBOX_PARAMS}&zoom={CLUSTER_MAX_ZOOM}")
        finally:
            app.dependency_overrides.pop(get_db, None)

        feature = resp.json()["features"][0]
        assert feature["type"] == "Feature"
        assert feature["geometry"]["type"] == "Point"
        assert feature["geometry"]["coordinates"] == [-74.0060, 40.7128]

        props = feature["properties"]
        assert props["bin"] == "1099042"
        assert props["address"] == "123 TEST ST"
        assert props["risk_level"] == "High"
        assert props["risk_color"] == RISK_COLORS["High"]
        assert props["total_complaints"] == 10

    async def test_risk_color_falls_back_for_null_risk_level(self, client):
        row = {**MAP_ROW, "risk_level": None}
        mock_db = make_mock_db(MockResult([MockRow(row)]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/map/clusters?{BBOX_PARAMS}&zoom={CLUSTER_MAX_ZOOM}")
        finally:
            app.dependency_overrides.pop(get_db, None)

        props = resp.json()["features"][0]["properties"]
        assert props["risk_level"] == "Insufficient data"
        assert props["risk_color"] == RISK_COLORS["Insufficient data"]

    async def test_returns_empty_feature_collection_when_no_buildings(self, client):
        mock_db = make_mock_db(MockResult([]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/map/clusters?{BBOX_PARAMS}&zoom={CLUSTER_MAX_ZOOM}")
        finally:
            app.dependency_overrides.pop(get_db, None)

        data = resp.json()
        assert data["type"] == "FeatureCollection"
        assert data["features"] == []


# ---------------------------------------------------------------------------
# Tests: GET /map/clusters — zoomed out (5 per-borough queries)
# ---------------------------------------------------------------------------

class TestGetClustersZoomedOut:
    async def test_issues_five_borough_queries_and_merges_results(self, client):
        # Supply one result per borough (5 boroughs → 5 execute calls).
        # Put one building in Manhattan, empty for the rest.
        mock_db = make_mock_db(
            MockResult([MockRow(MAP_ROW)]),  # Manhattan
            MockResult([]),                  # Brooklyn
            MockResult([]),                  # Queens
            MockResult([]),                  # Bronx
            MockResult([]),                  # Staten Island
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            zoom = CLUSTER_MAX_ZOOM - 1
            resp = await client.get(f"/map/clusters?{BBOX_PARAMS}&zoom={zoom}")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        features = resp.json()["features"]
        assert len(features) == 1
        assert features[0]["properties"]["bin"] == "1099042"

    async def test_aggregates_results_from_multiple_boroughs(self, client):
        bk_row = {**MAP_ROW, "bin": "3000001", "borough": "Brooklyn"}
        mock_db = make_mock_db(
            MockResult([MockRow(MAP_ROW)]),      # Manhattan
            MockResult([MockRow(bk_row)]),        # Brooklyn
            MockResult([]),                       # Queens
            MockResult([]),                       # Bronx
            MockResult([]),                       # Staten Island
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/map/clusters?{BBOX_PARAMS}&zoom={CLUSTER_MAX_ZOOM - 1}")
        finally:
            app.dependency_overrides.pop(get_db, None)

        features = resp.json()["features"]
        bins = {f["properties"]["bin"] for f in features}
        assert bins == {"1099042", "3000001"}


# ---------------------------------------------------------------------------
# Tests: GET /map/unified/clusters — DOB + HPD joined on bin
# ---------------------------------------------------------------------------

UNIFIED_ROW = {
    "bin": "1099042",
    "address": "123 TEST ST",
    "borough": "Manhattan",
    "zip_code": "10001",
    "nta_code": "MN2501",
    "latitude": 40.7128,
    "longitude": -74.0060,
    "dob_risk_level": "High",
    "dob_total": 10,
    "dob_open": 3,
    "dob_priority_a": 2,
    "hpd_risk_level": "Very high",
    "hpd_total": 40,
    "hpd_open": 12,
    "hpd_open_emergency": 4,
    "hpd_heat": 6,
    "hpd_latest_date": None,
}


class TestGetUnifiedClusters:
    async def test_feature_carries_both_dob_and_hpd_fields(self, client):
        mock_db = make_mock_db(MockResult([MockRow(UNIFIED_ROW)]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/map/unified/clusters?{BBOX_PARAMS}&zoom={CLUSTER_MAX_ZOOM}")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        feature = resp.json()["features"][0]
        assert feature["geometry"]["coordinates"] == [-74.0060, 40.7128]
        props = feature["properties"]
        assert props["bin"] == "1099042"
        assert props["dob_risk_level"] == "High"
        assert props["dob_total"] == 10
        assert props["hpd_risk_level"] == "Very high"
        assert props["hpd_open_emergency"] == 4
        assert props["dob_present"] == 1
        assert props["hpd_present"] == 1

    async def test_building_present_in_only_one_dataset_keeps_nulls(self, client):
        # HPD-only building: the FULL OUTER JOIN leaves all dob_* columns null.
        hpd_only = {**UNIFIED_ROW, "dob_risk_level": None, "dob_total": None,
                    "dob_open": None, "dob_priority_a": None}
        mock_db = make_mock_db(MockResult([MockRow(hpd_only)]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/map/unified/clusters?{BBOX_PARAMS}&zoom={CLUSTER_MAX_ZOOM}")
        finally:
            app.dependency_overrides.pop(get_db, None)

        props = resp.json()["features"][0]["properties"]
        assert props["dob_total"] is None
        assert props["hpd_total"] == 40
        # Absent from DOB → not low risk, just "no data" for that lens.
        assert props["dob_present"] == 0
        assert props["hpd_present"] == 1

    async def test_zoomed_out_issues_five_borough_queries(self, client):
        mock_db = make_mock_db(
            MockResult([MockRow(UNIFIED_ROW)]),  # Manhattan
            MockResult([]),                      # Brooklyn
            MockResult([]),                      # Queens
            MockResult([]),                      # Bronx
            MockResult([]),                      # Staten Island
        )
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/map/unified/clusters?{BBOX_PARAMS}&zoom={CLUSTER_MAX_ZOOM - 1}")
        finally:
            app.dependency_overrides.pop(get_db, None)

        features = resp.json()["features"]
        assert len(features) == 1
        assert features[0]["properties"]["bin"] == "1099042"

    async def test_returns_empty_feature_collection_when_no_buildings(self, client):
        mock_db = make_mock_db(MockResult([]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/map/unified/clusters?{BBOX_PARAMS}&zoom={CLUSTER_MAX_ZOOM}")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.json()["features"] == []


# ---------------------------------------------------------------------------
# Tests: GET /map/heatmap
# ---------------------------------------------------------------------------

class TestGetHeatmap:
    async def test_returns_list_of_zip_stats(self, client):
        mock_db = make_mock_db(MockResult([MockRow(HEATMAP_ROW)]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get("/map/heatmap")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 1
        row = data[0]
        assert row["zip_code"] == "10001"
        assert row["total_complaints"] == 50
        assert row["building_count"] == 20

    async def test_borough_filter_is_accepted(self, client):
        mock_db = make_mock_db(MockResult([MockRow(HEATMAP_ROW)]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get("/map/heatmap?borough=Manhattan")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        assert resp.json()[0]["zip_code"] == "10001"

    async def test_returns_empty_list_when_no_data(self, client):
        mock_db = make_mock_db(MockResult([]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get("/map/heatmap")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        assert resp.json() == []
