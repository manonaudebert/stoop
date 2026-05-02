"""Seed complaint_disposition_codes from NYC Open Data dataset 6v9u-ndjg."""
import asyncio
import httpx
import asyncpg
from config import DATABASE_URL, SOCRATA_APP_TOKEN

DISPOSITION_CODES_API = "https://data.cityofnewyork.us/resource/6v9u-ndjg.json"


async def seed():
    print("Fetching disposition codes from NYC Open Data...")
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            DISPOSITION_CODES_API,
            params={"$limit": 500},
            headers={"X-App-Token": SOCRATA_APP_TOKEN},
            timeout=30,
        )
        resp.raise_for_status()
        records = resp.json()

    print(f"  → {len(records)} codes fetched")

    conn = await asyncpg.connect(DATABASE_URL)
    try:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS complaint_disposition_codes (
                code        TEXT PRIMARY KEY,
                description TEXT NOT NULL
            )
        """)
        await conn.executemany(
            """INSERT INTO complaint_disposition_codes (code, description)
               VALUES ($1, $2)
               ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description""",
            [(r["code"], r["disposition"]) for r in records],
        )
        count = await conn.fetchval("SELECT COUNT(*) FROM complaint_disposition_codes")
        print(f"  → {count} rows in complaint_disposition_codes")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(seed())
