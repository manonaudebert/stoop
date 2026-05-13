"""Create the hpd_building_summary materialized view and its indexes."""
import asyncio
import asyncpg
from config import DATABASE_URL


def _asyncpg_url(url: str) -> str:
    return url.split("?")[0]


async def run() -> None:
    conn = await asyncpg.connect(
        _asyncpg_url(DATABASE_URL), ssl="require", statement_cache_size=0, timeout=120
    )
    try:
        print("Creating hpd_building_summary materialized view…")
        await conn.execute("""
            CREATE MATERIALIZED VIEW IF NOT EXISTS hpd_building_summary AS
            SELECT
                v.bin,
                MAX(b.latitude)   AS latitude,
                MAX(b.longitude)  AS longitude,
                MAX(b.borough)    AS borough,
                MAX(b.nta_code)   AS nta_code,
                MAX(b.nta_name)   AS nta_name,
                MAX(v.house_number || ' ' || v.street_name) AS address,
                MAX(v.zip_code)   AS zip_code,
                COUNT(*)          AS total_violations,
                COUNT(*) FILTER (WHERE v.violation_status = 'Open')                    AS open_violations,
                COUNT(*) FILTER (WHERE v.violation_class  = 'A')                       AS class_a_violations,
                COUNT(*) FILTER (WHERE v.violation_class  = 'B')                       AS class_b_violations,
                COUNT(*) FILTER (WHERE v.violation_status = 'Open'
                                   AND v.rent_impairing   = 'Y')                       AS rent_impairing_count,
                MAX(v.nov_issued_date) AS latest_violation_date
            FROM hpd_violations v
            JOIN buildings b ON v.bin = b.bin
            WHERE v.bin IS NOT NULL
            GROUP BY v.bin
        """)
        print("Creating indexes…")
        await conn.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS hpd_building_summary_bin_idx
                ON hpd_building_summary(bin)
        """)
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS hpd_building_summary_borough_idx
                ON hpd_building_summary(borough)
        """)
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS hpd_building_summary_lat_idx
                ON hpd_building_summary(latitude)
        """)
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS hpd_building_summary_open_idx
                ON hpd_building_summary(open_violations DESC)
        """)
        row = await conn.fetchrow("SELECT COUNT(*) AS n FROM hpd_building_summary")
        print(f"Done — {row['n']:,} buildings in hpd_building_summary.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(run())
