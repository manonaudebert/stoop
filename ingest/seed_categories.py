"""Insert complaint_categories lookup rows (idempotent)."""
import asyncio
import asyncpg
from config import DATABASE_URL, COMPLAINT_CATEGORIES


def _asyncpg_url(url: str) -> str:
    return url.split('?')[0]


async def seed():
    conn = await asyncpg.connect(_asyncpg_url(DATABASE_URL), ssl='require', statement_cache_size=0)
    rows = [(code, desc, priority) for code, (desc, priority) in COMPLAINT_CATEGORIES.items()]
    await conn.executemany(
        """
        INSERT INTO complaint_categories (code, description, priority)
        VALUES ($1, $2, $3)
        ON CONFLICT (code) DO UPDATE
            SET description = EXCLUDED.description,
                priority    = EXCLUDED.priority
        """,
        rows,
    )
    await conn.close()
    print(f"Seeded {len(rows)} complaint categories.")


if __name__ == "__main__":
    asyncio.run(seed())
