"""Optional dense embeddings. With the built-in "keyword" option, retrieval uses BM25 only."""

from __future__ import annotations

import httpx
import numpy as np

from . import settings_store

BATCH = 64


class EmbeddingError(RuntimeError):
    pass


def config() -> dict:
    return settings_store.load()["embeddings"]


def enabled(cfg: dict | None = None) -> bool:
    cfg = cfg or config()
    return cfg.get("kind") == "openai" and bool(cfg.get("base_url")) and bool(cfg.get("model"))


async def embed(texts: list[str], cfg: dict | None = None) -> np.ndarray | None:
    """Unit-normalised float32 vectors, or None when embeddings are off."""
    cfg = cfg or config()
    if not enabled(cfg) or not texts:
        return None
    headers = {"Content-Type": "application/json"}
    if cfg.get("api_key"):
        headers["Authorization"] = f"Bearer {cfg['api_key']}"
    url = cfg["base_url"].rstrip("/") + "/embeddings"
    vectors: list[list[float]] = []
    async with httpx.AsyncClient(timeout=120) as client:
        for start in range(0, len(texts), BATCH):
            batch = texts[start:start + BATCH]
            resp = await client.post(url, headers=headers, json={"model": cfg["model"], "input": batch})
            if resp.status_code >= 400:
                raise EmbeddingError(f"Embeddings failed ({resp.status_code}): {resp.text[:300]}")
            data = sorted(resp.json()["data"], key=lambda d: d.get("index", 0))
            vectors.extend(d["embedding"] for d in data)
    arr = np.asarray(vectors, dtype=np.float32)
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    return arr / np.maximum(norms, 1e-8)
