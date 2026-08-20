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
  priority_ab_2yr: number
  open_priority_a_complaints: number
  open_priority_b_complaints: number
  no_access_count_5yr: number
  closed_5yr_complaints: number
  first_complaint_date: string | null
  latest_complaint_date: string | null
  construction_year: string | null
  nta_code: string | null
  nta_name: string | null
  risk_level: string | null
  serious_rate: number | null
  serious_rate_percentile: number | null
  trend_direction: string | null
  recent_complaint_count: number | null
  prior_complaint_count: number | null
  normalized_percentile: number | null
  normalized_serious_rate_percentile: number | null
}

export interface NeighborhoodData {
  nta_code: string
  nta_name: string
  building_count: number
  nta_percentile: number | null
  median_serious_rate: number | null
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
  recent_complaint_count: number
  prior_complaint_count: number
  recent_emergency_count: number
  trend_direction: string | null
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

export interface ViolationAgeBucketItem {
  bucket: string  // <30d | 30-90d | 3-12mo | 1-3yr | 3yr+
  count: number
}

// ── SF (San Francisco) ────────────────────────────────────────────────────────

export interface Sf311Complaint {
  service_request_id: string
  service_name: string | null
  service_subtype: string | null
  address: string | null
  requested_datetime: string | null
  status_description: string | null
}

export interface SfNov {
  row_id: string
  mapblklot: string | null
  status: string | null
  nov_category_description: string | null
  item: string | null
  nov_item_description: string | null
  date_filed: string | null
  neighborhood: string | null
  location_lat: number | null
  location_lon: number | null
}

export interface SfBuildingSummary {
  mapblklot: string
  address: string | null
  neighborhood: string | null
  latitude: number | null
  longitude: number | null
  // 311 complaints domain
  total_complaints: number
  recent_complaint_count: number
  prior_complaint_count: number
  trend_direction: string | null
  heat_complaints: number
  lead_complaints: number
  pest_complaints: number
  severe_complaints_5yr: number
  serious_complaints_5yr: number
  minor_complaints_5yr: number
  latest_complaint_date: string | null
  complaints_density_pct: number | null
  complaints_risk_level: string | null
  // DBI violations domain
  total_violations: number
  open_violations: number
  open_lead_violations: number
  open_fire_violations: number
  open_severe_violations: number
  open_serious_violations: number
  open_minor_violations: number
  latest_violation_date: string | null
  violations_density_pct: number | null
  violations_risk_level: string | null
}

export interface SfBuildingDetail extends SfBuildingSummary {
  complaints: Sf311Complaint[]
  violations: SfNov[]
  complaints_total_count: number
  violations_total_count: number
  page: number
  page_size: number
}

export interface SfComplaintBreakdownItem {
  subtype: string
  count: number
}

export interface SfViolationBreakdownItem {
  category: string
  count: number
  open_count: number
}

// ── Building Brief ────────────────────────────────────────────────────────────

// Every text field on a watch item is AUTHORED, not generated: condition,
// why_it_matters and action are copied verbatim from the backend's rules.yaml,
// and citation names the page of HPD's "ABCs of Housing" they came from. This
// is why the component renders them without an AI-assisted label — nothing here
// has been near a model.
export interface BriefCitation {
  label: string
  // Set for sources on the web rather than in the ABCs PDF; rendered as a link.
  url: string | null
  // Which claims this source backs. Only populated when an item cites more than
  // one document, where the reader needs to know which to check for what.
  covers: string | null
}

export interface BriefWatchItem {
  rule_id: string
  // Layer 1: the authored compact line. Null when the rule authors none, in
  // which case rendering falls back to `condition` — never a client-side
  // truncation, which would be exactly the paraphrase this feature avoids.
  brief_line: string | null
  // The only generated text on the building page. Null whenever the corpus has
  // no row for this rule's input shape, which is the normal state for every
  // rule below the top two and for any rule whose corpus was deleted. Anything
  // rendering it must carry the AI-assisted label — see WatchForLine.
  watch_for: string | null
  // Which kind of text `watch_for` holds. 'generated' is the only value that may
  // carry the AI-assisted label; 'authored' text is cited like everything else,
  // and null whenever `watch_for` is null. Read this rather than the city — a
  // NYC rule whose corpus row is deleted serves authored text too.
  watch_for_source: 'authored' | 'generated' | null
  condition: string
  why_it_matters: string
  // Optional: omitted where the only honest action is generic advice that
  // applies to every condition alike. See api/services/briefs/rules.py::Rule.
  action?: string | null
  citations: BriefCitation[]
  // Only populated for the class C rule. [] and null differ: [] means flagged
  // but nothing describable, null means this rule is not about hazard areas.
  hazard_areas: string[] | null
  // The same areas as one ready-to-interpolate prose phrase for layer 1, e.g.
  // "mold and pests, and building maintenance". hazard_areas pairs each label
  // with its authored tooltip sentence — right depth for the expanded block,
  // far too much for a one-line summary.
  //
  // Joined server-side, and deliberately not a string[]: the entries contain
  // their own "and", so the serial comma is load-bearing, and joining here
  // would be a second implementation of taxonomy.join_prose free to drift from
  // the one the expanded block uses. Null when the rule has no areas AND when
  // none are describable — layer 1 renders the bare authored line either way.
  hazard_area_phrase: string | null
}

/**
 * Everything a rendered brief needs, minus the identifier.
 *
 * The identifier is exactly what the two cities cannot share: NYC keys on a BIN
 * (one building) and SF on a mapblklot (one PARCEL, possibly several buildings).
 * `BuildingBrief.tsx` takes this base type, so it never has to know which, and
 * the two ids stay honestly named rather than one pretending to be the other.
 */
export interface BuildingBriefBase {
  watch_items: BriefWatchItem[]
  confidence_note: string | null
  no_flags: boolean
  // False only when the building has no HPD record at all. Splits no_flags into
  // two states that need different sentences: "nothing crossed the thresholds
  // we flag" implies checking happened, which is untrue of a building with
  // nothing to check. Do not infer this by matching confidence_note's wording.
  has_records: boolean
  // Violations and complaints together. The only number the brief renders,
  // and only in the empty state — see EmptyState in BuildingBrief.tsx.
  record_count: number
}

export interface BuildingBrief extends BuildingBriefBase {
  bin: string
}

export interface SfBuildingBrief extends BuildingBriefBase {
  // A PARCEL id, not a building id: one mapblklot can carry several buildings,
  // which is why SF's copy says "property" where NYC's says "building".
  mapblklot: string
}
