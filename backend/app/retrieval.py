"""Chunking and hybrid retrieval (BM25 + optional embeddings, fused by reciprocal rank)."""

from __future__ import annotations

import math
import re
from collections import Counter

import numpy as np

from . import db, embeddings

CHUNK_CHARS = 1200
OVERLAP_CHARS = 200
TOKEN_RE = re.compile(r"[\w']+", re.UNICODE)
STOPWORDS = set(
    "a an the and or but if of to in on at by for with from as is are was were be been being it its "
    "this that these those what which who whom how why when where do does did not no can could would "
    "should will shall may might must i you he she we they me him her us them my your our their".split()
)


def tokenize(text: str) -> list[str]:
    return [t for t in TOKEN_RE.findall(text.lower()) if t not in STOPWORDS]


def chunk_text(text: str, pages: list[tuple[int, str]] | None = None) -> list[dict]:
    """Split into ~CHUNK_CHARS pieces on paragraph/sentence boundaries, keeping page numbers."""
    units: list[tuple[int | None, str]] = []
    if pages:
        for page_no, page_text in pages:
            units.extend((page_no, p) for p in re.split(r"\n\s*\n", page_text) if p.strip())
    else:
        units.extend((None, p) for p in re.split(r"\n\s*\n", text) if p.strip())

    chunks: list[dict] = []
    current, current_page, has_new = "", None, False

    def flush() -> None:
        nonlocal current, has_new
        if has_new and current.strip():
            chunks.append({"text": current.strip(), "page": current_page})
        # The next chunk starts with the tail of this one so ideas aren't cut in half.
        current = current[-OVERLAP_CHARS:] if len(current) > OVERLAP_CHARS else ""
        has_new = False

    for page_no, para in units:
        para = re.sub(r"[ \t]+", " ", para.strip())
        # Very long paragraphs are cut at sentence ends, then hard-cut if still too long.
        pieces = [para] if len(para) <= CHUNK_CHARS else re.split(r"(?<=[.!?])\s+", para)
        for piece in pieces:
            while piece:
                part, piece = piece[:CHUNK_CHARS - OVERLAP_CHARS], piece[CHUNK_CHARS - OVERLAP_CHARS:]
                if has_new and len(current) + len(part) + 2 > CHUNK_CHARS:
                    flush()
                if not has_new:
                    current_page = page_no
                current += ("\n\n" if current else "") + part
                has_new = True
    flush()
    return chunks


def bm25_scores(query: list[str], docs: list[list[str]], k1: float = 1.5, b: float = 0.75) -> list[float]:
    if not docs:
        return []
    n = len(docs)
    avg = sum(len(d) for d in docs) / n or 1
    df: Counter[str] = Counter()
    for d in docs:
        df.update(set(d))
    scores = []
    for d in docs:
        tf = Counter(d)
        score = 0.0
        for term in query:
            if term not in tf:
                continue
            idf = math.log(1 + (n - df[term] + 0.5) / (df[term] + 0.5))
            score += idf * tf[term] * (k1 + 1) / (tf[term] + k1 * (1 - b + b * len(d) / avg))
        scores.append(score)
    return scores


def _ranks(scores: list[float] | np.ndarray) -> dict[int, int]:
    order = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
    return {idx: rank for rank, idx in enumerate(order) if scores[idx] > 0}


async def search(notebook_id: str, query: str, source_ids: list[str] | None = None, k: int = 8) -> list[dict]:
    """Top-k chunks for the query among the given sources (default: the selected ones)."""
    with db.tx() as conn:
        if source_ids is None:
            rows = conn.execute(
                "SELECT c.id, c.source_id, c.idx, c.text, c.page, c.embedding, s.title AS source_title "
                "FROM chunks c JOIN sources s ON s.id = c.source_id "
                "WHERE c.notebook_id=? AND s.selected=1 AND s.status='ready'",
                (notebook_id,),
            ).fetchall()
        else:
            if not source_ids:
                return []
            marks = ",".join("?" * len(source_ids))
            rows = conn.execute(
                "SELECT c.id, c.source_id, c.idx, c.text, c.page, c.embedding, s.title AS source_title "
                f"FROM chunks c JOIN sources s ON s.id = c.source_id WHERE c.source_id IN ({marks})",
                tuple(source_ids),
            ).fetchall()
    if not rows:
        return []
    texts = [r["text"] for r in rows]
    fused: dict[int, float] = {}
    for idx, rank in _ranks(bm25_scores(tokenize(query), [tokenize(t) for t in texts])).items():
        fused[idx] = fused.get(idx, 0) + 1 / (60 + rank)

    stored = [r["embedding"] for r in rows]
    if embeddings.enabled() and all(stored):
        qvec = await embeddings.embed([query])
        if qvec is not None:
            matrix = np.vstack([np.frombuffer(e, dtype=np.float32) for e in stored])
            if matrix.shape[1] == qvec.shape[1]:
                sims = matrix @ qvec[0]
                for idx, rank in _ranks(sims).items():
                    fused[idx] = fused.get(idx, 0) + 1 / (60 + rank)

    if not fused:
        # No lexical overlap and no vectors: fall back to the start of each source.
        fused = {i: 1.0 / (1 + rows[i]["idx"]) for i in range(len(rows))}
    best = sorted(fused, key=fused.get, reverse=True)[:k]  # type: ignore[arg-type]
    return [
        {
            "chunk_id": rows[i]["id"],
            "source_id": rows[i]["source_id"],
            "source_title": rows[i]["source_title"],
            "text": rows[i]["text"],
            "page": rows[i]["page"],
            "score": round(fused[i], 5),
        }
        for i in best
    ]


DEFAULT_CONTEXT_TOKENS = 100_000


def budget_for(conn: dict, share: float = 0.6) -> int:
    """Characters of source text that fit in a connection's context window, leaving room for the reply."""
    tokens = int(conn.get("context_tokens") or DEFAULT_CONTEXT_TOKENS)
    return max(8_000, int(tokens * share * 3.5))


def gather_sources(notebook_id: str, source_ids: list[str] | None = None, budget_chars: int = 400_000) -> list[dict]:
    """Full text of the selected sources, each trimmed to a fair share of the budget."""
    if source_ids:
        marks = ",".join("?" * len(source_ids))
        sources = db.fetch_all(
            f"SELECT id, title, kind, text FROM sources WHERE notebook_id=? AND id IN ({marks}) "
            "AND status='ready' ORDER BY created_at", (notebook_id, *source_ids))
    else:
        sources = db.fetch_all(
            "SELECT id, title, kind, text FROM sources WHERE notebook_id=? AND selected=1 "
            "AND status='ready' ORDER BY created_at", (notebook_id,))
    if not sources:
        return []
    remaining, out = budget_chars, []
    for pos, src in enumerate(sources):
        share = remaining // (len(sources) - pos)
        text = src["text"] or ""
        if len(text) > share:
            text = text[:share] + "\n[... source truncated to fit the model's context ...]"
        remaining -= len(text)
        out.append({**src, "text": text})
    return out


def format_sources(sources: list[dict]) -> str:
    return "\n\n".join(
        f'<source id="{i + 1}" title="{s["title"]}">\n{s["text"]}\n</source>' for i, s in enumerate(sources)
    )
