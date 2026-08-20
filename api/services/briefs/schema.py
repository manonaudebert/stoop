"""The output contract for the generated part of a Building Brief.

This is the entire model output: one sentence. Everything else a reader sees —
the counts, the percentile, the watch items and their advice, the confidence
note — is computed or authored and assembled around this field by code.

The class is named for what it is rather than for the feature, because the
temptation this refactor exists to resist is letting the model's output grow
back into "the brief". A `BuildingBrief` with a `summary` field invites more
fields. A `GeneratedContext` with one field does not.

`max_length` is deliberately *not* expressible in the API's JSON Schema subset —
the Anthropic SDK demotes it to a description hint and Pydantic enforces it
client-side, so an over-long line comes back schema-shaped but invalid. That is
the repair path in `generate.py`, not a bug: length is where hallucination
lives, so the cap is worth a retry.
"""

from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints


# How many hazard areas a city's hazard-area rule can describe. Three is what the
# model was given and what the rendered brief shows; more crowds the item.
#
# Defined here rather than in a signals generator because both the schema and
# every city's SQL read it, and a shared module must not import from one city.
HAZARD_AREA_LIMIT = 3

# Bump when the prompt or the schema changes in a way that invalidates stored
# briefs. Persisted alongside every generation so a corpus can be traced back to
# what produced it.
#
# v1 -> v2: the model wrote summary + key_concerns + confidence_note from a full
# metrics dump. It inferred absolute severity from a relative rank ("High number
# of open violations" at the 31st percentile) and used HPD jargon. v2 gives it
# one sentence and no numbers to reason about.
# v2 -> v3: added `watch_for`. The brief told a renter what the record contains
# but never what to do with that on a viewing. Note what did NOT move: the
# tenant-rights guidance in `rules.yaml` is still authored and cited. `watch_for`
# is what to look at, never what you are entitled to.
# v3 -> v4: `watch_for` becomes a list — one sentence per issue, for the top two
# flagged conditions. One sentence covering two issues had to generalise across
# them and lost the specificity that made it useful.
# v4 -> v5: `context_line` removed. It restated a standing the page already
# shows in its own card, and it was the only generated text asserting anything
# about the building as a whole — which made it the only text that could get the
# whole building wrong. It did, repeatedly: a building better than 89% of its
# neighborhood was described as "typical", then as "typical ... with fewer
# violations than most" in one breath. The model's entire output is now
# per-issue and concrete.
# v5 -> v6: the class C hazard-area block now tells the model to base its
# sentence on the FIRST area — the one this building has the most open
# violations of — rather than "one of them". Nothing about the data changed;
# the list was already ordered by open count descending. What changed is that
# the prompt stopped leaving the choice open, so the model can no longer pick
# the most writable area over the largest one.
# v6, amended 2026-08-12 and deliberately NOT bumped to v7: the class C issue
# may now carry TWO sentences, one for its largest hazard area and one for its
# second, when both are describable. Previously it named only the first, so a
# building with open violations for pests AND egress AND maintenance got one
# sentence about pests and the rest went unmentioned in layer 1. Every other
# issue is still exactly one sentence — see MAX_WATCH_FOR_MULTI for why this
# rule is the only one that can carry two.
#
# Amended in place because v6 has never backed a corpus: `brief_texts` is empty,
# so there is nothing to invalidate and a bump would buy nothing. Bump on the
# commit that FREEZES a prompt for generation, not on each edit — otherwise the
# version log fills with numbers that never produced a row.
# v6 -> v7: MAX_WATCH_ITEMS 2 -> 3, and `select_rules` capped to a matching 3.
# This one IS a bump rather than an amendment, on both halves of the rule above.
# The prompt materially changes for any building with three or more flagged
# conditions: it now numbers three issues instead of two, and the trailing
# unnumbered "other conditions" list disappears, because with the two caps equal
# there is never a remainder to list. A sentence generated under v6 was written
# for a model shown a different record.
#
# The handful of v6 rows in `brief_texts` are smoke-test output, not a corpus,
# and are invalidated by this on purpose.
#
# v7, amended in place 2026-08-14 (same session it was created, no rows behind
# it): the user turn was rewritten around the reader's actual situation — a
# fifteen-minute viewing, a broker, possibly an empty unit — and carries a
# worked GOOD/BAD pair. It replaces "ask the current tenant about their
# experience with X", which was grammatical, on-topic, and useless: it leaned on
# a person who is usually absent, wanted an opinion rather than evidence, and
# left the reader to invent the wording. SYSTEM lost the example that taught
# exactly that shape.
# v7 -> v8: showing the model each issue's authored `action` text, so that "do
# not repeat the static text" became an instruction it could follow, was TRIED
# AND REVERTED on 2026-08-17. It did not work: the detector line came back as
# "Look for a smoke alarm within fifteen feet of the bedroom door... and press
# their test buttons", which is the authored action with the nouns shuffled. A
# model shown the text it must avoid rewrites it more carefully rather than
# finding something else to say, so the +138 tokens per call bought nothing.
#
# The number stays at v8 rather than reverting to v7. Both have rows behind them
# now, generated under prompts that differ, and reusing v7 would serve those
# older rows alongside new ones under a version that no longer identifies a
# single prompt — which is the one thing this field exists to prevent.
# v8 -> v9 -> v10: the worked examples left the apartment domain entirely and
# are now about buying a used car. qwen3:8b returned the old heat example
# VERBATIM as its answer for the heat rule — a valid sentence it had not
# written, bound for the largest shape in the corpus.
#
# v9 moved the example to a self-closing fire door, which was wrong and is
# recorded because the reasoning was the interesting part. It reduced exposure
# (633 shapes vs 962) instead of removing it, and worse, it destroyed the only
# way to detect the problem: the corpus already contains a stairwell-door
# sentence written with NO door example in the prompt, so under v9 a door
# sentence could not be told apart from the model reaching the obvious answer
# on its own. Every collision here has been caught by reading a row and
# recognising it; an in-domain example retires that method.
#
# In-domain examples also manufacture false positives. A real lead-paint
# sentence scores 0.83 containment against an in-domain lead-paint example,
# above `validate.ECHO_CONTAINMENT` — the check would hard-fail correct output.
# Out of domain, every real sentence in the corpus scores at most 0.10 and a
# verbatim echo scores 1.00. That margin is what makes `check_echoes_example`
# measurable rather than decorative.
# v10 -> v11: the class C issue now asks for ONE SENTENCE PER AREA SHOWN, up to
# three, instead of always exactly two. The prompt listed up to three areas while
# asking for two sentences, and the model answered the list — returning three
# entries for one issue on 1,722 of 2,785 paired shapes (62%). That was the
# source of the entry-count failures, and it was a contradiction in the prompt
# rather than a model fault.
PROMPT_VERSION = "brief-v11"

