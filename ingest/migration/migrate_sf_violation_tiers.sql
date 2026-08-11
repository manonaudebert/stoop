-- Surface open-violation severity tiers on the SF DBI violations card.
--
-- The A/B/C severity map previously existed only inside the
-- weighted_violation_sum scalar. This migration refactors that map into a single
-- `tagged` CTE that tags each NOV with a tier, so the weighted sum AND three new
-- per-tier open counts share one definition (re-tiering now happens in exactly
-- one place). weighted_violation_sum is reproduced byte-for-byte: fire / smoke
-- detection / lead sections = A (15), building / plumbing & electrical /
-- interior surfaces / sanitation / security = B (8), everything else = C (3),
-- and the 2yr/5yr/10yr decay is unchanged.
--
-- New columns (every NOV is tier A/B/C, so these three sum to open_violations):
--   open_severe_violations   Tier A, status active
--   open_serious_violations  Tier B, status active
--   open_minor_violations    Tier C, status active
--
-- These replace the fixed Fire/Lead rows in the "Open violations" card (which
-- were mostly zeros on SF's sparse data) with pooled severity tiers, mirroring
-- the complaint-severity treatment in migrate_sf_severity_5yr.sql. METRICS.md
-- documents the tenant-facing card these power.

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
