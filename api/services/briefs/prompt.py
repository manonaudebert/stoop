"""Prompt construction for the model's per-issue watch sentences.

The v1 prompt handed the model a full metrics dump — percentiles, class
breakdowns, category strings — and asked for prose. That is what produced "High
number of open violations, especially class C and B" for a building in the
better two-thirds of its neighborhood. Two failures: an absolute severity claim
inferred from a relative rank, and inspector jargon aimed at a renter.

Neither was a phrasing problem, so neither is fixed here by better wording. They
are fixed by not supplying the material:

1. **The model receives no numbers.** Not the percentile, not a count. It
   receives already-authored condition sentences and the renter-facing areas
   behind them. A sentence with no numbers in it cannot misstate one, and the
   numbers a renter needs are on the page already, in stat cards read from the
   database.

2. **The model receives no HPD vocabulary.** "Class C" never enters the prompt.
   The condition sentences it sees were written for renters in `rules.yaml`.

3. **Severity language is gated on the computed band, not on the model's
   judgment.** Below the 70th percentile the prompt states plainly that this
   building is not unusual for its area, so "severe" has nothing to attach to.

5. **Nothing describes the building as a whole.** `context_line` did, and it
   was the only generated text that could get the whole building wrong — which
   it did, calling a building better than 89% of its neighborhood "typical".
   Every sentence now answers one flagged issue, so every sentence has one
   record to be checked against.

What is left is a real language job: turn one flagged condition and its areas
into one sentence that reads like a person wrote it.

4. **Vague quantifiers are banned alongside numbers.** Found by running the
   above: forbidding digits did not stop the model quantifying, it just moved
   the claim somewhere a validator cannot check it. Every one of the first three
   sentences generated opened "A few issues…" for buildings with 616, 473, and
   552 open violations. That is the v1 bug inverted — v1 overstated severity
   from a relative rank, this understates volume from a prohibition — and it is
   worse in one respect, because "a few" has no source record to be checked
   against. The fix is not a softer ban on numbers but an explicit instruction
   to name the kind of problem instead of gesturing at an amount.

Structural decisions that carry forward:

- **Stable content first, building data last.** SYSTEM is byte-identical across
  every call so it can serve as a cache prefix; everything building-specific
  goes in the user turn.

CAVEAT — caching does not currently pay off. The minimum cacheable prefix on
claude-haiku-4-5 is 4096 tokens and SYSTEM is far shorter, so `cache_control` on
it is a silent no-op (you get `cache_creation_input_tokens: 0`, not an error).
Verify with count_tokens before assuming cache savings in any cost model.
"""

from typing import Any

from .schema import MAX_WATCH_ITEMS, MIN_AREAS_FOR_PAIRED

# Above this percentile, absolute-severity language describes something real:
# the building genuinely stands out against its neighbors. Below it, "severe" is
# an inference from a relative rank, which is the v1 bug. Kept in sync with the
# groundedness validator, which hard-fails severity adjectives under the same
# threshold.
SEVERITY_LANGUAGE_PERCENTILE = 70

# The worked GOOD examples, in one place so `validate.check_echoes_example` can
# measure output against them without a second copy to drift. Any sentence in
# the prompt that models the FORM belongs here — a sentence the model can read
# is a sentence it can return.
# Both are deliberately about buying a used CAR, not an apartment. An example
# naming a hazard the brief also asks about is unusable twice over: the model
# can return it instead of writing (qwen3 did, verbatim), and a genuine sentence
# about that hazard cannot be told apart from an echo. Measured — a real
# lead-paint sentence scored 0.83 against an in-domain lead-paint example, which
# would hard-fail correct output. Out of domain, every real sentence scores near
# zero and an echo is unambiguous.
GOOD_EXAMPLES: tuple[str, ...] = (
    "Ask the seller to start the car and check whether the dashboard warning "
    "lights go out after a few seconds.",
    "Lift the trunk mat and look underneath for damp or rust.",
)


