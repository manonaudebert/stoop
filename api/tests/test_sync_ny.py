"""
Tests for the pure transforms in the NY weekly sync scripts:
  - ingest/sync.py                 (DOB complaints)
  - ingest/sync_hpd.py             (HPD violations)
  - ingest/sync_hpd_complaints.py  (HPD complaints)

Each script's clean() takes a raw Socrata DataFrame and returns the DB-ready
frame. These run unattended every week and fail *silently* when they drift: a
mis-normalised BIN doesn't raise, it just detaches rows from their building.
The three clean() functions live in separate files and can drift independently,
so each is covered on its own rather than assuming they stay in lockstep.

Input frames use post-rename (DB) column names — the JSON_COLUMN_MAP rename is a
config concern, out of scope here. Network fetches, DB upserts, and run() are
also out of scope; only the transforms are tested.
"""
import os
import sys
from datetime import date, timedelta

import pandas as pd
import pytest

# The sync scripts live in ingest/, not on the api path. config.py reads
# DATABASE_URL at import time; conftest has already set a fake value.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "ingest"))

import sync                  # noqa: E402  DOB complaints
import sync_hpd              # noqa: E402  HPD violations
import sync_hpd_complaints   # noqa: E402  HPD complaints


# ── DOB complaints: sync.clean() ──────────────────────────────────────────────

class TestDobClean:
    def _frame(self, **overrides) -> pd.DataFrame:
        base = {
            "complaint_number": "12345",
            "bin":              "1008765",
            "date_entered":     "01/15/2025",
        }
        base.update(overrides)
        return pd.DataFrame([base])

    def test_borough_derived_from_bin_first_digit(self):
        out = sync.clean(self._frame(bin="3001234"))
        assert out.iloc[0]["borough"] == "Brooklyn"

    def test_each_borough_prefix(self):
        cases = {"1": "Manhattan", "2": "Bronx", "3": "Brooklyn",
                 "4": "Queens", "5": "Staten Island"}
        for prefix, borough in cases.items():
            out = sync.clean(self._frame(bin=f"{prefix}001234"))
            assert out.iloc[0]["borough"] == borough

    def test_all_zero_bin_nulled(self):
        out = sync.clean(self._frame(bin="0000000"))
        assert out.iloc[0]["bin"] is None

    def test_empty_bin_nulled(self):
        out = sync.clean(self._frame(bin=""))
        assert out.iloc[0]["bin"] is None

    def test_valid_bin_preserved(self):
        out = sync.clean(self._frame(bin="1008765"))
        assert out.iloc[0]["bin"] == "1008765"

    def test_valid_date_parsed(self):
        out = sync.clean(self._frame(date_entered="01/15/2025"))
        assert out.iloc[0]["date_entered"] == date(2025, 1, 15)

    def test_garbage_date_coerced_to_null(self):
        out = sync.clean(self._frame(date_entered="not a date"))
        assert pd.isna(out.iloc[0]["date_entered"])

    def test_blank_complaint_number_dropped(self):
        df = pd.concat([self._frame(complaint_number="111"),
                        self._frame(complaint_number="   ")], ignore_index=True)
        out = sync.clean(df)
        assert list(out["complaint_number"]) == ["111"]

    def test_dedup_keeps_last(self):
        df = pd.concat([self._frame(complaint_number="777", bin="1000001"),
                        self._frame(complaint_number="777", bin="2000002")],
                       ignore_index=True)
        out = sync.clean(df)
        assert len(out) == 1
        assert out.iloc[0]["bin"] == "2000002"
        assert out.iloc[0]["borough"] == "Bronx"


# ── HPD violations: sync_hpd.clean() ──────────────────────────────────────────

