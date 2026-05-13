-- Rebuild hpd_complaints_building_summary so open_emergency_complaints counts
-- both EMERGENCY and IMMEDIATE EMERGENCY types (not just EMERGENCY).

DROP MATERIALIZED VIEW IF EXISTS hpd_complaints_building_summary;

CREATE MATERIALIZED VIEW hpd_complaints_building_summary AS
SELECT
    c.bin,
    MAX(b.latitude)   AS latitude,
    MAX(b.longitude)  AS longitude,
    MAX(b.borough)    AS borough,
    MAX(b.nta_code)   AS nta_code,
    MAX(b.nta_name)   AS nta_name,
    MAX(c.house_number || ' ' || c.street_name) AS address,
    MAX(c.zip_code)   AS zip_code,
    COUNT(*)          AS total_complaints,
    COUNT(*) FILTER (WHERE c.complaint_status = 'Open')                                        AS open_complaints,
    COUNT(*) FILTER (WHERE c.type IN ('EMERGENCY', 'IMMEDIATE EMERGENCY')
                       AND c.complaint_status = 'Open')                                        AS open_emergency_complaints,
    COUNT(*) FILTER (WHERE c.major_category = 'HEAT/HOT WATER')                               AS heat_complaints,
    MAX(c.received_date) AS latest_complaint_date
FROM hpd_complaints c
JOIN buildings b ON c.bin = b.bin
WHERE c.bin IS NOT NULL
GROUP BY c.bin;

CREATE UNIQUE INDEX hpd_complaints_building_summary_bin_idx
    ON hpd_complaints_building_summary(bin);
CREATE INDEX hpd_complaints_building_summary_borough_idx
    ON hpd_complaints_building_summary(borough);
CREATE INDEX hpd_complaints_building_summary_lat_idx
    ON hpd_complaints_building_summary(latitude);
CREATE INDEX hpd_complaints_building_summary_open_idx
    ON hpd_complaints_building_summary(open_complaints DESC);
