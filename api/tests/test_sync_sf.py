"""
Tests for the pure transforms in ingest/sync_sf.py.

These functions run on the weekly SF sync and fail *silently* when they drift:
a bad join key doesn't raise — it just leaves rows unmatched, so buildings quietly
vanish from the materialized views. That's exactly the failure a unit test catches
and monitoring does not, so the parcel-key derivations are covered most heavily.

Only the pure transforms are tested here; network (_fetch_all), DB upserts, and
run() orchestration are integration concerns and intentionally out of scope.
"""
import os
import sys
from datetime import date

import pytest

# sync_sf lives in ingest/, not on the api path. sf_config reads DATABASE_URL at
# import time; conftest has already set a fake value in os.environ by now.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "ingest"))

import sync_sf  # noqa: E402


# ── DBI NOV parcel key: block/lot → mapblklot ─────────────────────────────────
# The join key every violation hangs on. Most important thing in this file.

class TestNovMapblklot:
    def test_zero_pads_block_and_lot(self):
        assert sync_sf._nov_mapblklot("123", "45") == "0123045"

    def test_already_wide_values_unchanged(self):
        assert sync_sf._nov_mapblklot("1234", "567") == "1234567"

    def test_strips_surrounding_whitespace(self):
        assert sync_sf._nov_mapblklot(" 123 ", " 45 ") == "0123045"

    def test_accepts_numeric_input(self):
        # Socrata sometimes hands back ints, not strings.
        assert sync_sf._nov_mapblklot(123, 45) == "0123045"

    def test_block_all_zeros_is_rejected(self):
        assert sync_sf._nov_mapblklot("0", "45") is None
        assert sync_sf._nov_mapblklot("", "45") is None

    def test_none_block_is_rejected(self):
        assert sync_sf._nov_mapblklot(None, "45") is None


# ── Footprint parcel key: MBLR → mapblklot ────────────────────────────────────

class TestMblrToMapblklot:
    def test_strips_sf_prefix(self):
        assert sync_sf._mblr_to_mapblklot("SF1234567") == "1234567"

    def test_strips_trailing_condo_letter(self):
        assert sync_sf._mblr_to_mapblklot("SF1234567A") == "1234567"

    def test_lowercase_prefix_and_letter(self):
        assert sync_sf._mblr_to_mapblklot("sf1234567a") == "1234567"

    def test_only_first_sf_occurrence_removed(self):
        # .replace("SF", "", 1) — a second "SF" in the body must survive.
        assert sync_sf._mblr_to_mapblklot("SF12SF34") == "12SF34"

    def test_non_string_returns_none(self):
        assert sync_sf._mblr_to_mapblklot(None) is None
        assert sync_sf._mblr_to_mapblklot(12345) is None


# ── 311 subtype normalisation (feeds the severity map) ────────────────────────

class TestNormalize311Subtype:
    def test_lowercases(self):
        assert sync_sf._normalize_311_subtype("Mold_And_Mildew") == "mold_and_mildew"

    def test_strips_building_prefix(self):
        assert (
            sync_sf._normalize_311_subtype("Building - heat_lack_of_heat")
            == "heat_lack_of_heat"
        )

    def test_prefix_strip_is_case_insensitive(self):
        assert sync_sf._normalize_311_subtype("BUILDING - fire_hazard") == "fire_hazard"

    def test_empty_and_none_become_none(self):
        assert sync_sf._normalize_311_subtype("") is None
        assert sync_sf._normalize_311_subtype(None) is None

    def test_nan_becomes_none(self):
        assert sync_sf._normalize_311_subtype(float("nan")) is None


# ── NOV date cleaning (floors out pre-1980 garbage) ───────────────────────────

class TestCleanNovDate:
    def test_parses_valid_date(self):
        assert sync_sf._clean_nov_date("2025-10-15") == date(2025, 10, 15)

    def test_floors_pre_1980_garbage(self):
        # The feed carries min year 0200 — must be dropped, not stored.
        assert sync_sf._clean_nov_date("0200-01-01") is None

    def test_1979_rejected_1980_kept(self):
        assert sync_sf._clean_nov_date("1979-12-31") is None
        assert sync_sf._clean_nov_date("1980-01-01") == date(1980, 1, 1)

    def test_unparseable_becomes_none(self):
        assert sync_sf._clean_nov_date("not a date") is None
        assert sync_sf._clean_nov_date(None) is None


# ── Geometry: centroid extraction ─────────────────────────────────────────────

class TestCentroid:
    def test_point_returns_lat_lon_swapped(self):
        # GeoJSON is [lon, lat]; we return (lat, lon).
        shape = {"type": "Point", "coordinates": [-122.42, 37.77]}
        assert sync_sf._centroid(shape) == (37.77, -122.42)

    def test_polygon_averages_ring(self):
        # Unit square from (0,0) to (2,2) → centroid (1, 1).
        shape = {
            "type": "Polygon",
            "coordinates": [[[0, 0], [2, 0], [2, 2], [0, 2]]],
        }
        lat, lon = sync_sf._centroid(shape)
        assert lat == pytest.approx(1.0)
        assert lon == pytest.approx(1.0)

    def test_multipolygon_uses_first_ring(self):
        shape = {
            "type": "MultiPolygon",
            "coordinates": [[[[0, 0], [4, 0], [4, 4], [0, 4]]]],
        }
        lat, lon = sync_sf._centroid(shape)
        assert lat == pytest.approx(2.0)
        assert lon == pytest.approx(2.0)

    def test_unrecognised_shape_returns_none_pair(self):
        assert sync_sf._centroid(None) == (None, None)
        assert sync_sf._centroid({"type": "LineString", "coordinates": []}) == (None, None)


