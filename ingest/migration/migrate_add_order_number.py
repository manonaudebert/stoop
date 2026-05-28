"""Add order_number column to hpd_violations (post-migration patch)."""
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
        _asyncpg_url(DATABASE_URL), ssl="require", statement_cache_size=0
    )
    try:
        await conn.execute(
            "ALTER TABLE hpd_violations ADD COLUMN IF NOT EXISTS order_number TEXT"
        )
        print("Done — order_number column added.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(run())
