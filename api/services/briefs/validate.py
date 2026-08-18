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


# Sentences that are grammatical, on-topic, within every length limit, and
# useless. The failure this catches was live in the corpus at 17 words and 104
# characters: "When visiting, ask the current tenant about their experience
# with heat and hot water through the winter." Nothing lexical was wrong with
# it. It fails because it leans on a person who is usually not at a viewing,
# asks for an opinion rather than evidence, and leaves the reader to invent the
# words to say.
#
# The prompt argues against this register at length. This is the stick: the
# prompt can be ignored, and a sentence that reaches `brief_texts` is served to
# thousands of buildings sharing that input shape.
#
# Deliberately NARROW. These are hard fails, so a false positive silently costs
# a rule its whole corpus entry — the same reasoning that kept "responsible
# for" out of RIGHTS_PATTERNS. Each pattern here requires the *asking* frame,
# not the topic: "ask the super when the building was last treated for mice"
# passes (a question with concrete words and an answerable fact), while "ask
# about their experience with pests" does not.
USELESS_REGISTER_PATTERNS: tuple[tuple[str, str], ...] = (
    # Asking for an opinion or an impression instead of a fact.
    ("opinion", r"\bask(?:ing)?\b[^.]{0,40}\babout\s+(?:their|the|his|her|your)\s+"
                r"(?:experience|thoughts|opinion|impression)"),
    ("opinion", r"\bask(?:ing)?\b[^.]{0,40}\b(?:how|whether)\s+(?:they|he|she|it)\s+"
                r"(?:feel|felt|find|found|like[ds]?)\b"),
    # "How did last winter go" — an invitation to reminisce, not a checkable
    # question, and the sentence never says what to actually ask.
    ("vague_question", r"\bask(?:ing)?\b[^.]{0,40}\bhow\s+[^.]{0,30}\b"
                       r"(?:went|was|has been|holds? up|held up)\b"),
    # Deferring the check to a time the reader is not being advised about. The
    # brief is for the viewing; "once you move in" is the landlord's problem or
    # the tenant's, and the authored `action` covers it with a citation.
    ("after_signing", r"\b(?:once|after)\s+you(?:'ve|\s+have)?\s+"
                      r"(?:move[ds]?\s+in|sign(?:ed)?|are\s+living)\b"),
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


def check_useless_register(sentence: str, rule_id: str, index: int) -> Verdict:
    """Grammatical, on-topic, within every length limit, and worth nothing.

    The one check here that is about usefulness rather than correctness. Every
    other check asks "is this claim allowed?"; this one asks "could the reader
    act on it at a fifteen-minute viewing?" — which is the whole job of the
    field, and the only failure mode the length and lexical checks cannot see.
    """
    lowered = sentence.lower()
    hits = sorted({
        kind for kind, pattern in USELESS_REGISTER_PATTERNS
        if re.search(pattern, lowered)
    })
    where = f"issue {index + 1} ({rule_id})"
    if hits:
        return Verdict(
            "useless_register",
            False,
            f"{where}: {', '.join(hits)} — names no evidence the reader can "
            f"find themselves at a viewing",
        )
    return Verdict("useless_register", True, where)


def check_on_topic(sentence: str, rule_id: str, index: int) -> Verdict:
    """The sentence has to be about the rule it was written for.

    Every other check reads the sentence alone. This one is the only thing that
    holds `watch_for[i]` to `selected_rules[i]` — the positional contract the
    whole field rests on — and it exists because that contract broke in a way
    nothing else could see. The model was asked for a paired two-sentence entry
    on the class C issue, answered with separate list entries instead, and a
    sentence about heat came to rest against the smoke-detector rule. Every
    lexical check passed, because there is nothing wrong with the sentence: it
    is just not about detectors.

    Matched on substrings, not word boundaries, so "discolor" catches
    "discoloration" and "exterminat" catches both "exterminate" and
    "extermination" — a rule's terms are stems on purpose.

    A rule declaring no `topic_terms` is not checked. `open_class_c` is the
    reason: its subject is whichever hazard areas the building has, so a fixed
    vocabulary would hard-fail correct sentences about fire escapes, pests, or
    heat in turn. It is also the rule that can least afford a false positive,
    being the one that fires most often.
    """
    from .rules import load_rules

    where = f"issue {index + 1} ({rule_id})"
    rule = next((r for r in load_rules()[0] if r.id == rule_id), None)
    if rule is None or not rule.topic_terms:
        return Verdict("on_topic", True, f"{where}: no topic terms declared")

    lowered = sentence.lower()
    if any(term in lowered for term in rule.topic_terms):
        return Verdict("on_topic", True, where)
    return Verdict(
        "on_topic",
        False,
        f"{where}: names none of this rule's subject terms, so it is likely a "
        f"sentence for a different issue",
    )


# Above this share of an example's content words, a sentence is echoing the
# example rather than imitating it. Calibrated against real output: the verbatim
# copy scores 1.0, and the highest-scoring genuine sentence in the corpus scores
# well under this. Set from measurement, not taste — see the calibration in
# tests/test_briefs_rules.py.
ECHO_CONTAINMENT = 0.6

# Words carried by nearly every sentence in this field. Left in the comparison
# they inflate every score toward the threshold, because the examples are the
# same KIND of sentence as the output and share all of this.
_ECHO_STOPWORDS = frozenset({
    "a", "an", "and", "are", "as", "at", "be", "check", "for", "from", "has",
    "have", "in", "is", "it", "its", "look", "of", "on", "or", "own", "rather",
    "than", "that", "the", "their", "them", "there", "they", "to", "up", "was",
    "whether", "with", "you", "your", "viewing", "ask",
})


def _content_words(text: str) -> set[str]:
    return {
        w for w in re.findall(r"[a-z]+", text.lower())
        if w not in _ECHO_STOPWORDS and len(w) > 2
    }


def echo_score(sentence: str) -> float:
    """How much of the nearest example's content this sentence reproduces.

    Containment against the example rather than symmetric similarity: the
    failure is the model returning the example, so what matters is how much of
    the EXAMPLE is present, not how alike the two strings are overall. A
    verbatim copy scores 1.0 whatever else it appends.
    """
    from .prompt import GOOD_EXAMPLES

    words = _content_words(sentence)
    if not words:
        return 0.0
    best = 0.0
    for example in GOOD_EXAMPLES:
        ex = _content_words(example)
        if ex:
            best = max(best, len(ex & words) / len(ex))
    return best


def check_echoes_example(sentence: str, rule_id: str, index: int) -> Verdict:
    """The model returning the prompt's example instead of writing a sentence.

    Observed: `qwen3:8b` returned the GOOD example verbatim as its answer, a
    valid sentence it had not written, bound for the largest shape in the
    corpus. Nothing else catches it — the example is a good sentence, so every
    quality check passes.

    This is also why the examples are deliberately OUT OF DOMAIN. An example
    about a hazard the brief also asks about cannot be told apart from the model
    independently arriving at the obvious answer for that hazard; the corpus
    already contains a stairwell-door sentence written with no door example in
    the prompt. Out-of-domain examples make an echo unambiguous, which is what
    makes this check meaningful rather than decorative.
    """
    score = echo_score(sentence)
    where = f"issue {index + 1} ({rule_id})"
    if score >= ECHO_CONTAINMENT:
        return Verdict(
            "echoes_example",
            False,
            f"{where}: reproduces {score:.0%} of a prompt example's content "
            f"words — returned rather than written",
        )
    return Verdict("echoes_example", True, where)


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
    check_useless_register,
    check_on_topic,
    check_echoes_example,
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
