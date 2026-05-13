import os
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '..', '.env'))

DATABASE_URL        = os.environ["DATABASE_URL"]
SOCRATA_APP_TOKEN   = os.environ.get("SOCRATA_APP_TOKEN", "")

COMPLAINTS_CSV    = "https://data.cityofnewyork.us/api/views/eabe-havv/rows.csv?accessType=DOWNLOAD"
COMPLAINTS_API    = "https://data.cityofnewyork.us/resource/eabe-havv.json"
BUILDINGS_API     = "https://data.cityofnewyork.us/resource/5zhs-2jue.json"

HPD_VIOLATIONS_CSV_URL = "https://data.cityofnewyork.us/api/views/wvxf-dwi5/rows.csv?accessType=DOWNLOAD"
HPD_VIOLATIONS_API     = "https://data.cityofnewyork.us/resource/wvxf-dwi5.json"

# CSV header → DB column name
COMPLAINTS_COLUMN_MAP = {
    "Complaint Number":  "complaint_number",
    "Status":            "status",
    "Date Entered":      "date_entered",
    "House Number":      "house_number",
    "House Street":      "house_street",
    "ZIP Code":          "zip_code",
    "BIN":               "bin",
    "Community Board":   "community_board",
    "Special District":  "special_district",
    "Complaint Category":"complaint_category",
    "Unit":              "unit",
    "Disposition Date":  "disposition_date",
    "Disposition Code":  "disposition_code",
    "Inspection Date":   "inspection_date",
    # DOBRunDate is an internal refresh timestamp — not stored
}

DB_COLUMNS = [
    "complaint_number", "status", "date_entered",
    "house_number", "house_street", "zip_code",
    "bin", "community_board", "special_district",
    "complaint_category", "unit",
    "disposition_date", "disposition_code", "inspection_date",
    "borough",
]

# First digit of BIN → borough name
BIN_BOROUGH_MAP = {
    "1": "Manhattan",
    "2": "Bronx",
    "3": "Brooklyn",
    "4": "Queens",
    "5": "Staten Island",
}

