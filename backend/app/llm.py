"""One async interface over every language-model provider.

Two wire protocols cover the presets: the Anthropic Messages API (through the official SDK) and the
OpenAI-compatible /chat/completions API (OpenAI, Gemini, Mistral, Groq, OpenRouter, Ollama, vLLM, ...).
"""

from __future__ import annotations

import json
from typing import AsyncIterator

import anthropic
import httpx

Message = dict  # {"role": "user"|"assistant", "content": str}

# Models that accept the server-side refusal fallback and the effort control.
ANTHROPIC_FALLBACK_MODELS = {"claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"}
ANTHROPIC_EFFORT_PREFIXES = ("claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-5",
                             "claude-opus-4-7", "claude-opus-4-8")
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class LLMError(RuntimeError):
    pass


class ThinkFilter:
    """Drops <think>...</think> spans that some local reasoning models put in their output."""

    OPEN, CLOSE = "<think>", "</think>"

    def __init__(self) -> None:
        self.buffer = ""
        self.inside = False

    def feed(self, text: str) -> str:
        self.buffer += text
        out = []
        while self.buffer:
            tag = self.CLOSE if self.inside else self.OPEN
            pos = self.buffer.find(tag)
            if pos >= 0:
                if not self.inside:
                    out.append(self.buffer[:pos])
                self.buffer = self.buffer[pos + len(tag):]
                self.inside = not self.inside
                continue
            # Keep a possible partial tag at the end for the next chunk.
            keep = next((n for n in range(len(tag) - 1, 0, -1) if self.buffer.endswith(tag[:n])), 0)
            emit, self.buffer = self.buffer[: len(self.buffer) - keep], self.buffer[len(self.buffer) - keep:]
            if not self.inside:
                out.append(emit)
            if keep == 0 or emit == "":
                break
        return "".join(out)

    def flush(self) -> str:
        rest, self.buffer = ("" if self.inside else self.buffer), ""
        return rest


def _headers(api_key: str) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def _error_text(resp: httpx.Response) -> str:
    try:
        body = resp.json()
        err = body.get("error", body)
        if isinstance(err, dict):
            return err.get("message") or json.dumps(err)[:400]
        return str(err)[:400]
    except ValueError:
        return resp.text[:400]


async def _openai_stream(conn: dict, model: str, system: str, messages: list[Message],
                         temperature: float | None, json_mode: bool) -> AsyncIterator[str]:
    body: dict = {
        "model": model,
        "messages": ([{"role": "system", "content": system}] if system else []) + messages,
        "stream": True,
    }
    if temperature is not None:
        body["temperature"] = temperature
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    url = conn["base_url"].rstrip("/") + "/chat/completions"
    think = ThinkFilter()
    async with httpx.AsyncClient(timeout=httpx.Timeout(600, connect=15)) as client:
        async with client.stream("POST", url, headers=_headers(conn.get("api_key", "")), json=body) as resp:
            if resp.status_code >= 400:
                await resp.aread()
                if json_mode and resp.status_code == 400:
                    # Not every server supports response_format; retry without it.
                    async for piece in _openai_stream(conn, model, system, messages, temperature, False):
                        yield piece
                    return
                raise LLMError(f"{conn.get('name', 'Provider')} returned {resp.status_code}: {_error_text(resp)}")
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    event = json.loads(data)
                except ValueError:
                    continue
                if "error" in event:
                    raise LLMError(str(event["error"].get("message", event["error"])))
                for choice in event.get("choices", []):
                    text = (choice.get("delta") or {}).get("content")
                    if text:
                        filtered = think.feed(text)
                        if filtered:
                            yield filtered
    tail = think.flush()
    if tail:
        yield tail


def _anthropic_client(conn: dict) -> anthropic.AsyncAnthropic:
    base = conn.get("base_url") or "https://api.anthropic.com"
    return anthropic.AsyncAnthropic(api_key=conn.get("api_key") or None, base_url=base, max_retries=3)


async def _anthropic_stream(conn: dict, model: str, system: str, messages: list[Message],
                            effort: str | None) -> AsyncIterator[str]:
    client = _anthropic_client(conn)
    params: dict = {"model": model, "max_tokens": 64000, "messages": messages}
    if system:
        params["system"] = system
    extra: dict = {}
    if effort and model.startswith(ANTHROPIC_EFFORT_PREFIXES):
        extra["output_config"] = {"effort": effort}
    official = "api.anthropic.com" in (conn.get("base_url") or "api.anthropic.com")
    use_fallback = official and model in ANTHROPIC_FALLBACK_MODELS
    try:
        if use_fallback:
            extra["fallbacks"] = "default"
            manager = client.beta.messages.stream(**params, betas=[FALLBACK_BETA], extra_body=extra)
        else:
            manager = client.messages.stream(**params, extra_body=extra or None)
        async with manager as stream:
            async for text in stream.text_stream:
                yield text
            final = await stream.get_final_message()
        if final.stop_reason == "refusal":
            raise LLMError("The model declined this request.")
    except anthropic.APIStatusError as exc:
        raise LLMError(f"Anthropic returned {exc.status_code}: {exc.message}") from exc
    except anthropic.APIConnectionError as exc:
        raise LLMError(f"Could not reach Anthropic: {exc}") from exc
    finally:
        await client.close()


async def stream_chat(conn: dict, model: str, system: str, messages: list[Message], *,
                      temperature: float | None = None, json_mode: bool = False,
                      effort: str | None = None) -> AsyncIterator[str]:
    if conn.get("kind") == "anthropic":
        async for piece in _anthropic_stream(conn, model, system, messages, effort):
            yield piece
    else:
        async for piece in _openai_stream(conn, model, system, messages, temperature, json_mode):
            yield piece


async def complete(conn: dict, model: str, system: str, messages: list[Message], **kwargs) -> str:
    """Full response text. Streams under the hood so long outputs never hit HTTP timeouts."""
    parts = [piece async for piece in stream_chat(conn, model, system, messages, **kwargs)]
    return "".join(parts).strip()


async def list_models(conn: dict) -> list[str]:
    if conn.get("kind") == "anthropic":
        client = _anthropic_client(conn)
        try:
            return sorted([m.id async for m in client.models.list(limit=100)], reverse=True)
        except anthropic.APIError as exc:
            raise LLMError(f"Could not list models: {exc}") from exc
        finally:
            await client.close()
    url = conn["base_url"].rstrip("/") + "/models"
    async with httpx.AsyncClient(timeout=20) as client:
        try:
            resp = await client.get(url, headers=_headers(conn.get("api_key", "")))
        except httpx.HTTPError as exc:
            raise LLMError(f"Could not reach {url}: {exc}") from exc
    if resp.status_code >= 400:
        raise LLMError(f"Could not list models ({resp.status_code}): {_error_text(resp)}")
    return sorted(m["id"] for m in resp.json().get("data", []) if "id" in m)
