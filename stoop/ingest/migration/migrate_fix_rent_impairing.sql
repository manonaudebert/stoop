-- Fix rent_impairing_count in hpd_building_summary.
-- Previously only counted OPEN rent-impairing violations; now counts all of them
-- so the KPI matches what tenants see in the violation log.

DROP MATERIALIZED VIEW IF EXISTS hpd_building_summary;

CREATE MATERIALIZED VIEW hpd_building_summary AS
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
    COUNT(*) FILTER (WHERE v.violation_status = 'Open')   AS open_violations,
    COUNT(*) FILTER (WHERE v.violation_class  = 'A')      AS class_a_violations,
    COUNT(*) FILTER (WHERE v.violation_class  = 'B')      AS class_b_violations,
    COUNT(*) FILTER (WHERE v.rent_impairing   = 'Y')      AS rent_impairing_count,
    MAX(v.nov_issued_date) AS latest_violation_date
FROM hpd_violations v
JOIN buildings b ON v.bin = b.bin
WHERE v.bin IS NOT NULL
GROUP BY v.bin;

CREATE UNIQUE INDEX hpd_building_summary_bin_idx ON hpd_building_summary(bin);
CREATE INDEX hpd_building_summary_borough_idx    ON hpd_building_summary(borough);
CREATE INDEX hpd_building_summary_lat_idx        ON hpd_building_summary(latitude);
CREATE INDEX hpd_building_summary_open_idx       ON hpd_building_summary(open_violations DESC);