# Complaint category codes from DOB PDF rev. 09/21 (code → (description, priority))
# Priority: A=imminent danger, B=active violation/illegal work, C=minor/admin, D=tracking/inspection
COMPLAINT_CATEGORIES = {
    # Numeric 01-09
    "01": ("Accident – Construction/Plumbing",                                        "A"),
    "02": ("Accident – To Public",                                                    "A"),
    "03": ("Adjacent Buildings – Not Protected",                                      "A"),
    "04": ("After Hours Work – Illegal",                                              "B"),
    "05": ("Permit – None (Building/PA/Demo etc.)",                                   "B"),
    "06": ("Construction – Change Grade/Change Watercourse",                          "B"),
    "07": ("Construction – Change Watercourse",                                       "B"),
    "08": ("Contractor's Sign – None",                                                "D"),
    "09": ("Debris – Excessive",                                                      "B"),
    # Numeric 10-19
    "10": ("Debris/Building – Falling or In Danger of Falling",                       "A"),
    "11": ("Demolition – No Permit",                                                  "B"),
    "12": ("Demolition – Unsafe/Illegal/Mechanical Demo",                             "A"),
    "13": ("Elevator In (FDNY) Readiness – None",                                     "A"),
    "14": ("Excavation – Undermining Adjacent Building",                              "A"),
    "15": ("Fence – None/Inadequate/Illegal",                                         "B"),
    "16": ("Inadequate Support/Shoring",                                                   "A"),
    "17": ("Material/Personnel Hoist – No Permit",                                    "B"),
    "18": ("Material Storage – Unsafe",                                               "A"),
    "19": ("Mechanical Demolition – Illegal",                                         "B"),
    # Numeric 20-29
    "20": ("Landmark Building – Illegal Work",                                        "B"),
    "21": ("Safety Net/Guard Rail – Damaged/Inadequate/None (over 6-stories/75FT)",   "B"),
    "22": ("Safety Netting – None",                                                   "B"),
    "23": ("Sidewalk Shed/Supported Scaffold – Inadequate/Defective/None/No Permit",  "B"),
    "24": ("Sidewalk Shed – None",                                                    "B"),
    "25": ("Warning Signs/Lights – None",                                             "B"),
    "26": ("Watchman – None",                                                         "B"),
    "27": ("Auto Repair – Illegal",                                                   "C"),
    "28": ("Building – In Danger of Collapse",                                        "A"),
    "29": ("Building – Vacant, Open and Unguarded",                                   "C"),
    # Numeric 30-39
    "30": ("Building Shaking/Vibrating/Structural Stability Affected",                     "A"),
    "31": ("Certificate of Occupancy – None/Illegal/Contrary to CO",                  "C"),
    "32": ("C of O – Not Being Complied With",                                        "C"),
    "33": ("Commercial Use – Illegal",                                                "C"),
    "34": ("Compactor Room/Refuse Chute – Illegal",                                   "C"),
    "35": ("Curb Cut/Driveway/Carport – Illegal",                                     "D"),
    "36": ("Driveway/Carport – Illegal",                                              "D"),
    "37": ("Egress – Locked/Blocked/Improper/No Secondary Means",                     "A"),
    "38": ("Egress: Exit Door Not Proper",                                                 "A"),
    "39": ("Egress: No Secondary Means",                                                   "A"),
    # Numeric 40-49
    "40": ("Falling – Part of Building",                                              "A"),
    "41": ("Falling – Part of Building in Danger of",                                 "A"),
    "42": ("Fence – Illegal",                                                         "C"),
    "43": ("Structural Stability Affected",                                                "A"),
    "44": ("Fireplace/Wood Stove – Illegal",                                          "B"),
    "45": ("Illegal Conversion",                                                           "B"),
    "46": ("PA Permit – None",                                                        "B"),
    "47": ("PA Permit – Not Being Complied With",                                     "B"),
    "48": ("Residential Use – Illegal",                                               "C"),
    "49": ("Storefront or Business Sign/Awning/Marquee/Canopy – Illegal",             "C"),
    # Numeric 50-59
    "50": ("Sign Falling: Danger/Sign Erection or Display In-Progress (Illegal)",          "A"),
    "51": ("Illegal Social Club",                                                          "B"),
    "52": ("Sprinkler System – Inadequate",                                           "B"),
    "53": ("Vent/Exhaust – Illegal/Improper",                                         "D"),
    "54": ("Wall/Retaining Wall – Bulging/Cracked",                                   "B"),
    "55": ("Zoning: Non-Conforming",                                                       "D"),
    "56": ("Boiler: Fumes/Smoke/Carbon Monoxide",                                          "A"),
    "57": ("Boiler: Illegal",                                                              "A"),
    "58": ("Boiler: Defective/Inoperative/No Permit",                                      "B"),
    "59": ("Electrical Wiring: Defective/Exposed – In Progress",                      "B"),
    # Numeric 60-69
    "60": ("Electrical Work: Improper",                                                    "B"),
    "61": ("Electrical Work: Unlicensed, In-Progress",                                     "B"),
    "62": ("Elevator: Danger Condition/Shaft Open/Unguarded",                              "A"),
    "63": ("Elevator: Defective/Inoperative",                                              "B"),
    "64": ("Elevator Shaft: Open and Unguarded",                                           "A"),
    "65": ("Gas Hook-Up/Piping – Illegal or Defective",                               "A"),
    "66": ("Plumbing Work – Illegal/No Permit (also Sprinkler/Standpipe)",            "B"),
    "67": ("Crane: No Permit/License/Cert/Unsafe/Illegal",                                 "A"),
    "68": ("Crane/Scaffold: Unsafe/Illegal Operations",                                    "A"),
    "69": ("Crane/Scaffold: Unsafe Installation/Equipment",                                "A"),
    # Numeric 70-79
    "70": ("Suspension Scaffold Hanging – No Work In-Progress",                       "B"),
    "71": ("SRO: Illegal Work/No Permit/Change in Occupancy Use",                          "B"),
    "72": ("SRO: Change in Occupancy/Use",                                                 "B"),
    "73": ("Failure to Maintain",                                                          "C"),
    "74": ("Illegal Commercial/Manufacturing Use in Residential Zone",                     "C"),
    "75": ("Adult Establishment",                                                          "B"),
    "76": ("Unlicensed/Illegal/Improper Plumbing Work In-Progress",                        "A"),
    "77": ("Contrary to LL58/87 (Handicap Access)",                                        "C"),
    "78": ("Privately Owned Public Space/Non-Compliance",                                  "B"),
    "79": ("Lights from Parking Lot Shining on Building",                                  "C"),
    # Numeric 80-89
    "80": ("Elevator Not Inspected/Illegal/No Permit",                                     "D"),
    "81": ("Elevator: Accident",                                                           "A"),
    "82": ("Boiler: Accident/Explosion",                                                   "A"),
    "83": ("Construction: Contrary/Beyond Approved Plans/Permits",                         "B"),
    "84": ("Facade: Defective/Cracking",                                                   "A"),
    "85": ("Failure to Retain Water/Improper Drainage (LL103/89)",                         "C"),
    "86": ("Work Contrary to Stop Work Order",                                             "A"),
    "87": ("Request for Deck Safety Inspection",                                           "C"),
    "88": ("Safety Net/Guard Rail – Damaged/Inadequate/None (6-stories/75FT or Less)", "B"),
    "89": ("Accident – Cranes/Derricks/Suspension",                                   "A"),
    # Numeric 90-99
    "90": ("Unlicensed/Illegal Activity",                                                  "C"),
    "91": ("Site Conditions Endangering Workers",                                          "A"),
    "92": ("Illegal Conversion of Manufacturing/Industrial Space",                         "B"),
    "93": ("Request for Retaining Wall Safety Inspection",                                 "C"),
    "94": ("Plumbing: Defective/Leaking/Not Maintained",                                   "C"),
    "95": ("Bronx 2nd Offense Pilot Project",                                              "C"),
    "96": ("Unlicensed Boiler, Electrical, Plumbing or Sign Work Completed",               "B"),
    "97": ("Other Agency Jurisdiction",                                                    "D"),
    "98": ("Refer to Operations for Determination",                                        "D"),
    "99": ("Other",                                                                        "D"),
    # Alphanumeric 1x
    "1A": ("Illegal Conversion Commercial Building/Space to Dwelling Units",               "B"),
    "1B": ("Illegal Tree Removal/Topo. Change in SNAD",                                    "B"),
    "1C": ("Damage Assessment Request or Report (Disaster)",                                "C"),
    "1D": ("Con Edison Referral",                                                          "B"),
    "1E": ("Suspended (Hanging) Scaffolds – No Permit/License/Dangerous/Accident",    "A"),
    "1F": ("Failure to Comply with Annual Crane Inspection",                               "B"),
    "1G": ("Stalled Construction Site",                                                    "B"),
    "1H": ("Emergency Asbestos Response Inspection",                                       "B"),
    "1J": ("Jewelry/Dentistry Torch: Gas Piping Removed w/o Permit",                       "B"),
    "1K": ("Bowstring Truss Tracking Complaint",                                           "D"),
    "1L": ("Gas Utility Referral",                                                         "B"),
    "1U": ("Special Operations Compliance Inspection",                                     "D"),
    "1V": ("Electrical Enforcement Work Order (DOB)",                                      "B"),
    "1W": ("Plumbing Enforcement Work Order (DOB)",                                        "B"),
    "1X": ("Construction Enforcement Work Order (DOB)",                                    "B"),
    "1Y": ("Enforcement Work Order (DOB)",                                                 "D"),
    "1Z": ("Enforcement Work Order (DOB)",                                                 "D"),
    # Alphanumeric 2x
    "2A": ("Posted Notice or Order Removed/Tampered With",                                 "B"),
    "2B": ("Failure to Comply with Vacate Order",                                          "A"),
    "2C": ("Smoking Ban – Smoking on Construction Site",                              "B"),
    "2D": ("Smoking Signs – No Smoking Signs Not Observed on Construction Site",      "B"),
    "2E": ("Tracking Complaint for Full Demolition Notification",                          "D"),
    "2F": ("Building Under Structural Monitoring",                                         "D"),
    "2G": ("Advertising Sign/Billboard/Posters/Flexible Fabric – Illegal",            "C"),
    "2H": ("Second Avenue Subway Construction",                                            "D"),
    "2J": ("Sandy: Building Destroyed",                                                    "D"),
    "2K": ("Structurally Compromised Building (LL33/08)",                                  "D"),
    "2L": ("Facade (LL11/98) – Unsafe Notification",                                  "D"),
    "2M": ("Monopole Tracking Complaint",                                                  "D"),
    "2N": ("COVID-19 Executive Order",                                                     "C"),
    "2P": ("Facades Unit Compliance Inspection",                                           "C"),
    # Alphanumeric 3x
    "3A": ("Unlicensed/Illegal/Improper Electrical Work in Progress",                      "B"),
    "3B": ("Routine Inspection",                                                           "D"),
    "3C": ("Plan Compliance Inspection",                                                   "D"),
    "3D": ("Bicycle Access Waiver Request – Elevator Safety",                         "D"),
    "3E": ("Bicycle Access Waiver Request – Alternate Parking",                       "D"),
    "3G": ("Restroom Non-Compliance with Local Law 79/16",                                 "C"),
    "3H": ("DCP/BSA Compliance Inspection",                                                "D"),
    # Alphanumeric 4x
    "4A": ("Illegal Hotel Rooms in Residential Buildings",                                 "B"),
    "4B": ("SEP – Professional Certification Compliance Audit",                       "B"),
    "4C": ("Excavation Tracking Complaint",                                                "D"),
    "4D": ("Interior Demo Tracking Complaint",                                             "D"),
    "4E": ("Stalled Sites Tracking Complaint",                                             "D"),
    "4F": ("SST Tracking Complaint",                                                       "D"),
    "4G": ("Illegal Conversion No Access Follow-Up",                                       "B"),
    "4H": ("V.E.S.T. Program (DOB & NYPD)",                                                "D"),
    "4J": ("M.A.R.C.H. Program (Interagency)",                                             "D"),
    "4K": ("CSC: DM Tracking Complaint",                                                   "D"),
    "4L": ("CSC: High-Rise Tracking Complaint",                                            "D"),
    "4M": ("CSC: Low-Rise Tracking Complaint",                                             "D"),
    "4N": ("Retaining Wall Tracking Complaint",                                            "D"),
    "4P": ("Legal/Padlock Tracking Complaint",                                             "D"),
    "4S": ("Sustainability Enforcement Work Order",                                        "B"),
    "4W": ("Woodside Settlement Project",                                                  "C"),
    "4X": ("After Hours Work – With an AHV Permit",                                   "C"),
    # Alphanumeric 5x
    "5A": ("Request for Joint FDNY/DOB Inspection",                                        "B"),
    "5B": ("Non-Compliance: with Lightweight Materials",                                   "A"),
    "5C": ("Structural Stability Impacted – New Building Under Construction",          "A"),
    "5D": ("Non-Compliance: with TPPN 1/00 – Vertical Enlargements",                  "C"),
    "5E": ("Amusement Ride Accident/Incident",                                             "A"),
    "5F": ("Compliance Inspection",                                                        "D"),
    "5G": ("Unlicensed/Illegal/Improper Work In-Progress",                                 "B"),
    "5H": ("Illegal Activity",                                                             "B"),
    "5J": ("Multi Agency Joint Inspection",                                                "D"),
    # Alphanumeric 6x
    "6A": ("Vesting Inspection",                                                           "D"),
    "6B": ("Semi-Annual Homeless Shelter Inspection: Plumbing",                            "C"),
    "6C": ("Semi-Annual Homeless Shelter Inspection: Construction",                        "C"),
    "6D": ("Semi-Annual Homeless Shelter Inspection: Electrical",                          "C"),
    "6M": ("Elevator: Multiple Devices on Property",                                       "C"),
    "6S": ("Elevator: Single Device on Property/No Alternate Service",                     "C"),
    "6V": ("Tenant Safety Inspection",                                                     "C"),
    "6W": ("Tenant Safety – Failure to Post/Distribute",                              "C"),
    "6X": ("Work Without Permits Watch List Compliance",                                   "B"),
    "6Y": ("Local Law Audits",                                                             "D"),
    "6Z": ("Training Compliance",                                                          "D"),
    # Alphanumeric 7x
    "7A": ("Integrity Complaint Referral",                                                 "D"),
    "7B": ("Illegal Commercial or Manufacturing Use in a C1 or C2 Zone",                   "C"),
    "7F": ("CSE: Tracking Compliance",                                                     "D"),
    "7G": ("CSE: Sweep",                                                                   "D"),
    "7J": ("Work Without a Permit – Occupied Multiple Dwelling",                      "B"),
    "7K": ("Local Law 188/17 Compliance Inspections – Active Jobs",                   "D"),
    "7L": ("DOHMH Referral – Tenant Protection Non-Compliance",                       "B"),
    "7N": ("Privately Owned Public Space/Compliance Inspection",                           "C"),
    # Alphanumeric 8x
    "8A": ("Construction Safety Compliance (CSC) Action",                                  "B"),
}

