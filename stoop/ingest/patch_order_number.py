"""Patch order_number into the existing parquet and hpd_violations table.

Reads only ViolationID + OrderNumber from the raw CSV — much faster than a
full re-clean + reload.
"""
import asyncio
from pathlib import Path

import asyncpg
import pandas as pd

from config import DATABASE_URL

RAW_DIR   = Path(__file__).parent.parent / "data" / "raw"
CLEAN_DIR = Path(__file__).parent.parent / "data" / "clean"

CHUNK_SIZE   = 200_000
UPDATE_BATCH = 5_000


def _asyncpg_url(url: str) -> str:
    return url.split("?")[0]


def _find_raw_file() -> Path:
    matches = sorted(RAW_DIR.glob("Housing_Maintenance_Code_Violations*.csv"))
    if not matches:
        raise FileNotFoundError("No Housing_Maintenance_Code_Violations*.csv found in data/raw/")
    return matches[-1]


def _read_order_map() -> pd.DataFrame:
    raw_path = _find_raw_file()
    print(f"Reading ViolationID + OrderNumber from {raw_path.name}…")

    chunks = []
    rows_read = 0
    for chunk in pd.read_csv(
        raw_path,
        usecols=["ViolationID", "OrderNumber"],
        dtype=str,
        chunksize=CHUNK_SIZE,
    ):
        chunk = chunk.rename(columns={"ViolationID": "violation_id", "OrderNumber": "order_number"})
        chunk["violation_id"] = chunk["violation_id"].str.strip()
        chunks.append(chunk)
        rows_read += len(chunk)
        print(f"  … {rows_read:,} rows read")

    order_map = (
        pd.concat(chunks, ignore_index=True)
        .drop_duplicates(subset=["violation_id"], keep="last")
    )
    print(f"Loaded {len(order_map):,} unique violation IDs.")
    return order_map


def patch_parquet(order_map: pd.DataFrame) -> None:
    path = CLEAN_DIR / "hpd_violations.parquet"
    print("Patching parquet…")
    df = pd.read_parquet(path)
    df = df.drop(columns=["order_number"], errors="ignore")
    df = df.merge(order_map, on="violation_id", how="left")
    df.to_parquet(path, index=False)
    print(f"  {len(df):,} rows written → {path}")


async def patch_db(order_map: pd.DataFrame) -> None:
    conn = await asyncpg.connect(
        _asyncpg_url(DATABASE_URL), ssl="require", statement_cache_size=0
    )
    try:
        print("Updating hpd_violations in database…")
        total = 0
        for start in range(0, len(order_map), UPDATE_BATCH):
            chunk = order_map.iloc[start : start + UPDATE_BATCH]
            chunk = chunk.where(pd.notnull(chunk), None)
            records = list(chunk.itertuples(index=False, name=None))
            await conn.executemany(
                "UPDATE hpd_violations SET order_number = $2 WHERE violation_id = $1",
                records,
            )
            total += len(records)
            print(f"  … {total:,} rows updated")
        print(f"Done — {total:,} rows updated.")
    finally:
        await conn.close()


async def run() -> None:
    order_map = _read_order_map()
    patch_parquet(order_map)
    await patch_db(order_map)


if __name__ == "__main__":
    asyncio.run(run())
