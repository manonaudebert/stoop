-- Add a latitude index to building_summary (DOB) to speed up bbox map queries.
--
-- building_summary had no lat/lng index, so every zoomed-in map request did a
-- full sequential scan of the matview (~523k rows). hpd_complaints_building_summary
-- already has the equivalent index (hpd_complaints_building_summary_lat_idx), so
-- this brings the DOB side to parity. A single-column btree on latitude is enough:
-- the planner bitmap-scans the latitude range, then filters longitude on the heap
-- (same plan the HPD lat index already produces).
--
-- This is a plain CREATE INDEX on an existing materialized view -- it does NOT
-- recompute the view, so it finishes in seconds and does not need a refresh.
-- Bare CREATE INDEX (no IF NOT EXISTS) by convention: a duplicate-name error on
-- re-run is the signal that the migration was already applied.

CREATE INDEX building_summary_lat_idx ON building_summary (latitude);
