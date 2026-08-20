"""Rule evaluation — deterministic, no model involved.

Signals in, advice out. This is the half of the Building Brief that used to be
the model's job and produced "High number of open violations" for a building in
the better two-thirds of its neighborhood.

Nothing here calls an API, so it is fast, free, and unit-testable — and the
`action` text a tenant reads is copied from rules.yaml rather than generated,
which is why "verbatim" is a property of the code rather than a hope about the
prompt.
"""

import logging
import operator
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import yaml

from services.briefs.cities import NYC, CityBriefConfig
from services.briefs.taxonomy import group_of_violation_category, join_prose

# NYC's, for the tests and callers that predate the city registry. Every
# function below takes a `config` and reads `config.rules_path` instead.
RULES_PATH = NYC.rules_path

log = logging.getLogger(__name__)

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
class Citation:
    """One source behind a rule's text.

    A rule usually cites one page of the ABCs of Housing. Some make claims that
    are simply not in that document — the class C correction timeline lives on
    HPD's penalties-and-fees page — and pointing at the PDF for those would put
    a real claim behind a reference that does not support it. That is worse than
    no citation: it looks checkable and fails when checked.
    """
    label: str
    url: str | None = None
    # Which part of the item this source backs, when a rule cites more than one.
    # Omitted for single-source rules, where it would only restate the item.
    covers: str | None = None

    def render(self) -> str:
        return f"{self.label} — {self.covers}" if self.covers else self.label


@dataclass(frozen=True)
class Rule:
    id: str
    priority: int
    when: dict[str, Any]
    condition: str
    why_it_matters: str
    source: str
    # Optional. Omitted where the only honest action is the generic "tell the
    # landlord in writing, then report it" that applies to every condition
    # alike: repeated under every rule it read as filler and crowded out
    # `watch_for`, which is the field that names something specific. Present
    # only where it says something this condition and no other calls for.
    action: str | None = None
    # The compact one-line form the page leads with. Falls back to `condition`
    # when absent. Compresses the cited text; never extends it — see rules.yaml.
    brief_line: str | None = None
    # What the PRIMARY source backs, named only when the rule cites more than
    # one — otherwise every item would carry a redundant clause.
    covers: str | None = None
    additional_sources: tuple["Citation", ...] = ()
    # Appended to `condition` to name the building's hazard areas in the
    # sentence. Only the class C rule declares one — see rules.yaml.
    areas_clause: str | None = None
    # The signal that orders this rule against its priority peers. Never
    # displayed — `magnitude`, the count template that was, is gone; the brief
    # carries no numbers at all now.
    rank_by: str | None = None
    # The renter-facing taxonomy group this rule describes. When that group is
    # already present among the building's OPEN class C violation categories,
    # this rule is suppressed: an inspector confirmed the condition, so a
    # tenant's complaint about the same thing is the weaker evidence for the
    # same claim. Only complaint-keyed rules set this.
    suppressed_by_class_c_group: str | None = None
    # The authored "worth checking" line — what a renter can look at or ask
    # about for this condition, quoted or compressed from a source that
    # publishes a viewing checklist. NYC has none (the ABCs of Housing contains
    # no such list, which is the entire reason the generated `watch_for` field
    # exists); SF's DRE guidebook and sf.gov vermin page do.
    #
    # A generated sentence, where a corpus row exists, takes precedence — the
    # route decides, and marks which one it served so the page can label the
    # generated one and not this.
    watch_for: str | None = None
    # Words a sentence answering this rule should contain at least one of, used
    # by `validate.check_on_topic` to catch a sentence that landed on the wrong
    # rule. Optional, and `open_class_c` deliberately declares none: its subject
    # is whatever hazard areas the building has, so no fixed vocabulary covers
    # it and a list would hard-fail correct sentences.
    topic_terms: tuple[str, ...] = ()

    def condition_with_areas(self, areas: list[str] | None) -> str:
        """`condition`, with the building's hazard areas named in the sentence.

        Returns the authored `condition` unchanged when the rule declares no
        `areas_clause` (every rule but class C) or when the building has none
        that are describable — the empty-list case, 4.6% of class C buildings,
        where the categories are all administrative or unmapped. Silence beats
        "including issues related to" trailing into nothing.

        The authored sentence is never rewritten, only extended: its final
        period is moved to the end of the appended clause. That keeps the
        verbatim guarantee checkable — the rendered string still *starts* with
        exactly what rules.yaml says — while letting one sentence carry both.
        """
        if not self.areas_clause or not areas:
            return self.condition
        clause = self.areas_clause.format(areas=join_prose(areas))
        return f"{self.condition.rstrip('.')}, {clause}."

    def cite(self, document: str) -> str:
        """The primary citation as one string. `citations()` is what renders.

        The page number is NOT rendered as of 2026-08-14. `source` is still
        required on every rule and still the authoring record — the thing that
        makes "if a claim cannot be located in the source PDF, it does not go
        in" auditable — it simply no longer reaches the page. A page reference
        is precision aimed at someone verifying the text against the PDF, which
        is the author's job here rather than the renter's, and it read as
        legal-citation clutter under a two-line item.
        """
        return document

    def citations(
        self, document: str, config: CityBriefConfig = NYC
    ) -> list[Citation]:
        """Every source behind this rule, primary first.

        The primary citation carries a URL only where the city's source document
        is deep-linkable and `source` names a section within it. NYC's `source`
        is a page reference into a PDF, so it stays label-only.
        """
        url = (
            f"{config.source_url_base}{self.source}"
            if config.source_url_base
            else None
        )
        return [
            Citation(label=self.cite(document), url=url, covers=self.covers),
            *self.additional_sources,
        ]

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


