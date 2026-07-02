-- User accounts for auth
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Static lookup: complaint disposition codes from NYC Open Data (6v9u-ndjg)
CREATE TABLE IF NOT EXISTS complaint_disposition_codes (
    code        TEXT PRIMARY KEY,
    description TEXT NOT NULL
);

-- Static lookup: complaint category codes from DOB PDF
CREATE TABLE IF NOT EXISTS complaint_categories (
    code        TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    priority    TEXT NOT NULL CHECK (priority IN ('A', 'B', 'C', 'D'))
);

-- Building centroids from NYC building footprints dataset (5zhs-2jue)
-- BIN first digit = borough: 1=Manhattan 2=Bronx 3=Brooklyn 4=Queens 5=Staten Island
CREATE TABLE IF NOT EXISTS buildings (
    bin               TEXT PRIMARY KEY,
    latitude          DOUBLE PRECISION,
    longitude         DOUBLE PRECISION,
    borough           TEXT,
    construction_year TEXT,
    nta_code          TEXT,
    nta_name          TEXT,
    nta_type          INTEGER,
    footprint_area    DOUBLE PRECISION,  -- sq ft (State Plane), from shape_area
    height_roof       DOUBLE PRECISION   -- ft, from heightroof
);

CREATE INDEX IF NOT EXISTS idx_buildings_nta ON buildings(nta_code);

CREATE INDEX IF NOT EXISTS idx_buildings_borough ON buildings(borough);