# One sentence each. Not a paragraph budget with room for a second thought — at
# this length a model that starts listing findings runs out of room and fails
# validation, which is the intended outcome rather than a tolerated one.
#
# DELIBERATE SLACK, and the one place the prompt and this file are allowed to
# disagree. The prompt asks for "under 30 words and under 200 characters"; this
# hard-fails at 215. The gap is intentional and in the safe direction: the
# instruction aims the model low, and the validator quarantines only genuine
# overflow rather than a sentence landing a few characters over.
#
# Set from the first full corpus run, where all 18 length drops measured
# 204-214 characters — single sentences a hair past the ask, not the runaway
# listing this cap exists to catch. Every one of them was a good sentence.
#
# Do NOT close the gap by raising the prompt to 215. The prompt text is what
# `PROMPT_VERSION` tracks, so editing it invalidates the corpus, while the
# validator can move without a bump. Instruction stricter than enforcement is
# the posture throughout — the same shape as the prompt banning quantifiers
# that `validate` exempts when they measure a duration.
MAX_WATCH_FOR = 215

# The class C issue carries ONE SENTENCE PER DESCRIBABLE HAZARD AREA, up to the
# number of areas the selection layer can supply.
#
# It is the only issue that can: every other rule names one condition, and a
# second sentence about it would either repeat the first or invent a detail. The
# class C rule is the one whose issue genuinely contains several distinct things
# — a building can have open violations for pests AND for maintenance AND for
# egress — and the reader used to hear about only the largest.
#
# WAS EXACTLY TWO until 2026-08-17, while the prompt showed up to three areas.
# That mismatch was the bug: shown three areas and asked for two sentences, the
# model wrote three entries, which is the reasonable reading of what it was
# given. `generate.py` then had a list longer than its issue count and, before
# the pairing fix, slid later sentences onto the wrong rules. 1,722 of 2,785
# paired shapes showed three areas — 62%, not an edge case. Asking for as many
# sentences as areas shown removes the contradiction at its source.
MAX_AREA_SENTENCES = HAZARD_AREA_LIMIT

