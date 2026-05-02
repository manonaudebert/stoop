"""Recompute all building metrics and refresh summary views after a load or sync."""
import asyncio
import asyncpg
from config import DATABASE_URL


def _asyncpg_url(url: str) -> str:
    return url.split('?')[0]


async def refresh():
    print("Refreshing building_summary…")
    conn = await asyncpg.connect(_asyncpg_url(DATABASE_URL), ssl='require', statement_cache_size=0)
    await conn.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY building_summary")
    row = await conn.fetchrow("SELECT COUNT(*) AS n FROM building_summary")
    print(f"  → {row['n']:,} buildings in summary")

    print("Refreshing nta_stats…")
    await conn.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY nta_stats")
    row = await conn.fetchrow("SELECT COUNT(*) AS n FROM nta_stats")
    print(f"  → {row['n']:,} NTAs in stats")

    await conn.close()
    print("Done.")


if __name__ == "__main__":
    asyncio.run(refresh())