class TestHpdViolationsClean:
    def _frame(self, **overrides) -> pd.DataFrame:
        base = {
            "violation_id": "V100",
            "bin":          "1008765",
            "latitude":     "40.7128",
            "longitude":    "-74.0060",
        }
        base.update(overrides)
        return pd.DataFrame([base])

    def test_placeholder_bin_nulled(self):
        # 1000000 is HPD's "unknown building" sentinel.
        out = sync_hpd.clean(self._frame(bin="1000000"))
        assert out.iloc[0]["bin"] is None

    def test_all_zero_bin_nulled(self):
        out = sync_hpd.clean(self._frame(bin="0000000"))
        assert out.iloc[0]["bin"] is None

    def test_valid_bin_preserved(self):
        out = sync_hpd.clean(self._frame(bin="1008765"))
        assert out.iloc[0]["bin"] == "1008765"

    def test_latlon_coerced_to_float(self):
        out = sync_hpd.clean(self._frame(latitude="40.7128", longitude="-74.0060"))
        assert out.iloc[0]["latitude"] == pytest.approx(40.7128)
        assert out.iloc[0]["longitude"] == pytest.approx(-74.0060)

    def test_bad_latlon_coerced_to_null(self):
        out = sync_hpd.clean(self._frame(latitude="N/A"))
        assert pd.isna(out.iloc[0]["latitude"])

    def test_blank_violation_id_dropped(self):
        df = pd.concat([self._frame(violation_id="V1"),
                        self._frame(violation_id="")], ignore_index=True)
        out = sync_hpd.clean(df)
        assert list(out["violation_id"]) == ["V1"]

    def test_dedup_keeps_last(self):
        df = pd.concat([self._frame(violation_id="V9", bin="1000001"),
                        self._frame(violation_id="V9", bin="3000003")],
                       ignore_index=True)
        out = sync_hpd.clean(df)
        assert len(out) == 1
        assert out.iloc[0]["bin"] == "3000003"


# ── HPD complaints: sync_hpd_complaints.clean() ───────────────────────────────

class TestHpdComplaintsClean:
    def _frame(self, **overrides) -> pd.DataFrame:
        base = {
            "problem_id":   "P100",
            "bin":          "1008765",
            "latitude":     "40.7128",
            "longitude":    "-74.0060",
            "received_date": "2025-01-15",
        }
        base.update(overrides)
        return pd.DataFrame([base])

    def test_placeholder_bin_nulled(self):
        out = sync_hpd_complaints.clean(self._frame(bin="1000000"))
        assert out.iloc[0]["bin"] is None

    def test_valid_bin_preserved(self):
        out = sync_hpd_complaints.clean(self._frame(bin="1008765"))
        assert out.iloc[0]["bin"] == "1008765"

    def test_latlon_coerced_to_float(self):
        out = sync_hpd_complaints.clean(self._frame())
        assert out.iloc[0]["latitude"] == pytest.approx(40.7128)

    def test_date_parsed(self):
        out = sync_hpd_complaints.clean(self._frame(received_date="2025-01-15"))
        assert out.iloc[0]["received_date"] == date(2025, 1, 15)

    def test_blank_problem_id_dropped(self):
        df = pd.concat([self._frame(problem_id="P1"),
                        self._frame(problem_id="  ")], ignore_index=True)
        out = sync_hpd_complaints.clean(df)
        assert list(out["problem_id"]) == ["P1"]

    def test_dedup_keeps_last(self):
        df = pd.concat([self._frame(problem_id="P9", bin="1000001"),
                        self._frame(problem_id="P9", bin="4000004")],
                       ignore_index=True)
        out = sync_hpd_complaints.clean(df)
        assert len(out) == 1
        assert out.iloc[0]["bin"] == "4000004"


# ── DOB incremental-sync safety rail: fetch_since 90-day guard ────────────────

class TestDobFetchSinceGuard:
    def test_lookback_over_90_days_raises(self):
        # Guard fires before any network call, so this is safe to run offline.
        since = date.today() - timedelta(days=200)
        with pytest.raises(ValueError, match="90-day limit"):
            sync.fetch_since(since)
