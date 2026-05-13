"""Run migrate_add_hpd_complaints.sql against the configured database."""
import asyncio
from pathlib import Path

import asyncpg

from config import DATABASE_URL

SQL_FILE = Path(__file__).parent.parent / "migrate_add_hpd_complaints.sql"


def _asyncpg_url(url: str) -> str:
    return url.split("?")[0]


async def run() -> None:
    sql = SQL_FILE.read_text()

    conn = await asyncpg.connect(
        _asyncpg_url(DATABASE_URL),
        ssl="require",
        statement_cache_size=0,
    )
    try:
        print(f"Running {SQL_FILE.name}…")
        await conn.execute(sql)
        print("Migration complete.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(run())
