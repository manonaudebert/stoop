-- Limit neighborhood density ranking to a 10-year window.
-- Records older than 10 years no longer contribute to weighted_violation_sum
-- or weighted_complaint_sum, so old buildings and new buildings are compared
-- on the same time horizon. Other aggregates (total_violations, open_violations,
-- total_complaints, etc.) are all-time and unchanged.

DROP MATERIALIZED VIEW IF EXISTS hpd_building_summary CASCADE;

CREATE MATERIALIZED VIEW hpd_building_summary AS
WITH base AS (
    SELECT
        v.bin,
        MAX(b.latitude)                             AS latitude,
        MAX(b.longitude)                            AS longitude,
        MAX(b.borough)                              AS borough,
        MAX(b.nta_code)                             AS nta_code,
        MAX(b.nta_name)                             AS nta_name,
        MAX(v.house_number || ' ' || v.street_name) AS address,
        MAX(v.zip_code)                             AS zip_code,
        MAX(b.footprint_area)                       AS footprint_area,
        MAX(b.height_roof)                          AS height_roof,
        COUNT(*)                                    AS total_violations,
        COUNT(*) FILTER (WHERE v.violation_status = 'Open')      AS open_violations,
        COUNT(*) FILTER (WHERE v.violation_class  = 'A')         AS class_a_violations,
        COUNT(*) FILTER (WHERE v.violation_class  = 'B')         AS class_b_violations,
        COUNT(*) FILTER (WHERE v.violation_status = 'Open' AND v.rent_impairing = 'Y') AS rent_impairing_count,
        MAX(v.nov_issued_date)                      AS latest_violation_date,
        COALESCE(SUM(
            CASE COALESCE(v.violation_class, 'I')
                WHEN 'C' THEN 15.0
                WHEN 'B' THEN  8.0
                WHEN 'A' THEN  3.0
                ELSE            1.0
            END *
            CASE
                WHEN v.nov_issued_date >= CURRENT_DATE - INTERVAL '2 years'  THEN 1.00
                WHEN v.nov_issued_date >= CURRENT_DATE - INTERVAL '5 years'  THEN 0.50
                WHEN v.nov_issued_date >= CURRENT_DATE - INTERVAL '10 years' THEN 0.25
            END
        ), 0.0)                                     AS weighted_violation_sum
    FROM hpd_violations v
    JOIN buildings b ON v.bin = b.bin
    WHERE v.bin IS NOT NULL
    GROUP BY v.bin
),
with_scale AS (
    SELECT *,
        CASE
            WHEN footprint_area > 0 AND height_roof > 0
            THEN footprint_area * GREATEST(height_roof / 12.0, 1.0)
        END AS estimated_scale
    FROM base
),
with_density AS (
    SELECT *,
        ROUND(
            (weighted_violation_sum / NULLIF(estimated_scale, 0) * 10000)::numeric, 4
        ) AS weighted_violations_density
    FROM with_scale
),
nta_density_pct AS (
    SELECT bin,
        ROUND((
            PERCENT_RANK() OVER (
                PARTITION BY nta_code
                ORDER BY weighted_violations_density ASC
            ) * 100
        )::numeric, 1) AS violations_density_pct
    FROM with_density
    WHERE nta_code IS NOT NULL AND weighted_violations_density IS NOT NULL
)
SELECT
    wd.bin, wd.latitude, wd.longitude, wd.borough, wd.nta_code, wd.nta_name,
    wd.address, wd.zip_code,
    wd.total_violations, wd.open_violations,
    wd.class_a_violations, wd.class_b_violations, wd.rent_impairing_count,
    wd.latest_violation_date,
    wd.weighted_violation_sum,
    wd.estimated_scale,
    wd.weighted_violations_density,
    np.violations_density_pct
FROM with_density wd
LEFT JOIN nta_density_pct np ON wd.bin = np.bin;

CREATE UNIQUE INDEX hpd_building_summary_bin_idx         ON hpd_building_summary(bin);
CREATE INDEX        hpd_building_summary_borough_idx     ON hpd_building_summary(borough);
CREATE INDEX        hpd_building_summary_lat_idx         ON hpd_building_summary(latitude);
CREATE INDEX        hpd_building_summary_open_idx        ON hpd_building_summary(open_violations DESC);
CREATE INDEX        hpd_building_summary_density_pct_idx ON hpd_building_summary(violations_density_pct);


DROP MATERIALIZED VIEW IF EXISTS hpd_complaints_building_summary CASCADE;

