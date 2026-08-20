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

-- ── hpd_brief_signals ─────────────────────────────────────────────────────────
-- The seven signals behind the Building Brief's rules, one row per building.
-- Generated from `api/services/briefs/signals.py` — see the note there before
-- editing the category lists, which come from renter-facing-groups.json.

CREATE MATERIALIZED VIEW IF NOT EXISTS hpd_brief_signals AS
WITH bins AS (
    -- Every building with an HPD page. Violations and complaints do not cover
    -- the same set: a building can have complaints and no violations, and the
    -- page renders for both, so a brief must exist for both.
    SELECT bin FROM hpd_building_summary
    UNION
    SELECT bin FROM hpd_complaints_building_summary
),
viol AS (
    SELECT
        v.bin,
        COUNT(*) FILTER (
            WHERE v.violation_status = 'Open' AND v.violation_class = 'C'
        )                                                   AS open_class_c_violations,
        -- Two predicates, not one: the current LEAD-BASED PAINT category, plus
        -- the repealed order numbers whose category is RETIRED but whose
        -- violations are open lead paint. See RETIRED_LEAD_ORDER_NUMBERS —
        -- 22% of open lead violations live under the second branch.
        COUNT(*) FILTER (
            WHERE v.violation_status = 'Open'
              AND (
                o.category = 'LEAD-BASED PAINT'
                OR v.order_number = ANY(ARRAY['555', '606', '607', '610', '611', '612', '614'])
              )
        )                                                   AS lead_paint_violations,
        -- Smoke and CO in one signal: the source treats them as one section and
        -- the guidance is identical. Neither category carries any open class C
        -- violations, so this cannot be folded into the class C signal.
        COUNT(*) FILTER (
            WHERE v.violation_status = 'Open'
              AND o.category = ANY(ARRAY['SMOKE DETECTING DEVICES', 'CARBON MONOXIDE DETECTING DEVICES'])
        )                                                   AS smoke_co_detector_violations
    FROM hpd_violations v
    -- LEFT, not INNER: a violation whose order number is missing from
    -- hpd_order_numbers still counts toward the class C signal, which does not
    -- depend on the category at all.
    LEFT JOIN hpd_order_numbers o ON v.order_number = o.order_number
    WHERE v.bin IS NOT NULL
    GROUP BY v.bin
),
hazard AS (
    -- The categories behind this building's OPEN class C violations, most
    -- common first. Without these the class C rule is the only abstract one in
    -- the set: "conditions HPD classifies as immediately hazardous" names no
    -- observable thing, and a model asked for something concrete anyway
    -- invented nouns that traced to nothing in its input.
    --
    -- Three states must stay distinct downstream and this view preserves them:
    -- a non-empty array, an empty array (flagged, nothing describable — 4.6% of
    -- class C buildings), and NULL (not flagged at all). Collapsing the empty
    -- array into NULL restores the invented-nouns bug.
    SELECT bin, array_agg(category ORDER BY n DESC, category) AS open_class_c_categories
    FROM (
        SELECT
            v.bin, o.category, COUNT(*) AS n,
            ROW_NUMBER() OVER (
                PARTITION BY v.bin ORDER BY COUNT(*) DESC, o.category
            ) AS rn
        FROM hpd_violations v
        JOIN hpd_order_numbers o ON v.order_number = o.order_number
        WHERE v.violation_status = 'Open'
          AND v.violation_class = 'C'
          AND v.bin IS NOT NULL
          AND o.category IS NOT NULL
        GROUP BY v.bin, o.category
    ) ranked
    WHERE rn <= 3
    GROUP BY bin
),
comp AS (
    SELECT
        c.bin,
        COUNT(*) FILTER (
            WHERE c.minor_category = ANY(ARRAY['MOLD'])
        )                                                   AS mold_complaints,
        COUNT(*) FILTER (
            WHERE c.minor_category = ANY(ARRAY['PESTS', 'VERMIN'])
        )                                                   AS pest_complaints,
        -- Grouped by the shared taxonomy, NOT by major_category. See the note
        -- on HEAT_CATEGORIES in signals.py before changing this.
        COUNT(*) FILTER (
            WHERE c.minor_category = ANY(ARRAY['APARTMENT ONLY', 'ENTIRE BUILDING', 'HEAT RELATED', 'HEAT-PLANT', 'RADIATOR', 'SPACE HEATER', 'BOILER'])
        )                                                   AS heat_hot_water_complaints
    FROM hpd_complaints c
    WHERE c.bin IS NOT NULL
      AND c.received_date >= CURRENT_DATE - INTERVAL '5 years'
    GROUP BY c.bin
)
SELECT
    b.bin,
    COALESCE(viol.open_class_c_violations, 0)       AS open_class_c_violations,
    COALESCE(viol.lead_paint_violations, 0)         AS lead_paint_violations,
    COALESCE(viol.smoke_co_detector_violations, 0)  AS smoke_co_detector_violations,
    -- Deliberately NOT coalesced to an empty array: NULL means "class C never
    -- fired", [] means "fired, nothing describable". Three states, not two.
    hazard.open_class_c_categories,
    COALESCE(comp.mold_complaints, 0)               AS mold_complaints,
    COALESCE(comp.pest_complaints, 0)               AS pest_complaints,
    COALESCE(comp.heat_hot_water_complaints, 0)     AS heat_hot_water_complaints,
    -- The two confidence.py inputs. Read off the existing summary views rather
    -- than recomputed, so "thin record" and "stale record" mean exactly what
    -- they mean everywhere else on the site. Both are all-time on purpose: a
    -- record is not thin because it is old.
    COALESCE(hv.total_violations, 0)
        + COALESCE(hc.total_complaints, 0)          AS hpd_record_count,
    GREATEST(hv.latest_violation_date, hc.latest_complaint_date) AS latest_hpd_activity
