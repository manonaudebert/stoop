"""Bulk-load data/clean/hpd_complaints.parquet into the hpd_complaints table."""
import asyncio
import os

import asyncpg
import pandas as pd
from tqdm import tqdm

from config import DATABASE_URL, HPD_COMPLAINTS_DB_COLUMNS

CLEAN_DIR  = os.path.join(os.path.dirname(__file__), '..', 'data', 'clean')
BATCH_SIZE = 50_000


def _asyncpg_url(url: str) -> str:
    return url.split('?')[0]


async def load() -> None:
    path = os.path.join(CLEAN_DIR, 'hpd_complaints.parquet')
    df = pd.read_parquet(path)
    total = len(df)
    print(f"Loading {total:,} rows into hpd_complaints…")

    conn = await asyncpg.connect(
        _asyncpg_url(DATABASE_URL),
        ssl='require',
        statement_cache_size=0,
    )

    loaded = 0
    async with conn.transaction():
        await conn.execute("TRUNCATE hpd_complaints RESTART IDENTITY CASCADE")
        with tqdm(total=total, unit='rows') as bar:
            for start in range(0, total, BATCH_SIZE):
                chunk = df.iloc[start:start + BATCH_SIZE]
                chunk = chunk.where(pd.notnull(chunk), None)
                records = [tuple(row) for row in chunk.itertuples(index=False, name=None)]
                await conn.copy_records_to_table(
                    'hpd_complaints', records=records, columns=HPD_COMPLAINTS_DB_COLUMNS
                )
                loaded += len(records)
                bar.update(len(records))

    await conn.close()
    print(f"Done — {loaded:,} rows inserted.")

    conn = await asyncpg.connect(
        _asyncpg_url(DATABASE_URL),
        ssl='require',
        statement_cache_size=0,
    )
    try:
        print("Refreshing hpd_complaints_building_summary…")
        await conn.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY hpd_complaints_building_summary")
        row = await conn.fetchrow("SELECT COUNT(*) AS n FROM hpd_complaints_building_summary")
        print(f"hpd_complaints_building_summary refreshed — {row['n']:,} buildings.")
        print("Refreshing building_summary…")
        await conn.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY building_summary")
        row = await conn.fetchrow("SELECT COUNT(*) AS n FROM building_summary")
        print(f"building_summary refreshed — {row['n']:,} buildings.")
        await conn.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY nta_stats")
        print("nta_stats refreshed.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(load())
