"""Grounded chat with numbered citations, plus the notebook overview (summary + suggested questions)."""

from __future__ import annotations

import json
import re
from typing import AsyncIterator

from . import db, jsonutil, llm, retrieval, settings_store

CITE_RE = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")
HISTORY_TURNS = 10

SYSTEM = """You are a research assistant inside a notebook. Answer using only the numbered source \
excerpts provided with each question.

- After every claim drawn from an excerpt, cite it with its number in square brackets, like [2] or [1, 3].
- If the excerpts do not contain the answer, say so plainly and suggest what source might help. \
Do not fill gaps from general knowledge unless the user asks you to, and then label it as outside the sources.
- Be direct. Use short paragraphs, and lists or tables only when they make the answer clearer.
- Write in the language of the question."""


def build_user_turn(question: str, excerpts: list[dict]) -> str:
    blocks = []
    for i, ex in enumerate(excerpts, start=1):
        where = f", page {ex['page']}" if ex.get("page") else ""
        blocks.append(f'<excerpt n="{i}" source="{ex["source_title"]}{where}">\n{ex["text"]}\n</excerpt>')
    return "Source excerpts:\n" + "\n\n".join(blocks) + f"\n\nQuestion: {question}"


def used_citations(answer: str, count: int) -> set[int]:
    used: set[int] = set()
    for match in CITE_RE.finditer(answer):
        used.update(int(n) for n in match.group(1).split(",") if 0 < int(n) <= count)
    return used


async def answer(notebook_id: str, question: str) -> AsyncIterator[dict]:
    """Yields events: citations, delta (text), done (saved message) or error."""
    conn, model = settings_store.role("chat")
    excerpts = await retrieval.search(notebook_id, question, k=8)
    citations = [
        {"n": i, "source_id": ex["source_id"], "source_title": ex["source_title"],
         "chunk_id": ex["chunk_id"], "page": ex["page"], "text": ex["text"]}
        for i, ex in enumerate(excerpts, start=1)
    ]
    yield {"type": "citations", "citations": citations}

    history = db.fetch_all(
        "SELECT role, content FROM messages WHERE notebook_id=? ORDER BY created_at DESC LIMIT ?",
        (notebook_id, HISTORY_TURNS),
    )[::-1]
    messages: list[dict] = []
    for m in history:
        # A failed answer leaves two user turns in a row; merge them so every API accepts the history.
        if messages and messages[-1]["role"] == m["role"]:
            messages[-1]["content"] += "\n\n" + m["content"]
        else:
            messages.append({"role": m["role"], "content": m["content"]})
    if messages and messages[-1]["role"] == "user":
        messages.pop()
    if not excerpts:
        messages.append({"role": "user", "content": f"(No sources are selected or ready.)\n\nQuestion: {question}"})
    else:
        messages.append({"role": "user", "content": build_user_turn(question, excerpts)})

    db.insert("messages", {"id": db.new_id(), "notebook_id": notebook_id, "role": "user",
                           "content": question, "citations": [], "created_at": db.now()})
    parts: list[str] = []
    try:
        async for piece in llm.stream_chat(conn, model, SYSTEM, messages, effort="low"):
            parts.append(piece)
            yield {"type": "delta", "text": piece}
    except llm.LLMError as exc:
        yield {"type": "error", "message": str(exc)}
        return
    text = "".join(parts).strip()
    used = used_citations(text, len(citations))
    for c in citations:
        c["used"] = c["n"] in used
    message = {"id": db.new_id(), "notebook_id": notebook_id, "role": "assistant", "content": text,
               "citations": citations, "created_at": db.now()}
    db.insert("messages", message)
    yield {"type": "done", "message": message}


OVERVIEW_PROMPT = """Read these sources and reply with JSON only:
{"title": "a short notebook title (max 6 words)",
 "summary": "3-4 sentences on what the sources cover together",
 "questions": ["three specific questions a learner might ask about these sources"]}

"""


async def refresh_overview(notebook_id: str) -> None:
    conn, model = settings_store.role("chat")
    sources = retrieval.gather_sources(notebook_id, budget_chars=min(60_000, retrieval.budget_for(conn)))
    if not sources:
        db.update("notebooks", notebook_id, {"summary": None, "questions": []})
        return
    raw = await llm.complete(conn, model, "", [{"role": "user", "content": OVERVIEW_PROMPT +
                                                retrieval.format_sources(sources)}],
                             json_mode=True, effort="low")
    data = jsonutil.extract_json(raw)
    values: dict = {"summary": str(data.get("summary", ""))[:2000],
                    "questions": [str(q) for q in data.get("questions", [])][:3]}
    notebook = db.fetch_one("SELECT title FROM notebooks WHERE id=?", (notebook_id,))
    if notebook and notebook["title"] == "Untitled notebook" and data.get("title"):
        values["title"] = str(data["title"])[:120]
    db.update("notebooks", notebook_id, values)


def to_json_line(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"