FROM bins b
LEFT JOIN viol   ON viol.bin   = b.bin
LEFT JOIN hazard ON hazard.bin = b.bin
LEFT JOIN comp   ON comp.bin   = b.bin
LEFT JOIN hpd_building_summary hv            ON hv.bin = b.bin
LEFT JOIN hpd_complaints_building_summary hc ON hc.bin = b.bin;

CREATE UNIQUE INDEX IF NOT EXISTS hpd_brief_signals_bin_idx
    ON hpd_brief_signals (bin);

-- ── brief_texts ───────────────────────────────────────────────────────────────
-- The Building Brief's generated-sentence corpus: one row per (rule, input
-- shape, prompt version), roughly 12,000 rows for all of NYC. The key is built
-- by `api/services/briefs/corpus.py::input_key`; a missing row is a normal
-- state and falls back to the authored `brief_line` in rules.yaml.

CREATE TABLE IF NOT EXISTS brief_texts (
    rule_id         text        NOT NULL,
    input_key       text        NOT NULL,
    watch_for       text        NOT NULL,
    prompt_version  text        NOT NULL,
    model           text        NOT NULL,
    -- A row exists only if it passed services/briefs/validate.py.
    validated_at    timestamptz NOT NULL,
    PRIMARY KEY (rule_id, input_key, prompt_version)
);

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
-- One row per complaint, tagged with a severity tier. Single source of truth
-- for the A/B/C map; feeds both weighted_complaint_sum and the 5yr tier counts.
tagged AS (
    SELECT
        c.mapblklot,
        c.requested_datetime,
        c.service_subtype,
        e.address,
        p.centroid_latitude    AS latitude,
        p.centroid_longitude   AS longitude,
        p.analysis_neighborhood AS neighborhood,
        f.footprint_area_sqm,
        f.hgt_median_m,
        CASE LOWER(REGEXP_REPLACE(c.service_subtype, '^Building - ', '', 'i'))
            WHEN 'heat_lack_of_heat'                                   THEN 'A'
            WHEN 'hot_water_lack_of_hot_water'                         THEN 'A'
            WHEN 'paint_lead_violating_safe_practices'                 THEN 'A'
            WHEN 'blocked_exit_common_areas'                           THEN 'A'
            WHEN 'fire_hazard'                                         THEN 'A'
            WHEN 'elevators_no_working_elevator_7_or_more_stories'     THEN 'A'
            WHEN 'electrical_hazardous_condition'                      THEN 'A'
            WHEN 'fire_alarm_system'                                   THEN 'A'
            WHEN 'smoke_detectors_missing_broken_unit_interior'        THEN 'A'
            WHEN 'fire_extinguishers_missing_expired'                  THEN 'A'
            WHEN 'fire_sprinkler_system'                               THEN 'A'
            WHEN 'smoke_detectors_missing_broken_common_areas'         THEN 'A'
            WHEN 'infestation_rodent_insect'                           THEN 'B'
            WHEN 'mold_and_mildew'                                     THEN 'B'
            WHEN 'plumbing_broken_leaking'                             THEN 'B'
            WHEN 'infestation_bed_bugs'                                THEN 'B'
            WHEN 'elevators_everthing_else'                            THEN 'B'
            WHEN 'doors_windows_broken_defective'                      THEN 'B'
            WHEN 'bathroom'                                            THEN 'B'
            WHEN 'ventilation_inadequate_or_none'                      THEN 'B'
            WHEN 'security_inadequately_secured_perimeter'             THEN 'B'
            WHEN 'deck_stairs_handrails'                               THEN 'B'
            WHEN 'light_wells_dirty_flooded'                           THEN 'B'
            WHEN 'general_maintenance_not_in_list_above'               THEN 'C'
            WHEN 'inadequately_maintained_building_exterior'           THEN 'C'
            WHEN 'paint_peeling'                                       THEN 'C'
            WHEN 'garbage_receptacles'                                 THEN 'C'
            WHEN 'clutter_hoarder_unit_interior_storage'               THEN 'C'
            WHEN 'electrical_non_hazard'                               THEN 'C'
            WHEN 'second_hand_smoke'                                   THEN 'C'
            WHEN 'noise_caused_by_building_systems'                    THEN 'C'
            WHEN 'kitchen_community'                                   THEN 'C'
            WHEN 'mail_service_delivery_problem'                       THEN 'C'
            WHEN 'illegal_construction_no_permit_exceeds_permit_scope' THEN 'X'
            WHEN 'illegal_guest_room_conversions'                      THEN 'X'
            WHEN 'visitor_policy_violations'                           THEN 'X'
            ELSE 'C'
        END AS tier
    FROM sf_311_housing c
    JOIN sf_parcels p ON c.mapblklot = p.mapblklot
    LEFT JOIN footprint_agg f ON f.mapblklot = c.mapblklot
    LEFT JOIN eas_repr e ON e.mapblklot = c.mapblklot
    WHERE c.mapblklot IS NOT NULL
),
base AS (
    SELECT
        t.mapblklot,
        MAX(t.address)                                    AS address,
        MAX(t.latitude)                                   AS latitude,
        MAX(t.longitude)                                  AS longitude,
        MAX(t.neighborhood)                               AS neighborhood,
        MAX(t.footprint_area_sqm)                         AS footprint_area_sqm,
        MAX(t.hgt_median_m)                               AS hgt_median_m,
        COUNT(*)                                          AS total_complaints,
        COUNT(*) FILTER (
            WHERE t.requested_datetime >= CURRENT_TIMESTAMP - INTERVAL '2 years'
        )                                                 AS recent_complaint_count,
        COUNT(*) FILTER (
            WHERE t.requested_datetime >= CURRENT_TIMESTAMP - INTERVAL '5 years'
              AND t.requested_datetime <  CURRENT_TIMESTAMP - INTERVAL '2 years'
        )                                                 AS prior_complaint_count,
        COUNT(*) FILTER (
            WHERE LOWER(REGEXP_REPLACE(t.service_subtype, '^Building - ', '', 'i'))
                  IN ('heat_lack_of_heat', 'hot_water_lack_of_hot_water')
        )                                                 AS heat_complaints,
        COUNT(*) FILTER (
            WHERE LOWER(REGEXP_REPLACE(t.service_subtype, '^Building - ', '', 'i'))
                  = 'paint_lead_violating_safe_practices'
        )                                                 AS lead_complaints,
        COUNT(*) FILTER (
            WHERE LOWER(REGEXP_REPLACE(t.service_subtype, '^Building - ', '', 'i'))
                  IN ('infestation_rodent_insect', 'infestation_bed_bugs')
        )                                                 AS pest_complaints,
        COUNT(*) FILTER (
            WHERE t.tier = 'A'
              AND t.requested_datetime >= CURRENT_TIMESTAMP - INTERVAL '5 years'
        )                                                 AS severe_complaints_5yr,
        COUNT(*) FILTER (
            WHERE t.tier = 'B'
              AND t.requested_datetime >= CURRENT_TIMESTAMP - INTERVAL '5 years'
        )                                                 AS serious_complaints_5yr,
        COUNT(*) FILTER (
            WHERE t.tier = 'C'
              AND t.requested_datetime >= CURRENT_TIMESTAMP - INTERVAL '5 years'
        )                                                 AS minor_complaints_5yr,
        MAX(t.requested_datetime::date)                   AS latest_complaint_date,
        COALESCE(SUM(
            CASE t.tier
                WHEN 'A' THEN 15.0
                WHEN 'B' THEN  8.0
                WHEN 'C' THEN  3.0
                ELSE          0.0
            END *
            CASE
                WHEN t.requested_datetime >= CURRENT_TIMESTAMP - INTERVAL '2 years'  THEN 1.00
                WHEN t.requested_datetime >= CURRENT_TIMESTAMP - INTERVAL '5 years'  THEN 0.50
                WHEN t.requested_datetime >= CURRENT_TIMESTAMP - INTERVAL '10 years' THEN 0.25
            END
        ), 0.0)                                           AS weighted_complaint_sum
    FROM tagged t
    GROUP BY t.mapblklot
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
    wt.severe_complaints_5yr,
    wt.serious_complaints_5yr,
    wt.minor_complaints_5yr,
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
-- One row per NOV, tagged with a severity tier. Single source of truth for the
-- A/B/C map; feeds both weighted_violation_sum and the open tier counts.
tagged AS (
    SELECT
        v.mapblklot,
        e.address,
        p.centroid_latitude     AS latitude,
        p.centroid_longitude    AS longitude,
        p.analysis_neighborhood AS neighborhood_analysis,
        v.neighborhood          AS neighborhood_raw,
        f.footprint_area_sqm,
        f.hgt_median_m,
        v.status,
        v.date_filed,
        v.nov_category_description,
        CASE LOWER(v.nov_category_description)
            WHEN 'fire section'                    THEN 'A'
            WHEN 'smoke detection section'         THEN 'A'
            WHEN 'lead section'                    THEN 'A'
            WHEN 'building section'                THEN 'B'
            WHEN 'plumbing and electrical section' THEN 'B'
            WHEN 'interior surfaces section'       THEN 'B'
            WHEN 'sanitation section'              THEN 'B'
            WHEN 'security requirements section'   THEN 'B'
            ELSE 'C'
        END AS tier
    FROM sf_dbi_nov v
    JOIN sf_parcels p ON v.mapblklot = p.mapblklot
    LEFT JOIN footprint_agg f ON f.mapblklot = v.mapblklot
    LEFT JOIN eas_repr e ON e.mapblklot = v.mapblklot
    WHERE v.mapblklot IS NOT NULL
),
base AS (
    SELECT
        t.mapblklot,
        MAX(t.address)                                              AS address,
        MAX(t.latitude)                                             AS latitude,
        MAX(t.longitude)                                            AS longitude,
        COALESCE(MAX(t.neighborhood_analysis), MAX(t.neighborhood_raw)) AS neighborhood,
        MAX(t.footprint_area_sqm)                                   AS footprint_area_sqm,
        MAX(t.hgt_median_m)                                         AS hgt_median_m,
        COUNT(*)                                                    AS total_violations,
        COUNT(*) FILTER (WHERE LOWER(t.status) = 'active')          AS open_violations,
        COUNT(*) FILTER (
            WHERE LOWER(t.nov_category_description) = 'lead section'
              AND LOWER(t.status) = 'active'
        )                                                           AS open_lead_violations,
        COUNT(*) FILTER (
            WHERE LOWER(t.nov_category_description) = 'fire section'
              AND LOWER(t.status) = 'active'
        )                                                           AS open_fire_violations,
        -- Open violations by severity tier (all tiers A/B/C, so these three sum
        -- to open_violations). Powers the "Open violations" card breakdown.
        COUNT(*) FILTER (WHERE t.tier = 'A' AND LOWER(t.status) = 'active') AS open_severe_violations,
        COUNT(*) FILTER (WHERE t.tier = 'B' AND LOWER(t.status) = 'active') AS open_serious_violations,
        COUNT(*) FILTER (WHERE t.tier = 'C' AND LOWER(t.status) = 'active') AS open_minor_violations,
        MAX(t.date_filed)                                           AS latest_violation_date,
        COALESCE(SUM(
            -- SF DBI severity weight, derived from the tier tag (single source
            -- of truth above), times the recency-decay factor.
            CASE t.tier
                WHEN 'A' THEN 15.0
                WHEN 'B' THEN  8.0
                ELSE           3.0
            END *
            CASE
                WHEN t.date_filed >= CURRENT_DATE - INTERVAL '2 years'  THEN 1.00
                WHEN t.date_filed >= CURRENT_DATE - INTERVAL '5 years'  THEN 0.50
                WHEN t.date_filed >= CURRENT_DATE - INTERVAL '10 years' THEN 0.25
            END
        ), 0.0)                                                     AS weighted_violation_sum
    FROM tagged t
    GROUP BY t.mapblklot
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
    wd.open_severe_violations,
    wd.open_serious_violations,
    wd.open_minor_violations,
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

-- ── sf_brief_signals ─────────────────────────────────────────────────────────
-- The signals behind SF's Building Brief rules, one row per parcel.
-- Generated from `api/services/briefs/cities/sf/signals.py` — see the note
-- there before editing the category lists, which come from that city's
-- taxonomy.json.

CREATE MATERIALIZED VIEW IF NOT EXISTS sf_brief_signals AS
WITH parcels AS (
    -- Every parcel with an SF page. Violations and complaints do not cover the
    -- same set — a parcel can have complaints and no violations, and the page
    -- renders for both — so a brief must exist for both.
    SELECT mapblklot FROM sf_violations_summary
    UNION
    SELECT mapblklot FROM sf_housing_complaints_summary
),
labelled AS (
    -- One condition group per ACTIVE notice of violation, read out of its text.
    --
    -- `nov_category_description` cannot do this job: it has ten values and 52.7%
    -- of rows are `building section`, `other section` or blank, which name a
    -- chapter of the code rather than a condition. The condition itself is in
    -- the text, in a canonical phrase DBI reuses ("repair damaged ceilings
    -- (1001b,h,o hc)"), so the CASE below reads it out. Ordered first-match-wins
    -- and generated from `cities/sf/nov_patterns.yaml` — read that file before
    -- changing the order, and never hand-edit this.
    --
    -- Category is the FALLBACK and only catches rows the text could not name.
    --
    -- NEITHER text field is ever rendered. They carry inspector names, addresses
    -- and narrative; this is classification only.
    --
    -- `status` has exactly two values, 'active' and 'not active'. DBI
    -- republishes every row on each publish, so `date_filed` is the incremental
    -- key and the status column is trued up wholesale — see the ingest notes.
    SELECT
        v.mapblklot,
        COALESCE(
            CASE
                WHEN length(t.txt) < 8 THEN NULL
                WHEN t.txt ~ 'smoke (detector|alarm)|carbon monoxide|\yco alarm\y|420\.\d|central alarm|alarm system' THEN 'smoke_detectors'
                WHEN t.txt ~ '\(701|provide heat|required heat|minimum room temperature|lack of (heat|hot water)|no hot water' THEN 'heat_hot_water'
                WHEN t.txt ~ 'floor covering|\yflooring\y|repair stairs|repair.{0,20}stair(way|case)' THEN 'floors_stairs'
                WHEN t.txt ~ 'egress|fire escape|fire alarm|sprinkler|fire extinguisher|combustible storage|self-clos|\y(801|901|904|905|907|908|706)\y|1001\s*\(?\s*[lmn]\y' THEN 'fire_safety'
                WHEN t.txt ~ '(repair|locate)[^.]{0,25}source of water damage|garbage disposal' THEN 'plumbing'
                WHEN t.txt ~ '\ymold|mildew' THEN 'mold'
                WHEN t.txt ~ 'damaged (wall|ceiling)|deteriorated (wall|ceiling|plaster)|damaged cabinet|repair cabinet|repair damaged (wall|ceiling)|patch.*(wall|ceiling)' THEN 'interior_surfaces'
                WHEN t.txt ~ 'peeling|flaking paint|damaged paint|chipping paint|lead (hazard )?warning|remove or cover damaged paint|repaint' THEN 'peeling_paint'
                WHEN t.txt ~ '\(708|708 hc|window (sash|hardware|glazing)|repair.*window|insulation|\yroof|waterproof|weather protection|\y504\y|1001\s*\(?\s*[hj]\y' THEN 'weather_windows'
                WHEN t.txt ~ 'regulated work area|abate lead hazard|lead abatement|lead hazard evaluation' THEN 'lead_paint'
                WHEN t.txt ~ '\yrodent|\yvermin|infestation|\yrats?\y|cockroach|bed ?bug' THEN 'pests'
                WHEN t.txt ~ 'garbage(?! disposal)|rubbish|remove debris|clean (&|and) (remove|sanitize)|clean up|overgrown|filth|unsanitary|\y1306\y|1001\s*\(?\s*[ki]\y' THEN 'sanitation'
                WHEN t.txt ~ 'electrical|wiring|\ycircuit\y|disconnect|1001\s*\(?\s*e\y' THEN 'electrical'
                WHEN t.txt ~ 'water damage|\yleak|toilet|plumbing|sanitation facilit|\y(703|505)\y|1001\s*\(?\s*f\y' THEN 'plumbing'
                WHEN t.txt ~ 'stairs|handrail|guardrail|structural|\y(802|604)\y|1001\s*\(?\s*c\y' THEN 'floors_stairs'
                WHEN t.txt ~ 'ventilation|light well|lighting|\ylights?\y|\yduct|mechanical fan|1001\s*\(?\s*g\y' THEN 'ventilation_light'
                WHEN t.txt ~ '\ylock\y|dead ?bolt|secure the (building|premises)|security' THEN 'security_locks'
                WHEN t.txt ~ 'lead[- ]based paint|disturbs lead|lead ordinance' THEN 'peeling_paint'
            END,
            CASE
                WHEN lower(v.nov_category_description) = ANY(ARRAY['fire section']) THEN 'fire_safety'
                WHEN lower(v.nov_category_description) = ANY(ARRAY['sanitation section']) THEN 'sanitation'
                WHEN lower(v.nov_category_description) = ANY(ARRAY['lead section']) THEN 'lead_paint'
                WHEN lower(v.nov_category_description) = ANY(ARRAY['security requirements section']) THEN 'security_locks'
                WHEN lower(v.nov_category_description) = ANY(ARRAY['smoke detection section']) THEN 'smoke_detectors'
            END
        )                                       AS condition_group
    FROM sf_dbi_nov v
    CROSS JOIN LATERAL (SELECT regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(v.item, '') || ' ' || coalesce(v.nov_item_description, '')), 'disturbing lead based paint can be extremely dangerous.*?ordinance #\d+-\d+\.?', ' ', 'g'), 'disturbing lead based paint can be extremely dangerous.*', ' ', 'g'), 'it is the property owner''?s responsibility.*', ' ', 'g'), 'this notice includes violations.*', ' ', 'g'), 'inspector comments regarding.*', ' ', 'g'), 'work practice for lead-based paint', ' ', 'g'), 'see attached lead hazard warning\.?', ' ', 'g') AS txt) t
    WHERE v.mapblklot IS NOT NULL
      AND v.status = 'active'
),
viol AS (
    SELECT
        t.mapblklot,
        COUNT(*) FILTER (WHERE t.condition_group = 'smoke_detectors')               AS open_smoke_detectors_violations,
        COUNT(*) FILTER (WHERE t.condition_group = 'heat_hot_water')                AS open_heat_hot_water_violations,
        COUNT(*) FILTER (WHERE t.condition_group = 'floors_stairs')                 AS open_floors_stairs_violations,
        COUNT(*) FILTER (WHERE t.condition_group = 'fire_safety')                   AS open_fire_safety_violations,
        COUNT(*) FILTER (WHERE t.condition_group = 'plumbing')                      AS open_plumbing_violations,
        COUNT(*) FILTER (WHERE t.condition_group = 'mold')                          AS open_mold_violations,
        COUNT(*) FILTER (WHERE t.condition_group = 'interior_surfaces')             AS open_interior_surfaces_violations,
        COUNT(*) FILTER (WHERE t.condition_group = 'peeling_paint')                 AS open_peeling_paint_violations,
        COUNT(*) FILTER (WHERE t.condition_group = 'weather_windows')               AS open_weather_windows_violations,
        COUNT(*) FILTER (WHERE t.condition_group = 'lead_paint')                    AS open_lead_paint_violations,
        COUNT(*) FILTER (WHERE t.condition_group = 'pests')                         AS open_pests_violations,
        COUNT(*) FILTER (WHERE t.condition_group = 'sanitation')                    AS open_sanitation_violations,
        COUNT(*) FILTER (WHERE t.condition_group = 'electrical')                    AS open_electrical_violations,
        COUNT(*) FILTER (WHERE t.condition_group = 'ventilation_light')             AS open_ventilation_light_violations,
        COUNT(*) FILTER (WHERE t.condition_group = 'security_locks')                AS open_security_locks_violations
    FROM labelled t
    WHERE t.condition_group IS NOT NULL
    GROUP BY t.mapblklot
),
comp AS (
    SELECT
        c.mapblklot,
        COUNT(*) FILTER (
            WHERE c.service_subtype = ANY(ARRAY['infestation_rodent_insect', 'infestation_bed_bugs'])
        )                                  AS pests_complaints,
        COUNT(*) FILTER (
            WHERE c.service_subtype = ANY(ARRAY['mold_and_mildew'])
        )                                   AS mold_complaints,
        COUNT(*) FILTER (
            WHERE c.service_subtype = ANY(ARRAY['plumbing_broken_leaking', 'bathroom'])
        )                               AS plumbing_complaints,
        COUNT(*) FILTER (
            WHERE c.service_subtype = ANY(ARRAY['inadequately_maintained_building_exterior', 'doors_windows_broken_defective'])
        )                        AS weather_windows_complaints,
        COUNT(*) FILTER (
            WHERE c.service_subtype = ANY(ARRAY['heat_lack_of_heat', 'hot_water_lack_of_hot_water'])
        )                         AS heat_hot_water_complaints,
        COUNT(*) FILTER (
            WHERE c.service_subtype = ANY(ARRAY['fire_hazard', 'fire_alarm_system', 'fire_sprinkler_system', 'fire_extinguishers_missing_expired', 'blocked_exit_common_areas'])
        )                            AS fire_safety_complaints,
        COUNT(*) FILTER (
            WHERE c.service_subtype = ANY(ARRAY['paint_peeling'])
        )                          AS peeling_paint_complaints,
        COUNT(*) FILTER (
            WHERE c.service_subtype = ANY(ARRAY['electrical_hazardous_condition', 'electrical_non_hazard'])
        )                             AS electrical_complaints,
        COUNT(*) FILTER (
            WHERE c.service_subtype = ANY(ARRAY['ventilation_inadequate_or_none', 'light_wells_dirty_flooded'])
        )                      AS ventilation_light_complaints,
        COUNT(*) FILTER (
            WHERE c.service_subtype = ANY(ARRAY['garbage_receptacles'])
        )                             AS sanitation_complaints,
        COUNT(*) FILTER (
            WHERE c.service_subtype = ANY(ARRAY['paint_lead_violating_safe_practices'])
        )                             AS lead_paint_complaints,
        COUNT(*) FILTER (
            WHERE c.service_subtype = ANY(ARRAY['security_inadequately_secured_perimeter'])
        )                         AS security_locks_complaints,
        COUNT(*) FILTER (
            WHERE c.service_subtype = ANY(ARRAY['deck_stairs_handrails'])
        )                          AS floors_stairs_complaints,
        COUNT(*) FILTER (
            WHERE c.service_subtype = ANY(ARRAY['mail_service_delivery_problem'])
        )                                AS mailbox_complaints,
        COUNT(*) FILTER (
            WHERE c.service_subtype = ANY(ARRAY['smoke_detectors_missing_broken_unit_interior', 'smoke_detectors_missing_broken_common_areas'])
        )                        AS smoke_detectors_complaints
    FROM sf_311_housing c
    WHERE c.mapblklot IS NOT NULL
      AND c.requested_datetime >= CURRENT_DATE - INTERVAL '5 years'
    GROUP BY c.mapblklot
)
SELECT
    p.mapblklot,
    COALESCE(viol.open_smoke_detectors_violations, 0)             AS open_smoke_detectors_violations,
    COALESCE(viol.open_heat_hot_water_violations, 0)              AS open_heat_hot_water_violations,
    COALESCE(viol.open_floors_stairs_violations, 0)               AS open_floors_stairs_violations,
    COALESCE(viol.open_fire_safety_violations, 0)                 AS open_fire_safety_violations,
    COALESCE(viol.open_plumbing_violations, 0)                    AS open_plumbing_violations,
    COALESCE(viol.open_mold_violations, 0)                        AS open_mold_violations,
    COALESCE(viol.open_interior_surfaces_violations, 0)           AS open_interior_surfaces_violations,
    COALESCE(viol.open_peeling_paint_violations, 0)               AS open_peeling_paint_violations,
    COALESCE(viol.open_weather_windows_violations, 0)             AS open_weather_windows_violations,
    COALESCE(viol.open_lead_paint_violations, 0)                  AS open_lead_paint_violations,
    COALESCE(viol.open_pests_violations, 0)                       AS open_pests_violations,
    COALESCE(viol.open_sanitation_violations, 0)                  AS open_sanitation_violations,
    COALESCE(viol.open_electrical_violations, 0)                  AS open_electrical_violations,
    COALESCE(viol.open_ventilation_light_violations, 0)           AS open_ventilation_light_violations,
    COALESCE(viol.open_security_locks_violations, 0)              AS open_security_locks_violations,
    COALESCE(comp.pests_complaints, 0)                            AS pests_complaints,
    COALESCE(comp.mold_complaints, 0)                             AS mold_complaints,
    COALESCE(comp.plumbing_complaints, 0)                         AS plumbing_complaints,
    COALESCE(comp.weather_windows_complaints, 0)                  AS weather_windows_complaints,
    COALESCE(comp.heat_hot_water_complaints, 0)                   AS heat_hot_water_complaints,
    COALESCE(comp.fire_safety_complaints, 0)                      AS fire_safety_complaints,
    COALESCE(comp.peeling_paint_complaints, 0)                    AS peeling_paint_complaints,
    COALESCE(comp.electrical_complaints, 0)                       AS electrical_complaints,
    COALESCE(comp.ventilation_light_complaints, 0)                AS ventilation_light_complaints,
    COALESCE(comp.sanitation_complaints, 0)                       AS sanitation_complaints,
    COALESCE(comp.lead_paint_complaints, 0)                       AS lead_paint_complaints,
    COALESCE(comp.security_locks_complaints, 0)                   AS security_locks_complaints,
    COALESCE(comp.floors_stairs_complaints, 0)                    AS floors_stairs_complaints,
    COALESCE(comp.mailbox_complaints, 0)                          AS mailbox_complaints,
    COALESCE(comp.smoke_detectors_complaints, 0)                  AS smoke_detectors_complaints,
    -- The two confidence.py inputs. Read off the existing summary views rather
    -- than recomputed, so "thin record" and "stale record" mean exactly what
    -- they mean everywhere else on the site. Both are all-time on purpose: a
    -- record is not thin because it is old.
    COALESCE(sv.total_violations, 0)
        + COALESCE(sc.total_complaints, 0)          AS sf_record_count,
    GREATEST(sv.latest_violation_date, sc.latest_complaint_date) AS latest_sf_activity
FROM parcels p
LEFT JOIN viol ON viol.mapblklot = p.mapblklot
LEFT JOIN comp ON comp.mapblklot = p.mapblklot
LEFT JOIN sf_violations_summary sv         ON sv.mapblklot = p.mapblklot
LEFT JOIN sf_housing_complaints_summary sc ON sc.mapblklot = p.mapblklot;

CREATE UNIQUE INDEX IF NOT EXISTS sf_brief_signals_mapblklot_idx
    ON sf_brief_signals (mapblklot);
