"""Renter-facing taxonomy — complaint groups, violation categories, tooltips.

Loads frontend/lib/renter-facing-groups.json — the same file
frontend/lib/constants.ts imports. Single definition, two consumers.

Three maps live in it, for three different HPD vocabularies:

  minor_categories             complaint minor_category -> group
                               (`PESTS`, `HEAT RELATED`)
  violation_categories         violation category -> group
                               (`EXTERMINATION & RODENT ERADICATION`)
  violation_category_tooltips  violation category -> one plain-English sentence

The first two are separate because HPD names the same concern differently in
its complaint and violation datasets; neither vocabulary is a superset of the
other. The tooltips were authored on the frontend for the "Top violation
categories" chart and moved into this file when the brief needed the same
sentences — a second hand-written description of the same 48 categories would
drift, and a reader meets both on one page.

Its job here is vocabulary. HPD's own category strings (`PESTS`, `HEAT-PLANT`,
`UNSANITARY CONDITION`) are inspector shorthand; the brief has to speak in the
same plain language the building page already uses, or it reads as a different
product bolted onto the same page.

The file lives on the frontend side because Turbopack cannot import across the
project root, so a copy elsewhere in the repo would require turbopack.root and
outputFileTracingRoot — deploy-affecting config, to share a category list.
Reading it by path from here is free.

That does mean this module needs the repo checkout, not just the api/ build
context. Brief generation is a batch job that runs from a checkout (as the
weekly sync does), and the request-serving API never imports this — it reads
finished briefs from the database. If that ever changes, the taxonomy has to be
vendored into the container or moved into the database.
"""

import json
from functools import lru_cache
from pathlib import Path

TAXONOMY_PATH = (
    Path(__file__).resolve().parents[3] / "frontend" / "lib" / "renter-facing-groups.json"
)


@lru_cache(maxsize=1)
def _load() -> dict:
    if not TAXONOMY_PATH.exists():
        raise FileNotFoundError(
            f"renter-facing taxonomy not found at {TAXONOMY_PATH}. This module "
            "requires the full repo checkout, not just the api/ directory — see "
            "the note in this file's docstring."
        )
    with TAXONOMY_PATH.open() as f:
        return json.load(f)


@lru_cache(maxsize=1)
def groups() -> dict[str, dict]:
    """group key -> {label, description, minor_categories}."""
    return _load()["groups"]


@lru_cache(maxsize=1)
def minor_to_group() -> dict[str, str]:
    """minor_category -> group key.

    MAINTENANCE, LINE OF TRAVEL, and SKYLIGHT each appear in two groups. The
    frontend builds this map with Object.fromEntries, where the last write wins;
    a Python dict comprehension over the same insertion order resolves them
    identically. If that ever stops being true the two consumers will disagree
    about which group a complaint belongs to, and the brief will contradict the
    card above it — hence test_taxonomy_parity.
    """
    return {
        minor: group
        for group, spec in groups().items()
        for minor in spec["minor_categories"]
    }


def group_of(minor_category: str | None) -> str | None:
    if not minor_category:
        return None
    return minor_to_group().get(minor_category.upper())


def label(group: str) -> str:
    return groups()[group]["label"]


def description(group: str) -> str:
    return groups()[group]["description"]


def minor_categories(group: str) -> list[str]:
    """The raw HPD strings in a group — for building SQL predicates."""
    return list(groups()[group]["minor_categories"])


@lru_cache(maxsize=1)
def violation_category_to_group() -> dict[str, str]:
    """HPD violation category -> group key.

    A second vocabulary for the same concerns. `minor_categories` are complaint
    strings (`PESTS`, `HEAT RELATED`); violation categories come from
    `hpd_order_numbers.category` and read differently (`EXTERMINATION & RODENT
    ERADICATION`, `HEAT AND HOT WATER`). Mapping both into one set of groups is
    what lets the brief describe an open violation in the same words the page
    uses for a complaint.

    Only categories that occur on open class C violations are mapped. The rest
    resolve to None and are dropped — a category the brief cannot name in
    renter-facing words is better omitted than approximated.
    """
    return {
        category: group
        for group, spec in groups().items()
        for category in spec.get("violation_categories", ())
    }


def group_of_violation_category(category: str | None) -> str | None:
    if not category:
        return None
    return violation_category_to_group().get(category.upper())


# Real violations, but nothing a renter can look at or ask about: expired
# registrations, missing signage, retired order numbers. Naming "Admin" as an
# area where a building has hazardous conditions is worse than saying nothing —
# it is a chart-legend label describing paperwork, and it crowds out an area the
# reader could actually check.
NON_OBSERVABLE_GROUPS = frozenset({"low_priority_admin"})


@lru_cache(maxsize=1)
def violation_category_tooltips() -> dict[str, str]:
    """HPD violation category -> one plain-English sentence, all 48 of them.

    The same sentences the "Top violation categories" chart shows on hover, so
    the brief and the chart describe a category identically. Authored on the
    frontend long before the brief existed; moved into the shared JSON rather
    than re-written here, because two hand-authored descriptions of the same 48
    categories would drift and the reader would meet both on one page.
    """
    return _load()["violation_category_tooltips"]


def violation_category_tooltip(category: str | None) -> str | None:
    if not category:
        return None
    return violation_category_tooltips().get(category.upper())


def describe_violation_categories(categories) -> list[str]:
    """Violation categories -> renter-facing labels, deduped, order preserved.

    Order is significance (the caller sorts by count), so dedupe must keep the
    first occurrence rather than sort. Unmappable categories are dropped
    silently here because the caller has no better answer for them either —
    they are simply not describable in the page's vocabulary.

    Returning an empty list is a valid answer and means "this building's
    hazardous conditions are all in areas a renter cannot inspect". The prompt
    then omits the block entirely rather than offering nothing to point at.
    """
    labels: list[str] = []
    for category in categories or ():
        group = group_of_violation_category(category)
        if group is None or group in NON_OBSERVABLE_GROUPS:
            continue
        name = label(group)
        if name not in labels:
            labels.append(name)
    return labels


def describe_hazard_areas(categories) -> list[str]:
    """Renter-facing labels paired with the sentence the page shows on hover.

    The label alone is a chart legend: "Electrical" tells a reader nothing they
    can act on, and a model asked to be concrete from it has to invent the
    detail. The authored sentence — "insufficient or missing required lighting
    in apartments, hallways, or common areas" — already contains the concrete
    nouns, so the model can point at one instead of guessing.

    Deduped by group, keeping the first (most common) category's sentence, so a
    building whose two top categories share a group is described once and by its
    larger problem.
    """
    seen: set[str] = set()
    out: list[str] = []
    for category in categories or ():
        group = group_of_violation_category(category)
        if group is None or group in NON_OBSERVABLE_GROUPS or group in seen:
            continue
        seen.add(group)
        tooltip = violation_category_tooltip(category)
        out.append(f"{label(group)} — {tooltip}" if tooltip else label(group))
    return out
