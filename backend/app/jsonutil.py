"""Pull a JSON value out of model output that may include prose or code fences."""

from __future__ import annotations

import json
import re
from typing import Any

FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)


class JSONExtractError(ValueError):
    pass


def _balanced(text: str, start: int) -> str | None:
    opener = text[start]
    closer = "}" if opener == "{" else "]"
    depth, in_str, escape = 0, False, False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch in "{[":
            depth += 1
        elif ch in "}]":
            depth -= 1
            if depth == 0:
                return text[start:i + 1] if ch == closer else None
    return None


def extract_json(text: str) -> Any:
    candidates = [m.group(1) for m in FENCE_RE.finditer(text)] + [text]
    for candidate in candidates:
        candidate = candidate.strip()
        try:
            return json.loads(candidate)
        except ValueError:
            pass
        for i, ch in enumerate(candidate):
            if ch in "{[":
                chunk = _balanced(candidate, i)
                if chunk:
                    try:
                        return json.loads(chunk)
                    except ValueError:
                        continue
    raise JSONExtractError("The model did not return valid JSON.")