@lru_cache(maxsize=None)
def load_rules(config: CityBriefConfig = NYC) -> tuple[list[Rule], str]:
    """Returns (rules sorted by priority, source document name) for one city."""
    with config.rules_path.open() as f:
        spec = yaml.safe_load(f)
    rules = [
        Rule(
            id=r["id"],
            priority=r["priority"],
            when=r["when"],
            condition=" ".join(r["condition"].split()),
            why_it_matters=" ".join(r["why_it_matters"].split()),
            source=r["source"],
            action=(" ".join(r["action"].split()) if r.get("action") else None),
            brief_line=(
                " ".join(r["brief_line"].split()) if r.get("brief_line") else None
            ),
            watch_for=(
                " ".join(r["watch_for"].split()) if r.get("watch_for") else None
            ),
            covers=r.get("covers"),
            areas_clause=r.get("areas_clause"),
            additional_sources=tuple(
                Citation(label=a["label"], url=a.get("url"), covers=a.get("covers"))
                for a in r.get("additional_sources", ())
            ),
            rank_by=r.get("rank_by"),
            suppressed_by_class_c_group=r.get("suppressed_by_class_c_group"),
            topic_terms=tuple(r.get("topic_terms", ())),
        )
        for r in spec["rules"]
    ]
    ids = [r.id for r in rules]
    if len(ids) != len(set(ids)):
        raise ValueError(f"duplicate rule ids in {config.rules_path}: {ids}")

    # Sharing a priority is legal, but only with a rank_by signal to break the tie.
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


CLASS_C_CATEGORIES_SIGNAL = "open_class_c_categories"


def class_c_groups(
    signals: dict[str, Any], config: CityBriefConfig = NYC
) -> set[str]:
    """Taxonomy groups behind this building's OPEN class C violations.

    None (rule never fired) and [] (fired, nothing describable) both mean "no
    groups", which is correct: neither can supersede anything.
    """
    return {
        group
        for category in (signals.get(CLASS_C_CATEGORIES_SIGNAL) or ())
        if (group := group_of_violation_category(category, config)) is not None
    }


