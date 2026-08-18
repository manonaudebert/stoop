"""Cost accounting and the hard call cap.

Both exist from the first API call rather than being retrofitted: instrumentation
added later means every measurement taken before it is unrecoverable, and a call
cap added later is a cap that wasn't there for the run that needed it.

The cap is the important one. There are 463,913 eligible NYC buildings; a script
that loops the selection query without a cap is the entire failure mode.
"""

import json
import os
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path

LOG_PATH = Path(os.getenv("BRIEF_LOG_PATH", Path(__file__).parents[3] / "data" / "brief_calls.jsonl"))

# USD per million tokens: (fresh input, output, cache read).
# Cache writes bill at 1.25x fresh input.
PRICING: dict[str, tuple[float, float, float]] = {
    "claude-haiku-4-5": (1.00, 5.00, 0.10),
    "claude-sonnet-5": (3.00, 15.00, 0.30),
    "claude-opus-5": (5.00, 25.00, 0.50),
}
CACHE_WRITE_MULTIPLIER = 1.25


class CallCapExceeded(RuntimeError):
    """Raised before dispatch when a script has made too many calls."""


class CallCap:
    """A per-process budget on API calls.

    Raises *before* the request goes out, so hitting the cap costs nothing.
    """

    def __init__(self, limit: int = 50):
        self.limit = limit
        self.used = 0

    def spend(self, n: int = 1) -> None:
        if self.used + n > self.limit:
            raise CallCapExceeded(
                f"call cap reached ({self.used}/{self.limit}). "
                "Raise the limit deliberately if this run is meant to be larger."
            )
        self.used += n

    def __repr__(self) -> str:
        return f"CallCap({self.used}/{self.limit})"


# Default cap for anything that doesn't pass its own. Deliberately low.
DEFAULT_CAP = CallCap(limit=50)


def compute_cost(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
) -> float:
    """USD for one call. Returns 0.0 for local models (not in PRICING)."""
    if model not in PRICING:
        return 0.0
    in_rate, out_rate, cache_read_rate = PRICING[model]
    return (
        input_tokens * in_rate
        + output_tokens * out_rate
        + cache_read_tokens * cache_read_rate
        + cache_write_tokens * in_rate * CACHE_WRITE_MULTIPLIER
    ) / 1_000_000


@dataclass
class CallRecord:
    """One row of the eval scorecard and the cost dashboard."""

    trace_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    building_id: str | None = None
    city: str | None = None
    model: str = ""
    provider: str = ""
    prompt_version: str = ""
    input_tokens: int = 0
    cached_tokens: int = 0
    cache_write_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    latency_ms: int = 0
    attempts: int = 1  # transient retries consumed
    repairs: int = 0  # schema-repair round trips consumed
    validation_result: str = "unknown"  # ok | invalid_schema | refusal | truncated | error
    error: str | None = None
    # Captured only on validation failure. Without the offending output a
    # failure log records *that* something broke but not *what*, which is the
    # difference between a pass rate and a diagnosis.
    output_chars: int | None = None
    raw_output: str | None = None
    # The model returned more watch_for sentences than there were issues to
    # address, and the surplus was truncated. Not a failure — the brief is still
    # published — but a standing count of how often the model overshoots an
    # explicit list length is worth having before trusting any other instruction
    # in that prompt.
    # No longer set: generate.py repaired-not-truncated surplus entries as of
    # 2026-08-17, so nothing drops a sentence any more. Kept so older rows in
    # data/brief_calls.jsonl still parse, and because `true` in a historical row
    # marks a call that may have published a shifted sentence — see the pairing
    # note in generate.py.
    dropped_watch_for: bool = False

    def log(self) -> None:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a") as f:
            f.write(json.dumps(asdict(self)) + "\n")


class Timer:
    """Wall-clock milliseconds for a block."""

    def __enter__(self) -> "Timer":
        self._start = time.perf_counter()
        self.ms = 0
        return self

    def __exit__(self, *exc) -> None:
        self.ms = int((time.perf_counter() - self._start) * 1000)