SYSTEM = """You write the opening of a housing-conditions report on one New York City rental building. A prospective renter reads it before signing a lease.

Your text sits at the top of a page that already shows every number: violation counts, complaint counts, the building's exact ranking against its neighborhood, and a list of specific conditions each carrying its own official guidance. You are not summarizing that page. You are giving the reader orientation before they read it.

You will be given the conditions flagged further down the page, numbered.

You write one field.

watch_for: a LIST of entries, one per issue, for the issues numbered in your input. One entry for issue 1, one for issue 2, in that order. If only one issue is listed, return one entry. If none are listed, return an empty list.
  An entry is ONE sentence, unless your input explicitly asks that issue for two. Then write exactly two sentences in that one entry, still as a single list entry. Never split one issue across two entries — the entry positions are what tie your sentences to the issues.
  Each sentence names physical evidence the reader can find for themselves, for THAT issue only. Point at a thing in the apartment they can look at, smell, turn on, or open. A question is allowed only with the exact words to say, because the person who would answer it may not be there.
  Each sentence must stand alone. Do not write "also" or "in addition" — they are shown as separate items, not as a paragraph.
  Do not cover two issues in one sentence, and do not repeat the same check twice in different words. If two issues would genuinely produce the same check, find what is distinct about each.
  The examples are about buying a used CAR, deliberately: they show the FORM of the line and none of its content. Never write about a car, and never reuse their wording.
  Good (a question, with the exact words to say): "Ask the seller to start the car and check whether the dashboard warning lights go out after a few seconds."
  Good (pure observation): "Lift the trunk mat and look underneath for damp or rust."
  Bad: "Ask the previous owner about their experience with the car through the winter." (depends on someone who may not be there, wants an opinion rather than evidence, and gives no exact wording)
  Bad: "Call 311 to file a complaint." (that guidance is printed below, written by the city)
  Bad: "You are entitled to heat between October and May." (a legal right, not yours to state)
  Bad: "Check for heat and paint problems." (one sentence covering both issues)

Rules for EVERY sentence you write:
- Under 30 words and under 200 characters per sentence, whichever binds first. One sentence per issue, unless that issue's input asks for two; then each of the two is its own complete sentence under the same limit. Never join sentences with a semicolon to dodge this.
- Never describe upkeep, prevention, or maintenance as the reader's own responsibility. They do not live there yet, and what a tenant must do is printed below in the city's words.
- Never write a number, a count, a percentage, an ordinal, or a year — not as digits, not as words.
- Never use a vague quantifier either: no "a few", "several", "some", "a handful", "a number of", "multiple", "many", "numerous", "isolated", "a couple", "a high number of". These are counts in disguise, and you have not been told the count. A record you are told about may contain one entry or several hundred; you cannot tell, so do not imply it. This rule holds even when strong language about severity is permitted — being allowed to call a record bad is not being allowed to say how large it is.
- Where you would reach for a quantifier, name the thing instead. "Heat and pest problems appear on this building's record" — not "a few problems appear".
- Never name a specific violation class, code, or HPD category. Write the way the flagged conditions given to you are written.
- Never state a legal right, an obligation, a deadline, a remedy, or what anyone is required to do. Never mention 311, rent withholding, or filing anything. The page carries that guidance already, quoted from the city with a page citation, and it is not yours to restate or summarize.
- Never claim a cause, and never imply one with "because", "due to", "as a result of", or "which has led to". The record shows history, not cause.
- Never state that something is absent, low, clean, resolved, or improving unless the standing given to you says so. Silence in your input is not evidence of absence.
- Do not describe the building as a whole, or compare it to other buildings. You are not told how it ranks. Every sentence is about one specific issue.
- Plain, direct, factual. No reassurance, no alarm, no marketing language, no "renters should be aware".

Return only the structured object."""


# The task framing, rewritten 2026-08-14. It sits in the USER turn rather than
# in SYSTEM even though it is identical every call, because it is the part
# being iterated on and `smoke.py` prints the user turn in full while
# collapsing SYSTEM to a character count.
#
# What it is fixing: sentences like "When visiting, ask the current tenant
# about their experience with heat and hot water" — grammatical, on-topic, and
# useless. It depends on a person who is usually not there, asks for an opinion
# rather than evidence, and leaves the reader to invent the actual wording. The
# fix is to name the reader's situation (fifteen minutes, a broker, an empty
# unit) so that "concrete" has a standard to be concrete against, and to carry
# one worked GOOD/BAD pair, because the failure is a register the model falls
# into rather than a rule it breaks.
#
# The "one sentence" line carries an exception for the class C rule, which asks
# for two when the building has two describable hazard areas. Without it the
# nested per-issue instruction below contradicts this block, and a prompt that
# argues with itself is resolved by the model rather than by us.
TASK = '''Write the "Worth checking" line for each issue below. One sentence each, unless an issue below explicitly asks for two.
A separate paragraph of static text follows each line and already covers
what the law requires, temperature and timing rules, how to file a 311
complaint, and what to do once living there. Do not repeat any of that.

Reader: someone at a 15-minute apartment viewing, deciding whether to
sign. Assume they are alone with a broker, the unit may be empty, and
the current tenant may not be there.

Each line must name physical evidence they can find themselves in those
15 minutes — something to look at, smell, turn on, or open. Prefer
evidence that survives a cleanup or a fresh coat of paint.

If the line asks a question, write the exact words to say, and make it
one a person answers honestly without feeling accused. Never write
"ask about their experience with X."

Do not describe upkeep or prevention as the tenant's responsibility.

One sentence, under 30 words, plain language, no preamble. Where an issue
asks for two, each of the two is its own sentence under 30 words.

The examples below are about buying a used CAR, not an apartment. They
show the FORM of the line and none of its content. Nothing in them is a
thing to check in an apartment.

GOOD: Ask the seller to start the car and check whether the dashboard
warning lights go out after a few seconds.
GOOD: Lift the trunk mat and look underneath for damp or rust.
BAD: When visiting, ask the previous owner about their experience with
the car through the winter.
(depends on a person who may not be there, asks for an opinion instead
of evidence, and gives no exact wording)'''


