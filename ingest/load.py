"""Bulk-load data/clean/complaints.parquet into the complaints table."""
import asyncio
import os
import pandas as pd
import asyncpg
from tqdm import tqdm
from config import DATABASE_URL, DB_COLUMNS

CLEAN_DIR  = os.path.join(os.path.dirname(__file__), '..', 'data', 'clean')
BATCH_SIZE = 50_000


def _asyncpg_url(url: str) -> str:
    return url.split('?')[0]


async def load():
    path = os.path.join(CLEAN_DIR, 'complaints.parquet')
    df = pd.read_parquet(path)
    total = len(df)
    print(f"Loading {total:,} rows into complaints…")

    conn = await asyncpg.connect(
        _asyncpg_url(DATABASE_URL),
        ssl='require',
        statement_cache_size=0,
    )

    loaded = 0
    async with conn.transaction():
        await conn.execute("TRUNCATE complaints RESTART IDENTITY CASCADE")
        with tqdm(total=total, unit='rows') as bar:
            for start in range(0, total, BATCH_SIZE):
                batch = df.iloc[start:start + BATCH_SIZE].where(pd.notnull(df.iloc[start:start + BATCH_SIZE]), None)
                records = [tuple(row) for row in batch.itertuples(index=False, name=None)]
                await conn.copy_records_to_table('complaints', records=records, columns=DB_COLUMNS)
                loaded += len(records)
                bar.update(len(records))

    await conn.close()
    print(f"Done — {loaded:,} rows inserted.")


if __name__ == "__main__":
    asyncio.run(load())
