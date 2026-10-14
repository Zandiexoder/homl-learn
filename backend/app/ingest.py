"""Turn uploads and links into text, chunks and (optionally) embeddings."""

from __future__ import annotations

import io
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
import numpy as np

from . import db, embeddings, llm, retrieval, settings_store, voice
from .config import get_config

AUDIO_EXT = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".webm", ".mp4", ".mkv", ".mov"}
TEXT_EXT = {".txt", ".md", ".markdown", ".csv", ".json", ".html", ".htm", ".srt", ".vtt"}
USER_AGENT = "Mozilla/5.0 (compatible; HomlLearn/0.1; +self-hosted)"


class IngestError(RuntimeError):
    pass


def source_dir(notebook_id: str, source_id: str) -> Path:
    path = get_config().files_dir / notebook_id / "sources" / source_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def kind_for_filename(name: str) -> str:
    ext = Path(name).suffix.lower()
    if ext == ".pdf":
        return "pdf"
    if ext == ".docx":
        return "docx"
    if ext in AUDIO_EXT:
        return "audio"
    if ext in TEXT_EXT:
        return "text"
    raise IngestError(f"Unsupported file type: {ext or name}")


def youtube_id(url: str) -> str | None:
    parsed = urlparse(url)
    host = parsed.netloc.lower().removeprefix("www.").removeprefix("m.")
    if host == "youtu.be":
        return parsed.path.strip("/").split("/")[0] or None
    if host in ("youtube.com", "music.youtube.com"):
        if parsed.path == "/watch":
            return (parse_qs(parsed.query).get("v") or [None])[0]
        match = re.match(r"^/(?:shorts|embed|live)/([\w-]{6,})", parsed.path)
        if match:
            return match.group(1)
    return None


def extract_pdf(data: bytes) -> tuple[str, list[tuple[int, str]]]:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    pages = []
    for i, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").strip()
        pages.append((i, text or "[image only page: no extractable text]"))
    if not any(t and not t.startswith("[image only") for _, t in pages):
        raise IngestError("This PDF has no extractable text (it may be scanned). Run OCR on it first.")
    return "\n\n".join(f"[Page {n}]\n{t}" for n, t in pages), pages


def extract_docx(data: bytes) -> str:
    import docx

    document = docx.Document(io.BytesIO(data))
    return "\n\n".join(p.text for p in document.paragraphs if p.text.strip())


async def fetch_web(url: str) -> tuple[str, str]:
    import trafilatura

    if urlparse(url).scheme not in ("http", "https"):
        raise IngestError("Only http and https links are supported.")
    async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers={"User-Agent": USER_AGENT}) as client:
        try:
            resp = await client.get(url)
        except httpx.HTTPError as exc:
            raise IngestError(f"Could not fetch the page: {exc}") from exc
    if resp.status_code >= 400:
        raise IngestError(f"The page returned {resp.status_code}.")
    ctype = resp.headers.get("content-type", "")
    if "pdf" in ctype:
        text, _ = extract_pdf(resp.content)
        return Path(urlparse(url).path).name or url, text
    html = resp.text
    text = trafilatura.extract(html, include_comments=False, include_tables=True, favor_recall=True) or ""
    meta = trafilatura.extract_metadata(html)
    title = (meta.title if meta and meta.title else None) or url
    if len(text.strip()) < 200:
        raise IngestError("Couldn't find readable text on that page (it may need JavaScript or a login).")
    return title, text


async def fetch_youtube(url: str, video_id: str) -> tuple[str, str]:
    from youtube_transcript_api import YouTubeTranscriptApi

    try:
        fetched = YouTubeTranscriptApi().fetch(video_id, languages=["en", "en-US", "en-GB", "es", "fr", "de"])
    except Exception as exc:  # noqa: BLE001 - library raises many specific errors
        raise IngestError(f"No transcript available for this video: {exc.__class__.__name__}") from exc
    lines = []
    for snippet in fetched:
        minutes, seconds = divmod(int(snippet.start), 60)
        lines.append(f"[{minutes:02d}:{seconds:02d}] {snippet.text}")
    title = f"YouTube {video_id}"
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.get("https://www.youtube.com/oembed", params={"url": url, "format": "json"})
            if resp.status_code == 200:
                title = resp.json().get("title", title)
        except httpx.HTTPError:
            pass
    return title, "\n".join(lines)


