"""Building Brief generation.

Two layers, deliberately kept separable:

  Deterministic — rules, taxonomy, confidence, schema. Pure functions over a
  signals dict. No network, no SDK, no API key. Import cost: milliseconds.

  Model call — generate, providers. Needs the Anthropic SDK, which costs ~0.5s
  warm and considerably more cold.

`__init__` re-exports the model-call names lazily via PEP 562. Importing them
eagerly here made `import services.briefs.rules` pull in the whole SDK, which
turned an offline unit-test suite into a multi-minute run — and quietly gave the
deterministic layer a dependency on the thing it exists to avoid needing.

    from services.briefs import rules          # fast, no SDK
    from services.briefs import generate_context_line  # loads the SDK on first access
"""

from typing import TYPE_CHECKING

from .cities import CITIES, NYC, SF, CityBriefConfig, get_city
from .confidence import confidence_note, confidence_note_from_signals
from .rules import MissingSignalError, Rule, eligible_rules, load_rules, select_rules
from .schema import MAX_WATCH_FOR, MAX_WATCH_ITEMS, PROMPT_VERSION, GeneratedContext
from .taxonomy import group_of, groups, minor_to_group
from .telemetry import CallCap, CallCapExceeded, CallRecord, compute_cost

if TYPE_CHECKING:  # for type checkers only — never executed at runtime
    from .generate import BriefGenerationFailed, BriefResult, generate_context_line
    from .providers import AnthropicProvider, OllamaProvider, Provider

_LAZY = {
    "BriefGenerationFailed": ".generate",
    "BriefResult": ".generate",
    "generate_context_line": ".generate",
    "AnthropicProvider": ".providers",
    "OllamaProvider": ".providers",
    "Provider": ".providers",
}


def __getattr__(name: str):
    """Import the SDK-backed names only when something actually asks for one."""
    module = _LAZY.get(name)
    if module is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    from importlib import import_module

    return getattr(import_module(module, __name__), name)


def __dir__() -> list[str]:
    return sorted(list(globals()) + list(_LAZY))


__all__ = [
    # per-city configuration
    "CITIES",
    "NYC",
    "SF",
    "CityBriefConfig",
    "get_city",
    # deterministic
    "GeneratedContext",
    "MAX_WATCH_FOR",
    "MAX_WATCH_ITEMS",
    "CallCap",
    "CallCapExceeded",
    "CallRecord",
    "MissingSignalError",
    "PROMPT_VERSION",
    "Rule",
    "compute_cost",
    "confidence_note",
    "confidence_note_from_signals",
    "eligible_rules",
    "group_of",
    "groups",
    "load_rules",
    "minor_to_group",
    "select_rules",
    # model call (lazy)
    "AnthropicProvider",
    "BriefGenerationFailed",
    "BriefResult",
    "OllamaProvider",
    "Provider",
    "generate_context_line",
]
