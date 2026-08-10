"""Rule evaluation — deterministic, no model involved.

Signals in, advice out. This is the half of the Building Brief that used to be
the model's job and produced "High number of open violations" for a building in
the better two-thirds of its neighborhood.

Nothing here calls an API, so it is fast, free, and unit-testable — and the
`action` text a tenant reads is copied from rules.yaml rather than generated,
which is why "verbatim" is a property of the code rather than a hope about the
prompt.
"""

import operator
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

RULES_PATH = Path(__file__).resolve().parent / "rules.yaml"

_OPS = {
    ">": operator.gt,
    ">=": operator.ge,
    "<": operator.lt,
    "<=": operator.le,
    "==": operator.eq,
    "!=": operator.ne,
}


class MissingSignalError(KeyError):
    """A rule references a signal the selection layer never supplied.

    This is a plumbing bug, not a data condition, and it fails loudly. The quiet
    alternative — treating an unknown signal as false — would silently disable a
    rule the moment someone renamed a column, and the only symptom would be
    briefs that stopped mentioning lead paint.
    """


@dataclass(frozen=True)
class Rule:
    id: str
    priority: int
    when: dict[str, Any]
    condition: str
    why_it_matters: str
    action: str
    source: str
    rank_by: str | None = None
    magnitude: str | None = None

    def cite(self, document: str) -> str:
        return f"{document}, {self.source}"

    def magnitude_text(self, signals: dict[str, Any]) -> str | None:
        """The count behind the condition, rendered from the template.

        Formatted here, from the database value, never by the model — which is
        the whole reason a number is safe to show at all. `str.format_map` over
        the signals dict means the template can only ever interpolate a signal
        that exists; a typo'd field name raises rather than printing a literal
        brace into a renter's brief.
        """
        if self.magnitude is None:
            return None
        try:
            return self.magnitude.format_map(signals)
        except KeyError as e:
            raise MissingSignalError(
                f"rule {self.id!r} magnitude references signal {e.args[0]!r}, "
                "which the selection layer did not supply"
            ) from None

    def rank_value(self, signals: dict[str, Any]) -> float:
        """Magnitude used to order this rule against its priority peers.

        Rules without `rank_by` never tie with anything (each other priority is
        held by exactly one rule), so 0.0 is unreachable rather than a default
        that could silently sort a real rule last.
        """
        if self.rank_by is None:
            return 0.0
        if self.rank_by not in signals:
            raise MissingSignalError(
                f"rule {self.id!r} ranks by signal {self.rank_by!r}, which the "
                "selection layer did not supply"
            )
        return signals[self.rank_by] or 0


@lru_cache(maxsize=1)
def load_rules() -> tuple[list[Rule], str]:
    """Returns (rules sorted by priority, source document name)."""
    with RULES_PATH.open() as f:
        spec = yaml.safe_load(f)
    rules = [
        Rule(
            id=r["id"],
            priority=r["priority"],
            when=r["when"],
            condition=" ".join(r["condition"].split()),
            why_it_matters=" ".join(r["why_it_matters"].split()),
            action=" ".join(r["action"].split()),
            source=r["source"],
            rank_by=r.get("rank_by"),
            magnitude=r.get("magnitude"),
        )
        for r in spec["rules"]
    ]
    ids = [r.id for r in rules]
    if len(ids) != len(set(ids)):
        raise ValueError(f"duplicate rule ids in {RULES_PATH}: {ids}")

    # Sharing a priority is legal, but only with a magnitude to break the tie.
    # Otherwise the ordering falls back to file position, which is exactly the
    # arbitrary ranking sharing a priority was meant to disclaim.
    by_priority: dict[int, list[str]] = {}
    for r in rules:
        by_priority.setdefault(r.priority, []).append(r.id)
    for priority, group in by_priority.items():
        if len(group) > 1:
            missing = [r.id for r in rules if r.priority == priority and not r.rank_by]
            if missing:
                raise ValueError(
                    f"rules {missing} share priority {priority} without `rank_by`; "
                    "peers must declare the signal that orders them"
                )

    return sorted(rules, key=lambda r: r.priority), spec["source_document"]


def evaluate(predicate: dict[str, Any], signals: dict[str, Any]) -> bool:
    """Evaluate a structured predicate against a building's signals.

    Deliberately not eval() — the predicate grammar is three shapes wide, and
    a rules file that can execute arbitrary Python is not config.

    A signal present but None means "not measured for this building", which is
    NOT zero. Returning False there is what stops the brief from telling someone
    their building has no lead violations when the truth is that nobody looked.
    """
    if "all" in predicate:
        return all(evaluate(p, signals) for p in predicate["all"])
    if "any" in predicate:
        return any(evaluate(p, signals) for p in predicate["any"])

    name = predicate["signal"]
    if name not in signals:
        raise MissingSignalError(
            f"rule references signal {name!r}, which the selection layer did not supply"
        )
    value = signals[name]
    if value is None:
        return False
    return _OPS[predicate["op"]](value, predicate["value"])


def eligible_rules(signals: dict[str, Any]) -> list[Rule]:
    """Every rule whose condition holds, in the order it would be shown.

    Priority first. Within a priority, the larger `rank_by` magnitude first —
    so a building's worse problem outranks its milder one rather than whichever
    rule was authored earlier. `id` is the final key, so ordering is total and
    equal counts still resolve the same way on every run.
    """
    rules, _ = load_rules()
    hits = [r for r in rules if evaluate(r.when, signals)]
    return sorted(hits, key=lambda r: (r.priority, -r.rank_value(signals), r.id))


def select_rules(signals: dict[str, Any], max_items: int = 4) -> list[Rule]:
    """The rules that go in the brief.

    Deterministic: strictly the highest-ranked eligible rules. Two buildings
    with identical signals get identical advice, and the selection is
    reproducible without an API call.

    `max_items` is 4 because 3 truncated an eligible rule on 10.2% of a
    random 8,000-building sample and 4 does so on 3.0% — and at 4, the only
    rule that can ever be truncated is the lower-ranked of the two priority-4
    peers, on buildings where all five rules fire.

    The priority ordering in rules.yaml is an editorial judgment, not something
    HPD publishes — it ranks hazard types against each other, which the source
    document never does. It is the most arguable thing in this module and the
    right place to look first if the wrong advice keeps surfacing.
    """
    return eligible_rules(signals)[:max_items]