-- Main complaints table (DOB Complaints Received — eabe-havv)
CREATE TABLE IF NOT EXISTS complaints (
    id                 BIGSERIAL PRIMARY KEY,
    complaint_number   TEXT UNIQUE NOT NULL,
    status             TEXT,
    date_entered       DATE,
    house_number       TEXT,
    house_street       TEXT,
    address            TEXT GENERATED ALWAYS AS
                           (COALESCE(house_number,'') || ' ' || COALESCE(house_street,''))
                           STORED,
    zip_code           TEXT,
    bin                TEXT,
    community_board    TEXT,
    special_district   TEXT,
    complaint_category TEXT,
    unit               TEXT,
    disposition_date   DATE,
    disposition_code   TEXT,
    inspection_date    DATE,
    borough            TEXT,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_complaints_bin           ON complaints(bin);
CREATE INDEX IF NOT EXISTS idx_complaints_zip           ON complaints(zip_code);
CREATE INDEX IF NOT EXISTS idx_complaints_borough       ON complaints(borough);
CREATE INDEX IF NOT EXISTS idx_complaints_date_entered  ON complaints(date_entered);
CREATE INDEX IF NOT EXISTS idx_complaints_status        ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_category      ON complaints(complaint_category);

-- Static lookup: HPD order number codes from data dictionary
CREATE TABLE IF NOT EXISTS hpd_order_numbers (
    order_number      TEXT PRIMARY KEY,
    full_description  TEXT,
    category          TEXT,
    short_description TEXT,
    md_pd             TEXT
);

-- HPD Housing Maintenance Code Violations (wvxf-dwi5)
-- Class: C=Immediately hazardous, B=Hazardous, A=Non-hazardous, I=Informational
CREATE TABLE IF NOT EXISTS hpd_violations (
    violation_id         TEXT PRIMARY KEY,
    bin                  TEXT,
    borough              TEXT,
    house_number         TEXT,
    street_name          TEXT,
    zip_code             TEXT,
    apartment            TEXT,
    violation_class      TEXT,
    inspection_date      DATE,
    approved_date        DATE,
    certified_date       DATE,
    nov_description      TEXT,
    nov_issued_date      DATE,
    current_status       TEXT,
    current_status_date  DATE,
    violation_status     TEXT,
    rent_impairing       TEXT,
    order_number         TEXT,
    latitude             DOUBLE PRECISION,
    longitude            DOUBLE PRECISION,
    community_board      TEXT,
    bbl                  TEXT,
    created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hpd_bin             ON hpd_violations(bin);
CREATE INDEX IF NOT EXISTS idx_hpd_nov_issued      ON hpd_violations(nov_issued_date);
CREATE INDEX IF NOT EXISTS idx_hpd_status_date     ON hpd_violations(current_status_date);
CREATE INDEX IF NOT EXISTS idx_hpd_violation_status ON hpd_violations(violation_status);
CREATE INDEX IF NOT EXISTS idx_hpd_class           ON hpd_violations(violation_class);

-- HPD Housing Maintenance Code Complaints (ygpa-z7cr)
-- Primary key: problem_id (one row per problem within a complaint_id group)
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

-- Per-building summary for fast map rendering and building detail pages
CREATE MATERIALIZED VIEW IF NOT EXISTS building_summary AS
WITH hpd_agg AS (
    SELECT
        bin,
        COUNT(*) FILTER (WHERE violation_status = 'Open')                          AS hpd_open_violations,
        COUNT(*) FILTER (WHERE violation_class  = 'A')                             AS hpd_class_a_violations,
        COUNT(*) FILTER (WHERE violation_class  = 'B')                             AS hpd_class_b_violations,
        COUNT(*) FILTER (WHERE violation_status = 'Open' AND rent_impairing = 'Y') AS hpd_rent_impairing,
        MAX(nov_issued_date)                                                        AS hpd_latest_date
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
        MAX(c.house_number || ' ' || c.house_street)    AS address,
        MAX(c.zip_code)                                 AS zip_code,
        MAX(c.borough)                                  AS borough,
        MAX(b.latitude)                                 AS latitude,
        MAX(b.longitude)                                AS longitude,
        MAX(b.nta_code)                                 AS nta_code,
        MAX(b.nta_name)                                 AS nta_name,
        MAX(b.nta_type)                                 AS nta_type,
        MAX(b.footprint_area)                           AS footprint_area,
        MAX(b.height_roof)                              AS height_roof,
        COUNT(*)                                        AS total_complaints,
        COUNT(*) FILTER (WHERE c.status = 'ACTIVE')     AS open_complaints,
        COUNT(*) FILTER (WHERE c.status = 'CLOSED')     AS closed_complaints,
        COUNT(*) FILTER (WHERE cc.priority = 'A')                       AS priority_a_complaints,
        COUNT(*) FILTER (WHERE cc.priority IN ('A','B'))                 AS priority_ab_complaints,
        COUNT(*) FILTER (WHERE cc.priority IN ('A','B')
                           AND c.date_entered >= CURRENT_DATE - INTERVAL '5 years') AS priority_ab_5yr,
        COUNT(*) FILTER (WHERE cc.priority IN ('A','B')
                           AND c.date_entered >= CURRENT_DATE - INTERVAL '2 years') AS priority_ab_2yr,
        -- Active (open) counts by priority for the KPI cards
        COUNT(*) FILTER (WHERE cc.priority = 'A' AND c.status = 'ACTIVE')         AS open_priority_a_complaints,
        COUNT(*) FILTER (WHERE cc.priority = 'B' AND c.status = 'ACTIVE')         AS open_priority_b_complaints,
        -- Unable-to-access (past 5 yrs): inspector couldn't gain entry (disposition codes C1–C8, WB)
        -- Denominator is closed complaints in the same 5-yr window (active excluded).
        COUNT(*) FILTER (
            WHERE c.disposition_code IN ('C1','C2','C3','C4','C5','C6','C7','C8','WB')
              AND c.date_entered >= CURRENT_DATE - INTERVAL '5 years'
        )                                               AS no_access_count_5yr,
        COUNT(*) FILTER (
            WHERE c.status = 'CLOSED'
              AND c.date_entered >= CURRENT_DATE - INTERVAL '5 years'
        )                                               AS closed_5yr_complaints,
        MIN(c.date_entered)                             AS first_complaint_date,
        MAX(c.date_entered)                             AS latest_complaint_date,
        COUNT(*) FILTER (
            WHERE c.date_entered >= CURRENT_DATE - INTERVAL '2 years'
        )                                               AS recent_complaint_count,
        COUNT(*) FILTER (
            WHERE c.date_entered >= CURRENT_DATE - INTERVAL '5 years'
              AND c.date_entered <  CURRENT_DATE - INTERVAL '2 years'
        )                                               AS prior_complaint_count,
        -- Weighted sum exposed separately so it can be used for normalization.
        -- Hard 10-year cutoff: complaints older than 10 years contribute nothing,
        -- matching the HPD methodology in hpd_building_summary.
        COALESCE(SUM(
            CASE COALESCE(cc.priority, 'C')
                WHEN 'A' THEN 15.0
                WHEN 'B' THEN  8.0
                WHEN 'C' THEN  3.0
                ELSE            1.0
            END *
            CASE
                WHEN c.date_entered >= CURRENT_DATE - INTERVAL '2 years'  THEN 1.00
                WHEN c.date_entered >= CURRENT_DATE - INTERVAL '5 years'  THEN 0.50
                WHEN c.date_entered >= CURRENT_DATE - INTERVAL '10 years' THEN 0.25
            END
        ), 0.0)                                         AS weighted_complaint_sum,
        -- Serious rate: priority A+B per year, 10-year window, floored at 1 year.
        -- Only complaints within the last 10 years are counted; denominator is
        -- capped at 10 so old and new buildings are compared on the same horizon.
        -- Matches the HPD methodology used in hpd_building_summary.
        COUNT(*) FILTER (WHERE cc.priority IN ('A','B')
                           AND c.date_entered >= CURRENT_DATE - INTERVAL '10 years')::numeric
            / GREATEST(
                LEAST(
                    (CURRENT_DATE - MIN(c.date_entered))::float / 365.25,
                    10.0
                ),
                1.0
            )                                           AS serious_rate
    FROM complaints c
    LEFT JOIN buildings b  ON c.bin = b.bin
    LEFT JOIN complaint_categories cc ON c.complaint_category = cc.code
    WHERE c.bin IS NOT NULL AND c.bin NOT IN ('0', '0000000', '')
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
with_trend AS (
    SELECT *,
        CASE WHEN estimated_scale > 0
             THEN ROUND((weighted_complaint_sum / estimated_scale * 10000)::numeric, 4)
        END AS normalized_complaint_density,
        -- Size-normalized serious rate: Priority A+B per year per unit of building volume.
        -- NULL when no footprint/height data (same condition as normalized_complaint_density).
        CASE WHEN estimated_scale > 0
             THEN ROUND((serious_rate / estimated_scale * 10000)::numeric, 4)
        END AS normalized_serious_density,
        (recent_complaint_count::float / 2.0) - (prior_complaint_count::float / 3.0) AS trend,
        CASE
            WHEN (recent_complaint_count::float / 2.0)
               - (prior_complaint_count::float / 3.0) < -1 THEN 'improving'
            WHEN (recent_complaint_count::float / 2.0)
               - (prior_complaint_count::float / 3.0) >  1 THEN 'worsening'
            ELSE 'stable'
        END AS trend_direction
    FROM with_scale
),
-- Percentiles among residential peers (nta_type = 0) within each NTA
residential_percentiles AS (
    SELECT
        bin,
        ROUND((
            PERCENT_RANK() OVER (PARTITION BY nta_code ORDER BY serious_rate ASC)
            * 100
        )::numeric, 1) AS serious_rate_percentile
    FROM with_trend
    WHERE nta_type = 0 AND nta_code IS NOT NULL
),
-- Size-normalized overall complaint density percentiles
normalized_percentiles AS (
    SELECT bin,
        ROUND((
            PERCENT_RANK() OVER (PARTITION BY nta_code ORDER BY normalized_complaint_density ASC)
            * 100
        )::numeric, 1) AS normalized_percentile
    FROM with_trend
    WHERE nta_type = 0 AND nta_code IS NOT NULL AND normalized_complaint_density IS NOT NULL
),
-- Size-normalized serious-rate percentiles (Priority A+B per yr per building volume)
normalized_serious_percentiles AS (
    SELECT bin,
        ROUND((
            PERCENT_RANK() OVER (PARTITION BY nta_code ORDER BY normalized_serious_density ASC)
            * 100
        )::numeric, 1) AS normalized_serious_rate_percentile
    FROM with_trend
    WHERE nta_type = 0 AND nta_code IS NOT NULL AND normalized_serious_density IS NOT NULL
),
final AS (
    SELECT
        wt.*,
        rp.serious_rate_percentile,
        np.normalized_percentile,
        nsp.normalized_serious_rate_percentile,
        COALESCE(h.hpd_open_violations,    0) AS hpd_open_violations,
        COALESCE(h.hpd_class_a_violations, 0) AS hpd_class_a_violations,
        COALESCE(h.hpd_class_b_violations, 0) AS hpd_class_b_violations,
        COALESCE(h.hpd_rent_impairing,     0) AS hpd_rent_impairing,
        h.hpd_latest_date,
        COALESCE(hc.hpd_open_complaints,   0) AS hpd_open_complaints,
        COALESCE(hc.hpd_heat_complaints,   0) AS hpd_heat_complaints,
        hc.hpd_latest_complaint_date
    FROM with_trend wt
    LEFT JOIN residential_percentiles        rp  ON wt.bin = rp.bin
    LEFT JOIN normalized_percentiles         np  ON wt.bin = np.bin
    LEFT JOIN normalized_serious_percentiles nsp ON wt.bin = nsp.bin
    LEFT JOIN hpd_agg h                          ON wt.bin = h.bin
    LEFT JOIN hpd_complaints_agg hc              ON wt.bin = hc.bin
)
SELECT
    bin, address, zip_code, borough, latitude, longitude,
    nta_code, nta_name, nta_type,
    total_complaints, open_complaints, closed_complaints,
    priority_a_complaints, priority_ab_complaints, priority_ab_5yr, priority_ab_2yr,
    open_priority_a_complaints, open_priority_b_complaints,
    no_access_count_5yr, closed_5yr_complaints,
    first_complaint_date, latest_complaint_date,
    serious_rate,
    serious_rate_percentile,
    recent_complaint_count,
    prior_complaint_count,
    trend_direction,
    estimated_scale,
    normalized_complaint_density,
    normalized_percentile,
    normalized_serious_density,
    normalized_serious_rate_percentile,
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
        WHEN normalized_percentile IS NULL THEN 'Not comparable'
        WHEN normalized_percentile < 15    THEN 'Very low'
        WHEN normalized_percentile < 40    THEN 'Low'
        WHEN normalized_percentile < 70    THEN 'Moderate'
        WHEN normalized_percentile < 90    THEN 'High'
        ELSE                                    'Very high'
    END AS risk_level
FROM final;

CREATE UNIQUE INDEX IF NOT EXISTS building_summary_bin_idx            ON building_summary(bin);
CREATE INDEX IF NOT EXISTS building_summary_borough_idx               ON building_summary(borough);
CREATE INDEX IF NOT EXISTS building_summary_lat_idx                   ON building_summary(latitude);
CREATE INDEX IF NOT EXISTS building_summary_zip_idx                   ON building_summary(zip_code);
CREATE INDEX IF NOT EXISTS building_summary_total_idx                 ON building_summary(total_complaints DESC);
CREATE INDEX IF NOT EXISTS building_summary_open_idx                  ON building_summary(open_complaints DESC);
CREATE INDEX IF NOT EXISTS building_summary_priority_a_idx            ON building_summary(priority_a_complaints DESC);
CREATE INDEX IF NOT EXISTS building_summary_normalized_density_idx    ON building_summary(normalized_complaint_density);
CREATE INDEX IF NOT EXISTS building_summary_normalized_serious_idx    ON building_summary(normalized_serious_rate_percentile);

-- NTA-level aggregates for neighborhood context
CREATE MATERIALIZED VIEW IF NOT EXISTS nta_stats AS
SELECT
    b.nta_code,
    b.nta_name,
    b.nta_type,
    COUNT(*)                                                                            AS building_count,
    ROUND((PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY bs.serious_rate))::numeric, 2) AS median_serious_rate
FROM building_summary bs
JOIN buildings b ON bs.bin = b.bin
WHERE b.nta_code IS NOT NULL
GROUP BY b.nta_code, b.nta_name, b.nta_type;

CREATE UNIQUE INDEX IF NOT EXISTS nta_stats_code_idx ON nta_stats(nta_code);

-- Per-building HPD violation summary for fast map rendering
CREATE MATERIALIZED VIEW IF NOT EXISTS hpd_building_summary AS
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
                -- older than 10 years: NULL excluded from SUM
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

CREATE UNIQUE INDEX IF NOT EXISTS hpd_building_summary_bin_idx
    ON hpd_building_summary(bin);
CREATE INDEX IF NOT EXISTS hpd_building_summary_borough_idx
    ON hpd_building_summary(borough);
CREATE INDEX IF NOT EXISTS hpd_building_summary_lat_idx
    ON hpd_building_summary(latitude);
CREATE INDEX IF NOT EXISTS hpd_building_summary_open_idx
    ON hpd_building_summary(open_violations DESC);
CREATE INDEX IF NOT EXISTS hpd_building_summary_density_pct_idx
    ON hpd_building_summary(violations_density_pct);

-- Per-building HPD complaint summary for fast map rendering
CREATE MATERIALIZED VIEW IF NOT EXISTS hpd_complaints_building_summary AS
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
        COUNT(*) FILTER (WHERE c.complaint_status = 'Open')                          AS open_complaints,
        COUNT(*) FILTER (WHERE c.type IN ('EMERGENCY', 'IMMEDIATE EMERGENCY')
                           AND c.complaint_status = 'Open')                          AS open_emergency_complaints,
        COUNT(*) FILTER (WHERE c.major_category = 'HEAT/HOT WATER')                 AS heat_complaints,
        COUNT(*) FILTER (
            WHERE c.received_date >= CURRENT_DATE - INTERVAL '2 years'
        )                                                                            AS recent_complaint_count,
        COUNT(*) FILTER (
            WHERE c.received_date >= CURRENT_DATE - INTERVAL '5 years'
              AND c.received_date <  CURRENT_DATE - INTERVAL '2 years'
        )                                                                            AS prior_complaint_count,
        COUNT(*) FILTER (
            WHERE c.type IN ('EMERGENCY', 'IMMEDIATE EMERGENCY')
              AND c.received_date >= CURRENT_DATE - INTERVAL '2 years'
        )                                                                            AS recent_emergency_count,
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
                -- older than 10 years: NULL excluded from SUM
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
with_trend AS (
    SELECT *,
        CASE
            WHEN (recent_complaint_count::float / 2.0)
               - (prior_complaint_count::float  / 3.0) >  1 THEN 'worsening'
            WHEN (recent_complaint_count::float / 2.0)
               - (prior_complaint_count::float  / 3.0) < -1 THEN 'improving'
            ELSE 'stable'
        END AS trend_direction
    FROM with_density
),
nta_density_pct AS (
    SELECT bin,
        ROUND((
            PERCENT_RANK() OVER (
                PARTITION BY nta_code
                ORDER BY weighted_complaints_density ASC
            ) * 100
        )::numeric, 1) AS complaints_density_pct
    FROM with_trend
    WHERE nta_code IS NOT NULL AND weighted_complaints_density IS NOT NULL
),
-- Fallback percentile for buildings without footprint/height data
nta_raw_pct AS (
    SELECT bin,
        ROUND((
            PERCENT_RANK() OVER (
                PARTITION BY nta_code
                ORDER BY weighted_complaint_sum ASC
            ) * 100
        )::numeric, 1) AS complaints_raw_pct
    FROM with_trend
    WHERE nta_code IS NOT NULL
)
SELECT
    wd.bin, wd.latitude, wd.longitude, wd.borough, wd.nta_code, wd.nta_name,
    wd.address, wd.zip_code,
    wd.total_complaints, wd.open_complaints,
    wd.open_emergency_complaints, wd.heat_complaints,
    wd.recent_complaint_count, wd.prior_complaint_count,
    wd.recent_emergency_count,
    wd.trend_direction,
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
FROM with_trend wd
LEFT JOIN nta_density_pct np ON wd.bin = np.bin
LEFT JOIN nta_raw_pct     rp ON wd.bin = rp.bin;

CREATE UNIQUE INDEX IF NOT EXISTS hpd_complaints_building_summary_bin_idx
    ON hpd_complaints_building_summary(bin);
CREATE INDEX IF NOT EXISTS hpd_complaints_building_summary_borough_idx
    ON hpd_complaints_building_summary(borough);
CREATE INDEX IF NOT EXISTS hpd_complaints_building_summary_lat_idx
    ON hpd_complaints_building_summary(latitude);
CREATE INDEX IF NOT EXISTS hpd_complaints_building_summary_open_idx
    ON hpd_complaints_building_summary(open_complaints DESC);
CREATE INDEX IF NOT EXISTS hpd_complaints_building_summary_recent_idx
    ON hpd_complaints_building_summary(recent_complaint_count DESC);
CREATE INDEX IF NOT EXISTS hpd_complaints_building_summary_density_pct_idx
    ON hpd_complaints_building_summary(complaints_density_pct);
CREATE INDEX IF NOT EXISTS hpd_complaints_building_summary_risk_level_idx
    ON hpd_complaints_building_summary(risk_level);

-- ── SF (San Francisco) ────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS sf_parcels (
    mapblklot             TEXT PRIMARY KEY,
    blklot                TEXT,
    analysis_neighborhood TEXT,
    centroid_latitude     DOUBLE PRECISION,
    centroid_longitude    DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS idx_sf_parcels_neighborhood ON sf_parcels(analysis_neighborhood);

CREATE TABLE IF NOT EXISTS sf_footprints (
    mblr               TEXT PRIMARY KEY,
    mapblklot          TEXT,
    footprint_area_sqm DOUBLE PRECISION,
    hgt_median_m       DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS idx_sf_footprints_mapblklot ON sf_footprints(mapblklot);

CREATE TABLE IF NOT EXISTS sf_311_housing (
    service_request_id TEXT PRIMARY KEY,
    service_name       TEXT,
    service_subtype    TEXT,
    address            TEXT,
    point_lat          DOUBLE PRECISION,
    point_lon          DOUBLE PRECISION,
    requested_datetime TIMESTAMPTZ,
    status_description TEXT,
    mapblklot          TEXT
);
CREATE INDEX IF NOT EXISTS idx_sf_311_mapblklot ON sf_311_housing(mapblklot);
CREATE INDEX IF NOT EXISTS idx_sf_311_datetime  ON sf_311_housing(requested_datetime);
CREATE INDEX IF NOT EXISTS idx_sf_311_subtype   ON sf_311_housing(service_subtype);

CREATE TABLE IF NOT EXISTS sf_dbi_nov (
    row_id                   TEXT PRIMARY KEY,
    block                    TEXT,
    lot                      TEXT,
    mapblklot                TEXT,
    status                   TEXT,
    nov_category_description TEXT,
    item                     TEXT,
    nov_item_description     TEXT,
    date_filed               DATE,
    neighborhood             TEXT,
    location_lat             DOUBLE PRECISION,
    location_lon             DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS idx_sf_dbi_nov_mapblklot ON sf_dbi_nov(mapblklot);
CREATE INDEX IF NOT EXISTS idx_sf_dbi_nov_status    ON sf_dbi_nov(status);
CREATE INDEX IF NOT EXISTS idx_sf_dbi_nov_date      ON sf_dbi_nov(date_filed);

CREATE TABLE IF NOT EXISTS sf_addresses (
    eas_fullid     TEXT PRIMARY KEY,
    address        TEXT,
    parcel_number  TEXT,
    eas_baseid     TEXT,
    latitude       DOUBLE PRECISION,
    longitude      DOUBLE PRECISION,
    nhood          TEXT
);
CREATE INDEX IF NOT EXISTS idx_sf_addresses_parcel       ON sf_addresses(parcel_number);
CREATE INDEX IF NOT EXISTS idx_sf_addresses_address_trgm ON sf_addresses USING gin(address gin_trgm_ops);

-- ── sf_housing_complaints_summary ────────────────────────────────────────────
-- Mirrors hpd_complaints_building_summary, parcel-grained. See
-- ingest/migration/migrate_add_sf.sql for the authoritative definition and
-- METRICS.md for the methodology (severity map, decay weights, risk floors).
DROP MATERIALIZED VIEW IF EXISTS sf_housing_complaints_summary;
CREATE MATERIALIZED VIEW sf_housing_complaints_summary AS
WITH footprint_agg AS (
    SELECT
        mapblklot,
        SUM(footprint_area_sqm) AS footprint_area_sqm,
        MAX(hgt_median_m)       AS hgt_median_m
    FROM sf_footprints
    WHERE mapblklot IS NOT NULL
    GROUP BY mapblklot
),
eas_repr AS (
    SELECT DISTINCT ON (parcel_number)
        parcel_number AS mapblklot,
        address
    FROM sf_addresses
    WHERE parcel_number IS NOT NULL
    ORDER BY parcel_number, eas_fullid
),
base AS (
    SELECT
        c.mapblklot,
        MAX(e.address)                                    AS address,
        MAX(p.centroid_latitude)                          AS latitude,
        MAX(p.centroid_longitude)                         AS longitude,
        MAX(p.analysis_neighborhood)                      AS neighborhood,
        MAX(f.footprint_area_sqm)                         AS footprint_area_sqm,
        MAX(f.hgt_median_m)                               AS hgt_median_m,
        COUNT(*)                                          AS total_complaints,
        COUNT(*) FILTER (
            WHERE c.requested_datetime >= CURRENT_TIMESTAMP - INTERVAL '2 years'
        )                                                 AS recent_complaint_count,
        COUNT(*) FILTER (
            WHERE c.requested_datetime >= CURRENT_TIMESTAMP - INTERVAL '5 years'
              AND c.requested_datetime <  CURRENT_TIMESTAMP - INTERVAL '2 years'
        )                                                 AS prior_complaint_count,
        COUNT(*) FILTER (
            WHERE LOWER(REGEXP_REPLACE(c.service_subtype, '^Building - ', '', 'i'))
                  IN ('heat_lack_of_heat', 'hot_water_lack_of_hot_water')
        )                                                 AS heat_complaints,
        COUNT(*) FILTER (
            WHERE LOWER(REGEXP_REPLACE(c.service_subtype, '^Building - ', '', 'i'))
                  = 'paint_lead_violating_safe_practices'
        )                                                 AS lead_complaints,
        COUNT(*) FILTER (
            WHERE LOWER(REGEXP_REPLACE(c.service_subtype, '^Building - ', '', 'i'))
                  IN ('infestation_rodent_insect', 'infestation_bed_bugs')
        )                                                 AS pest_complaints,
        MAX(c.requested_datetime::date)                   AS latest_complaint_date,
        COALESCE(SUM(
            CASE LOWER(REGEXP_REPLACE(c.service_subtype, '^Building - ', '', 'i'))
                WHEN 'heat_lack_of_heat'                                   THEN 15.0
                WHEN 'hot_water_lack_of_hot_water'                         THEN 15.0
                WHEN 'paint_lead_violating_safe_practices'                 THEN 15.0
                WHEN 'blocked_exit_common_areas'                           THEN 15.0
                WHEN 'fire_hazard'                                         THEN 15.0
                WHEN 'elevators_no_working_elevator_7_or_more_stories'     THEN 15.0
                WHEN 'electrical_hazardous_condition'                      THEN 15.0
                WHEN 'fire_alarm_system'                                   THEN 15.0
                WHEN 'smoke_detectors_missing_broken_unit_interior'        THEN 15.0
                WHEN 'fire_extinguishers_missing_expired'                  THEN 15.0
                WHEN 'fire_sprinkler_system'                               THEN 15.0
                WHEN 'smoke_detectors_missing_broken_common_areas'         THEN 15.0
                WHEN 'infestation_rodent_insect'                           THEN  8.0
                WHEN 'mold_and_mildew'                                     THEN  8.0
                WHEN 'plumbing_broken_leaking'                             THEN  8.0
                WHEN 'infestation_bed_bugs'                                THEN  8.0
                WHEN 'elevators_everthing_else'                            THEN  8.0
                WHEN 'doors_windows_broken_defective'                      THEN  8.0
                WHEN 'bathroom'                                            THEN  8.0
                WHEN 'ventilation_inadequate_or_none'                      THEN  8.0
                WHEN 'security_inadequately_secured_perimeter'             THEN  8.0
                WHEN 'deck_stairs_handrails'                               THEN  8.0
                WHEN 'light_wells_dirty_flooded'                           THEN  8.0
                WHEN 'general_maintenance_not_in_list_above'               THEN  3.0
                WHEN 'inadequately_maintained_building_exterior'           THEN  3.0
                WHEN 'paint_peeling'                                       THEN  3.0
                WHEN 'garbage_receptacles'                                 THEN  3.0
                WHEN 'clutter_hoarder_unit_interior_storage'               THEN  3.0
                WHEN 'electrical_non_hazard'                               THEN  3.0
                WHEN 'second_hand_smoke'                                   THEN  3.0
                WHEN 'noise_caused_by_building_systems'                    THEN  3.0
                WHEN 'kitchen_community'                                   THEN  3.0
                WHEN 'mail_service_delivery_problem'                       THEN  3.0
                WHEN 'illegal_construction_no_permit_exceeds_permit_scope' THEN  0.0
                WHEN 'illegal_guest_room_conversions'                      THEN  0.0
                WHEN 'visitor_policy_violations'                           THEN  0.0
                ELSE 3.0
            END *
            CASE
                WHEN c.requested_datetime >= CURRENT_TIMESTAMP - INTERVAL '2 years'  THEN 1.00
                WHEN c.requested_datetime >= CURRENT_TIMESTAMP - INTERVAL '5 years'  THEN 0.50
                WHEN c.requested_datetime >= CURRENT_TIMESTAMP - INTERVAL '10 years' THEN 0.25
            END
        ), 0.0)                                           AS weighted_complaint_sum
    FROM sf_311_housing c
    JOIN sf_parcels p ON c.mapblklot = p.mapblklot
    LEFT JOIN footprint_agg f ON f.mapblklot = c.mapblklot
    LEFT JOIN eas_repr e ON e.mapblklot = c.mapblklot
    WHERE c.mapblklot IS NOT NULL
    GROUP BY c.mapblklot
),
with_scale AS (
    SELECT *,
        CASE
            WHEN footprint_area_sqm > 0 AND hgt_median_m > 0
            THEN footprint_area_sqm * GREATEST(hgt_median_m, 1.0)
        END AS estimated_scale
    FROM base
),
with_density AS (
    SELECT *,
        ROUND(COALESCE(
            weighted_complaint_sum / NULLIF(estimated_scale, 0) * 1000,
            weighted_complaint_sum
        )::numeric, 4) AS weighted_complaints_density
    FROM with_scale
),
with_trend AS (
    SELECT *,
        CASE
            WHEN (recent_complaint_count::float / 2.0)
               - (prior_complaint_count::float  / 3.0) >  1 THEN 'worsening'
            WHEN (recent_complaint_count::float / 2.0)
               - (prior_complaint_count::float  / 3.0) < -1 THEN 'improving'
            ELSE 'stable'
        END AS trend_direction
    FROM with_density
),
neighborhood_density_pct AS (
    SELECT mapblklot,
        ROUND((
            PERCENT_RANK() OVER (
                PARTITION BY neighborhood
                ORDER BY weighted_complaints_density ASC
            ) * 100
        )::numeric, 1) AS complaints_density_pct
    FROM with_trend
    WHERE neighborhood IS NOT NULL
)
SELECT
    wt.mapblklot,
    wt.address,
    wt.latitude,
    wt.longitude,
    wt.neighborhood,
    wt.total_complaints,
    wt.recent_complaint_count,
    wt.prior_complaint_count,
    wt.trend_direction,
    wt.heat_complaints,
    wt.lead_complaints,
    wt.pest_complaints,
    wt.latest_complaint_date,
    wt.weighted_complaint_sum,
    wt.estimated_scale,
    wt.weighted_complaints_density,
    np.complaints_density_pct,
    CASE
        WHEN wt.total_complaints < 2               THEN 'Very low'
        WHEN np.complaints_density_pct IS NULL     THEN 'Very low'
        WHEN np.complaints_density_pct < 15        THEN 'Very low'
        WHEN np.complaints_density_pct < 40        THEN 'Low'
        WHEN np.complaints_density_pct < 70        THEN 'Moderate'
        WHEN np.complaints_density_pct < 90        THEN 'High'
        ELSE                                            'Very high'
    END AS risk_level
FROM with_trend wt
LEFT JOIN neighborhood_density_pct np ON wt.mapblklot = np.mapblklot;

CREATE UNIQUE INDEX IF NOT EXISTS sf_housing_complaints_summary_mapblklot_idx
    ON sf_housing_complaints_summary(mapblklot);
CREATE INDEX IF NOT EXISTS sf_housing_complaints_summary_neighborhood_idx
    ON sf_housing_complaints_summary(neighborhood);
CREATE INDEX IF NOT EXISTS sf_housing_complaints_summary_lat_idx
    ON sf_housing_complaints_summary(latitude);
CREATE INDEX IF NOT EXISTS sf_housing_complaints_summary_recent_idx
    ON sf_housing_complaints_summary(recent_complaint_count DESC);
CREATE INDEX IF NOT EXISTS sf_housing_complaints_summary_risk_idx
    ON sf_housing_complaints_summary(risk_level);
CREATE INDEX IF NOT EXISTS sf_housing_complaints_summary_density_pct_idx
    ON sf_housing_complaints_summary(complaints_density_pct);

-- ── sf_violations_summary ────────────────────────────────────────────────────
-- Mirrors hpd_building_summary, parcel-grained. See migrate_add_sf.sql / METRICS.md.
DROP MATERIALIZED VIEW IF EXISTS sf_violations_summary;
CREATE MATERIALIZED VIEW sf_violations_summary AS
WITH footprint_agg AS (
    SELECT
        mapblklot,
        SUM(footprint_area_sqm) AS footprint_area_sqm,
        MAX(hgt_median_m)       AS hgt_median_m
    FROM sf_footprints
    WHERE mapblklot IS NOT NULL
    GROUP BY mapblklot
),
eas_repr AS (
    SELECT DISTINCT ON (parcel_number)
        parcel_number AS mapblklot,
        address
    FROM sf_addresses
    WHERE parcel_number IS NOT NULL
    ORDER BY parcel_number, eas_fullid
),
base AS (
    SELECT
        v.mapblklot,
        MAX(e.address)                                              AS address,
        MAX(p.centroid_latitude)                                    AS latitude,
        MAX(p.centroid_longitude)                                   AS longitude,
        COALESCE(MAX(p.analysis_neighborhood), MAX(v.neighborhood)) AS neighborhood,
        MAX(f.footprint_area_sqm)                                   AS footprint_area_sqm,
        MAX(f.hgt_median_m)                                         AS hgt_median_m,
        COUNT(*)                                                    AS total_violations,
        COUNT(*) FILTER (WHERE LOWER(v.status) = 'active')          AS open_violations,
        COUNT(*) FILTER (
            WHERE LOWER(v.nov_category_description) = 'lead section'
              AND LOWER(v.status) = 'active'
        )                                                           AS open_lead_violations,
        COUNT(*) FILTER (
            WHERE LOWER(v.nov_category_description) = 'fire section'
              AND LOWER(v.status) = 'active'
        )                                                           AS open_fire_violations,
        MAX(v.date_filed)                                           AS latest_violation_date,
        COALESCE(SUM(
            CASE LOWER(v.nov_category_description)
                WHEN 'fire section'                    THEN 15.0
                WHEN 'smoke detection section'         THEN 15.0
                WHEN 'lead section'                    THEN 15.0
                WHEN 'building section'                THEN  8.0
                WHEN 'plumbing and electrical section' THEN  8.0
                WHEN 'interior surfaces section'       THEN  8.0
                WHEN 'sanitation section'              THEN  8.0
                WHEN 'security requirements section'   THEN  8.0
                ELSE 3.0
            END *
            CASE
                WHEN v.date_filed >= CURRENT_DATE - INTERVAL '2 years'  THEN 1.00
                WHEN v.date_filed >= CURRENT_DATE - INTERVAL '5 years'  THEN 0.50
                WHEN v.date_filed >= CURRENT_DATE - INTERVAL '10 years' THEN 0.25
            END
        ), 0.0)                                                     AS weighted_violation_sum
    FROM sf_dbi_nov v
    JOIN sf_parcels p ON v.mapblklot = p.mapblklot
    LEFT JOIN footprint_agg f ON f.mapblklot = v.mapblklot
    LEFT JOIN eas_repr e ON e.mapblklot = v.mapblklot
    WHERE v.mapblklot IS NOT NULL
    GROUP BY v.mapblklot
),
with_scale AS (
    SELECT *,
        CASE
            WHEN footprint_area_sqm > 0 AND hgt_median_m > 0
            THEN footprint_area_sqm * GREATEST(hgt_median_m, 1.0)
        END AS estimated_scale
    FROM base
),
with_density AS (
    SELECT *,
        ROUND(COALESCE(
            weighted_violation_sum / NULLIF(estimated_scale, 0) * 1000,
            weighted_violation_sum
        )::numeric, 4) AS weighted_violations_density
    FROM with_scale
),
neighborhood_density_pct AS (
    SELECT mapblklot,
        ROUND((
            PERCENT_RANK() OVER (
                PARTITION BY neighborhood
                ORDER BY weighted_violations_density ASC
            ) * 100
        )::numeric, 1) AS violations_density_pct
    FROM with_density
    WHERE neighborhood IS NOT NULL
)
SELECT
    wd.mapblklot,
    wd.address,
    wd.latitude,
    wd.longitude,
    wd.neighborhood,
    wd.total_violations,
    wd.open_violations,
    wd.open_lead_violations,
    wd.open_fire_violations,
    wd.latest_violation_date,
    wd.weighted_violation_sum,
    wd.estimated_scale,
    wd.weighted_violations_density,
    np.violations_density_pct,
    CASE
        WHEN wd.total_violations < 3               THEN 'Very low'
        WHEN np.violations_density_pct IS NULL     THEN 'Very low'
        WHEN np.violations_density_pct < 15        THEN 'Very low'
        WHEN np.violations_density_pct < 40        THEN 'Low'
        WHEN np.violations_density_pct < 70        THEN 'Moderate'
        WHEN np.violations_density_pct < 90        THEN 'High'
        ELSE                                            'Very high'
    END AS risk_level
FROM with_density wd
LEFT JOIN neighborhood_density_pct np ON wd.mapblklot = np.mapblklot;

CREATE UNIQUE INDEX IF NOT EXISTS sf_violations_summary_mapblklot_idx
    ON sf_violations_summary(mapblklot);
CREATE INDEX IF NOT EXISTS sf_violations_summary_neighborhood_idx
    ON sf_violations_summary(neighborhood);
CREATE INDEX IF NOT EXISTS sf_violations_summary_lat_idx
    ON sf_violations_summary(latitude);
CREATE INDEX IF NOT EXISTS sf_violations_summary_open_idx
    ON sf_violations_summary(open_violations DESC);
CREATE INDEX IF NOT EXISTS sf_violations_summary_risk_idx
    ON sf_violations_summary(risk_level);
CREATE INDEX IF NOT EXISTS sf_violations_summary_density_pct_idx
    ON sf_violations_summary(violations_density_pct);
