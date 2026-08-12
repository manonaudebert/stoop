-- GENERATED FILE — do not edit by hand.
--
-- Written by `api/services/briefs/signals.py::render_migration`, which reads
-- the complaint categories from `frontend/lib/renter-facing-groups.json` via
-- the shared taxonomy. Editing this file directly forks the heat definition
-- away from the building page's "Heat / hot water" card, which is the exact
-- bug the taxonomy alignment fixed.
--
-- To change it: edit `signals.py` (or the JSON), then regenerate with
--     cd api && ../.venv/bin/python -m services.briefs.signals
-- `tests/test_briefs_signals_sql.py` fails if this file and the generator
-- disagree, and if `schema.sql` has drifted from either.
--
-- The seven signals behind the Building Brief's rules, one row per building.
-- `smoke.py` computes these inline against the base tables, which takes ~2.5s
-- per building — fine for a smoke run, far too slow for a page render. This
-- view is the same computation, precomputed.
--
-- Unlike most migrations here, this one is safely re-runnable: the DROP clears
-- the way, so it does not fail on the unique index the second time.

DROP MATERIALIZED VIEW IF EXISTS hpd_brief_signals;

CREATE MATERIALIZED VIEW hpd_brief_signals AS
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
        COUNT(*) FILTER (
            WHERE v.violation_status = 'Open' AND o.category = 'LEAD-BASED PAINT'
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

-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY, and the route looks up
-- by bin.
CREATE UNIQUE INDEX hpd_brief_signals_bin_idx ON hpd_brief_signals (bin);
