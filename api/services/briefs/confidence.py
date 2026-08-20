"""Deterministic confidence note.

The model used to write this field, and produced things like "Data suggests
significant unresolved issues impacting living conditions" — which is not a
statement about confidence at all, just filler in the shape of a caveat.

Confidence in a record is a function of how much of it there is and how old it
is. Both are known. So this is computed, and the field stops being a place for
the model to sound careful.
"""

from datetime import date

from services.briefs.cities import NYC, CityBriefConfig

# Fewer records than this and the percentile is resting on very little.
THIN_RECORD_THRESHOLD = 5

# Beyond this, the record describes a building that may have changed hands,
# been renovated, or simply stopped being inspected.
STALE_YEARS = 3


def confidence_note(
    record_count: int | None,
    latest_activity: date | None,
    today: date | None = None,
    config: CityBriefConfig = NYC,
) -> str | None:
    """Return a caveat, or None when the record supports a confident read.

    None is the common case and the correct one — a note on every brief trains
    readers to skip it, which defeats the point of having one.

    Two nouns come from the city config. `record_noun` names the record set the
    count is of; `subject_noun` is what a row describes, which is NOT always a
    building — SF is parcel-grained, and one mapblklot can carry several
    buildings, so the copy says "property" there rather than promising more
    precision than the row has.
    """
    today = today or date.today()
    noun, subject = config.record_noun, config.subject_noun

    if record_count is None:
        return (
            f"We could not determine how much {noun} history exists for this "
            f"{subject}, so treat this summary as provisional."
        )

    if record_count == 0:
        return f"There are no {noun} records on file for this {subject}."

    if record_count < THIN_RECORD_THRESHOLD:
        plural = "record" if record_count == 1 else "records"
        return (
            f"This {subject} has only {record_count} {noun} {plural} on file, so "
            "this summary rests on limited information."
        )

    if latest_activity is None:
        return (
            f"We could not determine when this {subject}'s {noun} record was last "
            "updated, so treat this summary as provisional."
        )

    years = (today - latest_activity).days / 365.25
    if years >= STALE_YEARS:
        return (
            f"The most recent {noun} activity on file is from {latest_activity.year}, "
            "so current conditions may differ."
        )

    return None


def confidence_note_from_signals(
    signals: dict,
    today: date | None = None,
    config: CityBriefConfig = NYC,
) -> str | None:
    """Dict-facing wrapper for the selection layer.

    Kept separate so the logic above stays a pure function of two values and can
    be tested without constructing a signals payload.
    """
    return confidence_note(
        record_count=signals.get(config.record_count_signal),
        latest_activity=signals.get(config.latest_activity_signal),
        today=today,
        config=config,
    )
