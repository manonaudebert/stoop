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
    nta_percentile: float | None   # 0–100: pct of NTA buildings this building scores better than
    peer_scores: list[float]       # sampled scores for dot plot (≤200)
