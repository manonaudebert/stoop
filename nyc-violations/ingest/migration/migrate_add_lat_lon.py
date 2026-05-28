"""Add latitude and longitude columns to hpd_violations."""
import asyncio
import sys
from pathlib import Path
import asyncpg

sys.path.insert(0, str(Path(__file__).parent.parent))
from config import DATABASE_URL


def _asyncpg_url(url: str) -> str:
    return url.split("?")[0]


async def run() -> None:
    conn = await asyncpg.connect(
        _asyncpg_url(DATABASE_URL), ssl="require", statement_cache_size=0, timeout=120
    )
    try:
        await conn.execute("""
            ALTER TABLE hpd_violations
                ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION,
                ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION
        """)
        print("Done — latitude and longitude columns added.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(run())
