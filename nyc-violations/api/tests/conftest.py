"""
Shared fixtures and mock helpers for the API test suite.

Strategy: override FastAPI's get_db dependency with a mock AsyncSession so
tests never touch a real database. Each test configures exactly which results
its db.execute() calls return.
"""
import os
import sys

# Must set these before importing anything from the api package:
# - database.py calls create_async_engine at module level using DATABASE_URL
# - main.py reads INTERNAL_API_SECRET at module level for the auth middleware
# python-dotenv's load_dotenv() does NOT override vars already in os.environ,
# so setting them here prevents .env values from leaking into tests.
os.environ.setdefault("DATABASE_URL", "postgresql://fake:fake@localhost/fakedb")
os.environ["INTERNAL_API_SECRET"] = ""   # disable auth middleware in tests

# Add the api/ directory to sys.path so tests can import api modules directly.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
import pytest_asyncio
from unittest.mock import AsyncMock
from httpx import AsyncClient, ASGITransport

from main import app
from database import get_db
from cache import cache_clear


# ---------------------------------------------------------------------------
# Mock database primitives
# ---------------------------------------------------------------------------

class MockRow:
    """Mimics a SQLAlchemy Row: supports ._mapping (dict) and attribute access."""

    def __init__(self, data: dict):
        self._mapping = data
        for k, v in data.items():
            setattr(self, k, v)


class MockResult:
    """Mimics a SQLAlchemy CursorResult returned by AsyncSession.execute()."""

    def __init__(self, rows: list | None = None, scalar_value=None):
        self._rows = rows or []
        self._scalar = scalar_value

    def first(self):
        return self._rows[0] if self._rows else None

    def all(self):
        return self._rows

    def scalar(self):
        return self._scalar

    def __iter__(self):
        return iter(self._rows)


def make_mock_db(*results: MockResult):
    """
    Build an async DB session mock whose execute() calls return `results`
    in sequence (one result object per call).
    """
    session = AsyncMock()
    session.execute = AsyncMock(side_effect=list(results))
    return session


def db_override(session):
    """Return a FastAPI dependency function that yields `session`."""
    async def _get_db():
        yield session
    return _get_db


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def clear_cache_between_tests():
    """Clear the in-process LRU cache before and after each test."""
    cache_clear()
    yield
    cache_clear()


@pytest_asyncio.fixture
async def client():
    """Async HTTP client backed by the FastAPI test app (no real network)."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as c:
        yield c