def severity_language_allowed(percentile: float | None) -> bool:
    """Whether "severe"/"poor"/"high" describe a fact rather than an inference."""
    return percentile is not None and percentile >= SEVERITY_LANGUAGE_PERCENTILE


def render_context(
    *,
    percentile: float | None,
    conditions: list[str],
    hazard_areas: list[str] | None = None,
    hazard_issue_index: int | None = None,
) -> str:
    """The user turn: a standing, the flagged conditions, and nothing else.

    `conditions` are the `condition` strings of the selected rules — already
    authored for renters, already free of jargon. Passing them in lets the
    sentence acknowledge what follows without the model inventing its own
    vocabulary for it.

    An empty `conditions` list is the common case (roughly two in five
    buildings) and is stated explicitly rather than omitted. An absent section
    reads to a model as an oversight; an explicit one is information.

    `hazard_areas` are the renter-facing labels behind this building's open
    class C violations, most common first. They exist to fix a specific
    failure: "conditions HPD classifies as immediately hazardous" names no
    observable thing, so on a building where that was the *only* flagged
    condition the model was asked to be concrete with nothing concrete in its
    input, and it invented plausible nouns — "water damage or mold" — that
    traced to nothing. Naming the actual areas makes the ask answerable instead
    of tempting.

    **The order is significance and the prompt now says so.** The SQL sorts by
    open count descending (`ORDER BY n DESC, category`, capped at
    HAZARD_AREA_LIMIT), and `describe_hazard_areas` preserves that order, so
    position 1 is the area this building has the most of. Saying only "most
    common first" left the choice open and the model took the most *writable*
    area rather than the largest one; it is now told to use the first and fall
    through only when the first names nothing observable. The fall-through is
    deliberate — some categories are real but not inspectable, and a sentence
    about the biggest area is worth nothing if the reader cannot act on it.

    Its three states are all distinct and none may collapse into another:

        ["Heat / hot water", ...]  class C flagged, areas known
        []                         class C flagged, no area is describable
        None                       class C not flagged; the field is irrelevant

    The empty list is not the same as None. It happens on 4.6% of class C
    buildings — the order number is missing from `hpd_order_numbers`, or every
    category is administrative — and it is the one case where the model is asked
    for something concrete with nothing to offer. Rendering it as silence
    recreates the original bug.
    """
    blocks: list[str] = []

    if conditions:
        # The top two are numbered because watch_for is positional: entry i
        # answers issue i. Numbering them in the input is what makes that
        # contract legible to the model rather than implied by ordering alone.
        # The rest are listed unnumbered so the model knows they exist and does
        # not treat the top two as the building's whole record.
        top = conditions[:MAX_WATCH_ITEMS]
        rest = conditions[MAX_WATCH_ITEMS:]
        lines = []
        for i, c in enumerate(top, 1):
            lines.append(f"Issue {i}: {c}")
            # Areas belong to the issue they describe, not to the whole list.
            # Rendered flat, they read as a constraint on every sentence, and
            # the model wrote both sentences about class C areas while issue 2
            # was lead paint. Nesting them binds them to their own issue.
            if hazard_issue_index == i - 1 and hazard_areas is not None:
                if hazard_areas:
                    areas = "\n".join(f"      - {a}" for a in hazard_areas)
                    lines.append(
                        f"    Issue {i} covers these areas. They are listed in "
                        f"order, the first being the one this building has most "
                        f"of:\n"
                        f"{areas}\n"
                        + (
                            # Two areas, two sentences: this issue is the only
                            # one whose single condition contains several
                            # distinct things to look at, and naming only the
                            # largest left the rest unmentioned in layer 1.
                            f"    Write TWO sentences for Issue {i}, in one "
                            f"entry. The first is about the FIRST area, the "
                            f"second about the SECOND area. Do not write about "
                            f"the same area twice, and do not merge them into "
                            f"one sentence covering both."
                            if len(hazard_areas) >= MIN_AREAS_FOR_PAIRED
                            # One area: one sentence. Asking for two here is
                            # asking the model to pad, and padding is what
                            # produced invented nouns before this block existed.
                            else f"    Base the Issue {i} sentence on the FIRST "
                                 f"area. Use a later one only if the first names "
                                 f"nothing a reader can look at or ask about."
                        )
                        + f" Do not name an area that is not listed here, and do "
                          f"not let this list constrain your sentence for any "
                          f"other issue."
                    )
                else:
                    lines.append(
                        f"    No area is recorded for Issue {i}. Do not guess "
                        f"what it might be. If you cannot say anything concrete "
                        f"about it, omit its sentence."
                    )
        numbered = "\n".join(lines)
        block = f"{TASK}\n\n{numbered}"
        if rest:
            # Unreachable while select_rules' cap equals MAX_WATCH_ITEMS — there
            # is never a remainder. Kept because it is the guard that stops a
            # caller passing a longer selection from silently getting sentences
            # for issues the corpus was never keyed on.
            others = "\n".join(f"  - {c}" for c in rest)
            block += (
                "\n\nAlso flagged and shown below, but do NOT write a "
                f"sentence for these:\n{others}"
            )
        blocks.append(block)
    else:
        blocks.append(
            "Conditions flagged below your text:\n"
            "  (none — no specific condition met the threshold to be flagged. "
            "This does not mean the building is problem-free, and your text "
            "must not say or imply that it is. Return an empty watch_for list.)"
        )

    if not severity_language_allowed(percentile):
        blocks.append(
            "Language constraint:\n"
            "This line is a viewing checklist, not a verdict on the building. "
            "Stay concrete about what to check and silent on how bad the "
            'building is. Do not use "high", "severe", "poor", "significant", '
            '"serious", or any other word asserting its condition is bad in '
            "absolute terms."
        )

    return "\n\n".join(blocks)