def suppressed_rules(
    signals: dict[str, Any], config: CityBriefConfig = NYC
) -> list[tuple[Rule, str]]:
    """(rule, group) for every otherwise-eligible rule a class C item supersedes.

    Exposed separately from `eligible_rules` so the suppression is inspectable —
    from smoke.py, and from tests — rather than being a silent subtraction.
    """
    if not config.suppression_enabled:
        return []
    rules, _ = load_rules(config)
    groups = class_c_groups(signals, config)
    return [
        (r, r.suppressed_by_class_c_group)
        for r in rules
        if r.suppressed_by_class_c_group in groups and evaluate(r.when, signals)
    ]


# The one raw HPD category `open_class_c` can never describe by naming a hazard
# area: lead paint deliberately has no taxonomy group (see taxonomy.py) because
# it already reads as plain English and has its own rule. RETIRED is
# administrative, like the rest of `NON_OBSERVABLE_GROUPS`, and never
# describable either.
_LEAD_PAINT_CATEGORY = "LEAD-BASED PAINT"
_RETIRED_CATEGORY = "RETIRED"


def class_c_fully_covered_by_lead_paint(signals: dict[str, Any]) -> bool:
    """True when `open_class_c` has nothing to say that `lead_paint` doesn't.

    Every open class C category maps to no taxonomy group (LEAD-BASED PAINT
    and/or RETIRED only), so `condition_with_areas` can never extend the class
    C sentence past "immediately hazardous conditions... on this building's
    record" — it stays abstract on every page that hits this. Meanwhile
    `lead_paint`, if it fires, already names the specific finding with its own
    citation and deadline. Affects 4.1% of class C buildings (3,404 of
    82,422); BIN 4009581 is an example.

    Requires at least one LEAD-BASED PAINT category, not just an all-RETIRED
    building — a building whose class C record is purely administrative isn't
    duplicating anything, it's just abstract, which is accepted elsewhere.
    """
    categories = {c.upper() for c in (signals.get(CLASS_C_CATEGORIES_SIGNAL) or ())}
    if _LEAD_PAINT_CATEGORY not in categories:
        return False
    return categories <= {_LEAD_PAINT_CATEGORY, _RETIRED_CATEGORY}


def class_c_self_suppressed(
    signals: dict[str, Any], config: CityBriefConfig = NYC
) -> bool:
    """True when `open_class_c` should be dropped in favor of `lead_paint`.

    The reverse of `suppressed_by_class_c_group`: there, a *complaint*-keyed
    rule is dropped because class C already proves the same group with
    stronger evidence. Here, `open_class_c` itself is dropped, because in this
    one case it is the item with nothing left to add — see
    `class_c_fully_covered_by_lead_paint`. `lead_paint` is never suppressed by
    class C in the normal direction (test_only_complaint_keyed_rules_declare_
    suppression): an inspector's finding is never weaker evidence for its own
    claim. This isn't that case — LEAD-BASED PAINT is the same violation both
    rules are reading, not two independent pieces of evidence for one claim.

    Guarded on `lead_paint` actually firing so `open_class_c` is never dropped
    with nothing to replace it, even though the two signals should always
    agree in practice: a LEAD-BASED PAINT category implies lead_paint_violations > 0.
    """
    if not config.suppression_enabled:
        return False
    if not class_c_fully_covered_by_lead_paint(signals):
        return False
    rules, _ = load_rules(config)
    lead_paint_rule = next(r for r in rules if r.id == "lead_paint")
    return evaluate(lead_paint_rule.when, signals)


