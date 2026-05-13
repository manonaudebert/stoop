"""Normalize HPD Complaints CSV → data/clean/hpd_complaints.parquet.

- Rename columns per HPD_COMPLAINTS_COLUMN_MAP
- Parse date columns
- Drop rows with no problem_id
- Null out dummy BINs
- Write in chunks to avoid OOM on the ~14M row source file
"""
import os

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from config import HPD_COMPLAINTS_COLUMN_MAP, HPD_COMPLAINTS_DB_COLUMNS

RAW_DIR   = os.path.join(os.path.dirname(__file__), '..', 'data', 'raw')
CLEAN_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'clean')

DATE_COLS  = ("complaint_status_date", "problem_status_date", "received_date")
CHUNK_SIZE = 200_000


def _clean_chunk(df: pd.DataFrame) -> pd.DataFrame:
    df = df.rename(columns=HPD_COMPLAINTS_COLUMN_MAP)

    df = df.dropna(subset=["problem_id"])
    df["problem_id"] = df["problem_id"].astype(str).str.strip()
    df = df[df["problem_id"] != ""]

    for col in DATE_COLS:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors="coerce").dt.date

    bin_col = df.get("bin", pd.Series(dtype=str)).fillna("").astype(str).str.strip()
    df["bin"] = bin_col
    df.loc[df["bin"].str.lstrip("0").isin({"", "1000000"}), "bin"] = None

    for col in HPD_COMPLAINTS_DB_COLUMNS:
        if col not in df.columns:
            df[col] = None

    return df[HPD_COMPLAINTS_DB_COLUMNS]


def _find_raw_file() -> str:
    matches = [
        f for f in os.listdir(RAW_DIR)
        if f.startswith("HPD_Complaints") and f.endswith(".csv")
    ]
    if not matches:
        raise FileNotFoundError(
            "No HPD_Complaints*.csv found in data/raw/. "
            "Download it from https://data.cityofnewyork.us/api/views/ygpa-z7cr/rows.csv?accessType=DOWNLOAD"
        )
    return os.path.join(RAW_DIR, sorted(matches)[-1])


if __name__ == "__main__":
    os.makedirs(CLEAN_DIR, exist_ok=True)
    raw_path = _find_raw_file()
    out_path = os.path.join(CLEAN_DIR, "hpd_complaints.parquet")

    print(f"Cleaning {os.path.basename(raw_path)} in {CHUNK_SIZE:,}-row chunks…")

    writer = None
    total = 0

    for chunk in pd.read_csv(raw_path, chunksize=CHUNK_SIZE, dtype=str, low_memory=False):
        cleaned = _clean_chunk(chunk)
        table = pa.Table.from_pandas(cleaned, preserve_index=False)
        if writer is None:
            writer = pq.ParquetWriter(out_path, table.schema)
        writer.write_table(table)
        total += len(cleaned)
        print(f"  … {total:,} rows written")

    if writer:
        writer.close()

    print(f"Done — {total:,} rows → {out_path}")