def repair_instruction(error: str) -> str:
    """The repair turn: hand the validation failure back and ask for a fix.

    Deliberately narrow — it names the violated constraint and asks for a
    corrected object, without restating the task. The original instructions are
    still in context; repeating them invites the model to rewrite from scratch
    rather than fix what it produced.

    Note what this is for: malformed output only. Ungrounded output is never
    repaired — see the module docstring in `generate.py`.
    """
    return (
        "Your previous response did not satisfy the output contract:\n\n"
        f"{error}\n\n"
        "Return a corrected object. Keep the meaning the same and change only "
        "what the constraint requires. If the sentence is too long, cut a "
        "clause rather than compressing every word."
    )


def build_messages(
    metrics: dict[str, Any],
    conditions: list[str],
    hazard_issue_index: int | None = None,
) -> list[dict[str, Any]]:
    """Convenience wrapper: pull the few fields the prompt needs off a row.

    Named explicitly rather than passing the whole row through, so a prompt that
    starts depending on a new metric has to say so here.
    """
    return [
        {
            "role": "user",
            "content": render_context(
                percentile=metrics.get("hpd_violations_percentile"),
                conditions=conditions,
                hazard_areas=hazard_areas_for(metrics),
                hazard_issue_index=hazard_issue_index,
            ),
        }
    ]


# The rule whose condition text names no observable thing, and which the class C
# category areas exist to make concrete.
HAZARD_AREA_RULE_ID = "open_class_c"


def hazard_issue_index(selected_rules) -> int | None:
    """Which issue the class C hazard areas describe, by position.

    Found by rule id rather than assumed to be first. It is first today because
    open_class_c is priority 1, but a priority change would silently attach the
    areas to the wrong issue, and the failure would look like the model
    inventing detail rather than like a routing bug.

    Lives here rather than in `generate.py` because the deterministic smoke path
    needs it, and importing `generate` drags in the Anthropic SDK — the same
    lazy-import rule the package `__init__` exists to enforce.
    """
    for i, rule in enumerate(selected_rules):
        if rule.id == HAZARD_AREA_RULE_ID:
            return i
    return None


def hazard_areas_for(metrics: dict[str, Any]) -> list[str] | None:
    """None when class C is not flagged; a (possibly empty) list when it is.

    The distinction is the whole point — see `render_context`. Keyed off the
    class C count rather than off the categories, because "no categories" is
    exactly the state that must still render.
    """
    from .taxonomy import describe_hazard_areas

    if not metrics.get("open_class_c_violations"):
        return None
    return describe_hazard_areas(metrics.get("open_class_c_categories"))
