"""Generate the text a Building Brief's model is allowed to write.

A single function, provider-agnostic, that turns a building's standing and its
selected rules into a schema-valid `GeneratedContext` or an honest failure.

Note the word *schema-valid*. What comes back from here is *unvalidated* in the
sense that matters: nothing in this module checks whether the sentence is true.
Groundedness is a separate layer, deliberately, because the two failures want
opposite responses — malformed output is repaired by handing the error back,
while ungrounded output must never be repaired. Asking a model to re-check a
claim it invented produces a different invented claim with equal confidence. So
this module returns something explicitly provisional and something else decides
whether it may be published.

The control flow distinguishes three outcomes that are easy to conflate:

  TRANSIENT (429, 529, timeout, connection drop)
      The request never produced an answer. Nothing is wrong with our input, so
      resend it unchanged after exponential backoff. -> retry

  INVALID (unparseable JSON, or parsed but violating a Pydantic constraint)
      The model answered and the answer is unusable. Resending unchanged would
      produce the same output, so the validation error goes back as a new turn
      and the model corrects its own work. -> repair

  FATAL (refusal, truncation)
      Deterministic given the same inputs. Retrying spends money on an identical
      failure; repairing can't help either, because the binding constraint is
      the token budget or a policy decision, not the model's phrasing. -> raise

Retries and repairs share one loop because they interleave: a repair attempt can
itself be rate-limited. Token usage accumulates across every round trip, so the
logged cost is what the brief actually cost, not what the last call cost.
"""

import asyncio
import random
from dataclasses import dataclass
from typing import Any

from anthropic.lib._parse._transform import transform_schema
from pydantic import ValidationError

from .prompt import SYSTEM, build_messages, hazard_issue_index, repair_instruction
from .providers import (
    Provider,
    RefusalError,
    TransientError,
    TruncatedError,
)
from .rules import Rule
from .schema import MAX_WATCH_ITEMS, PROMPT_VERSION, GeneratedContext
from .telemetry import CallRecord, Timer, compute_cost

# Computed once: the wire schema is part of the cache prefix, so it must be
# byte-identical across calls.
WIRE_SCHEMA: dict[str, Any] = transform_schema(GeneratedContext)


class BriefGenerationFailed(RuntimeError):
    """Every avenue exhausted. Carries the record so the failure is still logged."""

    def __init__(self, message: str, record: CallRecord):
        super().__init__(message)
        self.record = record


@dataclass
class BriefResult:
    context: GeneratedContext
    record: CallRecord


def _backoff_seconds(attempt: int, base: float = 1.0, cap: float = 30.0) -> float:
    """Exponential backoff with full jitter.

    Jitter matters more than the exponent here: without it, a batch of calls
    rate-limited together retries in lockstep and re-triggers the limit.
    """
    return random.uniform(0, min(cap, base * (2**attempt)))


