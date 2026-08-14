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
# issue is still exactly one sentence — see MAX_WATCH_FOR_PAIRED for why this
# rule is the only one that can carry two.
#
# Amended in place because v6 has never backed a corpus: `brief_texts` is empty,
# so there is nothing to invalidate and a bump would buy nothing. Bump on the
# commit that FREEZES a prompt for generation, not on each edit — otherwise the
# version log fills with numbers that never produced a row.
PROMPT_VERSION = "brief-v6"

# One sentence each. Not a paragraph budget with room for a second thought — at
# 200 characters a model that starts listing findings runs out of room and fails
# validation, which is the intended outcome rather than a tolerated one.
MAX_WATCH_FOR = 200

# The class C issue may carry TWO sentences in one entry when the building has
# two describable hazard areas, so its budget is two sentences and nothing more.
#
# It is the only issue that can: every other rule names one condition, and a
# second sentence about it would either repeat the first or invent a detail. The
# class C rule is the one whose issue genuinely contains several distinct things
# — a building can have open violations for pests AND for maintenance AND for
# egress — and until now the reader heard about only the largest.
#
# Deliberately a hard multiple rather than a round number: the budget for two
# sentences is exactly the budget for one, twice. A model given slack per
# sentence writes longer sentences.
MAX_WATCH_FOR_PAIRED = MAX_WATCH_FOR * 2

# The rule allowed to use MAX_WATCH_FOR_PAIRED. Named here rather than in
# prompt.py because the schema, the prompt and the validator all have to agree
# on it, and two of the three already import from this module.
PAIRED_SENTENCE_RULE_ID = "open_class_c"

# A second sentence needs a second thing to be about. Below this many
# describable hazard areas the model is asked for one sentence, because the
# alternative is padding — and padding a sentence about hazards is how the
# invented nouns ("water damage or mold") got in before the areas block existed.
MIN_AREAS_FOR_PAIRED = 2

# One per issue, for the top two. A list rather than a paragraph because each
# entry is answerable to a specific rule: entry i addresses selected_rules[i],
# which is what lets a validator check that a sentence about mold was produced
# for a building with a mold flag. Free prose covering both would only be
# checkable as a whole.
MAX_WATCH_ITEMS = 2

# The schema holds the LOOSER cap, because one entry legitimately reaches it and
# Pydantic cannot see which rule an entry answers. The tighter per-rule limit is
# enforced by validate.check_length, which is handed the rule id. Schema rejects
# what is structurally impossible; the validator rejects what is wrong for this
# issue — the same split as everywhere else in this package.
WatchSentence = Annotated[str, StringConstraints(max_length=MAX_WATCH_FOR_PAIRED)]


class GeneratedContext(BaseModel):
    """Everything the model is allowed to write: up to two watch items.

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
            "One sentence per flagged issue, for the two most significant, in "
            "the same order they were given. Each names something the reader "
            "can look at, ask about, or check themselves. Each under 200 "
            "characters. Never a legal right, obligation, deadline, or remedy. "
            "Empty list when nothing is flagged."
        ),
    )
