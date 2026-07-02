import logging
import os
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

from limiter import limiter
from routes.building import router as building_router
from routes.hpd import router as hpd_router
from routes.hpd_complaints import router as hpd_complaints_router
from routes.map import router as map_router
from routes.sf import router as sf_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("nycd")

_INTERNAL_API_SECRET = os.environ.get("INTERNAL_API_SECRET", "")
_ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

app = FastAPI(
    title="NYC DOB Complaints API",
    description="Building complaint history for NYC renters",
    version="1.0.0",
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)


# Edge/CDN cache lifetimes. Source data refreshes weekly via ingest/sync_all.py,
# so we can cache aggressively: serve fresh for a day, then background-revalidate
# (stale-while-revalidate) for up to a week. This lets the CDN absorb repeat
# traffic so Neon stays scaled-to-zero instead of waking on every page view.
_DAY = 86400
_WEEK = 604800


def _cache_control_for(path: str) -> str | None:
    """Pick a Cache-Control policy for a successful GET, keyed by route shape.
    Returns None for paths that should not be cached (e.g. /health)."""
    if path == "/health":
        return None
    # Search is query-driven and user-facing; keep it fresher than static data.
    if path.endswith("/search"):
        return "public, s-maxage=3600, stale-while-revalidate=86400"
    # Everything else (building detail, breakdowns, timelines, leaderboards,
    # map clusters/heatmap) is derived from the weekly materialized views.
    return f"public, s-maxage={_DAY}, stale-while-revalidate={_WEEK}"


@app.middleware("http")
async def set_cache_headers(request: Request, call_next):
    response = await call_next(request)
    if request.method == "GET" and response.status_code == 200 \
            and "cache-control" not in response.headers:
        policy = _cache_control_for(request.url.path)
        if policy:
            response.headers["Cache-Control"] = policy
    return response


@app.middleware("http")
async def verify_internal_key(request: Request, call_next):
    # Allow CORS preflight and health checks through
    if request.method == "OPTIONS" or request.url.path == "/health":
        return await call_next(request)
    if not _INTERNAL_API_SECRET:
        logger.warning("INTERNAL_API_SECRET not set — requests are unauthenticated")
        return await call_next(request)
    if request.headers.get("X-Internal-Key") != _INTERNAL_API_SECRET:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    return await call_next(request)


app.include_router(building_router)
app.include_router(hpd_router)
app.include_router(hpd_complaints_router)
app.include_router(map_router)
app.include_router(sf_router)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled error on %s %s: %s", request.method, request.url, exc, exc_info=True)
    return JSONResponse(status_code=500, content={"detail": "An unexpected error occurred."})


@app.get("/health")
async def health():
    return {"status": "ok"}
