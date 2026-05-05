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
from routes.map import router as map_router

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
app.include_router(map_router)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled error on %s %s: %s", request.method, request.url, exc, exc_info=True)
    return JSONResponse(status_code=500, content={"detail": "An unexpected error occurred."})


@app.get("/health")
async def health():
    return {"status": "ok"}
