-- Surface complaint severity tiers (last 5 years) on the SF building page.
--
-- The A/B/C severity map (locked in SF_EXPANSION_PLAN.md) previously existed
-- only inside the weighted_complaint_sum scalar. This migration refactors that
-- map into a single `tagged` CTE that tags each complaint with a tier, so the
-- weighted sum AND three new per-tier 5-year counts share one definition
-- (re-tiering now happens in exactly one place). weighted_complaint_sum is
-- reproduced byte-for-byte: A=15, B=8, C=3, weight-0 regulatory items = 0,
-- unknown subtypes default to C (=3), and the 2yr/5yr/10yr decay is unchanged
-- (complaints older than 10 years contribute NULL and drop out of the SUM).
--
-- New columns (all count only tiers A/B/C, i.e. habitability conditions; the
-- weight-0 regulatory subtypes are excluded):
--   severe_complaints_5yr   Tier A in the last 5 years
--   serious_complaints_5yr  Tier B in the last 5 years
--   minor_complaints_5yr    Tier C in the last 5 years
--
-- METRICS.md documents the tenant-facing card these power.

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
-- One row per complaint, joined to its parcel/footprint/address and tagged with
-- a severity tier. Single source of truth for the A/B/C map.
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
            -- Tier A: severe / immediately hazardous (weight 15)
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
            -- Tier B: serious / hazardous (weight 8)
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
            -- Tier C: minor / quality-of-life (weight 3)
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
            -- Weight 0: regulatory / not building condition (excluded from risk
            -- and from the severity counts)
            WHEN 'illegal_construction_no_permit_exceeds_permit_scope' THEN 'X'
            WHEN 'illegal_guest_room_conversions'                      THEN 'X'
            WHEN 'visitor_policy_violations'                           THEN 'X'
            -- Default: minor (C) for unknown subtypes
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
        -- Severity tiers, last 5 years (habitability conditions only; tier X
        -- regulatory items are excluded)
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
            -- SF 311 severity weight, derived from the tier tag (single source
            -- of truth above), times the recency-decay factor.
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