CREATE MATERIALIZED VIEW hpd_complaints_building_summary AS
WITH base AS (
    SELECT
        c.bin,
        MAX(b.latitude)                             AS latitude,
        MAX(b.longitude)                            AS longitude,
        MAX(b.borough)                              AS borough,
        MAX(b.nta_code)                             AS nta_code,
        MAX(b.nta_name)                             AS nta_name,
        MAX(c.house_number || ' ' || c.street_name) AS address,
        MAX(c.zip_code)                             AS zip_code,
        MAX(b.footprint_area)                       AS footprint_area,
        MAX(b.height_roof)                          AS height_roof,
        COUNT(*)                                    AS total_complaints,
        COUNT(*) FILTER (WHERE c.complaint_status = 'Open')                 AS open_complaints,
        COUNT(*) FILTER (WHERE c.type IN ('EMERGENCY', 'IMMEDIATE EMERGENCY')
                           AND c.complaint_status = 'Open')                 AS open_emergency_complaints,
        COUNT(*) FILTER (WHERE c.major_category = 'HEAT/HOT WATER')        AS heat_complaints,
        MAX(c.received_date)                        AS latest_complaint_date,
        COALESCE(SUM(
            CASE COALESCE(c.type, 'NON EMERGENCY')
                WHEN 'IMMEDIATE EMERGENCY' THEN 15.0
                WHEN 'EMERGENCY'           THEN  8.0
                ELSE                             3.0
            END *
            CASE
                WHEN c.received_date >= CURRENT_DATE - INTERVAL '2 years'  THEN 1.00
                WHEN c.received_date >= CURRENT_DATE - INTERVAL '5 years'  THEN 0.50
                WHEN c.received_date >= CURRENT_DATE - INTERVAL '10 years' THEN 0.25
            END
        ), 0.0)                                     AS weighted_complaint_sum
    FROM hpd_complaints c
    JOIN buildings b ON c.bin = b.bin
    WHERE c.bin IS NOT NULL
    GROUP BY c.bin
),
with_scale AS (
    SELECT *,
        CASE
            WHEN footprint_area > 0 AND height_roof > 0
            THEN footprint_area * GREATEST(height_roof / 12.0, 1.0)
        END AS estimated_scale
    FROM base
),
with_density AS (
    SELECT *,
        ROUND(
            (weighted_complaint_sum / NULLIF(estimated_scale, 0) * 10000)::numeric, 4
        ) AS weighted_complaints_density
    FROM with_scale
),
nta_density_pct AS (
    SELECT bin,
        ROUND((
            PERCENT_RANK() OVER (
                PARTITION BY nta_code
                ORDER BY weighted_complaints_density ASC
            ) * 100
        )::numeric, 1) AS complaints_density_pct
    FROM with_density
    WHERE nta_code IS NOT NULL AND weighted_complaints_density IS NOT NULL
),
nta_raw_pct AS (
    SELECT bin,
        ROUND((
            PERCENT_RANK() OVER (
                PARTITION BY nta_code
                ORDER BY weighted_complaint_sum ASC
            ) * 100
        )::numeric, 1) AS complaints_raw_pct
    FROM with_density
    WHERE nta_code IS NOT NULL
)
SELECT
    wd.bin, wd.latitude, wd.longitude, wd.borough, wd.nta_code, wd.nta_name,
    wd.address, wd.zip_code,
    wd.total_complaints, wd.open_complaints,
    wd.open_emergency_complaints, wd.heat_complaints,
    wd.latest_complaint_date,
    wd.weighted_complaint_sum,
    wd.estimated_scale,
    wd.weighted_complaints_density,
    np.complaints_density_pct,
    rp.complaints_raw_pct,
    CASE
        WHEN wd.total_complaints < 5                                                        THEN 'Very low'
        WHEN COALESCE(np.complaints_density_pct, rp.complaints_raw_pct) IS NULL            THEN 'Very low'
        WHEN COALESCE(np.complaints_density_pct, rp.complaints_raw_pct) < 15              THEN 'Very low'
        WHEN COALESCE(np.complaints_density_pct, rp.complaints_raw_pct) < 40              THEN 'Low'
        WHEN COALESCE(np.complaints_density_pct, rp.complaints_raw_pct) < 70              THEN 'Moderate'
        WHEN COALESCE(np.complaints_density_pct, rp.complaints_raw_pct) < 90              THEN 'High'
        ELSE                                                                                    'Very high'
    END AS risk_level
FROM with_density wd
LEFT JOIN nta_density_pct np ON wd.bin = np.bin
LEFT JOIN nta_raw_pct     rp ON wd.bin = rp.bin;

CREATE UNIQUE INDEX hpd_complaints_building_summary_bin_idx         ON hpd_complaints_building_summary(bin);
CREATE INDEX        hpd_complaints_building_summary_borough_idx     ON hpd_complaints_building_summary(borough);
CREATE INDEX        hpd_complaints_building_summary_lat_idx         ON hpd_complaints_building_summary(latitude);
CREATE INDEX        hpd_complaints_building_summary_open_idx        ON hpd_complaints_building_summary(open_complaints DESC);
CREATE INDEX        hpd_complaints_building_summary_density_pct_idx ON hpd_complaints_building_summary(complaints_density_pct);
CREATE INDEX        hpd_complaints_building_summary_risk_level_idx  ON hpd_complaints_building_summary(risk_level);
