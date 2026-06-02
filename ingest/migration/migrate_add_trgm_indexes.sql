-- Enable trigram extension for fuzzy address search fallback.
-- Adds GIN indexes on the address column of the two materialized views
-- that back the active search endpoints (DOB complaints and HPD complaints).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS building_summary_address_trgm_idx
    ON building_summary USING GIN (address gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS hpd_complaints_building_summary_address_trgm_idx
    ON hpd_complaints_building_summary USING GIN (address gin_trgm_ops);
