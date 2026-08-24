"""
Tests for request logging, event capture, and 5xx alert throttling.

The point of this module is that a *fault* stays distinguishable from *data*:
4xx and 5xx must be logged (they were invisible before), the route label must
stay low-cardinality so grouping by route works at all, and none of the
telemetry may be able to slow down or break a request.
"""
import asyncio
import json
import logging
import pathlib
import re

import pytest

import observability
from database import get_db
from main import app
from tests.conftest import MockRow, MockResult, make_mock_db, db_override

# The route's response model is strict, so reuse the suite's canonical row
# rather than a hand-rolled subset that drifts from the schema.
from tests.test_building import BUILDING_SUMMARY_ROW


@pytest.fixture(autouse=True)
def drain_queue():
    """Events are module-global; keep one test's rows out of the next."""
    def _drain():
        while True:
            try:
                observability._queue.get_nowait()
            except asyncio.QueueEmpty:
                return
    _drain()
    yield
    _drain()


def queued():
    return list(observability._queue._queue)


class TestRequestId:
    async def test_response_carries_request_id(self, client):
        mock_db = make_mock_db(MockResult([MockRow(BUILDING_SUMMARY_ROW)]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            res = await client.get("/building/search?q=123+TEST+ST")
        finally:
            app.dependency_overrides.clear()
        assert res.status_code == 200
        rid = res.headers.get("x-request-id")
        assert rid and len(rid) == 12

    async def test_each_request_gets_a_distinct_id(self, client):
        res1 = await client.get("/nope")
        res2 = await client.get("/nope")
        assert res1.headers["x-request-id"] != res2.headers["x-request-id"]

    async def test_health_is_not_instrumented(self, client):
        """Railway polls it constantly; it would drown out real traffic."""
        res = await client.get("/health")
        assert res.status_code == 200
        assert "x-request-id" not in res.headers
        assert queued() == []


class TestFaultCapture:
    async def test_404_is_recorded(self, client):
        """4xx used to produce no log line and no row at all."""
        res = await client.get("/nope")
        assert res.status_code == 404
        rows = queued()
        assert len(rows) == 1
        assert rows[0]["kind"] == "request"
        assert rows[0]["status"] == 404
        assert rows[0]["request_id"] == res.headers["x-request-id"]

    async def test_successful_request_is_not_stored(self, client):
        """200s stay in stdout: storing them multiplies volume for nothing."""
        mock_db = make_mock_db(MockResult([MockRow(BUILDING_SUMMARY_ROW)]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            res = await client.get("/building/search?q=123+TEST+ST")
        finally:
            app.dependency_overrides.clear()
        assert res.status_code == 200
        assert [r for r in queued() if r["kind"] == "request"] == []

    async def test_route_label_is_the_template_not_the_raw_path(self, client):
        """`/building/{bin}` — a raw path would give every BIN its own label."""
        records = []

        class Capture(logging.Handler):
            def emit(self, record):
                records.append(record)

        handler = Capture()
        logging.getLogger("nycd").addHandler(handler)
        # Two empty results reaches the route's 404 branch (see test_building).
        mock_db = make_mock_db(MockResult([]), MockResult([]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            await client.get("/building/0000000")
        finally:
            app.dependency_overrides.clear()
            logging.getLogger("nycd").removeHandler(handler)

        routes = [getattr(r, "route", None) for r in records]
        assert "/building/{bin}" in routes
        assert "/building/0000000" not in routes


class TestEmitEvent:
    def test_never_raises_when_the_queue_is_full(self):
        """Dropping analytics must beat backpressuring a request."""
        for _ in range(observability.QUEUE_MAX + 50):
            observability.emit_event(kind="search", query="x")
        assert observability._queue.qsize() == observability.QUEUE_MAX

    def test_meta_is_serialised_for_the_jsonb_column(self):
        observability.emit_event(kind="pageview", meta={"building": "123"})
        assert json.loads(queued()[0]["meta"]) == {"building": "123"}

    def test_unknown_fields_are_dropped(self):
        """A stray kwarg must not break the INSERT's bind parameters."""
        observability.emit_event(kind="search", nonsense="x")
        assert "nonsense" not in queued()[0]


class TestEventTimestamp:
    def test_ts_is_event_time_not_flush_time(self):
        """Rows flushed in one batch must keep distinct times: the column
        default is NOW(), which is transaction time and identical per batch."""
        import time as _t
        observability.emit_event(kind="request", status=404)
        _t.sleep(0.01)
        observability.emit_event(kind="request", status=500)
        a, b = queued()[:2]
        assert a["ts"] is not None and b["ts"] is not None
        assert a["ts"] < b["ts"]


class TestInsertStatement:
    def test_bind_params_match_the_queued_row_exactly(self):
        """A typo here would only surface as a dropped batch in production,
        long after the fact — the flush swallows its own errors by design."""
        import re
        binds = set(re.findall(r":(\w+)", str(observability._INSERT)))
        assert binds == set(observability._COLUMNS)

    def test_every_column_in_the_insert_is_in_the_migration(self):
        migration = (
            pathlib.Path(__file__).resolve().parents[2]
            / "ingest" / "migration" / "migrate_api_events.sql"
        ).read_text()
        ddl = migration[migration.index("CREATE TABLE"):migration.index(");")]
        for column in observability._COLUMNS:
            assert re.search(rf"^\s+{column}\s", ddl, re.MULTILINE), column


class TestSearchEvents:
    async def test_zero_result_search_is_recorded_as_such(self, client):
        """The clearest proxy for a data gap, so it must survive as a 0."""
        mock_db = make_mock_db(MockResult([]), MockResult([]))
        app.dependency_overrides[get_db] = db_override(mock_db)
        try:
            res = await client.get("/building/search?q=nowhere at all")
        finally:
            app.dependency_overrides.clear()
        assert res.status_code == 200
        searches = [r for r in queued() if r["kind"] == "search"]
        assert len(searches) == 1
        assert searches[0]["result_count"] == 0
        assert searches[0]["query"] == "nowhere at all"
        assert searches[0]["city"] == "nyc"
        # NYC has three search endpoints; city alone cannot tell them apart.
        assert searches[0]["route"] == "/building/search"


class TestClientEvents:
    async def test_pageview_beacon_is_recorded(self, client):
        """Page views cannot come from request logs: lib/api.ts caches
        server-side reads for a day, so most page loads never reach the API."""
        res = await client.post("/events", json={
            "kind": "pageview", "city": "nyc",
            "route": "/hpd/building/[bin]", "building": "1099042",
        })
        assert res.status_code == 204
        assert res.content == b""
        row = queued()[0]
        assert row["kind"] == "pageview"
        assert row["city"] == "nyc"
        assert json.loads(row["meta"]) == {"building": "1099042"}

    async def test_unknown_kind_is_rejected(self, client):
        """The payload is closed: no free-text write-anything endpoint."""
        res = await client.post("/events", json={"kind": "whatever"})
        assert res.status_code == 422

    async def test_oversized_route_is_rejected(self, client):
        res = await client.post("/events", json={"kind": "pageview", "route": "x" * 200})
        assert res.status_code == 422


class TestTagging:
    def test_bot_user_agents_are_flagged(self):
        assert observability.is_bot("Mozilla/5.0 (compatible; Googlebot/2.1)")
        assert observability.is_bot("curl/8.7.1")
        assert not observability.is_bot(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15"
        )
        assert not observability.is_bot("")

    async def test_internal_header_tags_the_row(self, client):
        res = await client.get("/nope", headers={"X-Stoop-Internal": "1"})
        assert queued()[0]["internal"] is True
        assert res.status_code == 404

    async def test_untagged_traffic_is_not_internal(self, client):
        await client.get("/nope")
        assert queued()[0]["internal"] is False


class TestAlertThrottle:
    def test_repeat_signature_is_suppressed_within_the_window(self):
        """An error loop that mails 4,000 times is worse than no alert."""
        observability._alerted_at.clear()
        assert observability._should_alert("ValueError:/x") is True
        assert observability._should_alert("ValueError:/x") is False
        assert observability._should_alert("ValueError:/y") is True

    def test_alert_is_disabled_without_credentials(self):
        """No key configured → silently off, so local and CI are unaffected."""
        observability._alerted_at.clear()
        assert observability._RESEND_API_KEY == ""
        observability.alert_5xx(_FakeRequest(), ValueError("boom"))
        assert observability._alerted_at == {}


class TestJsonFormatter:
    def test_extras_are_promoted_to_top_level_keys(self):
        record = logging.LogRecord(
            "nycd", logging.WARNING, __file__, 1, "GET /x 404", None, None
        )
        record.status = 404
        record.route = "/x"
        payload = json.loads(observability.JsonFormatter().format(record))
        assert payload["level"] == "WARNING"
        assert payload["status"] == 404
        assert payload["route"] == "/x"
        assert payload["msg"] == "GET /x 404"

    def test_exception_text_is_included(self):
        try:
            raise ValueError("boom")
        except ValueError:
            import sys
            record = logging.LogRecord(
                "nycd", logging.ERROR, __file__, 1, "failed", None, sys.exc_info()
            )
        payload = json.loads(observability.JsonFormatter().format(record))
        assert "ValueError: boom" in payload["exc"]


class _FakeRequest:
    method = "GET"
    url = "http://test/x"
    scope: dict = {}

    class _URL:
        path = "/x"

    url_obj = _URL()

    def __init__(self):
        self.url = self._URL()
