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
    nta_type          INTEGER
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

-- Per-building summary for fast map rendering and building detail pages
CREATE MATERIALIZED VIEW IF NOT EXISTS building_summary AS
WITH base AS (
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
        -- Weighted deduction score (basis for neighborhood_percentile ranking)
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
        -- Serious rate: priority A+B per year, floored at 1 year
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
-- Percentiles computed only among residential peers (nta_type = 0)
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
    SELECT wt.*, rp.serious_rate_percentile, rp.neighborhood_percentile
    FROM with_trend wt
    LEFT JOIN residential_percentiles rp ON wt.bin = rp.bin
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

CREATE UNIQUE INDEX IF NOT EXISTS building_summary_bin_idx      ON building_summary(bin);
CREATE INDEX IF NOT EXISTS building_summary_borough_idx         ON building_summary(borough);
CREATE INDEX IF NOT EXISTS building_summary_zip_idx             ON building_summary(zip_code);
CREATE INDEX IF NOT EXISTS building_summary_total_idx           ON building_summary(total_complaints DESC);
CREATE INDEX IF NOT EXISTS building_summary_open_idx            ON building_summary(open_complaints DESC);
CREATE INDEX IF NOT EXISTS building_summary_priority_a_idx      ON building_summary(priority_a_complaints DESC);

-- NTA-level aggregates for neighborhood context
CREATE MATERIALIZED VIEW IF NOT EXISTS nta_stats AS
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

CREATE UNIQUE INDEX IF NOT EXISTS nta_stats_code_idx ON nta_stats(nta_code);
