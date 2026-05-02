from datetime import date
from dataclasses import dataclass, field
import math

PRIORITY_DEDUCTIONS: dict[str, float] = {"A": 15, "B": 8, "C": 3, "D": 1}


@dataclass
class PriorityTier:
    count: int = 0
    weighted_deduction: float = 0.0


@dataclass
class ScoreResult:
    score: float
    by_priority: dict[str, PriorityTier] = field(default_factory=dict)
    by_recency: dict[str, int] = field(default_factory=dict)


def compute_score(complaints: list[dict]) -> ScoreResult:
    """
    complaints: list of dicts with keys 'priority' (A/B/C/D) and 'date_entered' (date | None).
    Returns ScoreResult with grade, numeric score, and breakdown by priority tier and recency bucket.
    """
    today = date.today()

    by_priority: dict[str, PriorityTier] = {p: PriorityTier() for p in "ABCD"}
    by_recency: dict[str, int] = {"recent": 0, "mid": 0, "old": 0}
    total_deduction = 0.0

    for c in complaints:
        priority = c.get("priority") or "C"
        if priority not in PRIORITY_DEDUCTIONS:
            priority = "C"

        entered = c.get("date_entered")
        if entered:
            years = (today - entered).days / 365.25
        else:
            years = 3.5  # unknown date → mid bucket

        if years <= 2:
            weight, bucket = 1.0, "recent"
        elif years <= 5:
            weight, bucket = 0.5, "mid"
        else:
            weight, bucket = 0.25, "old"

        deduction = PRIORITY_DEDUCTIONS[priority] * weight
        total_deduction += deduction

        by_priority[priority].count += 1
        by_priority[priority].weighted_deduction = round(
            by_priority[priority].weighted_deduction + deduction, 1
        )
        by_recency[bucket] += 1

    score = round(100.0 * math.exp(-total_deduction / 40.0), 1)

    return ScoreResult(score=score, by_priority=by_priority, by_recency=by_recency)
