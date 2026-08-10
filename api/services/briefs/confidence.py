"""Deterministic confidence note.

The model used to write this field, and produced things like "Data suggests
significant unresolved issues impacting living conditions" — which is not a
statement about confidence at all, just filler in the shape of a caveat.

Confidence in a record is a function of how much of it there is and how old it
is. Both are known. So this is computed, and the field stops being a place for
the model to sound careful.
"""

from datetime import date

# Fewer HPD records than this and the percentile is resting on very little.
THIN_RECORD_THRESHOLD = 5

# Beyond this, the record describes a building that may have changed hands,
# been renovated, or simply stopped being inspected.
STALE_YEARS = 3


def confidence_note(
    record_count: int | None,
    latest_activity: date | None,
    today: date | None = None,
) -> str | None:
    """Return a caveat, or None when the record supports a confident read.

    None is the common case and the correct one — a note on every brief trains
    readers to skip it, which defeats the point of having one.
    """
    today = today or date.today()

    if record_count is None:
        return (
            "We could not determine how much HPD history exists for this "
            "building, so treat this summary as provisional."
        )

    if record_count == 0:
        return "There are no HPD records on file for this building."

    if record_count < THIN_RECORD_THRESHOLD:
        plural = "record" if record_count == 1 else "records"
        return (
            f"This building has only {record_count} HPD {plural} on file, so "
            "this summary rests on limited information."
        )

    if latest_activity is None:
        return (
            "We could not determine when this building's HPD record was last "
            "updated, so treat this summary as provisional."
        )

    years = (today - latest_activity).days / 365.25
    if years >= STALE_YEARS:
        return (
            f"The most recent HPD activity on file is from {latest_activity.year}, "
            "so current conditions may differ."
        )

    return None


def confidence_note_from_signals(signals: dict, today: date | None = None) -> str | None:
    """Dict-facing wrapper for the selection layer.

    Kept separate so the logic above stays a pure function of two values and can
    be tested without constructing a signals payload.
    """
    return confidence_note(
        record_count=signals.get("hpd_record_count"),
        latest_activity=signals.get("latest_hpd_activity"),
        today=today,
    )
