from datetime import date
from pydantic import BaseModel


class ComplaintResponse(BaseModel):
    id: int
    complaint_number: str
    status: str | None
    date_entered: date | None
    address: str | None
    zip_code: str | None
    bin: str | None
    community_board: str | None
    complaint_category: str | None
    category_description: str | None
    category_priority: str | None
    unit: str | None
    disposition_date: date | None
    disposition_code: str | None
    disposition_description: str | None
    inspection_date: date | None
    borough: str | None

    model_config = {"from_attributes": True}


class PriorityTierDetail(BaseModel):
    count: int
    weighted_deduction: float


class ScoreDetail(BaseModel):
    score: float
    by_priority: dict[str, PriorityTierDetail]
    by_recency: dict[str, int]


class BuildingSummaryResponse(BaseModel):
    bin: str
    address: str | None
    zip_code: str | None
    borough: str | None
    latitude: float | None
    longitude: float | None
    total_complaints: int
    open_complaints: int
    closed_complaints: int
    priority_a_complaints: int
    priority_ab_complaints: int
    open_priority_a_complaints: int = 0
    open_priority_b_complaints: int = 0
    no_access_count_5yr: int = 0
    closed_5yr_complaints: int = 0
    first_complaint_date: date | None
    latest_complaint_date: date | None
    score: float | None
    construction_year: str | None = None
    nta_code: str | None = None
    nta_name: str | None = None
    risk_level: str | None = None
    serious_rate: float | None = None
    serious_rate_percentile: float | None = None
    trend_direction: str | None = None
    recent_complaint_count: int | None = None
    prior_complaint_count: int | None = None
    neighborhood_percentile: float | None = None

    model_config = {"from_attributes": True}


class BuildingDetailResponse(BuildingSummaryResponse):
    score_detail: ScoreDetail | None
    complaints: list[ComplaintResponse]
    total_count: int
    page: int
    page_size: int


class TimelinePoint(BaseModel):
    month: str
    count: int


class CategoryBreakdownItem(BaseModel):
    category: str
    description: str | None
    priority: str | None
    count: int


class NeighborhoodResponse(BaseModel):
    nta_code: str
    nta_name: str
    nta_type: int | None
    building_count: int
    avg_score: float | None
    median_score: float | None
    p25_score: float | None
    p75_score: float | None
    nta_percentile: float | None        # 0–100: pct of NTA buildings this building scores better than
    median_serious_rate: float | None   # median Priority A+B rate/yr among NTA residential peers
    peer_scores: list[float]            # sampled scores for dot plot (≤200)


# ── HPD violations ────────────────────────────────────────────────────────────

class HpdViolationResponse(BaseModel):
    violation_id: str
    bin: str | None
    apartment: str | None
    violation_class: str | None
    nov_issued_date: date | None
    current_status: str | None
    current_status_date: date | None
    violation_status: str | None
    rent_impairing: str | None
    nov_description: str | None
    order_number: str | None
    order_category: str | None          # from hpd_order_numbers lookup
    order_short_description: str | None # short_description with leading "N - " stripped
    inspection_date: date | None
    approved_date: date | None
    certified_date: date | None

    model_config = {"from_attributes": True}


class HpdBuildingSummaryResponse(BaseModel):
    bin: str
    address: str | None
    zip_code: str | None
    borough: str | None
    latitude: float | None
    longitude: float | None
    nta_code: str | None
    nta_name: str | None
    total_violations: int
    open_violations: int
    class_a_violations: int
    class_b_violations: int
    rent_impairing_count: int
    latest_violation_date: date | None
    hpd_risk_tier: str | None
    violations_density_pct: float | None = None

    model_config = {"from_attributes": True}


class HpdBuildingDetailResponse(HpdBuildingSummaryResponse):
    violations: list[HpdViolationResponse]
    total_count: int
    page: int
    page_size: int


class ViolationClassBreakdownItem(BaseModel):
    violation_class: str
    category: str | None
    count: int
    open_count: int


# ── HPD complaints ────────────────────────────────────────────────────────────

class HpdComplaintResponse(BaseModel):
    problem_id: str
    complaint_id: str | None
    bin: str | None
    apartment: str | None
    unit_type: str | None
    space_type: str | None
    type: str | None
    major_category: str | None
    minor_category: str | None
    complaint_status: str | None
    complaint_status_date: date | None
    problem_status: str | None
    problem_status_date: date | None
    status_description: str | None
    received_date: date | None

    model_config = {"from_attributes": True}


class HpdComplaintBuildingSummaryResponse(BaseModel):
    bin: str
    address: str | None
    zip_code: str | None
    borough: str | None
    latitude: float | None
    longitude: float | None
    nta_code: str | None
    nta_name: str | None
    total_complaints: int
    open_complaints: int
    open_emergency_complaints: int
    heat_complaints: int
    latest_complaint_date: date | None
    complaint_risk_tier: str | None
    complaints_density_pct: float | None = None
    risk_level: str | None = None

    model_config = {"from_attributes": True}


class HpdComplaintBuildingDetailResponse(HpdComplaintBuildingSummaryResponse):
    complaints: list[HpdComplaintResponse]
    total_count: int
    page: int
    page_size: int


class ComplaintCategoryBreakdownItem(BaseModel):
    type: str | None          # EMERGENCY / NON EMERGENCY
    major_category: str
    count: int
    open_count: int


class ComplaintTypePeriodItem(BaseModel):
    type: str                 # IMMEDIATE EMERGENCY / EMERGENCY / NON EMERGENCY
    recent_count: int         # last 12 months
    prior_count: int          # prior 4 years (1–5 years ago)


class ComplaintResolutionItem(BaseModel):
    bucket: str               # open | no_access | partial_no_access | inspected_violation |
                              # inspected_no_violation | phone_resolved | insufficient_time |
                              # lead_followup | section_8_failure | unknown
    count: int


class ComplaintMinorBreakdownItem(BaseModel):
    minor_category: str
    count: int
    open_count: int


class ViolationAgeBucketItem(BaseModel):
    bucket: str   # <30d | 30-90d | 3-12mo | 1-3yr | 3yr+
    count: int
