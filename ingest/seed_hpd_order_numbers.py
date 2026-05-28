"""Seed hpd_order_numbers lookup table from the HPD data dictionary Excel file."""
import asyncio
from pathlib import Path

import asyncpg
import pandas as pd

from config import DATABASE_URL

DICT_PATH = Path(__file__).parent.parent.parent / "reference" / "HPD_Code_Violations_Data_Dictionary.xlsx"


def _asyncpg_url(url: str) -> str:
    return url.split("?")[0]


def load_order_numbers() -> list[tuple]:
    df = pd.read_excel(DICT_PATH, sheet_name="Order Number", dtype=str, header=1)
    df.columns = ["order_number", "full_description", "category", "short_description", "md_pd"]

    df = df.dropna(subset=["order_number"])
    df["order_number"] = df["order_number"].str.strip()

    # Normalize trailing whitespace in category and fix MD\PD typo
    df["category"] = df["category"].str.strip()
    df["md_pd"] = df["md_pd"].str.strip().str.replace("\\", "/", regex=False)

    for col in ("full_description", "short_description"):
        df[col] = df[col].str.strip()

    return [tuple(row) for row in df.itertuples(index=False, name=None)]


async def run() -> None:
    records = load_order_numbers()
    print(f"Seeding {len(records)} order number codes…")

    conn = await asyncpg.connect(
        _asyncpg_url(DATABASE_URL), ssl="require", statement_cache_size=0
    )
    try:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS hpd_order_numbers (
                order_number      TEXT PRIMARY KEY,
                full_description  TEXT,
                category          TEXT,
                short_description TEXT,
                md_pd             TEXT
            )
        """)
        await conn.executemany("""
            INSERT INTO hpd_order_numbers
                (order_number, full_description, category, short_description, md_pd)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (order_number) DO UPDATE SET
                full_description  = EXCLUDED.full_description,
                category          = EXCLUDED.category,
                short_description = EXCLUDED.short_description,
                md_pd             = EXCLUDED.md_pd
        """, records)
        print(f"Done — {len(records)} rows upserted into hpd_order_numbers.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(run())
