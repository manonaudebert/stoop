"""
Tests for the Cache-Control middleware (main.set_cache_headers).

These headers let an edge/CDN absorb repeat traffic so Neon can stay
scaled-to-zero instead of waking on every page view. Source data refreshes
weekly, so reads are cached for a day with a week of stale-while-revalidate;
search is kept fresher; /health is never cached.
"""
import pytest

from database import get_db
from main import app
from routes.map import CLUSTER_MAX_ZOOM
from tests.conftest import MockRow, MockResult, make_mock_db, db_override

BBOX_PARAMS = "west=-74.02&south=40.70&east=-73.98&north=40.73"

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


class TestCacheHeaders:
    async def test_static_read_gets_day_long_swr_policy(self, client):
        mock_db = make_mock_db(MockResult([MockRow(MAP_ROW)]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get(f"/map/clusters?{BBOX_PARAMS}&zoom={CLUSTER_MAX_ZOOM}")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        assert resp.headers["cache-control"] == \
            "public, s-maxage=86400, stale-while-revalidate=604800"

    async def test_search_gets_shorter_policy(self, client):
        # Both search phases (ILIKE, then trigram) miss → empty 200 response.
        mock_db = make_mock_db(MockResult([]), MockResult([]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get("/building/search?q=nope")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 200
        assert resp.headers["cache-control"] == \
            "public, s-maxage=3600, stale-while-revalidate=86400"

    async def test_health_is_not_cached(self, client):
        resp = await client.get("/health")
        assert resp.status_code == 200
        assert "cache-control" not in resp.headers

    async def test_error_response_is_not_cached(self, client):
        # No db override: a building lookup miss returns 404, which must not
        # be cached at the edge.
        mock_db = make_mock_db(MockResult([]), MockResult([]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            resp = await client.get("/building/0000000")
        finally:
            app.dependency_overrides.pop(get_db, None)

        assert resp.status_code == 404
        assert "cache-control" not in resp.headers
