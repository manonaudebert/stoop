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
    priority_ab_2yr: int = 0
    open_priority_a_complaints: int = 0
    open_priority_b_complaints: int = 0
    no_access_count_5yr: int = 0
    closed_5yr_complaints: int = 0
    first_complaint_date: date | None
    latest_complaint_date: date | None
    construction_year: str | None = None
    nta_code: str | None = None
    nta_name: str | None = None
    risk_level: str | None = None
    serious_rate: float | None = None
    serious_rate_percentile: float | None = None
    trend_direction: str | None = None
    recent_complaint_count: int | None = None
    prior_complaint_count: int | None = None
    normalized_percentile: float | None = None
    normalized_serious_rate_percentile: float | None = None

    model_config = {"from_attributes": True}


class BuildingDetailResponse(BuildingSummaryResponse):
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
    nta_percentile: float | None        # 0–100: normalized_percentile for this building within its NTA
    median_serious_rate: float | None   # median Priority A+B rate/yr among NTA residential peers


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
    recent_complaint_count: int = 0
    prior_complaint_count: int = 0
    recent_emergency_count: int = 0
    trend_direction: str | None = None
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


# ── Building Brief ────────────────────────────────────────────────────────────

class BriefCitation(BaseModel):
    """One source behind a watch item. `url` is set for sources that live on the
    web rather than in the ABCs PDF; `covers` names which claims this source
    backs, and is only populated when the item cites more than one document."""
    label: str
    url: str | None = None
    covers: str | None = None


class BriefWatchItem(BaseModel):
    """One flagged condition. Every text field here is authored, except one.

    `condition`, `why_it_matters` and `action` are copied verbatim from
    rules.yaml, and `citation` names the page of HPD's *ABCs of Housing* they
    came from. No counts are sent at all — `magnitude` was removed 2026-08-12,
    and the cards on the same page own every number.

    `watch_for` is the single exception and the only generated text on this
    page — read from the `brief_texts` corpus, where a row exists only if it
    passed the validator. It is null on every item until a corpus is generated,
    and null is a normal state for any individual item forever: the rest of the
    item is unaffected, and the frontend renders the authored `brief_line`.
    Anything rendering it must carry the AI-assisted label.
    """
    rule_id: str
    # The compact line the page leads with; the fields below sit behind a
    # disclosure. None when the rule authors none, in which case the frontend
    # falls back to `condition`.
    brief_line: str | None = None
    # The generated sentence for this rule, or null when the corpus has no row
    # for this input shape. Sits in layer 1 beside `brief_line` and must be
    # labelled as AI-assisted wherever it renders — it is the only text on the
    # page a model wrote.
    watch_for: str | None = None
    condition: str
    why_it_matters: str
    action: str
    # Every source behind this item, primary first. A list rather than a string
    # because a rule can make claims from two documents — the class C item takes
    # its violation classes from the ABCs PDF and its correction deadlines from
    # HPD's penalties-and-fees page, and citing only the first would put a real
    # claim behind a reference that does not support it.
    citations: list[BriefCitation]
    # Populated only for the class C rule. Empty list and None mean different
    # things: [] is "flagged, nothing describable" (4.6% of class C buildings),
    # None is "this rule is not about hazard areas at all".
    hazard_areas: list[str] | None = None
    # The same areas as bare group labels, for layer 1. `hazard_areas` pairs
    # each label with its authored tooltip sentence, which is the right depth
    # for the expanded block and far too much for a one-line summary — the
    # sentences are dictionary definitions, not body copy. Sent as its own field
    # rather than split from the above on " — ", which would break the moment a
    # label contained a dash.
    hazard_area_labels: list[str] | None = None


class BuildingBriefResponse(BaseModel):
    bin: str
    watch_items: list[BriefWatchItem]
    # The computed caveat — thin record, stale record — or null when neither
    # applies. Independent of watch_items: a building can flag nothing and still
    # warrant "we have very little on this address".
    confidence_note: str | None = None
    # True when no rule fired. Explicit rather than left to the reader of an
    # empty list, because the frontend renders a specific sentence for it and
    # "empty because nothing fired" must not be confused with "empty because the
    # lookup failed".
    no_flags: bool = False
    # False only when the building has no HPD record whatsoever. Splits the
    # no_flags case in two, and the two need different sentences: "nothing
    # crossed the thresholds we flag" implies checking happened, which is a lie
    # on a building with nothing to check. The frontend must not infer this by
    # matching the text of confidence_note — that copy is expected to change.
    has_records: bool = True


# ── SF (San Francisco) ────────────────────────────────────────────────────────

class Sf311ComplaintResponse(BaseModel):
    service_request_id: str
    service_name: str | None
    service_subtype: str | None
    address: str | None
    requested_datetime: str | None
    status_description: str | None

    model_config = {"from_attributes": True}


class SfNovResponse(BaseModel):
    row_id: str
    mapblklot: str | None
    status: str | None
    nov_category_description: str | None
    item: str | None
    nov_item_description: str | None
    date_filed: date | None
    neighborhood: str | None
    location_lat: float | None
    location_lon: float | None

    model_config = {"from_attributes": True}


class SfBuildingSummaryResponse(BaseModel):
    mapblklot: str
    address: str | None
    neighborhood: str | None
    latitude: float | None
    longitude: float | None
    # 311 complaints domain
    total_complaints: int = 0
    recent_complaint_count: int = 0
    prior_complaint_count: int = 0
    trend_direction: str | None = None
    heat_complaints: int = 0
    lead_complaints: int = 0
    pest_complaints: int = 0
    # Severity tiers, last 5 years (habitability conditions only)
    severe_complaints_5yr: int = 0
    serious_complaints_5yr: int = 0
    minor_complaints_5yr: int = 0
    latest_complaint_date: date | None = None
    complaints_density_pct: float | None = None
    complaints_risk_level: str | None = None
    # DBI violations domain
    total_violations: int = 0
    open_violations: int = 0
    open_lead_violations: int = 0
    open_fire_violations: int = 0
    # Open violations by severity tier (sum to open_violations)
    open_severe_violations: int = 0
    open_serious_violations: int = 0
    open_minor_violations: int = 0
    latest_violation_date: date | None = None
    violations_density_pct: float | None = None
    violations_risk_level: str | None = None

    model_config = {"from_attributes": True}


class SfBuildingDetailResponse(SfBuildingSummaryResponse):
    complaints: list[Sf311ComplaintResponse] = []
    violations: list[SfNovResponse] = []
    complaints_total_count: int = 0
    violations_total_count: int = 0
    page: int = 1
    page_size: int = 50


class SfComplaintBreakdownItem(BaseModel):
    subtype: str
    count: int


class SfViolationBreakdownItem(BaseModel):
    category: str
    count: int
    open_count: int
