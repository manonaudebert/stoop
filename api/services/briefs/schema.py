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
PROMPT_VERSION = "brief-v6"

# One sentence each. Not a paragraph budget with room for a second thought — at
# 200 characters a model that starts listing findings runs out of room and fails
# validation, which is the intended outcome rather than a tolerated one.
MAX_WATCH_FOR = 200

# One per issue, for the top two. A list rather than a paragraph because each
# entry is answerable to a specific rule: entry i addresses selected_rules[i],
# which is what lets a validator check that a sentence about mold was produced
# for a building with a mold flag. Free prose covering both would only be
# checkable as a whole.
MAX_WATCH_ITEMS = 2

WatchSentence = Annotated[str, StringConstraints(max_length=MAX_WATCH_FOR)]


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
