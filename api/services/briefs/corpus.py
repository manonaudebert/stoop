"""The corpus key — what a stored `watch_for` sentence is looked up by.

One row per (rule, input shape, prompt version), not one row per building.
Roughly 12,000 rows cover all of NYC because the prompt contains no counts, no
percentile, no address and no neighborhood — all stripped so the model could not
misstate a number — which leaves the model's input a pure function of *which
rule fired, which hazard areas are behind it, and whether severity language was
permitted*. Thousands of buildings produce the same input, and the same input
needs exactly one generation.

**Structured, not a hash of the rendered prompt.** The earlier design keyed on
`sha1(user turn)`. It works, and it welds the corpus to the exact bytes of
`prompt.py`'s output: every consumer computing a lookup would have to reproduce
that rendering character-for-character, and a stray space becomes a permanent
miss that silently degrades to phase-0 rendering and looks completely fine. The
inputs below are computed from data the route already has in hand.

**What the key deliberately ignores: the sibling issues.** A sentence is
generated in a prompt that also lists the building's other flagged conditions,
so strictly the output is a function of that whole prompt. The key does not
encode it, because the prompt requires every sentence to stand alone — no
"also", no "in addition", one issue per sentence — so a sentence that depends on
its siblings has already violated the contract. Keying on the sibling set would
multiply the corpus severalfold to preserve a dependency the prompt forbids.

**`prompt_version` is the invalidation lever, and it is broader than its name.**
Bump it for any change to what the model is shown: `prompt.py`'s wording, the
`condition` text in rules.yaml, or the authored tooltip sentences in the shared
taxonomy. The key encodes identifiers, so none of those change it.
"""

from typing import Iterable

from .schema import MAX_WATCH_ITEMS, PROMPT_VERSION

# The class C rule is the only one whose input carries hazard areas — see
# prompt.HAZARD_AREA_RULE_ID. For every other rule the areas segment is empty,
# which is a fact about the rule rather than about the building.
from .prompt import HAZARD_AREA_RULE_ID, severity_language_allowed
from .taxonomy import hazard_area_keys


def input_key(
    rule_id: str,
    *,
    hazard_areas: Iterable[str] = (),
    severity_allowed: bool = False,
) -> str:
    """The lookup key for one rule's generated sentence.

    Readable rather than hashed. A corpus miss is the failure this whole design
    is shaped around — it degrades silently to phase-0 rendering — so the key
    has to be greppable in a log and comparable by eye against a row in the
    table. At three hazard areas it stays comfortably short.

    `hazard_areas` are `taxonomy.hazard_area_keys` values, in significance
    order. Order is preserved and NOT sorted: the prompt presents them most
    common first and tells the model to base its sentence on one of them, so two
    different orders are two different inputs.
    """
    areas = ",".join(hazard_areas)
    return f"{rule_id}|sev={int(severity_allowed)}|areas={areas}"


def key_for(rule_id: str, *, categories, percentile: float | None) -> str:
    """`input_key` from the two raw values a page already holds.

    `categories` is the building's `open_class_c_categories`; `percentile` its
    violations percentile. Both are on the brief route's signals row, so a
    caller never has to reach for the taxonomy or the severity threshold itself
    — which is the point of a structured key.
    """
    return input_key(
        rule_id,
        hazard_areas=(
            hazard_area_keys(categories) if rule_id == HAZARD_AREA_RULE_ID else ()
        ),
        severity_allowed=severity_language_allowed(percentile),
    )


def keys_for_selection(selected_rules, *, categories, percentile: float | None):
    """[(rule_id, input_key)] for the rules that can carry a generated sentence.

    Only the first `MAX_WATCH_ITEMS` are looked up, because only those were ever
    generated: the prompt numbers the top two issues and asks for one sentence
    each, and `generate.py` enforces that count. A lookup for the third rule
    would be a guaranteed miss on every building — cheap, but it would make the
    corpus hit rate unreadable as a health metric.
    """
    return [
        (rule.id, key_for(rule.id, categories=categories, percentile=percentile))
        for rule in list(selected_rules)[:MAX_WATCH_ITEMS]
    ]


# Re-exported so a caller writing a corpus row and a caller reading one agree on
# the version without importing two modules.
__all__ = [
    "PROMPT_VERSION",
    "input_key",
    "key_for",
    "keys_for_selection",
]