# ── Geometry: polygon area ────────────────────────────────────────────────────

class TestPolygonAreaSqm:
    def test_known_square_area(self):
        # A ~0.001° square near SF latitude. Shoelace deg² = 1e-6; convert with
        # (111_320²)·cos(37.77°) ≈ the m² per deg² factor. Assert it lands in a
        # sane range rather than pinning floating-point exactly.
        shape = {
            "type": "Polygon",
            "coordinates": [[
                [-122.420, 37.770],
                [-122.419, 37.770],
                [-122.419, 37.771],
                [-122.420, 37.771],
            ]],
        }
        area = sync_sf._polygon_area_sqm(shape)
        assert area is not None
        # 0.001° lat ≈ 111 m; 0.001° lon at 37.77° ≈ 88 m → ~9,800 m².
        assert 9_000 < area < 10_500

    def test_degenerate_ring_returns_none(self):
        # Fewer than 3 points can't form a polygon.
        shape = {"type": "Polygon", "coordinates": [[[0, 0], [1, 1]]]}
        assert sync_sf._polygon_area_sqm(shape) is None

    def test_non_dict_returns_none(self):
        assert sync_sf._polygon_area_sqm(None) is None


# ── Point lat/lon unpacking (311 'point' / NOV 'location') ─────────────────────

class TestPointExtractors:
    def test_extracts_lat_lon_from_dict(self):
        p = {"latitude": "37.77", "longitude": "-122.42"}
        assert float(sync_sf._point_lat(p)) == pytest.approx(37.77)
        assert float(sync_sf._point_lon(p)) == pytest.approx(-122.42)

    def test_non_dict_returns_none(self):
        assert sync_sf._point_lat(None) is None
        assert sync_sf._point_lon("not a dict") is None


# ── Incremental filters: the $where clause each fetcher sends to Socrata ───────
# The event fetchers use different incremental keys on purpose — 311 has genuine
# per-row :updated_at, NOV is republished wholesale so only date_filed works.

from datetime import date  # noqa: E402


class TestIncrementalFilters:
    def _capture_where(self, monkeypatch):
        """Patch _fetch_all to record the `where` it's called with, return no rows."""
        captured = {}

        def fake_fetch_all(api_url, where=None, select=None):
            captured["where"] = where
            return []

        monkeypatch.setattr(sync_sf, "_fetch_all", fake_fetch_all)
        return captured

    def test_nov_incremental_filters_on_date_filed(self, monkeypatch):
        cap = self._capture_where(monkeypatch)
        sync_sf.fetch_dbi_nov(since=date(2026, 7, 2))
        assert cap["where"] == "date_filed >= '2026-07-02'"

    def test_nov_full_has_no_filter(self, monkeypatch):
        cap = self._capture_where(monkeypatch)
        sync_sf.fetch_dbi_nov()
        assert cap["where"] is None

    def test_nov_fetch_requests_both_record_shapes(self, monkeypatch):
        captured = {}

        def fake_fetch_all(api_url, where=None, select=None):
            captured["select"] = select
            return []

        monkeypatch.setattr(sync_sf, "_fetch_all", fake_fetch_all)
        sync_sf.fetch_dbi_nov()

        assert "nov_item_description" in captured["select"]
        assert "code_violation_desc" in captured["select"]
        assert "unsafe_building" in captured["select"]

    def test_nov_fetch_preserves_non_housing_fields(self, monkeypatch):
        def fake_fetch_all(api_url, where=None, select=None):
            return [{
                ":id": "row-1",
                "complaint_number": "202307791",
                "block": "2636",
                "lot": "003",
                "status": "active",
                "receiving_division": "Building Inspection Division",
                "code_violation_desc": "Observed fire damage to unit 1 M.",
                "unsafe_building": "Y",
                "date_filed": "2023-05-09",
            }]

        monkeypatch.setattr(sync_sf, "_fetch_all", fake_fetch_all)
        row = sync_sf.fetch_dbi_nov().iloc[0]

        assert row["row_id"] == "row-1"
        assert row["mapblklot"] == "2636003"
        assert row["code_violation_desc"] == "Observed fire damage to unit 1 M."
        assert row["unsafe_building"] == "Y"

    def test_311_incremental_filters_on_updated_at(self, monkeypatch):
        cap = self._capture_where(monkeypatch)
        sync_sf.fetch_311(since=date(2026, 7, 2))
        # Keeps the service_name filter AND adds the freshness filter.
        assert "service_name IN (" in cap["where"]
        assert ":updated_at >= '2026-07-02'" in cap["where"]

    def test_311_full_omits_updated_at(self, monkeypatch):
        cap = self._capture_where(monkeypatch)
        sync_sf.fetch_311()
        assert "service_name IN (" in cap["where"]
        assert ":updated_at" not in cap["where"]
