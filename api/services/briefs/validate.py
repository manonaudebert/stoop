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

`check_direction` used to live here and was removed with `context_line`: it
asserted that generated text preserved the computed standing's direction, and
no generated text describes the building as a whole any more. The failure it
caught is gone with the field that produced it.

STATUS: two checks are implemented — `vague_quantifiers` and `rights_language`.
Both are lexical, unconditional hard fails, and both were chosen first because
both have already been observed failing on real output rather than being
anticipated. The remaining designed checks (numeric claims, categorical claims,
absence claims, causal language, absolute-severity adjectives, rule-id subset)
are specified in AI_METHODOLOGY.md and are not implemented.

**Why lexical checks are worth having even though they duplicate a prompt
instruction.** The prompt already forbids both, and the prompt is not a
mechanism: the first three sentences ever generated all opened "A few issues…"
for buildings carrying 616, 473, and 552 open violations, under a prompt that
banned numbers. An instruction is a request; this file is the thing that says
no. The two are held in sync by a test asserting every banned quantifier here
also appears in the prompt's own list.

**Why these fail rather than being repaired.** A vague quantifier is a quantity
claim with no source record behind it, and rights language is a claim about
entitlement the reader can act on to their own cost. Neither is a phrasing slip
the model can be trusted to correct — asked to fix "a few", it will pick another
word for the same unfounded quantity. The corpus is generated in bulk and each
prompt shape is generated once, so a quarantined shape simply does not ship and
its rule falls back to the authored `brief_line`. Failing is cheap here.
"""

import re
from dataclasses import dataclass
from typing import Callable, Iterable

from .schema import (
    MAX_WATCH_FOR, MAX_WATCH_FOR_PAIRED, PAIRED_SENTENCE_RULE_ID,
)

# ---------------------------------------------------------------------------
# Check 1 — vague quantifiers
# ---------------------------------------------------------------------------

# Every phrase here must also appear in prompt.SYSTEM's own ban list, and a test
# pins that. The prompt asks; this enforces. When the two drift the prompt is
# the one that gets updated, because a model told about a constraint fails it
# less often than a model surprised by it.
#
# Unconditional, including when severity language is permitted: being allowed to
# call a record bad is not being allowed to say how large it is. The model is
# told no counts, so any quantity word in its output is invented by definition.
VAGUE_QUANTIFIERS: tuple[str, ...] = (
    "a few",
    "several",
    "some",
    "a handful",
    "a number of",
    "multiple",
    "many",
    "numerous",
    "isolated",
    "a couple",
    "a high number of",
)


# ---------------------------------------------------------------------------
# Check 2 — rights language
# ---------------------------------------------------------------------------

# What a tenant is *entitled* to is authored in rules.yaml with a page citation
# and must never be paraphrased into generated text: a wrong entitlement is the
# one failure in this feature a reader can act on to their own cost.
#
# `watch_for` says what to LOOK AT. Asking a landlord a question is in scope;
# telling a reader what the landlord owes them is not. The patterns are written
# to keep that line — "ask who handles pest treatment" passes, "the landlord is
# required to treat pests" fails — so `must` and `required` are only banned when
# they attach to a party, not on sight.
RIGHTS_PATTERNS: tuple[tuple[str, str], ...] = (
    # Naming a remedy or a filing channel. 311 is called out in the prompt by
    # name because it is the single most likely thing to be paraphrased.
    ("remedy", r"\b311\b|\bhousing court\b|\brent (?:withholding|strike)\b"
               r"|\bwithhold(?:ing)?\s+(?:the\s+)?rent\b"),
    ("filing", r"\bfil(?:e|ing|ed)\b[^.]{0,24}\b(?:complaint|claim|case|report)\b"),
    # Entitlement, stated directly.
    ("entitlement", r"\bentitle(?:d|ment)?\b|\b(?:your|tenant|legal)s?\s+rights?\b"
                    r"|\b(?:a|the)\s+right\s+to\b"),
    # An obligation attributed to a party. The party is required: a bare "must"
    # can be ordinary advice ("you must look closely"), which is not a rights
    # claim and is not this check's business.
    #
    # "responsible for" was tried here and cut. "Ask the landlord who is
    # responsible for pest treatment" is exactly the kind of sentence this field
    # is for, and it would have hard-failed — costing that rule its corpus entry
    # for a sentence that claims nothing. Obligation reaches the reader through
    # must/required/obligated; those carry the claim, "responsible" carries a
    # question.
    ("obligation", r"\b(?:landlord|owner|management|manager|super)\b[^.]{0,40}"
                   r"\b(?:must|has to|have to|is required|are required|obligated)\b"),
    ("obligation", r"\b(?:required|obligated|obliged)\s+(?:by law|to\s+(?:provide|"
                   r"fix|repair|replace|install|maintain|inspect))\b"),
    # Deadlines and the law in the abstract. The correction timeline in
    # rules.yaml is cited to HPD's penalties page; a generated restatement of it
    # would carry no citation at all.
    ("deadline", r"\bby law\b|\bunder (?:the )?law\b|\blegally\b|\bdeadlines?\b"
                 r"|\bgrace period\b|\bwithin \w+ (?:hours|days|weeks)\b"),
)


@dataclass(frozen=True)
class Verdict:
    check: str
    passed: bool
    detail: str

    def __bool__(self) -> bool:
        return self.passed


def _find_quantifiers(sentence: str) -> list[str]:
    """Banned quantifiers present in one sentence, in list order.

    Word-boundaried so "some" does not fire on "something" and "many" does not
    fire on a longer word containing it — the check is a hard fail, so a false
    positive silently costs a rule its whole corpus entry.
    """
    lowered = sentence.lower()
    return [
        q for q in VAGUE_QUANTIFIERS
        if re.search(rf"\b{re.escape(q)}\b", lowered)
    ]


def check_vague_quantifiers(sentence: str, rule_id: str, index: int) -> Verdict:
    """A quantity claim with nothing to check it against is worse than a wrong
    number, which is at least checkable against the record."""
    hits = _find_quantifiers(sentence)
    where = f"issue {index + 1} ({rule_id})"
    if hits:
        return Verdict(
            "vague_quantifiers",
            False,
            f"{where}: quantifies without a count — {', '.join(repr(h) for h in hits)}",
        )
    return Verdict("vague_quantifiers", True, where)


def check_rights_language(sentence: str, rule_id: str, index: int) -> Verdict:
    """Entitlements, remedies, deadlines and obligations belong to rules.yaml."""
    lowered = sentence.lower()
    hits = sorted({
        kind for kind, pattern in RIGHTS_PATTERNS
        if re.search(pattern, lowered)
    })
    where = f"issue {index + 1} ({rule_id})"
    if hits:
        return Verdict(
            "rights_language",
            False,
            f"{where}: states {', '.join(hits)} — that text is authored and cited "
            f"in rules.yaml and must not be paraphrased",
        )
    return Verdict("rights_language", True, where)


def check_length(sentence: str, rule_id: str, index: int) -> Verdict:
    """The per-issue character budget, which is not uniform.

    Pydantic caps every entry at the LOOSER `MAX_WATCH_FOR_PAIRED`, because the
    schema cannot see which rule an entry answers and one rule legitimately
    reaches it. That leaves the tighter limit unenforced for every other rule,
    which is exactly the gap a validator handed the rule id can close.

    Without this, raising the schema cap to let the class C issue carry two
    sentences would have silently doubled the budget for mold, pests, heat and
    lead paint too — and the 200-character limit is not a formatting preference.
    It is what makes a model that starts listing findings run out of room.
    """
    budget = (
        MAX_WATCH_FOR_PAIRED if rule_id == PAIRED_SENTENCE_RULE_ID else MAX_WATCH_FOR
    )
    where = f"issue {index + 1} ({rule_id})"
    if len(sentence) > budget:
        return Verdict(
            "length",
            False,
            f"{where}: {len(sentence)} characters, over the {budget} allowed "
            f"for this issue",
        )
    return Verdict("length", True, where)


# One check per (sentence, rule) pair. Registering them here rather than calling
# them inline is what lets `validate` stay a loop while the designed set grows,
# and what makes "which checks ran" answerable from the verdict list alone.
CHECKS: tuple[Callable[[str, str, int], Verdict], ...] = (
    check_vague_quantifiers,
    check_rights_language,
    check_length,
)


def validate(watch_for: list[str], *, selected_rules: Iterable) -> list[Verdict]:
    """Every verdict for one generated brief, in check order.

    Returns all of them rather than short-circuiting: a brief failing three
    checks and a brief failing one are different problems, and only the full
    list distinguishes them.

    `watch_for[i]` answers `selected_rules[i]` — the positional contract in
    `schema.py`. Every check is handed the rule its sentence was written for,
    because a lexical check is the cheap case and the designed set is mostly not
    lexical: a numeric or categorical check needs the record behind the sentence,
    and a signature that only sees prose could never grow one.

    A `watch_for` longer than the rules it answers is a broken pairing, not a
    surplus sentence to be ignored — `zip` would silently drop it and every
    verdict would still pass. `generate.py` already truncates the surplus case,
    so reaching here means something assembled a corpus row by hand.

    An empty `watch_for` returns no verdicts and is therefore NOT publishable.
    That is correct rather than an edge case: there is no generated text, so
    there is nothing to publish. Zero-flag buildings never call the model at all
    (see the cost model's lever 1), and a rule whose sentence was dropped falls
    back to its authored `brief_line`.
    """
    rules = list(selected_rules)
    if len(watch_for) > len(rules):
        return [Verdict(
            "pairing",
            False,
            f"{len(watch_for)} sentence(s) for {len(rules)} flagged rule(s) — "
            "watch_for[i] must answer selected_rules[i]",
        )]

    verdicts: list[Verdict] = []
    for i, (sentence, rule) in enumerate(zip(watch_for, rules)):
        for check in CHECKS:
            verdicts.append(check(sentence, rule.id, i))
    return verdicts


def is_publishable(verdicts: list[Verdict]) -> bool:
    """True only if at least one check ran and every check passed.

    The empty list is deliberately not publishable. `all([])` is True, so the
    natural implementation would silently green-light every brief whenever the
    verdict list is empty — which is every brief with no generated text, and was
    every brief at all for as long as the registry stayed empty. A validator
    that passes everything is worse than no validator, because it looks like
    assurance.
    """
    return bool(verdicts) and all(v.passed for v in verdicts)


def failures(verdicts: list[Verdict]) -> list[Verdict]:
    """Just the failing verdicts — for logging a quarantine reason."""
    return [v for v in verdicts if not v.passed]
