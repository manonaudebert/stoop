"""Recreate hpd_building_summary so rent_impairing_count covers all violations, not just open ones."""
import asyncio
import sys
from pathlib import Path
import asyncpg

sys.path.insert(0, str(Path(__file__).parent.parent))
from config import DATABASE_URL

SQL_FILE = Path(__file__).parent / "migrate_fix_rent_impairing.sql"

def _asyncpg_url(url: str) -> str:
    return url.split("?")[0]

async def run() -> None:
    conn = await asyncpg.connect(_asyncpg_url(DATABASE_URL), ssl="require", statement_cache_size=0)
    try:
        print(f"Running {SQL_FILE.name}…")
        await conn.execute(SQL_FILE.read_text())
        row = await conn.fetchrow("SELECT COUNT(*) AS n FROM hpd_building_summary")
        print(f"Done — hpd_building_summary rebuilt ({row['n']:,} buildings).")
    finally:
        await conn.close()

if __name__ == "__main__":
    asyncio.run(run())
