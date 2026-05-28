"""Recompute all building metrics and refresh summary views after a load or sync."""
import asyncio
import asyncpg
from config import DATABASE_URL


def _asyncpg_url(url: str) -> str:
    return url.split('?')[0]


async def refresh():
    conn = await asyncpg.connect(_asyncpg_url(DATABASE_URL), ssl='require', statement_cache_size=0)

    for view, label in [
        ("hpd_building_summary",            "HPD violation summary"),
        ("hpd_complaints_building_summary", "HPD complaint summary"),
        ("building_summary",                "DOB building summary"),
        ("nta_stats",                       "NTA stats"),
    ]:
        print(f"Refreshing {label}…")
        await conn.execute(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {view}")
        row = await conn.fetchrow(f"SELECT COUNT(*) AS n FROM {view}")
        print(f"  → {row['n']:,} rows")

    await conn.close()
    print("Done.")


if __name__ == "__main__":
    asyncio.run(refresh())