def eligible_rules(
    signals: dict[str, Any], config: CityBriefConfig = NYC
) -> list[Rule]:
    """Every rule whose condition holds, in the order it would be shown.

    A rule is dropped when the condition it describes ALREADY appears among the
    building's open class C violations — see `suppressed_rules`. Observed on BIN
    2003187, where "Mold & pests" was one of the class C hazard areas and the
    mold and pests complaint rules each fired standalone as well: one condition
    stated three times, with the weakest evidence (a tenant report) getting its
    own item while the strongest (an inspector's finding) was reduced to a
    sub-bullet. Verified supersedes reported.

    Priority first. Within a priority, the larger `rank_by` magnitude first —
    so a building's worse problem outranks its milder one rather than whichever
    rule was authored earlier. `id` is the final key, so ordering is total and
    equal counts still resolve the same way on every run.
    """
    rules, _ = load_rules(config)

    # Fail loudly rather than silently skipping suppression. Suppression only
    # ever REMOVES an item, so a quiet failure here surfaces as the duplicate
    # this exists to prevent — visible on the page, invisible in the logs.
    if any(r.suppressed_by_class_c_group for r in rules):
        if CLASS_C_CATEGORIES_SIGNAL not in signals:
            raise MissingSignalError(
                f"rules declare class C suppression but the selection layer did "
                f"not supply {CLASS_C_CATEGORIES_SIGNAL!r}"
            )

    groups = class_c_groups(signals, config) if config.suppression_enabled else set()
    self_suppress_class_c = class_c_self_suppressed(signals, config)
    hits = []
    for r in rules:
        if not evaluate(r.when, signals):
            continue
        if r.suppressed_by_class_c_group in groups:
            log.info(
                "brief: suppressing rule %r — %r is already an open class C "
                "hazard area on this building",
                r.id, r.suppressed_by_class_c_group,
            )
            continue
        if r.id == config.hazard_area_rule_id and self_suppress_class_c:
            log.info(
                "brief: suppressing rule %r — every open class C category is "
                "lead paint and/or retired, which lead_paint already covers",
                r.id,
            )
            continue
        hits.append(r)
    return sorted(hits, key=lambda r: (r.priority, -r.rank_value(signals), r.id))


def select_rules(
    signals: dict[str, Any],
    max_items: int = 3,
    config: CityBriefConfig = NYC,
) -> list[Rule]:
    """The rules that go in the brief.

    Deterministic: strictly the highest-ranked eligible rules. Two buildings
    with identical signals get identical advice, and the selection is
    reproducible without an API call.

    `max_items` is 3, LOWERED from 5 on 2026-08-14 so that it equals
    `schema.MAX_WATCH_ITEMS` — every item the brief shows now carries a
    generated "worth checking" line, instead of the top two of as many as five.
    An item with a concrete thing to look at is worth more than two more items
    without one.

    Measured over all 310,400 buildings in `hpd_brief_signals` rather than a
    sample. Eligible-rule counts are 1: 65,590 buildings, 2: 38,814, 3: 19,427,
    4: 7,898, 5: 1,518 — so the cap truncates something on 9,416 buildings,
    7.1% of the 133,247 that flag anything and 3.0% of the city. What it drops
    is by construction the lowest-priority item on the longest briefs.

    One real cost beyond the truncation: `prompt.py` used to list the unselected
    conditions unnumbered after the numbered ones, so the model knew the top two
    were not the building's whole record. With the two caps equal there is never
    a remainder, and on those 9,416 buildings the model no longer learns the
    dropped conditions exist. Acceptable because every sentence must stand alone
    anyway — the prompt forbids "also" and "in addition", and the corpus key
    deliberately ignores sibling issues — but it is the thing to revisit first
    if the generated lines start reading as if each building had one problem.

    The cap is kept rather than dropped even though six rules is a hard upper
    bound: it is the guard that stops the next authored rule from silently
    lengthening every brief. Change it deliberately, with a re-measurement.

    The priority ordering in rules.yaml is an editorial judgment, not something
    HPD publishes — it ranks hazard types against each other, which the source
    document never does. It is the most arguable thing in this module and the
    right place to look first if the wrong advice keeps surfacing.
    """
    return eligible_rules(signals, config)[:max_items]
