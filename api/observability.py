"""Request logging, durable event capture, and 5xx alerting.

Three sinks, one event shape:

  stdout (JSON)  every request, one line each      — Railway's log tail
  api_events     >=400, searches, page views       — Neon, queryable for months
  Resend email   5xx only, throttled               — push

The stdout sink is synchronous and always on. The other two are best-effort:
they run off a queue drained by a background task, and every failure path in
them degrades to a log line. Nothing here may slow down or break a request.
"""
import asyncio
import json
import logging
import os
import re
import time
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from database import _build_url

logger = logging.getLogger("nycd")

request_id_var: ContextVar[str] = ContextVar("request_id", default="")

_EVENTS_DB_ENABLED = os.environ.get("EVENTS_DB_ENABLED", "1").lower() not in ("0", "false", "no")
_RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
_ALERT_EMAIL = os.environ.get("ALERT_EMAIL", "")
_ALERT_FROM = os.environ.get("ALERT_FROM", "alerts@stoopcity.org")

QUEUE_MAX = 5000
BATCH_MAX = 500
FLUSH_INTERVAL_SECONDS = 60
ALERT_THROTTLE_SECONDS = 15 * 60

_BOT_UA = re.compile(
    r"bot|crawl|spider|slurp|bingpreview|headless|lighthouse|"
    r"python-requests|curl/|wget|httpx|axios|go-http-client",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# stdout: JSON lines
# ---------------------------------------------------------------------------

# Everything the stdlib puts on a LogRecord. Anything else came from an
# `extra=` at the call site and belongs in the emitted object.
_RESERVED = frozenset(logging.LogRecord("", 0, "", 0, "", None, None).__dict__) | {
    "asctime", "message", "taskName",
}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        rid = request_id_var.get()
        if rid:
            payload["request_id"] = rid
        for key, value in record.__dict__.items():
            if key not in _RESERVED:
                payload[key] = value
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)


# ---------------------------------------------------------------------------
# Per-request facts
# ---------------------------------------------------------------------------

def db_target() -> str:
    """The DB host, for the startup line. Never the password — this is logged."""
    url = os.environ.get("DATABASE_URL", "")
    host = url.split("@")[-1].split("/")[0] if "@" in url else "unset"
    return host.split(".")[0] or "unset"


def new_request_id() -> str:
    return uuid.uuid4().hex[:12]


def route_template(request) -> str:
    """`/hpd/building/{bin}`, not `/hpd/building/1234567`.

    The raw path would give every BIN its own value and make grouping by route
    useless, so fall back to the raw path only when no route matched (404s).
    """
    route = request.scope.get("route")
    return getattr(route, "path", None) or request.url.path


def client_ip(request) -> str:
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else ""


def is_bot(user_agent: str) -> bool:
    return bool(user_agent) and bool(_BOT_UA.search(user_agent))


def is_internal(request) -> bool:
    """Traffic tagged by the frontend's `stoop_dev` cookie (see frontend/proxy.ts)."""
    return request.headers.get("X-Stoop-Internal") == "1"


# ---------------------------------------------------------------------------
# api_events: queue in, batched insert out
# ---------------------------------------------------------------------------

_queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAX)
_flush_now: asyncio.Event | None = None
_drain_task: asyncio.Task | None = None
_engine = None

_INSERT = text("""
    INSERT INTO api_events
        (ts, kind, city, route, status, duration_ms, request_id,
         query, result_count, internal, is_bot, meta)
    VALUES
        (:ts, :kind, :city, :route, :status, :duration_ms, :request_id,
         :query, :result_count, :internal, :is_bot, CAST(:meta AS JSONB))
""")

_COLUMNS = {
    "ts": None,
    "kind": None, "city": None, "route": None, "status": None,
    "duration_ms": None, "request_id": None, "query": None,
    "result_count": None, "internal": False, "is_bot": False, "meta": None,
}