async def summarize_source(title: str, text: str) -> str | None:
    try:
        conn, model = settings_store.role("chat")
    except LookupError:
        return None
    prompt = (
        "Summarise this source in 2-3 sentences for someone deciding whether it is relevant. "
        "Then list 3-6 key topics as a comma-separated line starting with 'Topics:'.\n\n"
        f"<source title=\"{title}\">\n{text[:30000]}\n</source>"
    )
    try:
        return await llm.complete(conn, model, "", [{"role": "user", "content": prompt}], effort="low")
    except llm.LLMError:
        return None


async def process_source(source_id: str) -> None:
    src = db.fetch_one("SELECT * FROM sources WHERE id=?", (source_id,))
    if not src:
        return
    db.update("sources", source_id, {"status": "processing", "error": None})
    meta = src["meta"]
    pages: list[tuple[int, str]] | None = None
    title, text = src["title"], src["text"] or ""

    if src["kind"] in ("pdf", "docx", "audio", "file-text"):
        path = Path(meta["path"])
        data = path.read_bytes()
        if src["kind"] == "pdf":
            text, pages = extract_pdf(data)
        elif src["kind"] == "docx":
            text = extract_docx(data)
        elif src["kind"] == "file-text":
            text = data.decode("utf-8", errors="replace")
        else:
            result = await voice.transcribe(path, diarize=True, long_form=True)
            text = _format_transcript(result)
            meta["segments"] = len(result["segments"])
    elif src["kind"] == "web":
        title, text = await fetch_web(src["uri"])
    elif src["kind"] == "youtube":
        title, text = await fetch_youtube(src["uri"], meta["video_id"])

    text = text.strip()
    if not text:
        raise IngestError("No text found in this source.")
    chunks = retrieval.chunk_text(text, pages)
    vectors: np.ndarray | None = None
    if embeddings.enabled():
        try:
            vectors = await embeddings.embed([c["text"] for c in chunks])
        except embeddings.EmbeddingError as exc:
            meta["embedding_error"] = str(exc)
    with db.tx() as conn:
        conn.execute("DELETE FROM chunks WHERE source_id=?", (source_id,))
        conn.executemany(
            "INSERT INTO chunks (id, source_id, notebook_id, idx, text, page, embedding) VALUES (?,?,?,?,?,?,?)",
            [
                (db.new_id(), source_id, src["notebook_id"], i, c["text"], c["page"],
                 vectors[i].tobytes() if vectors is not None else None)
                for i, c in enumerate(chunks)
            ],
        )
    meta["chars"] = len(text)
    meta["chunks"] = len(chunks)
    db.update("sources", source_id, {"title": title[:300], "text": text, "meta": meta})
    summary = await summarize_source(title, text)
    db.update("sources", source_id, {"summary": summary, "status": "ready"})


def _format_transcript(result: dict) -> str:
    if not result["segments"]:
        return result["text"]
    lines = []
    for seg in result["segments"]:
        start = int(seg.get("start") or 0)
        speaker = f"{seg['speaker']}: " if seg.get("speaker") else ""
        lines.append(f"[{start // 60:02d}:{start % 60:02d}] {speaker}{seg['text']}")
    return "\n".join(lines)


async def reembed_all() -> int:
    """Recompute embeddings for every chunk, after the embedding model changes."""
    rows = db.fetch_all("SELECT id, text FROM chunks")
    if not embeddings.enabled():
        db.execute("UPDATE chunks SET embedding=NULL")
        return 0
    batch = 256
    for start in range(0, len(rows), batch):
        part = rows[start:start + batch]
        vectors = await embeddings.embed([r["text"] for r in part])
        if vectors is None:
            break
        with db.tx() as conn:
            conn.executemany("UPDATE chunks SET embedding=? WHERE id=?",
                             [(vectors[i].tobytes(), r["id"]) for i, r in enumerate(part)])
    return len(rows)


async def discover(query: str) -> list[dict]:
    """Web search through a SearXNG instance, if one is configured."""
    base = settings_store.load()["search"].get("base_url", "").rstrip("/")
    if not base:
        raise IngestError("Set a SearXNG URL in Settings to search the web for sources.")
    async with httpx.AsyncClient(timeout=20, headers={"User-Agent": USER_AGENT}) as client:
        resp = await client.get(f"{base}/search", params={"q": query, "format": "json"})
    if resp.status_code >= 400:
        raise IngestError(f"Search returned {resp.status_code}. Is JSON output enabled in SearXNG?")
    return [
        {"title": r.get("title", r["url"]), "url": r["url"], "snippet": r.get("content", "")}
        for r in resp.json().get("results", [])[:10]
        if r.get("url")
    ]