# ── HPD Housing Maintenance Code Violations (wvxf-dwi5) ──────────────────────

# CSV header → DB column name
HPD_COLUMN_MAP = {
    "ViolationID":       "violation_id",
    "BIN":               "bin",
    "Borough":           "borough",
    "HouseNumber":       "house_number",
    "StreetName":        "street_name",
    "Postcode":          "zip_code",
    "Apartment":         "apartment",
    "Class":             "violation_class",
    "InspectionDate":    "inspection_date",
    "ApprovedDate":      "approved_date",
    "CertifiedDate":     "certified_date",
    "NOVDescription":    "nov_description",
    "NOVIssuedDate":     "nov_issued_date",
    "CurrentStatus":     "current_status",
    "CurrentStatusDate": "current_status_date",
    "ViolationStatus":   "violation_status",
    "RentImpairing":     "rent_impairing",
    "OrderNumber":       "order_number",
    "Latitude":          "latitude",
    "Longitude":         "longitude",
    "CommunityBoard":    "community_board",
    "BBL":               "bbl",
}

# Socrata JSON API field name → DB column name (API returns lowercase)
HPD_JSON_COLUMN_MAP = {
    "violationid":       "violation_id",
    "bin":               "bin",
    "borough":           "borough",
    "housenumber":       "house_number",
    "streetname":        "street_name",
    "postcode":          "zip_code",
    "apartment":         "apartment",
    "class":             "violation_class",
    "inspectiondate":    "inspection_date",
    "approveddate":      "approved_date",
    "certifieddate":     "certified_date",
    "novdescription":    "nov_description",
    "novissueddate":     "nov_issued_date",
    "currentstatus":     "current_status",
    "currentstatusdate": "current_status_date",
    "violationstatus":   "violation_status",
    "rentimpairing":     "rent_impairing",
    "ordernumber":       "order_number",
    "latitude":          "latitude",
    "longitude":         "longitude",
    "communityboard":    "community_board",
    "bbl":               "bbl",
}