async def generate_context_line(
    metrics: dict[str, Any],
    selected_rules: list[Rule],
    provider: Provider,
    *,
    building_id: str | None = None,
    city: str | None = None,
    max_attempts: int = 3,
    max_repairs: int = 1,
    max_tokens: int = 400,
) -> BriefResult:
    """Return a schema-valid `GeneratedContext` for one building.

    `metrics` must contain only values read from the database, and only two of
    them reach the model: the violations percentile, which is converted to a
    qualitative band first, and the neighborhood name. `selected_rules` come
    from `rules.select_rules`; their authored `condition` sentences are what the
    model is told about, so it never has to invent vocabulary for a hazard.

    `max_tokens` is 400 rather than v1's 600. The output is at most three
    sentences of 200 characters, so a response needing more than this is
    malformed by definition, and a low ceiling turns runaway generation into a
    fast fatal error instead of an expensive one.
    """
    record = CallRecord(
        building_id=building_id,
        city=city,
        model=provider.model,
        provider=provider.name,
        prompt_version=PROMPT_VERSION,
    )

    messages: list[dict[str, Any]] = build_messages(
        metrics,
        [r.condition for r in selected_rules],
        hazard_issue_index=hazard_issue_index(selected_rules),
    )
    attempts = 0
    repairs = 0
    last_error = ""

    with Timer() as timer:
        while True:
            try:
                raw = await provider.complete(
                    system=SYSTEM,
                    messages=messages,
                    schema=WIRE_SCHEMA,
                    max_tokens=max_tokens,
                )
            except TransientError as e:
                attempts += 1
                record.attempts = attempts + 1
                last_error = str(e)
                if attempts >= max_attempts:
                    record.validation_result = "error"
                    record.error = f"transient, gave up after {attempts}: {e}"
                    break
                await asyncio.sleep(_backoff_seconds(attempts))
                continue
            except RefusalError as e:
                # Fatal: a policy decision, not a phrasing problem.
                record.validation_result = "refusal"
                record.error = str(e)
                break
            except TruncatedError as e:
                # Fatal: the token budget is binding. Raise max_tokens or
                # shrink the schema — another identical call cannot help.
                record.validation_result = "truncated"
                record.error = str(e)
                break

            # Usage accumulates across every round trip, including the ones
            # that failed validation. A brief that took two calls cost two.
            record.input_tokens += raw.input_tokens
            record.output_tokens += raw.output_tokens
            record.cached_tokens += raw.cached_tokens
            record.cache_write_tokens += raw.cache_write_tokens

            try:
                context = GeneratedContext.model_validate_json(raw.text)
            except ValidationError as e:
                last_error = _summarize_validation_error(e)
                # Keep the offending output so the failure is diagnosable. The
                # last failure wins — that's the one that ended the attempt.
                record.output_chars = len(raw.text)
                record.raw_output = raw.text[:1000]
                if repairs >= max_repairs:
                    record.validation_result = "invalid_schema"
                    record.error = (
                        f"still invalid after {repairs} repair attempt(s): {last_error}"
                    )
                    break
                repairs += 1
                record.repairs = repairs
                # Repair: show the model its own output, then the failure.
                messages.append({"role": "assistant", "content": raw.text})
                messages.append({"role": "user", "content": repair_instruction(last_error)})
                continue

            # How many watch items are warranted is a fact about the input, not
            # a judgment: one per flagged issue, capped at MAX_WATCH_ITEMS, and
            # none at all when nothing is flagged. A model asked for a
            # suggestion will supply a generic one rather than decline, so the
            # prompt asks and this enforces.
            #
            # ANY mismatch is repaired. A surplus used to be truncated instead,
            # on the reasoning that the extra sentence was simply not wanted and
            # a round trip to delete it was paid for nothing. That is true only
            # when no entry was supposed to hold two sentences, and it stopped
            # being true when the class C rule started asking for a paired
            # entry: the model answered by splitting the pair across two LIST
            # entries, which is not a surplus but a SHIFT. Truncating then kept
            # the first N entries and silently slid every later sentence onto
            # the wrong rule.
            #
            # Observed on BIN 1013795: four entries for two issues, three of
            # them the class C pair split apart, and a sentence about heat was
            # stored against the smoke-detector rule. Nothing downstream could
            # catch it — each sentence was individually well formed, and
            # validate's pairing check only fires when the counts still
            # disagree, which truncation had already fixed up.
            #
            # The two cases are indistinguishable from out here, and they fail
            # in opposite directions: dropping a spurious sentence costs one
            # sentence, while mis-shifting a split pair publishes text under a
            # heading it does not describe, to every building sharing that
            # input shape. So the cheap guess is gone.
            expected = min(len(selected_rules), MAX_WATCH_ITEMS)
            if len(context.watch_for) != expected:
                last_error = (
                    f"- watch_for: expected exactly {expected} entr(y/ies), one "
                    f"per numbered issue, but got {len(context.watch_for)}. An "
                    f"issue asked to carry two sentences takes both in ONE "
                    f"entry; never split one issue across two entries."
                )
                record.output_chars = len(raw.text)
                record.raw_output = raw.text[:1000]
                if repairs < max_repairs:
                    repairs += 1
                    record.repairs = repairs
                    messages.append({"role": "assistant", "content": raw.text})
                    messages.append(
                        {"role": "user", "content": repair_instruction(last_error)}
                    )
                    continue
                record.validation_result = "invalid_schema"
                record.error = (
                    f"still invalid after {repairs} repair attempt(s): {last_error}"
                )
                break

            record.validation_result = "ok"
            break

    record.latency_ms = timer.ms
    record.cost_usd = compute_cost(
        provider.model,
        input_tokens=record.input_tokens,
        output_tokens=record.output_tokens,
        cache_read_tokens=record.cached_tokens,
        cache_write_tokens=record.cache_write_tokens,
    )
    record.log()

    if record.validation_result != "ok":
        raise BriefGenerationFailed(
            f"{record.validation_result}: {record.error or last_error}", record
        )

    return BriefResult(context=context, record=record)


def _summarize_validation_error(e: ValidationError) -> str:
    """Compact the Pydantic error to what the model needs to fix.

    The full ValidationError repr includes URLs and input echoes that add tokens
    without adding signal.
    """
    parts = []
    for err in e.errors():
        loc = ".".join(str(p) for p in err["loc"]) or "(root)"
        parts.append(f"- {loc}: {err['msg']}")
    return "\n".join(parts)
