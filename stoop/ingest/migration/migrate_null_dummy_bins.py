"""Null out placeholder BIN values in hpd_violations and refresh building_summary."""
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
        result = await conn.execute("""
            UPDATE hpd_violations
            SET bin = NULL
            WHERE bin IN ('0', '0000000', '1000000', '')
        """)
        print(f"Nulled dummy BINs: {result}")

        print("Refreshing building_summary…")
        await conn.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY building_summary")
        row = await conn.fetchrow("SELECT COUNT(*) AS n FROM building_summary")
        print(f"building_summary refreshed — {row['n']:,} buildings.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(run())
