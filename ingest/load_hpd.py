"""Bulk-load data/clean/hpd_violations.parquet into the hpd_violations table."""
import asyncio
import os

import asyncpg
import pandas as pd
from tqdm import tqdm

from config import DATABASE_URL, HPD_DB_COLUMNS

CLEAN_DIR  = os.path.join(os.path.dirname(__file__), '..', 'data', 'clean')
BATCH_SIZE = 50_000


def _asyncpg_url(url: str) -> str:
    return url.split('?')[0]


async def load() -> None:
    path = os.path.join(CLEAN_DIR, 'hpd_violations.parquet')
    df = pd.read_parquet(path)
    total = len(df)
    print(f"Loading {total:,} rows into hpd_violations…")

    conn = await asyncpg.connect(
        _asyncpg_url(DATABASE_URL),
        ssl='require',
        statement_cache_size=0,
    )

    loaded = 0
    async with conn.transaction():
        await conn.execute("TRUNCATE hpd_violations RESTART IDENTITY CASCADE")
        with tqdm(total=total, unit='rows') as bar:
            for start in range(0, total, BATCH_SIZE):
                chunk = df.iloc[start:start + BATCH_SIZE]
                chunk = chunk.where(pd.notnull(chunk), None)
                records = [tuple(row) for row in chunk.itertuples(index=False, name=None)]
                await conn.copy_records_to_table(
                    'hpd_violations', records=records, columns=HPD_DB_COLUMNS
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
        print("Refreshing hpd_building_summary…")
        await conn.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY hpd_building_summary")
        row = await conn.fetchrow("SELECT COUNT(*) AS n FROM hpd_building_summary")
        print(f"hpd_building_summary refreshed — {row['n']:,} buildings.")
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
