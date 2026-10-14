"""Provider settings: stored in SQLite with API keys encrypted; masked when sent to the browser."""

from __future__ import annotations

import copy
from typing import Any

from . import db
from .security import decrypt, encrypt

KEY = "providers"

ROLES = ("chat", "studio", "video")

DEFAULTS: dict[str, Any] = {
    # Saved LLM connections, keyed by id. Each: preset, name, kind, base_url, api_key.
    "connections": {},
    # Which connection + model each task uses.
    "roles": {role: {"connection": "", "model": ""} for role in ROLES},
    "embeddings": {"preset": "keyword", "kind": "keyword", "base_url": "", "api_key": "", "model": ""},
    "voice": {
        "preset": "kokoro", "kind": "openai", "base_url": "http://kokoro:8880/v1", "api_key": "",
        "model_id": "kokoro", "project": "", "host_a": "af_heart", "host_b": "am_michael",
        "narrator": "bm_george", "language_code": "",
    },
    "stt": {"preset": "voice", "kind": "voice", "base_url": "", "api_key": "", "model": "", "project": ""},
    "video": {"palette": "deep-space", "max_custom_scenes": 3},
    # Optional SearXNG instance for "Discover sources".
    "search": {"base_url": ""},
    # Language for Studio outputs, podcasts and videos when a request doesn't name one.
    "general": {"language": ""},
}

SECRET_FIELDS = {"api_key"}


def _merge(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict) and key != "connections":
            out[key] = _merge(out[key], value)
        else:
            out[key] = value
    return out


def load_raw() -> dict:
    """Settings with keys still encrypted."""
    return _merge(DEFAULTS, db.get_setting(KEY, {}))


def load() -> dict:
    """Settings with keys decrypted, for server-side use only."""
    raw = load_raw()
    for conn in raw["connections"].values():
        conn["api_key"] = decrypt(conn.get("api_key", ""))
    for section in ("embeddings", "voice", "stt"):
        raw[section]["api_key"] = decrypt(raw[section].get("api_key", ""))
    return raw


def public() -> dict:
    """Settings for the browser: keys replaced by a has_key flag."""
    raw = load_raw()
    for conn in raw["connections"].values():
        conn["has_key"] = bool(conn.pop("api_key", ""))
    for section in ("embeddings", "voice", "stt"):
        raw[section]["has_key"] = bool(raw[section].pop("api_key", ""))
    return raw


def _apply_secret(target: dict, incoming: dict) -> None:
    """api_key: None/missing keeps the stored key, "" clears it, anything else replaces it."""
    for field in SECRET_FIELDS:
        if field in incoming and incoming[field] is not None:
            target[field] = encrypt(incoming[field]) if incoming[field] else ""
    for key, value in incoming.items():
        if key not in SECRET_FIELDS and key != "has_key":
            target[key] = value


def save(update: dict) -> dict:
    raw = load_raw()
    if "connections" in update:
        conns: dict = {}
        for conn_id, incoming in update["connections"].items():
            target = copy.deepcopy(raw["connections"].get(conn_id, {"api_key": ""}))
            _apply_secret(target, incoming)
            conns[conn_id] = target
        raw["connections"] = conns
    for section in ("embeddings", "voice", "stt"):
        if section in update:
            _apply_secret(raw[section], update[section])
    if "roles" in update:
        raw["roles"] = _merge(raw["roles"], update["roles"])
    for section in ("video", "search", "general"):
        if section in update:
            raw[section] = _merge(raw[section], update[section])
    db.set_setting(KEY, raw)
    return public()


def role(name: str) -> tuple[dict, str]:
    """The connection (with decrypted key) and model to use for a task."""
    settings = load()
    chosen = settings["roles"].get(name) or {}
    conn = settings["connections"].get(chosen.get("connection", ""))
    if conn is None:
        # Fall back to the chat role, then to any saved connection.
        fallback = settings["roles"].get("chat") or {}
        conn = settings["connections"].get(fallback.get("connection", ""))
        chosen = fallback if conn else chosen
    if conn is None and settings["connections"]:
        conn = next(iter(settings["connections"].values()))
    if conn is None:
        raise LookupError("No language model is set up yet. Add one in Settings.")
    model = chosen.get("model") or conn.get("model", "")
    if not model:
        raise LookupError(f"Pick a model for '{name}' in Settings.")
    return conn, model


def output_language(options: dict) -> str:
    """The language a generated output should use: the request's, else the default from Settings."""
    return (options.get("language") or load_raw()["general"].get("language") or "").strip()