# Deliberately a hard multiple rather than a round number: the budget for three
# sentences is exactly the budget for one, three times. A model given slack per
# sentence writes longer sentences.
MAX_WATCH_FOR_MULTI = MAX_WATCH_FOR * MAX_AREA_SENTENCES

# The rule allowed to use MAX_WATCH_FOR_MULTI. Named here rather than in
# prompt.py because the schema, the prompt and the validator all have to agree
# on it, and two of the three already import from this module.
MULTI_SENTENCE_RULE_ID = "open_class_c"

# A second sentence needs a second thing to be about. Below this many
# describable hazard areas the model is asked for one sentence, because the
# alternative is padding — and padding a sentence about hazards is how the
# invented nouns ("water damage or mold") got in before the areas block existed.
MIN_AREAS_FOR_MULTI = 2

# One per issue. A list rather than a paragraph because each entry is
# answerable to a specific rule: entry i addresses selected_rules[i], which is
# what lets a validator check that a sentence about mold was produced for a
# building with a mold flag. Free prose covering them all would only be
# checkable as a whole.
#
# RAISED 2026-08-14, 2 -> 3, to match `select_rules(max_items=3)`. The two are
# now equal on purpose: every item the page shows carries a generated line,
# rather than the top two of five. Measured over all 310,400 buildings in
# `hpd_brief_signals` before the change — it adds ZERO corpus rows. Only
# `open_class_c` carries hazard areas in its key (899 of the 909 rows); every
# other rule's key is `rule|sev=0|1|areas=` and therefore has exactly two
# possible rows however many slots exist. The third slot is always filled by a
# rule whose rows were already being generated. The cost is calls, not rows:
# distinct prompt shapes go 2,114 -> 3,170, about $4.86 -> $7.29 at Haiku
# rates.
MAX_WATCH_ITEMS = 3

# The schema holds the LOOSER cap, because one entry legitimately reaches it and
# Pydantic cannot see which rule an entry answers. The tighter per-rule limit is
# enforced by validate.check_length, which is handed the rule id. Schema rejects
# what is structurally impossible; the validator rejects what is wrong for this
# issue — the same split as everywhere else in this package.
WatchSentence = Annotated[str, StringConstraints(max_length=MAX_WATCH_FOR_MULTI)]


class GeneratedContext(BaseModel):
    """Everything the model is allowed to write: up to MAX_WATCH_ITEMS items.

    All of it is orientation. None of it is advice: what a tenant may *do* —
    call 311, write to the owner, what the owner is obliged to inspect — is
    quoted from NYC HPD's *ABCs of Housing* in `rules.yaml` with a page
    citation, because a model paraphrase of a legal entitlement is wrong in a
    way a reader can act on. `watch_for` says what to look at. It never says
    what you are owed.

    There is deliberately no field describing the building as a whole. Every
    sentence answers one flagged issue, so every sentence has one record to be
    checked against.

    `watch_for[i]` addresses `selected_rules[i]`. That positional contract is
    what makes the field checkable: a sentence can be held against the specific
    flag it was written for, rather than judged as prose. `generate.py` enforces
    the length; nothing downstream should assume it without checking.
    """

    model_config = {"extra": "forbid"}

    watch_for: list[WatchSentence] = Field(
        default_factory=list,
        max_length=MAX_WATCH_ITEMS,
        description=(
            "One sentence per flagged issue, in "
            "the same order they were given. Each names something the reader "
            "can look at, ask about, or check themselves. Each under 200 "
            "characters. Never a legal right, obligation, deadline, or remedy. "
            "Empty list when nothing is flagged."
        ),
    )
