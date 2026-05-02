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
