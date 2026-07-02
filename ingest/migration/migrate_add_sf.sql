-- SF Expansion: raw tables, search index, and materialized views
-- Run on a Neon branch before applying to prod (migration-workflow rule).
--
-- Depends on:
--   - pg_trgm extension (for EAS address search)
--   - sf_parcels, sf_footprints, sf_311_housing, sf_dbi_nov, sf_addresses
--   loaded via sync_sf.py before refreshing the views.
--
-- Views DROP/CREATE: takes a few minutes to recompute; API serves stale cache
-- during that window and picks up the new view automatically.
--
-- This is the single, consolidated SF migration reflecting the final view state:
--   - density falls back to the unscaled weighted sum when footprint data is
--     missing, so every building participates in the neighborhood percentile;
--   - risk minimum thresholds are tuned for SF volume (complaints < 2, NOV < 3);
--   - sf_dbi_nov carries the NOV item + item-description fields.
-- Keep this file and schema.sql in sync whenever a view definition changes.

-- ── pg_trgm extension (needed for EAS address search index) ──────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── SF Parcels (DataSF acdm-wktn): geometry hub ──────────────────────────────
CREATE TABLE IF NOT EXISTS sf_parcels (
    mapblklot             TEXT PRIMARY KEY,
    blklot                TEXT,
    analysis_neighborhood TEXT,
    centroid_latitude     DOUBLE PRECISION,
    centroid_longitude    DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS idx_sf_parcels_neighborhood
    ON sf_parcels(analysis_neighborhood);

-- ── SF Building Footprints (DataSF ynuv-fyni): size normalisation ─────────────
-- mblr = "SF" + mapblklot (with possible trailing condo letter).
-- mapblklot is derived during ingest: replace("SF","") then strip trailing letter.
CREATE TABLE IF NOT EXISTS sf_footprints (
    mblr               TEXT PRIMARY KEY,
    mapblklot          TEXT,
    footprint_area_sqm DOUBLE PRECISION,
    hgt_median_m       DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS idx_sf_footprints_mapblklot
    ON sf_footprints(mapblklot);

-- ── SF 311 Housing Complaints (DataSF vw6y-z8j6) ────────────────────────────
-- Filter: service_name IN ('Residential Building Request','Residential Building')
-- mapblklot is populated post-load via the EAS address join in sync_sf.py.
CREATE TABLE IF NOT EXISTS sf_311_housing (
    service_request_id TEXT PRIMARY KEY,
    service_name       TEXT,
    service_subtype    TEXT,
    address            TEXT,
    point_lat          DOUBLE PRECISION,
    point_lon          DOUBLE PRECISION,
    requested_datetime TIMESTAMPTZ,
    status_description TEXT,
    mapblklot          TEXT  -- populated via address join; NULL until sync step 2
);

CREATE INDEX IF NOT EXISTS idx_sf_311_mapblklot
    ON sf_311_housing(mapblklot);
CREATE INDEX IF NOT EXISTS idx_sf_311_datetime
    ON sf_311_housing(requested_datetime);
CREATE INDEX IF NOT EXISTS idx_sf_311_subtype
    ON sf_311_housing(service_subtype);

-- ── SF DBI Notices of Violation (DataSF nbtm-fbw5) ───────────────────────────
-- mapblklot derived during ingest from block+lot concatenation.
-- Bad date_filed values (year < 1980) are excluded during ingest.
-- item / nov_item_description carry the short code + inspector free-text detail,
-- surfaced in the building report's violation log.
CREATE TABLE IF NOT EXISTS sf_dbi_nov (
    row_id                   TEXT PRIMARY KEY,
    block                    TEXT,
    lot                      TEXT,
    mapblklot                TEXT,
    status                   TEXT,   -- 'active' / 'not active'
    nov_category_description TEXT,
    item                     TEXT,
    nov_item_description     TEXT,
    date_filed               DATE,
    neighborhood             TEXT,   -- neighborhoods_analysis_boundaries
    location_lat             DOUBLE PRECISION,
    location_lon             DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS idx_sf_dbi_nov_mapblklot
    ON sf_dbi_nov(mapblklot);
CREATE INDEX IF NOT EXISTS idx_sf_dbi_nov_status
    ON sf_dbi_nov(status);
CREATE INDEX IF NOT EXISTS idx_sf_dbi_nov_date
    ON sf_dbi_nov(date_filed);

-- ── SF EAS Addresses (DataSF ramy-di5m): search corpus + join crosswalk ───────
-- Every SF address including buildings with zero complaints (enables confident
-- "no records" empty state). pg_trgm index for prefix / fuzzy search.
CREATE TABLE IF NOT EXISTS sf_addresses (
    eas_fullid     TEXT PRIMARY KEY,
    address        TEXT,
    parcel_number  TEXT,   -- mapblklot
    eas_baseid     TEXT,
    latitude       DOUBLE PRECISION,
    longitude      DOUBLE PRECISION,
    nhood          TEXT
);

CREATE INDEX IF NOT EXISTS idx_sf_addresses_parcel
    ON sf_addresses(parcel_number);
CREATE INDEX IF NOT EXISTS idx_sf_addresses_address_trgm
    ON sf_addresses USING gin(address gin_trgm_ops);

-- ── sf_housing_complaints_summary ────────────────────────────────────────────
-- Mirrors hpd_complaints_building_summary, parcel-grained.
-- No open_complaints KPI: 311 auto-closes (~0.9% open); open signal is in
-- sf_violations_summary instead.
-- Density falls back to the unscaled weighted sum when footprint data is missing
-- so every building participates in the neighborhood percentile. Risk floor is
-- total_complaints < 2 (SF averages ~3.1 complaints/building; a higher floor
-- forces most buildings to 'Very low' before the percentile can rank them).
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
            -- SF 311 severity map (locked in SF_EXPANSION_PLAN.md)
            CASE LOWER(REGEXP_REPLACE(c.service_subtype, '^Building - ', '', 'i'))
                -- Tier A: severe / immediately hazardous (15)
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
                -- Tier B: serious / hazardous (8)
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
                -- Tier C: minor / quality-of-life (3)
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
                -- Weight 0: regulatory / not building condition (excluded from risk)
                WHEN 'illegal_construction_no_permit_exceeds_permit_scope' THEN  0.0
                WHEN 'illegal_guest_room_conversions'                      THEN  0.0
                WHEN 'visitor_policy_violations'                           THEN  0.0
                -- Default: minor (3) for unknown subtypes
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
        -- When footprint data is available, normalise by building volume.
        -- When not (footprint join failed), fall back to weighted_complaint_sum
        -- so the building still participates in the neighbourhood percentile.
        ROUND(COALESCE(
            weighted_complaint_sum / NULLIF(estimated_scale, 0) * 1000,
            weighted_complaint_sum   -- unscaled fallback; unitless but orderable
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
-- Mirrors hpd_building_summary, parcel-grained.
-- open_violations = rows WHERE status = 'active' (clean binary split in source).
-- Same footprint-fallback density as the complaints view. Risk floor is
-- total_violations < 3.
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
            -- SF DBI NOV severity map (locked in SF_EXPANSION_PLAN.md)
            CASE LOWER(v.nov_category_description)
                -- Tier A: fire / smoke / lead (15)
                WHEN 'fire section'                    THEN 15.0
                WHEN 'smoke detection section'         THEN 15.0
                WHEN 'lead section'                    THEN 15.0
                -- Tier B: structural / systems / health (8)
                WHEN 'building section'                THEN  8.0
                WHEN 'plumbing and electrical section' THEN  8.0
                WHEN 'interior surfaces section'       THEN  8.0
                WHEN 'sanitation section'              THEN  8.0
                WHEN 'security requirements section'   THEN  8.0
                -- Tier C: other / blank (3)
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
            weighted_violation_sum   -- unscaled fallback; unitless but orderable
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
