"""Validation of generated text — the layer that decides what may be published.

Deliberately separate from generation. `generate.py` repairs **malformed**
output by handing the error back; this module judges whether output is **true**,
and its failures are never repaired. Asking a model to re-check a claim it
invented produces a different invented claim with equal confidence, so a
groundedness failure quarantines the brief instead.

Verdicts are emitted per check rather than as one pass/fail, so a failure is
diagnosable rather than merely countable. A brief may be published only when
every verdict passes.

Checks are deterministic string and number work. Nothing here calls a model:
a validator that needs a model to decide whether the model was honest inherits
exactly the problem it was built to solve.

STATUS: NO CHECKS ARE IMPLEMENTED. The registry is empty, so `is_publishable`
returns False for everything — deliberately, because `all([])` is True and a
validator that silently passes every brief looks like assurance while providing
none.

`check_direction` used to live here and was removed with `context_line`: it
asserted that generated text preserved the computed standing's direction, and
no generated text describes the building as a whole any more. The failure it
caught is gone with the field that produced it.

The groundedness, absence-claim, causal, severity, and quantifier checks
specified in AI_METHODOLOGY.md belong here. Each should be checkable against one
flagged issue, which is what the per-issue `watch_for` shape now allows.
"""

from dataclasses import dataclass

NO_CHECKS_IMPLEMENTED = True


@dataclass(frozen=True)
class Verdict:
    check: str
    passed: bool
    detail: str

    def __bool__(self) -> bool:
        return self.passed


def validate(watch_for: list[str], *, selected_rules) -> list[Verdict]:
    """Every verdict for one generated brief, in check order.

    Returns all of them rather than short-circuiting: a brief failing three
    checks and a brief failing one are different problems, and only the full
    list distinguishes them.

    Returns an empty list today, which `is_publishable` treats as NOT
    publishable — see below.
    """
    return []


def is_publishable(verdicts: list[Verdict]) -> bool:
    """True only if at least one check ran and every check passed.

    The empty list is deliberately not publishable. `all([])` is True, so the
    natural implementation would silently green-light every brief for as long as
    the registry stays empty — a validator that passes everything is worse than
    no validator, because it looks like assurance.
    """
    return bool(verdicts) and all(v.passed for v in verdicts)
