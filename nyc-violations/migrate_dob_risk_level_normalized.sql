-- Switch DOB risk_level to normalized_percentile and remove score_numeric.
--
-- Two changes:
--
-- 1. risk_level now uses normalized_percentile (weighted_complaint_sum / building_volume
--    ranked within NTA) instead of neighborhood_percentile (score_numeric ranked within NTA).
--    This aligns DOB with the HPD methodology which size-normalises before ranking.
--    Buildings without footprint/height data (~0.6% of residential buildings) have
--    normalized_percentile = NULL and are labelled "Not comparable".
--
-- 2. score_numeric and neighborhood_percentile are removed entirely.
--    score_numeric was the exponential decay formula 100×exp(−weighted/40) — it was
--    only displayed in the leaderboard and never used for the building detail page.
--    neighborhood_percentile was the percentile of score_numeric within an NTA.
--    Both are superseded by normalized_percentile.
--
-- Edge-case handling is unchanged:
--   Insufficient data  — <10 complaints AND <2yr history (can't detect trends)
--   Not comparable     — non-residential NTA, no NTA, or no footprint/height data

DROP MATERIALIZED VIEW IF EXISTS nta_stats CASCADE;
DROP MATERIALIZED VIEW IF EXISTS building_summary CASCADE;

CREATE MATERIALIZED VIEW building_summary AS
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
-- Size-normalized percentiles (only buildings with footprint + height data)
normalized_percentiles AS (
    SELECT bin,
        ROUND((
            PERCENT_RANK() OVER (PARTITION BY nta_code ORDER BY normalized_complaint_density ASC)
            * 100
        )::numeric, 1) AS normalized_percentile
    FROM with_trend
    WHERE nta_type = 0 AND nta_code IS NOT NULL AND normalized_complaint_density IS NOT NULL
),
final AS (
    SELECT
        wt.*,
        rp.serious_rate_percentile,
        np.normalized_percentile,
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
    LEFT JOIN normalized_percentiles   np ON wt.bin = np.bin
    LEFT JOIN hpd_agg h                   ON wt.bin = h.bin
    LEFT JOIN hpd_complaints_agg hc       ON wt.bin = hc.bin
)
SELECT
    bin, address, zip_code, borough, latitude, longitude,
    nta_code, nta_name, nta_type,
    total_complaints, open_complaints, closed_complaints,
    priority_a_complaints, priority_ab_complaints,
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

CREATE UNIQUE INDEX building_summary_bin_idx                ON building_summary(bin);
CREATE INDEX        building_summary_borough_idx            ON building_summary(borough);
CREATE INDEX        building_summary_zip_idx                ON building_summary(zip_code);
CREATE INDEX        building_summary_total_idx              ON building_summary(total_complaints DESC);
CREATE INDEX        building_summary_open_idx               ON building_summary(open_complaints DESC);
CREATE INDEX        building_summary_priority_a_idx         ON building_summary(priority_a_complaints DESC);
CREATE INDEX        building_summary_normalized_density_idx ON building_summary(normalized_complaint_density);

CREATE MATERIALIZED VIEW nta_stats AS
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

CREATE UNIQUE INDEX nta_stats_nta_code_idx ON nta_stats(nta_code);
