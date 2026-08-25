-- Store the complete DataSF DBI Notice of Violation record shape and use it
-- for tenant-facing descriptions, condition classification, and severity.
--
-- nbtm-fbw5 has Housing rows whose detail lives in item / nov_item_description
-- and non-Housing rows whose detail lives in code_violation_desc. The latter
-- were previously ingested as blank records and defaulted to tier C.
--
-- Validated on an isolated Neon branch on 2026-08-25 after a 516,360-row full
-- backfill: 44,204 violation parcels, 46,277 brief-signal parcels, and all open
-- A/B/C counts summed to open_violations. Against the old tier logic on the
-- same snapshot: severe +2,347, serious +1,271, minor -3,618, fire +488,
-- lead +1, weighted score +8.1%; 1,309 parcel risk labels changed. The
-- sf_violations_summary refresh took about 134 seconds.

ALTER TABLE sf_dbi_nov
    ADD COLUMN complaint_number TEXT,
    ADD COLUMN item_sequence_number TEXT,
    ADD COLUMN receiving_division TEXT,
    ADD COLUMN assigned_division TEXT,
    ADD COLUMN code_violation_desc TEXT,
    ADD COLUMN work_without_permit TEXT,
    ADD COLUMN additional_work_beyond_permit TEXT,
    ADD COLUMN expired_permit TEXT,
    ADD COLUMN cancelled_permit TEXT,
    ADD COLUMN unsafe_building TEXT;

-- sf_brief_signals depends on sf_violations_summary, so remove it first and
-- recreate it from the current generated definition after the summary view.
DROP MATERIALIZED VIEW IF EXISTS sf_brief_signals;

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
classified AS (
    SELECT
        v.*,
        CASE
            WHEN length(t.txt) < 8 THEN NULL
            WHEN t.txt ~ 'smoke (detector|alarm)|carbon monoxide|\yco alarm\y|420\.\d|central alarm|alarm system' THEN 'smoke_detectors'
            WHEN t.txt ~ '\(701|provide heat|required heat|minimum room temperature|lack of (heat|hot water)|no hot water' THEN 'heat_hot_water'
            WHEN t.txt ~ 'floor covering|\yflooring\y|repair stairs|repair.{0,20}stair(way|case)' THEN 'floors_stairs'
            WHEN t.txt ~ 'egress|fire damage|fire escape|fire alarm|sprinkler|fire extinguisher|combustible storage|self-clos|\y(801|901|904|905|907|908|706)\y|1001\s*\(?\s*[lmn]\y' THEN 'fire_safety'
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
        END AS condition_group
    FROM sf_dbi_nov v
    CROSS JOIN LATERAL (
        SELECT regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(v.item, '') || ' ' || coalesce(v.nov_item_description, '') || ' ' || coalesce(v.code_violation_desc, '')), 'disturbing lead based paint can be extremely dangerous.*?ordinance #\d+-\d+\.?', ' ', 'g'), 'disturbing lead based paint can be extremely dangerous.*', ' ', 'g'), 'it is the property owner''?s responsibility.*', ' ', 'g'), 'this notice includes violations.*', ' ', 'g'), 'inspector comments regarding.*', ' ', 'g'), 'work practice for lead-based paint', ' ', 'g'), 'see attached lead hazard warning\.?', ' ', 'g') AS txt
    ) t
),
-- One row per NOV, tagged once so the weighted score and open counts cannot
-- disagree about severity.
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
        v.condition_group,
        CASE
            WHEN LOWER(v.unsafe_building) = 'y' THEN 'A'
            WHEN LOWER(v.nov_category_description) IN (
                'fire section', 'smoke detection section', 'lead section'
            ) THEN 'A'
            WHEN LOWER(v.nov_category_description) IN (
                'building section', 'plumbing and electrical section',
                'interior surfaces section', 'sanitation section',
                'security requirements section'
            ) THEN 'B'
            WHEN NULLIF(BTRIM(v.nov_category_description), '') IS NULL
                 AND v.condition_group IN (
                     'fire_safety', 'smoke_detectors', 'lead_paint', 'heat_hot_water'
                 ) THEN 'A'
            WHEN NULLIF(BTRIM(v.nov_category_description), '') IS NULL
                 AND v.condition_group IN (
                     'pests', 'mold', 'plumbing', 'weather_windows',
                     'interior_surfaces', 'electrical', 'ventilation_light',
                     'sanitation', 'security_locks', 'floors_stairs'
                 ) THEN 'B'
            ELSE 'C'
        END AS tier
    FROM classified v
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
            WHERE (
                    LOWER(t.nov_category_description) = 'lead section'
                    OR (
                        NULLIF(BTRIM(t.nov_category_description), '') IS NULL
                        AND t.condition_group = 'lead_paint'
                    )
                  )
              AND LOWER(t.status) = 'active'
        )                                                           AS open_lead_violations,
        COUNT(*) FILTER (
            WHERE (
                    LOWER(t.nov_category_description) = 'fire section'
                    OR (
                        NULLIF(BTRIM(t.nov_category_description), '') IS NULL
                        AND t.condition_group = 'fire_safety'
                    )
                  )
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


DROP MATERIALIZED VIEW IF EXISTS sf_brief_signals;

CREATE MATERIALIZED VIEW sf_brief_signals AS
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
    -- This expression is classification-only. The building API separately
    -- chooses one nonblank source description for the violation log.
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
                WHEN t.txt ~ 'egress|fire damage|fire escape|fire alarm|sprinkler|fire extinguisher|combustible storage|self-clos|\y(801|901|904|905|907|908|706)\y|1001\s*\(?\s*[lmn]\y' THEN 'fire_safety'
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
    CROSS JOIN LATERAL (SELECT regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(v.item, '') || ' ' || coalesce(v.nov_item_description, '') || ' ' || coalesce(v.code_violation_desc, '')), 'disturbing lead based paint can be extremely dangerous.*?ordinance #\d+-\d+\.?', ' ', 'g'), 'disturbing lead based paint can be extremely dangerous.*', ' ', 'g'), 'it is the property owner''?s responsibility.*', ' ', 'g'), 'this notice includes violations.*', ' ', 'g'), 'inspector comments regarding.*', ' ', 'g'), 'work practice for lead-based paint', ' ', 'g'), 'see attached lead hazard warning\.?', ' ', 'g') AS txt) t
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

-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY, and the route looks up
-- by mapblklot.
CREATE UNIQUE INDEX sf_brief_signals_mapblklot_idx
    ON sf_brief_signals (mapblklot);