HPD_DB_COLUMNS = [
    "violation_id", "bin", "borough", "house_number", "street_name", "zip_code",
    "apartment", "violation_class", "inspection_date", "approved_date", "certified_date",
    "nov_description", "nov_issued_date", "current_status", "current_status_date",
    "violation_status", "rent_impairing", "order_number", "latitude", "longitude",
    "community_board", "bbl",
]

# ── HPD Housing Maintenance Code Complaints (ygpa-z7cr) ──────────────────────

HPD_COMPLAINTS_CSV_URL = "https://data.cityofnewyork.us/api/views/ygpa-z7cr/rows.csv?accessType=DOWNLOAD"
HPD_COMPLAINTS_API     = "https://data.cityofnewyork.us/resource/ygpa-z7cr.json"

# CSV header → DB column name (Socrata CSV uses PascalCase headers)
HPD_COMPLAINTS_COLUMN_MAP = {
    "ProblemID":           "problem_id",
    "ComplaintID":         "complaint_id",
    "BIN":                 "bin",
    "Borough":             "borough",
    "HouseNumber":         "house_number",
    "StreetName":          "street_name",
    "PostCode":            "zip_code",
    "Apartment":           "apartment",
    "UnitType":            "unit_type",
    "SpaceType":           "space_type",
    "Type":                "type",
    "MajorCategory":       "major_category",
    "MinorCategory":       "minor_category",
    "ProblemCode":         "problem_code",
    "ComplaintStatus":     "complaint_status",
    "ComplaintStatusDate": "complaint_status_date",
    "ProblemStatus":       "problem_status",
    "ProblemStatusDate":   "problem_status_date",
    "StatusDescription":   "status_description",
    "ReceivedDate":        "received_date",
    "Latitude":            "latitude",
    "Longitude":           "longitude",
    "CommunityBoard":      "community_board",
    "BBL":                 "bbl",
}

