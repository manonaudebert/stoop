import os
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

DATABASE_URL      = os.environ["DATABASE_URL"]
SOCRATA_APP_TOKEN = os.environ.get("SOCRATA_APP_TOKEN", "")

# DataSF Socrata endpoints
SF_PARCELS_API      = "https://data.sfgov.org/resource/acdm-wktn.json"
SF_FOOTPRINTS_API   = "https://data.sfgov.org/resource/ynuv-fyni.json"
SF_311_API          = "https://data.sfgov.org/resource/vw6y-z8j6.json"
SF_DBI_NOV_API      = "https://data.sfgov.org/resource/nbtm-fbw5.json"
SF_ADDRESSES_API    = "https://data.sfgov.org/resource/ramy-di5m.json"

# 311 filter: both service-name variants (sequential, not parallel)
SF_311_SERVICE_NAMES = ("Residential Building Request", "Residential Building")

# ── SF Parcels column map (Socrata JSON → DB) ─────────────────────────────────
SF_PARCELS_COLUMN_MAP = {
    "mapblklot":            "mapblklot",
    "blklot":               "blklot",
    "analysis_neighborhood": "analysis_neighborhood",
    # centroid pulled from shape geometry — computed in Python via shape centroid
    # fallback fields if present in API response:
    "shape":                None,  # raw geometry, not stored directly
}

SF_PARCELS_DB_COLUMNS = [
    "mapblklot", "blklot", "analysis_neighborhood",
    "centroid_latitude", "centroid_longitude",
]

# ── SF Footprints column map ───────────────────────────────────────────────────
SF_FOOTPRINTS_COLUMN_MAP = {
    "mblr":         "mblr",
    "hgt_median_m": "hgt_median_m",
    # footprint area computed from shape geometry in Python
    "shape":        None,
}

SF_FOOTPRINTS_DB_COLUMNS = [
    "mblr", "mapblklot", "footprint_area_sqm", "hgt_median_m",
]

# ── SF 311 Housing Complaints column map ──────────────────────────────────────
SF_311_COLUMN_MAP = {
    "service_request_id": "service_request_id",
    "service_name":       "service_name",
    "service_subtype":    "service_subtype",
    "address":            "address",
    "point":              None,   # location object → point_lat / point_lon in Python
    "requested_datetime": "requested_datetime",
    "status_description": "status_description",
}

SF_311_DB_COLUMNS = [
    "service_request_id", "service_name", "service_subtype",
    "address", "point_lat", "point_lon",
    "requested_datetime", "status_description",
    "mapblklot",
]

# ── SF DBI NOV column map ─────────────────────────────────────────────────────
SF_DBI_NOV_COLUMN_MAP = {
    ":id":                           "row_id",
    "complaint_number":              "complaint_number",
    "item_sequence_number":          "item_sequence_number",
    "block":                         "block",
    "lot":                           "lot",
    "status":                        "status",
    "receiving_division":            "receiving_division",
    "assigned_division":             "assigned_division",
    "nov_category_description":      "nov_category_description",
    "item":                          "item",
    "nov_item_description":          "nov_item_description",
    "code_violation_desc":           "code_violation_desc",
    "work_without_permit":           "work_without_permit",
    "additional_work_beyond_permit": "additional_work_beyond_permit",
    "expired_permit":                "expired_permit",
    "cancelled_permit":              "cancelled_permit",
    "unsafe_building":               "unsafe_building",
    "date_filed":                    "date_filed",
    "neighborhoods_analysis_boundaries": "neighborhood",
    "location":                      None,  # → location_lat / location_lon in Python
}

SF_DBI_NOV_DB_COLUMNS = [
    "row_id", "complaint_number", "item_sequence_number",
    "block", "lot", "mapblklot", "status", "receiving_division", "assigned_division",
    "nov_category_description", "item", "nov_item_description", "code_violation_desc",
    "work_without_permit", "additional_work_beyond_permit", "expired_permit",
    "cancelled_permit", "unsafe_building",
    "date_filed", "neighborhood", "location_lat", "location_lon",
]

# ── SF EAS Addresses column map ───────────────────────────────────────────────
SF_ADDRESSES_COLUMN_MAP = {
    "eas_fullid":     "eas_fullid",
    "address":        "address",
    "parcel_number":  "parcel_number",
    "eas_baseid":     "eas_baseid",
    "latitude":       "latitude",
    "longitude":      "longitude",
    "nhood":          "nhood",
}

SF_ADDRESSES_DB_COLUMNS = [
    "eas_fullid", "address", "parcel_number", "eas_baseid",
    "latitude", "longitude", "nhood",
]

# ── Severity maps (informational — weights live in migrate_add_sf.sql) ─────────

# 311 subtype → severity tier (A=15, B=8, C=3, 0=excluded from risk score)
SF_311_SEVERITY: dict[str, int] = {
    # Tier A
    "heat_lack_of_heat":                                   15,
    "hot_water_lack_of_hot_water":                         15,
    "paint_lead_violating_safe_practices":                 15,
    "blocked_exit_common_areas":                           15,
    "fire_hazard":                                         15,
    "elevators_no_working_elevator_7_or_more_stories":     15,
    "electrical_hazardous_condition":                      15,
    "fire_alarm_system":                                   15,
    "smoke_detectors_missing_broken_unit_interior":        15,
    "fire_extinguishers_missing_expired":                  15,
    "fire_sprinkler_system":                               15,
    "smoke_detectors_missing_broken_common_areas":         15,
    # Tier B
    "infestation_rodent_insect":                            8,
    "mold_and_mildew":                                      8,
    "plumbing_broken_leaking":                              8,
    "infestation_bed_bugs":                                 8,
    "elevators_everthing_else":                             8,
    "doors_windows_broken_defective":                       8,
    "bathroom":                                             8,
    "ventilation_inadequate_or_none":                       8,
    "security_inadequately_secured_perimeter":              8,
    "deck_stairs_handrails":                                8,
    "light_wells_dirty_flooded":                            8,
    # Tier C
    "general_maintenance_not_in_list_above":                3,
    "inadequately_maintained_building_exterior":            3,
    "paint_peeling":                                        3,
    "garbage_receptacles":                                  3,
    "clutter_hoarder_unit_interior_storage":                3,
    "electrical_non_hazard":                                3,
    "second_hand_smoke":                                    3,
    "noise_caused_by_building_systems":                     3,
    "kitchen_community":                                    3,
    "mail_service_delivery_problem":                        3,
    # Excluded from risk score
    "illegal_construction_no_permit_exceeds_permit_scope":  0,
    "illegal_guest_room_conversions":                       0,
    "visitor_policy_violations":                            0,
}

# DBI NOV category → severity tier
SF_NOV_SEVERITY: dict[str, int] = {
    # Tier A
    "fire section":                    15,
    "smoke detection section":         15,
    "lead section":                    15,
    # Tier B
    "building section":                 8,
    "plumbing and electrical section":  8,
    "interior surfaces section":        8,
    "sanitation section":               8,
    "security requirements section":    8,
    # Tier C (default for anything else)
}
SF_NOV_DEFAULT_SEVERITY = 3
