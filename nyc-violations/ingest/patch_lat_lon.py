"""Patch latitude and longitude into the existing parquet and hpd_violations table.

Reads only ViolationID, Latitude, Longitude from the raw CSV.
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


def _read_coords() -> pd.DataFrame:
    raw_path = _find_raw_file()
    print(f"Reading ViolationID + Latitude + Longitude from {raw_path.name}…")

    chunks = []
    rows_read = 0
    for chunk in pd.read_csv(
        raw_path,
        usecols=["ViolationID", "Latitude", "Longitude"],
        dtype=str,
        chunksize=CHUNK_SIZE,
    ):
        chunk = chunk.rename(columns={
            "ViolationID": "violation_id",
            "Latitude":    "latitude",
            "Longitude":   "longitude",
        })
        chunk["violation_id"] = chunk["violation_id"].str.strip()
        chunk["latitude"]  = pd.to_numeric(chunk["latitude"],  errors="coerce")
        chunk["longitude"] = pd.to_numeric(chunk["longitude"], errors="coerce")
        chunks.append(chunk)
        rows_read += len(chunk)
        print(f"  … {rows_read:,} rows read")

    coords = (
        pd.concat(chunks, ignore_index=True)
        .drop_duplicates(subset=["violation_id"], keep="last")
    )
    has_coords = coords[["latitude", "longitude"]].notna().all(axis=1).sum()
    print(f"Loaded {len(coords):,} violation IDs — {has_coords:,} with valid coordinates.")
    return coords


def patch_parquet(coords: pd.DataFrame) -> None:
    path = CLEAN_DIR / "hpd_violations.parquet"
    print("Patching parquet…")
    df = pd.read_parquet(path)
    df = df.drop(columns=["latitude", "longitude"], errors="ignore")
    df = df.merge(coords, on="violation_id", how="left")
    df.to_parquet(path, index=False)
    print(f"  {len(df):,} rows written → {path}")


async def patch_db(coords: pd.DataFrame) -> None:
    conn = await asyncpg.connect(
        _asyncpg_url(DATABASE_URL), ssl="require", statement_cache_size=0, timeout=120
    )
    try:
        print("Updating hpd_violations in database…")
        total = 0
        for start in range(0, len(coords), UPDATE_BATCH):
            chunk = coords.iloc[start : start + UPDATE_BATCH]
            chunk = chunk.where(pd.notnull(chunk), None)
            records = list(chunk.itertuples(index=False, name=None))
            await conn.executemany(
                "UPDATE hpd_violations SET latitude = $2, longitude = $3 WHERE violation_id = $1",
                records,
            )
            total += len(records)
            print(f"  … {total:,} rows updated")
        print(f"Done — {total:,} rows updated.")
    finally:
        await conn.close()


async def run() -> None:
    coords = _read_coords()
    patch_parquet(coords)
    await patch_db(coords)


if __name__ == "__main__":
    asyncio.run(run())
