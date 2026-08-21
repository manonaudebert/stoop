"""Condition buckets for the SF building page's "Top violation categories" card.

The brief's classifier answers "which statutory habitability element is this?",
and answers `None` for anything outside that list. That is right for a brief and
wrong for a chart: on 5 years of DBI notices it labels 45.0% of rows, so a card
built on it alone would put the majority of every building's history into one
bar named "Other".

This module composes two tables to fix that WITHOUT touching the brief's:

    1. `classifier` (nov_patterns.yaml) runs first and wins outright.
    2. `nov_card_patterns.yaml` runs only on what it declined, adding buckets
       for DBI's non-habitability space — gas shutoff tools, §327 work
       practices, permits, boilers, general dilapidation.
    3. Rows that are pure narrative after both strips get NO bucket, and the
       route drops them from the chart instead of charting them as "Other".

Step 1 running first is the property that matters. The card physically cannot
relabel a row the brief calls `mold`, so the chart and the brief below it agree
on every row they both see, by construction rather than by review.

Why a second file rather than more rules in `nov_patterns.yaml`: every group
there becomes a column in `sf_brief_signals`, so a card bucket would cost a
materialized-view recompute and trip the signals/rules parity test. The header
comment in the YAML has the full argument.

Same two-engine arrangement as the brief classifier, and the same hazard:
`classify()` runs in Python, `render_sql_case()` compiles the identical table
into the route's query, and `\\y` is rewritten to `\\b` for Python because
Postgres reads `\\b` as backspace. `tests/test_briefs_sf_card_categories.py`
holds the two together.
"""

import re
from functools import lru_cache

import yaml

from services.briefs.cities import SF
from services.briefs.cities.sf import classifier
from services.briefs.taxonomy import groups as taxonomy_groups

CARD_PATTERNS_PATH = SF.rules_path.parent / "nov_card_patterns.yaml"

# The bucket for notices that name no condition once narrative is stripped. Not
# a taxonomy group and not a card group — the route drops these from the chart
# and reports them as a footnote, so this key never reaches a bar.
UNCLASSIFIED_GROUP = "unclassified"


@lru_cache(maxsize=1)
def _spec() -> dict:
    with CARD_PATTERNS_PATH.open() as f:
        return yaml.safe_load(f)


@lru_cache(maxsize=1)
def narrative_patterns() -> list[str]:
    """Card-only strips, applied AFTER the brief's advisory list."""
    return list(_spec()["narrative"])


@lru_cache(maxsize=1)
def rules() -> list[tuple[str, str]]:
    """[(group, POSIX pattern)] in evaluation order. First match wins."""
    return [(r["group"], r["pattern"]) for r in _spec()["rules"]]


@lru_cache(maxsize=1)
def card_only_groups() -> dict[str, dict]:
    """group key -> {label, description} for groups defined only on the card."""
    return _spec()["groups"]


@lru_cache(maxsize=1)
def groups() -> tuple[str, ...]:
    """Every bucket the card can show, brief groups first, in evaluation order."""
    seen = list(classifier.groups())
    for group, _ in rules():
        if group not in seen:
            seen.append(group)
    return tuple(seen)


@lru_cache(maxsize=1)
def _compiled() -> list[tuple[str, re.Pattern]]:
    return [(g, re.compile(p.replace(r"\y", r"\b"))) for g, p in rules()]


@lru_cache(maxsize=1)
def _compiled_narrative() -> list[re.Pattern]:
    return [re.compile(p.replace(r"\y", r"\b"), re.S) for p in narrative_patterns()]


def clean(item: str | None, description: str | None) -> str:
    """The brief's cleaned text with card narrative removed as well.

    Used ONLY for the card's own rules and for the emptiness test. The brief
    classifier is always handed its own `clean()` output, never this, so extra
    stripping here can never change a label the brief already assigns.
    """
    text = classifier.clean(item, description)
    for narrative in _compiled_narrative():
        text = narrative.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def classify(item: str | None, description: str | None) -> str | None:
    """The card bucket for one NOV row, or None when it describes no condition.

    None means "leave this row off the chart" — inspector narrative, nuisance
    declarations, scheduling notes. It is a third of DBI's corpus and charting
    it would invent findings out of an inspector's notes.
    """
    brief_label = classifier.classify(item, description)
    if brief_label:
        return brief_label
    text = clean(item, description)
    if len(text) < classifier.MIN_TEXT_LENGTH:
        return None
    for group, pattern in _compiled():
        if pattern.search(text):
            return group
    return None


def label(group: str) -> str:
    if group in card_only_groups():
        return card_only_groups()[group]["label"]
    return taxonomy_groups(SF)[group]["label"]


@lru_cache(maxsize=1)
def description_overrides() -> dict[str, str]:
    """Card-side tooltip wording for groups that live in `taxonomy.json`.

    The taxonomy is written in the complaint voice ("reported in the building"),
    which is wrong on a card of inspector findings — and it is the brief's
    vocabulary, so it cannot be reworded for a chart's sake. See the block
    comment in nov_card_patterns.yaml.
    """
    return _spec().get("descriptions", {})


def description(group: str) -> str:
    if group in card_only_groups():
        return card_only_groups()[group]["description"]
    if group in description_overrides():
        return description_overrides()[group]
    return taxonomy_groups(SF)[group]["description"]


def render_sql_narrative_strip(expr: str) -> str:
    """Wrap `expr` in the card's narrative strips only.

    Split out from the full text expression so the route can apply it to the
    brief's already-computed text — a nested CTE rather than recomputing the
    seven advisory `regexp_replace` calls a second time per row.
    """
    for narrative in narrative_patterns():
        escaped = narrative.replace("'", "''")
        expr = f"regexp_replace({expr}, '{escaped}', ' ', 'g')"
    return expr


def render_sql_text_expression() -> str:
    """The cleaned card text, mirroring `clean()`. Assumes the `v` alias."""
    return render_sql_narrative_strip(classifier.render_sql_text_expression())


def render_sql_case(indent: str = "        ") -> str:
    """The composed table as a SQL CASE, mirroring `classify()`.

    Reads two computed columns: `t.txt` (the brief's cleaned text, so the
    embedded brief CASE is unchanged and still authoritative) and `t.card_txt`
    (narrative additionally stripped). The brief arm is evaluated first for the
    same reason it is in Python.
    """
    lines = [
        f"{indent}CASE",
        f"{indent}    WHEN {_brief_arm(indent)} IS NOT NULL THEN {_brief_arm(indent)}",
        # Mirrors the MIN_TEXT_LENGTH guard in `classify()`: nothing left to
        # name, so NULL — which the route reads as "keep it off the chart".
        f"{indent}    WHEN length(t.card_txt) < {classifier.MIN_TEXT_LENGTH} THEN NULL",
    ]
    for group, pattern in rules():
        escaped = pattern.replace("'", "''")
        lines.append(f"{indent}    WHEN t.card_txt ~ '{escaped}' THEN '{group}'")
    lines.append(f"{indent}END")
    return "\n".join(lines)


def _brief_arm(indent: str) -> str:
    """The brief's CASE, parenthesised for use as an expression."""
    inner = classifier.render_sql_case(indent=indent + "        ")
    return f"(\n{inner}\n{indent}    )"


__all__ = [
    "CARD_PATTERNS_PATH",
    "UNCLASSIFIED_GROUP",
    "card_only_groups",
    "classify",
    "clean",
    "description",
    "description_overrides",
    "groups",
    "label",
    "narrative_patterns",
    "render_sql_case",
    "render_sql_narrative_strip",
    "render_sql_text_expression",
    "rules",
]
