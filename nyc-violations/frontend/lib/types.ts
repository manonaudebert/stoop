export interface Complaint {
  id: number
  complaint_number: string
  status: string | null
  date_entered: string | null
  address: string | null
  zip_code: string | null
  bin: string | null
  community_board: string | null
  complaint_category: string | null
  category_description: string | null
  category_priority: string | null
  unit: string | null
  disposition_date: string | null
  disposition_code: string | null
  disposition_description: string | null
  inspection_date: string | null
  borough: string | null
}

export interface BuildingSummary {
  bin: string
  address: string | null
  zip_code: string | null
  borough: string | null
  latitude: number | null
  longitude: number | null
  total_complaints: number
  open_complaints: number
  closed_complaints: number
  priority_a_complaints: number
  priority_ab_complaints: number
  first_complaint_date: string | null
  latest_complaint_date: string | null
  score: number | null
  construction_year: string | null
  nta_code: string | null
  nta_name: string | null
  risk_level: string | null
  serious_rate: number | null
  serious_rate_percentile: number | null
  trend_direction: string | null
  recent_complaint_count: number | null
  prior_complaint_count: number | null
  neighborhood_percentile: number | null
}

export interface NeighborhoodData {
  nta_code: string
  nta_name: string
  building_count: number
  avg_score: number | null
  median_score: number | null
  p25_score: number | null
  p75_score: number | null
  nta_percentile: number | null
  peer_scores: number[]
}

export interface BuildingDetail extends BuildingSummary {
  complaints: Complaint[]
  total_count: number
  page: number
  page_size: number
}

export interface TimelinePoint {
  month: string
  count: number
}

export interface CategoryBreakdownItem {
  category: string
  description: string | null
  priority: string | null
  count: number
}

// ── HPD violations ────────────────────────────────────────────────────────────

export interface HpdViolation {
  violation_id: string
  bin: string | null
  apartment: string | null
  violation_class: string | null
  nov_issued_date: string | null
  current_status: string | null
  current_status_date: string | null
  violation_status: string | null
  rent_impairing: string | null
  nov_description: string | null
  order_number: string | null
  order_category: string | null
  order_short_description: string | null
  inspection_date: string | null
  approved_date: string | null
  certified_date: string | null
}

export interface HpdBuildingSummary {
  bin: string
  address: string | null
  zip_code: string | null
  borough: string | null
  latitude: number | null
  longitude: number | null
  nta_code: string | null
  nta_name: string | null
  total_violations: number
  open_violations: number
  class_a_violations: number
  class_b_violations: number
  rent_impairing_count: number
  latest_violation_date: string | null
  hpd_risk_tier: string | null
  violations_density_pct: number | null
}

export interface HpdBuildingDetail extends HpdBuildingSummary {
  violations: HpdViolation[]
  total_count: number
  page: number
  page_size: number
}

export interface ViolationClassBreakdownItem {
  violation_class: string
  category: string | null
  count: number
  open_count: number
}

// ── HPD complaints ────────────────────────────────────────────────────────────

export interface HpdComplaint {
  problem_id: string
  complaint_id: string | null
  bin: string | null
  apartment: string | null
  unit_type: string | null
  space_type: string | null
  type: string | null
  major_category: string | null
  minor_category: string | null
  complaint_status: string | null
  complaint_status_date: string | null
  problem_status: string | null
  problem_status_date: string | null
  status_description: string | null
  received_date: string | null
}

export interface HpdComplaintBuildingSummary {
  bin: string
  address: string | null
  zip_code: string | null
  borough: string | null
  latitude: number | null
  longitude: number | null
  nta_code: string | null
  nta_name: string | null
  total_complaints: number
  open_complaints: number
  open_emergency_complaints: number
  heat_complaints: number
  latest_complaint_date: string | null
  complaint_risk_tier: string | null
  complaints_density_pct: number | null
  risk_level: string | null
}

export interface HpdComplaintBuildingDetail extends HpdComplaintBuildingSummary {
  complaints: HpdComplaint[]
  total_count: number
  page: number
  page_size: number
}

export interface ComplaintCategoryBreakdownItem {
  type: string | null       // EMERGENCY / NON EMERGENCY
  major_category: string
  count: number
  open_count: number
}

export interface ComplaintTypePeriodItem {
  type: string              // IMMEDIATE EMERGENCY | EMERGENCY | NON EMERGENCY
  recent_count: number      // last 12 months
  prior_count: number       // prior 4 years (1–5 years ago)
}

export interface ComplaintResolutionItem {
  bucket: string            // open | no_access | partial_no_access | inspected_violation |
                            // inspected_no_violation | phone_resolved | insufficient_time |
                            // lead_followup | section_8_failure | unknown
  count: number
}

export interface ComplaintMinorBreakdownItem {
  minor_category: string
  count: number
  open_count: number
}
