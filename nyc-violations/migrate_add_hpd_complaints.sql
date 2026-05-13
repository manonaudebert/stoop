-- Migration: add hpd_complaints table + hpd_complaints_building_summary mat view
--            and update building_summary + nta_stats with hpd_complaints_agg columns.
-- Run once against an existing database.
--
--   psql $DATABASE_URL -f nyc-violations/migrate_add_hpd_complaints.sql

-- 1. Create hpd_complaints table (idempotent)
CREATE TABLE IF NOT EXISTS hpd_complaints (
    problem_id            TEXT PRIMARY KEY,
    complaint_id          TEXT,
    bin                   TEXT,
    borough               TEXT,
    house_number          TEXT,
    street_name           TEXT,
    zip_code              TEXT,
    apartment             TEXT,
    unit_type             TEXT,
    space_type            TEXT,
    type                  TEXT,
    major_category        TEXT,
    minor_category        TEXT,
    problem_code          TEXT,
    complaint_status      TEXT,
    complaint_status_date DATE,
    problem_status        TEXT,
    problem_status_date   DATE,
    status_description    TEXT,
    received_date         DATE,
    latitude              DOUBLE PRECISION,
    longitude             DOUBLE PRECISION,
    community_board       TEXT,
    bbl                   TEXT,
    created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hpd_complaints_bin           ON hpd_complaints(bin);
CREATE INDEX IF NOT EXISTS idx_hpd_complaints_received      ON hpd_complaints(received_date);
CREATE INDEX IF NOT EXISTS idx_hpd_complaints_status_date   ON hpd_complaints(problem_status_date);
CREATE INDEX IF NOT EXISTS idx_hpd_complaints_status        ON hpd_complaints(complaint_status);
CREATE INDEX IF NOT EXISTS idx_hpd_complaints_major_cat     ON hpd_complaints(major_category);

-- 2. Create hpd_complaints_building_summary mat view (idempotent)
CREATE MATERIALIZED VIEW IF NOT EXISTS hpd_complaints_building_summary AS
SELECT
    c.bin,
    MAX(b.latitude)   AS latitude,
    MAX(b.longitude)  AS longitude,
    MAX(b.borough)    AS borough,
    MAX(b.nta_code)   AS nta_code,
    MAX(b.nta_name)   AS nta_name,
    MAX(c.house_number || ' ' || c.street_name) AS address,
    MAX(c.zip_code)   AS zip_code,
    COUNT(*)          AS total_complaints,
    COUNT(*) FILTER (WHERE c.complaint_status = 'Open')                          AS open_complaints,
    COUNT(*) FILTER (WHERE c.type IN ('EMERGENCY', 'IMMEDIATE EMERGENCY')
                       AND c.complaint_status = 'Open')                          AS open_emergency_complaints,
    COUNT(*) FILTER (WHERE c.major_category = 'HEAT/HOT WATER')                  AS heat_complaints,
    MAX(c.received_date) AS latest_complaint_date
FROM hpd_complaints c
JOIN buildings b ON c.bin = b.bin
WHERE c.bin IS NOT NULL
GROUP BY c.bin;

CREATE UNIQUE INDEX IF NOT EXISTS hpd_complaints_building_summary_bin_idx
    ON hpd_complaints_building_summary(bin);
CREATE INDEX IF NOT EXISTS hpd_complaints_building_summary_borough_idx
    ON hpd_complaints_building_summary(borough);
CREATE INDEX IF NOT EXISTS hpd_complaints_building_summary_lat_idx
    ON hpd_complaints_building_summary(latitude);
CREATE INDEX IF NOT EXISTS hpd_complaints_building_summary_open_idx
    ON hpd_complaints_building_summary(open_complaints DESC);

-- 3. Drop dependent materialized views so we can rebuild building_summary
DROP MATERIALIZED VIEW IF EXISTS nta_stats;
DROP MATERIALIZED VIEW IF EXISTS building_summary;

-- 4. Recreate building_summary with hpd_complaints_agg CTE
CREATE MATERIALIZED VIEW building_summary AS
WITH hpd_agg AS (
    SELECT
        bin,
        COUNT(*) FILTER (WHERE violation_status = 'Open')                           AS hpd_open_violations,
        COUNT(*) FILTER (WHERE violation_class  = 'A')                              AS hpd_class_a_violations,
        COUNT(*) FILTER (WHERE violation_class  = 'B')                              AS hpd_class_b_violations,
        COUNT(*) FILTER (WHERE violation_status = 'Open' AND rent_impairing = 'Y')  AS hpd_rent_impairing,
        MAX(nov_issued_date)                                                         AS hpd_latest_date
    FROM hpd_violations
    WHERE bin IS NOT NULL AND bin NOT IN ('0', '0000000', '1000000', '')
    GROUP BY bin
),
hpd_complaints_agg AS (
    SELECT
        bin,
        COUNT(*) FILTER (WHERE complaint_status = 'Open')         AS hpd_open_complaints,
        COUNT(*) FILTER (WHERE major_category = 'HEAT/HOT WATER') AS hpd_heat_complaints,
        MAX(received_date)                                         AS hpd_latest_complaint_date
    FROM hpd_complaints
    WHERE bin IS NOT NULL AND bin NOT IN ('0', '0000000', '1000000', '')
    GROUP BY bin
),
base AS (
    SELECT
        c.bin,
        MAX(c.house_number || ' ' || c.house_street)                            AS address,
        MAX(c.zip_code)                                                         AS zip_code,
        MAX(c.borough)                                                          AS borough,
        MAX(b.latitude)                                                         AS latitude,
        MAX(b.longitude)                                                        AS longitude,
        MAX(b.nta_code)                                                         AS nta_code,
        MAX(b.nta_name)                                                         AS nta_name,
        MAX(b.nta_type)                                                         AS nta_type,
        COUNT(*)                                                                AS total_complaints,
        COUNT(*) FILTER (WHERE c.status = 'ACTIVE')                             AS open_complaints,
        COUNT(*) FILTER (WHERE c.status = 'CLOSED')                             AS closed_complaints,
        COUNT(*) FILTER (WHERE cc.priority = 'A')                               AS priority_a_complaints,
        COUNT(*) FILTER (WHERE cc.priority IN ('A','B'))                         AS priority_ab_complaints,
        MIN(c.date_entered)                                                     AS first_complaint_date,
        MAX(c.date_entered)                                                     AS latest_complaint_date,
        COUNT(*) FILTER (
            WHERE c.date_entered >= CURRENT_DATE - INTERVAL '2 years'
        )                                                                       AS recent_complaint_count,
        COUNT(*) FILTER (
            WHERE c.date_entered >= CURRENT_DATE - INTERVAL '5 years'
              AND c.date_entered <  CURRENT_DATE - INTERVAL '2 years'
        )                                                                       AS prior_complaint_count,
        ROUND((100.0 * EXP(-COALESCE(SUM(
            CASE COALESCE(cc.priority, 'C')
                WHEN 'A' THEN 15.0
                WHEN 'B' THEN  8.0
                WHEN 'C' THEN  3.0
                ELSE            1.0
            END *
            CASE
                WHEN c.date_entered >= CURRENT_DATE - INTERVAL '2 years' THEN 1.00
                WHEN c.date_entered >= CURRENT_DATE - INTERVAL '5 years' THEN 0.50
                ELSE                                                           0.25
            END
        ), 0.0) / 40.0))::numeric, 1)                                          AS score_numeric,
        COUNT(*) FILTER (WHERE cc.priority IN ('A','B'))::numeric
            / GREATEST(
                (CURRENT_DATE - MIN(c.date_entered))::float / 365.25,
                1.0
            )                                                                   AS serious_rate
    FROM complaints c
    LEFT JOIN buildings b  ON c.bin = b.bin
    LEFT JOIN complaint_categories cc ON c.complaint_category = cc.code
    WHERE c.bin IS NOT NULL AND c.bin NOT IN ('0', '0000000', '')
    GROUP BY c.bin
),
with_trend AS (
    SELECT *,
        (recent_complaint_count::float / 2.0) - (prior_complaint_count::float / 3.0) AS trend,
        CASE
            WHEN (recent_complaint_count::float / 2.0)
               - (prior_complaint_count::float / 3.0) < -1 THEN 'improving'
            WHEN (recent_complaint_count::float / 2.0)
               - (prior_complaint_count::float / 3.0) >  1 THEN 'worsening'
            ELSE 'stable'
        END AS trend_direction
    FROM base
),
residential_percentiles AS (
    SELECT
        bin,
        ROUND((
            PERCENT_RANK() OVER (PARTITION BY nta_code ORDER BY serious_rate   ASC)
            * 100
        )::numeric, 1) AS serious_rate_percentile,
        ROUND((
            PERCENT_RANK() OVER (PARTITION BY nta_code ORDER BY score_numeric  DESC)
            * 100
        )::numeric, 1) AS neighborhood_percentile
    FROM with_trend
    WHERE nta_type = 0 AND nta_code IS NOT NULL
),
final AS (
    SELECT wt.*, rp.serious_rate_percentile, rp.neighborhood_percentile,
           COALESCE(h.hpd_open_violations,    0) AS hpd_open_violations,
           COALESCE(h.hpd_class_a_violations, 0) AS hpd_class_a_violations,
           COALESCE(h.hpd_class_b_violations, 0) AS hpd_class_b_violations,
           COALESCE(h.hpd_rent_impairing,     0) AS hpd_rent_impairing,
           h.hpd_latest_date,
           COALESCE(hc.hpd_open_complaints,   0) AS hpd_open_complaints,
           COALESCE(hc.hpd_heat_complaints,   0) AS hpd_heat_complaints,
           hc.hpd_latest_complaint_date
    FROM with_trend wt
    LEFT JOIN residential_percentiles rp  ON wt.bin = rp.bin
    LEFT JOIN hpd_agg h                   ON wt.bin = h.bin
    LEFT JOIN hpd_complaints_agg hc       ON wt.bin = hc.bin
)
SELECT
    bin, address, zip_code, borough, latitude, longitude,
    nta_code, nta_name, nta_type,
    total_complaints, open_complaints, closed_complaints,
    priority_a_complaints, priority_ab_complaints,
    first_complaint_date, latest_complaint_date,
    score_numeric,
    serious_rate,
    serious_rate_percentile,
    recent_complaint_count,
    prior_complaint_count,
    trend_direction,
    neighborhood_percentile,
    hpd_open_violations,
    hpd_class_a_violations,
    hpd_class_b_violations,
    hpd_rent_impairing,
    hpd_latest_date,
    hpd_open_complaints,
    hpd_heat_complaints,
    hpd_latest_complaint_date,
    CASE
        WHEN total_complaints < 10
          AND (
            first_complaint_date IS NULL
            OR (CURRENT_DATE - first_complaint_date)::float / 365.25 < 2
          ) THEN 'Insufficient data'
        WHEN neighborhood_percentile IS NULL THEN 'Not comparable'
        WHEN neighborhood_percentile < 15    THEN 'Very low'
        WHEN neighborhood_percentile < 40    THEN 'Low'
        WHEN neighborhood_percentile < 70    THEN 'Moderate'
        WHEN neighborhood_percentile < 90    THEN 'High'
        ELSE                                      'Very high'
    END AS risk_level
FROM final;

CREATE UNIQUE INDEX building_summary_bin_idx      ON building_summary(bin);
CREATE INDEX building_summary_borough_idx         ON building_summary(borough);
CREATE INDEX building_summary_zip_idx             ON building_summary(zip_code);
CREATE INDEX building_summary_total_idx           ON building_summary(total_complaints DESC);
CREATE INDEX building_summary_open_idx            ON building_summary(open_complaints DESC);
CREATE INDEX building_summary_priority_a_idx      ON building_summary(priority_a_complaints DESC);

-- 5. Recreate nta_stats (unchanged definition)
CREATE MATERIALIZED VIEW nta_stats AS
SELECT
    b.nta_code,
    b.nta_name,
    b.nta_type,
    COUNT(*)                                                                              AS building_count,
    ROUND(AVG(bs.score_numeric)::numeric, 1)                                              AS avg_score,
    ROUND((PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY bs.score_numeric))::numeric, 1)  AS p25_score,
    ROUND((PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY bs.score_numeric))::numeric, 1)  AS median_score,
    ROUND((PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY bs.score_numeric))::numeric, 1)  AS p75_score
FROM building_summary bs
JOIN buildings b ON bs.bin = b.bin
WHERE b.nta_code IS NOT NULL AND bs.score_numeric IS NOT NULL
GROUP BY b.nta_code, b.nta_name, b.nta_type;

CREATE UNIQUE INDEX nta_stats_code_idx ON nta_stats(nta_code);
