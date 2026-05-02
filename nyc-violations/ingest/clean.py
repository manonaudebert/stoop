"""Normalize complaints CSV → data/clean/complaints.parquet.

- Rename columns per COMPLAINTS_COLUMN_MAP
- Parse date columns
- Derive borough from BIN first digit
- Drop rows with no complaint_number
- Drop internal DOBRunDate column
"""
import os
import pandas as pd
from config import COMPLAINTS_COLUMN_MAP, BIN_BOROUGH_MAP, DB_COLUMNS

RAW_DIR   = os.path.join(os.path.dirname(__file__), '..', 'data', 'raw')
CLEAN_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'clean')


def _parse_date(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series, errors='coerce').dt.date


def _borough_from_bin(bin_series: pd.Series) -> pd.Series:
    first_digit = bin_series.fillna('').astype(str).str.strip().str[:1]
    return first_digit.map(BIN_BOROUGH_MAP)


if __name__ == "__main__":
    os.makedirs(CLEAN_DIR, exist_ok=True)
    print("Cleaning complaints…")

    df = pd.read_csv(
        os.path.join(RAW_DIR, 'complaints.csv'),
        dtype=str,
        low_memory=False,
    )

    df = df.rename(columns=COMPLAINTS_COLUMN_MAP)

    # Drop rows with no complaint number (can't upsert without a key)
    df = df.dropna(subset=['complaint_number'])
    df['complaint_number'] = df['complaint_number'].str.strip()
    df = df[df['complaint_number'] != '']

    # Parse dates
    for col in ('date_entered', 'disposition_date', 'inspection_date'):
        if col in df.columns:
            df[col] = _parse_date(df[col])

    # Derive borough from BIN
    df['borough'] = _borough_from_bin(df.get('bin', pd.Series(dtype=str)))

    # Normalize BIN: strip whitespace, treat '0' variants as null
    df['bin'] = df['bin'].fillna('').astype(str).str.strip()
    df.loc[df['bin'].str.lstrip('0') == '', 'bin'] = None

    # Ensure all DB columns exist
    for col in DB_COLUMNS:
        if col not in df.columns:
            df[col] = None

    # Deduplicate on complaint_number — keep last occurrence (most recent status)
    before = len(df)
    df = df.drop_duplicates(subset=['complaint_number'], keep='last')
    dupes = before - len(df)
    if dupes:
        print(f"  dropped {dupes:,} duplicate complaint_number rows")

    out = os.path.join(CLEAN_DIR, 'complaints.parquet')
    df[DB_COLUMNS].to_parquet(out, index=False)
    print(f"Done — {len(df):,} rows → {out}")
