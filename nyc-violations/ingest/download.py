"""Stream-download the complaints CSV to data/raw/complaints.csv."""
import os
import httpx
from tqdm import tqdm
from config import COMPLAINTS_CSV

RAW_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'raw')


def download(url: str, dest: str) -> None:
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    print(f"Downloading {url}")
    with httpx.stream("GET", url, follow_redirects=True, timeout=600) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0)) or None
        with open(dest, "wb") as f, tqdm(total=total, unit="B", unit_scale=True) as bar:
            for chunk in r.iter_bytes(chunk_size=1 << 20):
                f.write(chunk)
                bar.update(len(chunk))
    print(f"  → saved to {dest}")


if __name__ == "__main__":
    download(COMPLAINTS_CSV, os.path.join(RAW_DIR, "complaints.csv"))