def emit_event(**fields) -> None:
    """Queue one row for api_events. Never blocks, never raises."""
    if not _EVENTS_DB_ENABLED:
        return
    row = dict(_COLUMNS)
    row.update({k: v for k, v in fields.items() if k in _COLUMNS})
    # Stamped here, not by the column default: NOW() is transaction time, so
    # every row in a flush batch would share the flush timestamp instead of the
    # moment the event happened — which is the axis every trend query uses.
    row["ts"] = datetime.now(timezone.utc)
    row.setdefault("request_id", None)
    if not row["request_id"]:
        row["request_id"] = request_id_var.get() or None
    if row["meta"] is not None and not isinstance(row["meta"], str):
        row["meta"] = json.dumps(row["meta"], default=str)
    try:
        _queue.put_nowait(row)
    except asyncio.QueueFull:
        # Dropping analytics beats backpressuring a request.
        return
    if _flush_now is not None and _queue.qsize() >= BATCH_MAX:
        _flush_now.set()


def _get_engine():
    global _engine
    if _engine is None:
        # Deliberately not database.py's engine: an analytics insert must never
        # share a session with a request, so a failure here cannot poison one.
        _engine = create_async_engine(
            _build_url(),
            poolclass=NullPool,
            connect_args={"ssl": "require", "statement_cache_size": 0},
        )
    return _engine


async def _flush() -> None:
    rows = []
    while len(rows) < BATCH_MAX:
        try:
            rows.append(_queue.get_nowait())
        except asyncio.QueueEmpty:
            break
    if not rows:
        return
    try:
        async with _get_engine().begin() as conn:
            await conn.execute(_INSERT, rows)
    except Exception as exc:
        # Never re-queue: a persistent DB fault would spin here forever.
        logger.warning("api_events flush dropped %d rows: %s", len(rows), exc)


async def _drain_loop() -> None:
    assert _flush_now is not None
    while True:
        try:
            await asyncio.wait_for(_flush_now.wait(), timeout=FLUSH_INTERVAL_SECONDS)
        except asyncio.TimeoutError:
            pass
        _flush_now.clear()
        # An empty queue must not open a connection: frontend/lib/api.ts caches
        # server-side reads for a day so Neon can autosuspend, and a writer that
        # woke the database on every tick would defeat that.
        await _flush()


async def start_events() -> None:
    global _flush_now, _drain_task
    if not _EVENTS_DB_ENABLED or _drain_task is not None:
        return
    _flush_now = asyncio.Event()
    _drain_task = asyncio.create_task(_drain_loop())


async def stop_events() -> None:
    global _flush_now, _drain_task
    if _drain_task is None:
        return
    _drain_task.cancel()
    try:
        await _drain_task
    except asyncio.CancelledError:
        pass
    _drain_task = None
    _flush_now = None
    await _flush()


# ---------------------------------------------------------------------------
# 5xx alerting
# ---------------------------------------------------------------------------

_alerted_at: dict[str, float] = {}


def _should_alert(signature: str) -> bool:
    now = time.monotonic()
    last = _alerted_at.get(signature)
    if last is not None and now - last < ALERT_THROTTLE_SECONDS:
        return False
    _alerted_at[signature] = now
    return True


async def _send_alert(subject: str, body: str) -> None:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {_RESEND_API_KEY}"},
                json={
                    "from": _ALERT_FROM,
                    "to": [_ALERT_EMAIL],
                    "subject": subject,
                    "text": body,
                },
            )
        if res.status_code >= 400:
            logger.warning("alert email rejected (%s): %s", res.status_code, res.text[:200])
    except Exception as exc:
        logger.warning("alert email failed: %s", exc)


def alert_5xx(request, exc: Exception) -> None:
    """Fire-and-forget a 5xx alert. Never blocks, never raises."""
    if not (_RESEND_API_KEY and _ALERT_EMAIL):
        return
    route = route_template(request)
    # One mail per exception type per route per window: an error loop that mails
    # 4,000 times is worse than no alert at all.
    if not _should_alert(f"{type(exc).__name__}:{route}"):
        return
    rid = request_id_var.get() or "-"
    body = (
        f"{type(exc).__name__}: {exc}\n\n"
        f"route:      {request.method} {route}\n"
        f"url:        {request.url}\n"
        f"request_id: {rid}\n\n"
        f"Railway:  filter on request_id={rid}\n"
        f"Postgres: SELECT * FROM api_events WHERE request_id = '{rid}';"
    )
    try:
        asyncio.get_running_loop().create_task(
            _send_alert(f"[stoop] 500 on {route}", body)
        )
    except RuntimeError:
        pass