# Socrata JSON API field name → DB column name (API returns snake_case)
HPD_COMPLAINTS_JSON_COLUMN_MAP = {
    "problem_id":           "problem_id",
    "complaint_id":         "complaint_id",
    "bin":                  "bin",
    "borough":              "borough",
    "house_number":         "house_number",
    "street_name":          "street_name",
    "post_code":            "zip_code",       # only rename needed
    "apartment":            "apartment",
    "unit_type":            "unit_type",
    "space_type":           "space_type",
    "type":                 "type",
    "major_category":       "major_category",
    "minor_category":       "minor_category",
    "problem_code":         "problem_code",
    "complaint_status":     "complaint_status",
    "complaint_status_date":"complaint_status_date",
    "problem_status":       "problem_status",
    "problem_status_date":  "problem_status_date",
    "status_description":   "status_description",
    "received_date":        "received_date",
    "latitude":             "latitude",
    "longitude":            "longitude",
    "community_board":      "community_board",
    "bbl":                  "bbl",
}

HPD_COMPLAINTS_DB_COLUMNS = [
    "problem_id", "complaint_id", "bin", "borough", "house_number", "street_name",
    "zip_code", "apartment", "unit_type", "space_type", "type", "major_category",
    "minor_category", "problem_code", "complaint_status", "complaint_status_date",
    "problem_status", "problem_status_date", "status_description", "received_date",
    "latitude", "longitude", "community_board", "bbl",
]
