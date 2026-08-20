-- GENERATED FILE — do not edit by hand.
--
-- Written by `api/services/briefs/cities/sf/signals.py::render_migration`,
-- which reads the 311 subtypes and NOV categories from
-- `api/services/briefs/cities/sf/taxonomy.json`. Editing this file directly
-- forks the view away from the taxonomy the rules read, which is the bug the
-- generated SQL exists to prevent.
--
-- To change it: edit `cities/sf/signals.py` (or the JSON), then regenerate with
--     cd api && ../.venv/bin/python -m services.briefs.cities.sf.signals
-- `tests/test_briefs_signals_sql.py` fails if this file and the generator
-- disagree, and if `schema.sql` has drifted from either.
--
-- The signals behind SF's Building Brief rules, one row per PARCEL. A mapblklot
-- can carry more than one building, so copy derived from this view says
-- "property" rather than "building".
--
-- Complaint counts use a 5-year window; the two
-- confidence inputs are all-time on purpose.
--
-- Unlike most migrations here, this one is safely re-runnable: the DROP clears
-- the way, so it does not fail on the unique index the second time.

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

-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY, and the route looks up
-- by mapblklot.
CREATE UNIQUE INDEX sf_brief_signals_mapblklot_idx
    ON sf_brief_signals (mapblklot);
