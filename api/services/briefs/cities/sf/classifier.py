"""Assigns one condition group to a DBI notice of violation, from its text.

The fourth signal source for SF's brief, after 311 subtypes, NOV categories and
the narrow per-group `violation_patterns`. It subsumes the third: a single
ordered table now produces the label, rather than each group testing its own
patterns independently.

Two implementations of one table, and that is the delicate part:

  * `classify()` runs in Python, for tests and for offline evaluation against
    the hand-labelled sets.
  * `render_sql_case()` compiles the same table into the generated view, because
    a materialized view cannot call Python.

They must agree. `\\y` (POSIX word boundary) is rewritten to `\\b` for Python,
since Python spells it differently and Postgres reads `\\b` as backspace — a
silent mismatch that would classify differently on the site than in the tests.
`tests/test_briefs_sf_classifier.py` runs both engines over the labelled corpus
and asserts identical output, which is what makes the translation safe to trust.

Accuracy, measured against 114 hand-labelled rows: 98% overall, 99% on the 70
that were held out during tuning. The pattern table records where the ordering
came from; read it before changing anything, because most of it was derived from
disagreements rather than reasoned in advance.
"""

import re
from functools import lru_cache

import yaml

from services.briefs.cities import SF

PATTERNS_PATH = SF.rules_path.parent / "nov_patterns.yaml"

# Below this, there is no sentence left to classify — the row was advisory or
# administrative and the strip above removed all of it.
MIN_TEXT_LENGTH = 8


def _to_python(pattern: str) -> str:
    """POSIX `\\y` word boundary -> Python `\\b`. See the module docstring."""
    return pattern.replace(r"\y", r"\b")


@lru_cache(maxsize=1)
def _spec() -> dict:
    with PATTERNS_PATH.open() as f:
        return yaml.safe_load(f)


@lru_cache(maxsize=1)
def advisory_patterns() -> list[str]:
    return list(_spec()["advisory"])


@lru_cache(maxsize=1)
def rules() -> list[tuple[str, str]]:
    """[(group, POSIX pattern)] in evaluation order. First match wins."""
    return [(r["group"], r["pattern"]) for r in _spec()["rules"]]


@lru_cache(maxsize=1)
def groups() -> tuple[str, ...]:
    """Every group the classifier can assign, in first-appearance order."""
    seen: list[str] = []
    for group, _ in rules():
        if group not in seen:
            seen.append(group)
    return tuple(seen)


@lru_cache(maxsize=1)
def _compiled() -> list[tuple[str, re.Pattern]]:
    return [(g, re.compile(_to_python(p))) for g, p in rules()]


@lru_cache(maxsize=1)
def _compiled_advisory() -> list[re.Pattern]:
    return [re.compile(_to_python(p), re.S) for p in advisory_patterns()]


def clean(item: str | None, description: str | None) -> str:
    """Both fields, lowercased, with advisory boilerplate removed.

    Neither field is ever rendered — see the note in the pattern file. This text
    exists only to be matched against.
    """
    text = " ".join(x for x in (item, description) if x).lower()
    for advisory in _compiled_advisory():
        text = advisory.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def classify(item: str | None, description: str | None) -> str | None:
    """The condition group for one NOV row, or None when it names none.

    None is a normal and common answer — inspector narrative, scheduling
    addenda and permit-only orders describe no condition, and a brief that
    invented one for them would be worse than silent.
    """
    text = clean(item, description)
    if len(text) < MIN_TEXT_LENGTH:
        return None
    for group, pattern in _compiled():
        if pattern.search(text):
            return group
    return None


def _sql_text() -> str:
    """The SQL expression producing the cleaned text, mirroring `clean()`."""
    expr = "lower(coalesce(v.item, '') || ' ' || coalesce(v.nov_item_description, ''))"
    for advisory in advisory_patterns():
        escaped = advisory.replace("'", "''")
        expr = f"regexp_replace({expr}, '{escaped}', ' ', 'g')"
    return expr


def render_sql_case(indent: str = "        ") -> str:
    """The ordered table as a SQL CASE, evaluated once per row.

    A CASE cascade is exactly first-match-wins, so the Python loop and this
    compile to the same semantics rather than merely similar ones.
    """
    lines = [
        f"{indent}CASE",
        # Mirrors MIN_TEXT_LENGTH in `classify()`. Without it the two engines
        # disagree on rows the advisory strip emptied, which is the whole class
        # of inspector-narrative rows.
        f"{indent}    WHEN length(t.txt) < {MIN_TEXT_LENGTH} THEN NULL",
    ]
    for group, pattern in rules():
        escaped = pattern.replace("'", "''")
        lines.append(f"{indent}    WHEN t.txt ~ '{escaped}' THEN '{group}'")
    lines.append(f"{indent}END")
    return "\n".join(lines)


def render_sql_text_expression() -> str:
    return _sql_text()


__all__ = [
    "MIN_TEXT_LENGTH",
    "PATTERNS_PATH",
    "advisory_patterns",
    "classify",
    "clean",
    "groups",
    "render_sql_case",
    "render_sql_text_expression",
    "rules",
]
