"""Provider adapters.

One interface, two implementations: Anthropic for measured runs, Ollama for the
dev loop. Designing for this now costs nothing and avoids a refactor when
Module 7 benchmarks providers against each other.

Providers deliberately return **raw text plus usage** rather than a parsed
object. Schema validation and the repair loop live one layer up in `generate.py`
so their behaviour is identical no matter who served the request — otherwise
"the repair loop works" would only be a claim about the Anthropic SDK.

Note the SDK/HTTP split is per-provider and never mixed: Anthropic goes through
the official SDK, Ollama through its own HTTP API. No OpenAI-compatible shims.
"""

import json
import os
from dataclasses import dataclass
from typing import Any, Protocol

import anthropic
import httpx

from .telemetry import CallCap, CallCapExceeded  # noqa: F401  (re-exported for callers)


class TransientError(RuntimeError):
    """Rate limit, overload, timeout, or connection failure. Retry with backoff."""


class RefusalError(RuntimeError):
    """The model declined. Retrying the same prompt will not help."""


class TruncatedError(RuntimeError):
    """Hit max_tokens mid-object. Output is unparseable by construction."""


@dataclass
class RawResponse:
    """What every provider returns, normalized."""

    text: str
    input_tokens: int = 0
    output_tokens: int = 0
    cached_tokens: int = 0
    cache_write_tokens: int = 0


class Provider(Protocol):
    name: str
    model: str

    async def complete(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        schema: dict[str, Any],
        max_tokens: int,
    ) -> RawResponse: ...


class AnthropicProvider:
    """Measured runs. Structured output is enforced server-side via
    `output_config.format`, so malformed JSON is not a failure mode we handle —
    only *semantically* wrong or constraint-violating output is."""

    name = "anthropic"

    def __init__(
        self,
        model: str = "claude-haiku-4-5",
        cap: CallCap | None = None,
        base_url: str | None = None,
        # None on purpose: `effort` is an Opus-tier parameter, and the corpus
        # model is Haiku. Sending it to a model that does not support it is a
        # 400 — "This model does not support the effort parameter" — not a
        # silently ignored field. It defaulted to "low" and was never exercised,
        # because the dev loop runs against Ollama, which ignores it.
        #
        # Left as a parameter rather than deleted: the whole point of `effort`
        # is to buy depth on a harder model, and this prompt is one sentence of
        # renter-facing English. If a future run wants Opus for a comparison,
        # the seam is here.
        effort: str | None = None,
    ):
        self.model = model
        self.effort = effort
        self._cap = cap
        kwargs: dict[str, Any] = {
            # The SDK's own retries cover 429/5xx; our loop adds visibility and
            # counts attempts against the cap.
            "max_retries": 0,
            "timeout": 60.0,
        }
        if base_url or os.getenv("ANTHROPIC_BASE_URL"):
            kwargs["base_url"] = base_url or os.environ["ANTHROPIC_BASE_URL"]
        self._client = anthropic.AsyncAnthropic(**kwargs)

    async def complete(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        schema: dict[str, Any],
        max_tokens: int,
    ) -> RawResponse:
        if self._cap:
            self._cap.spend()
        try:
            response = await self._client.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                # cache_control on the system block: the stable prefix is the
                # only thing worth caching, and it must be byte-identical
                # across calls for the prefix match to hit.
                system=[
                    {
                        "type": "text",
                        "text": system,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=messages,
                # `format` is the structured-output contract and is supported on
                # Haiku; `effort` is Opus-tier only, so the key is omitted
                # entirely rather than sent as null — see __init__.
                output_config={
                    "format": {"type": "json_schema", "schema": schema},
                    **({"effort": self.effort} if self.effort else {}),
                },
            )
        except anthropic.RateLimitError as e:
            raise TransientError("rate limited (429)") from e
        except anthropic.APIConnectionError as e:
            raise TransientError(f"connection failure: {e}") from e
        except anthropic.APIStatusError as e:
            if e.status_code >= 500:
                raise TransientError(f"server error {e.status_code}") from e
            raise

        if response.stop_reason == "refusal":
            category = getattr(response.stop_details, "category", None)
            raise RefusalError(f"model declined (category={category})")
        if response.stop_reason == "max_tokens":
            raise TruncatedError(f"output exceeded max_tokens={max_tokens}")

        text = "".join(b.text for b in response.content if b.type == "text")
        usage = response.usage
        return RawResponse(
            text=text,
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            cached_tokens=usage.cache_read_input_tokens or 0,
            cache_write_tokens=usage.cache_creation_input_tokens or 0,
        )


class OllamaProvider:
    """The dev loop. Free and instant, so prompt iteration doesn't touch the
    budget.

    Local structured-output reliability is weaker than the API's: Ollama's
    `format` parameter takes a JSON Schema and constrains generation, but it
    does not enforce the constraint the way the Anthropic API does. If an 8B
    model can't hold this schema, that is a finding worth recording — not a
    reason to abandon the free dev loop.
    """

    name = "ollama"

    def __init__(
        self,
        model: str = "llama3.1:8b",
        base_url: str | None = None,
        cap: CallCap | None = None,
        think: bool | None = False,
    ):
        self.model = model
        self.base_url = (base_url or os.getenv("OLLAMA_HOST", "http://localhost:11434")).rstrip("/")
        self._cap = cap
        # Reasoning models (qwen3, deepseek-r1) emit a thinking block by
        # default. Ollama returns it in `message.thinking`, separate from
        # `message.content`, so it does not corrupt the JSON — but it is pure
        # latency for a task this mechanical. Default off; set None to omit the
        # field entirely for models that reject it.
        self.think = think

    async def complete(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        schema: dict[str, Any],
        max_tokens: int,
    ) -> RawResponse:
        if self._cap:
            self._cap.spend()
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, *messages],
            "format": schema,
            "stream": False,
            "options": {"temperature": 0, "num_predict": max_tokens},
        }
        if self.think is not None:
            payload["think"] = self.think
        try:
            async with httpx.AsyncClient(timeout=180.0) as client:
                r = await client.post(f"{self.base_url}/api/chat", json=payload)
        except httpx.RequestError as e:
            raise TransientError(f"could not reach Ollama at {self.base_url}: {e}") from e

        if r.status_code >= 500:
            raise TransientError(f"ollama server error {r.status_code}")
        r.raise_for_status()
        body = r.json()

        if body.get("done_reason") == "length":
            raise TruncatedError(f"output exceeded num_predict={max_tokens}")

        return RawResponse(
            text=body["message"]["content"],
            input_tokens=body.get("prompt_eval_count", 0),
            output_tokens=body.get("eval_count", 0),
        )


def describe(provider: Provider) -> str:
    return f"{provider.name}:{provider.model}"


def schema_json(schema: dict[str, Any]) -> str:
    return json.dumps(schema, indent=2)
