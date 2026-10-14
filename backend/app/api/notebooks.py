"""Notebooks, sources, chat, notes and studio artifacts."""

from __future__ import annotations

import logging
import secrets
import shutil
from typing import Literal
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel

from .. import chat, db, exporters, ingest, jobs, podcast, research, security, studio, voice
from ..config import get_config
from ..video import pipeline as video

router = APIRouter(prefix="/api", dependencies=[Depends(security.require_session)])
log = logging.getLogger("homl.api")

MAX_UPLOAD = 500 * 1024 * 1024
ARTIFACT_KINDS = set(studio.KINDS) | {"audio", "video", "research"}


def notebook_or_404(notebook_id: str) -> dict:
    nb = db.fetch_one("SELECT * FROM notebooks WHERE id=?", (notebook_id,))
    if not nb:
        raise HTTPException(404, "Notebook not found.")
    return nb


def source_or_404(source_id: str) -> dict:
    src = db.fetch_one("SELECT * FROM sources WHERE id=?", (source_id,))
    if not src:
        raise HTTPException(404, "Source not found.")
    return src


def artifact_or_404(artifact_id: str) -> dict:
    art = db.fetch_one("SELECT * FROM artifacts WHERE id=?", (artifact_id,))
    if not art:
        raise HTTPException(404, "Not found.")
    return art


def touch(notebook_id: str) -> None:
    db.execute("UPDATE notebooks SET updated_at=? WHERE id=?", (db.now(), notebook_id))


# ------------------------------------------------------------------ notebooks

class NotebookIn(BaseModel):
    title: str = "Untitled notebook"


class ChatConfig(BaseModel):
    style: Literal["default", "guide", "analyst", "custom"] = "default"
    length: Literal["shorter", "default", "longer"] = "default"
    custom: str = ""


class NotebookPatch(BaseModel):
    title: str | None = None
    chat_config: ChatConfig | None = None


@router.get("/notebooks")
def list_notebooks() -> list[dict]:
    return db.fetch_all(
        "SELECT n.id, n.title, n.created_at, n.updated_at, "
        "(SELECT COUNT(*) FROM sources s WHERE s.notebook_id=n.id) AS source_count, "
        "(SELECT COUNT(*) FROM artifacts a WHERE a.notebook_id=n.id AND a.kind='audio') AS audio_count, "
        "(SELECT COUNT(*) FROM artifacts a WHERE a.notebook_id=n.id AND a.kind='video') AS video_count, "
        "(SELECT COUNT(*) FROM artifacts a WHERE a.notebook_id=n.id AND a.kind NOT IN ('audio','video')) AS studio_count "
        "FROM notebooks n ORDER BY n.updated_at DESC"
    )


@router.post("/notebooks")
def create_notebook(body: NotebookIn) -> dict:
    nb = {"id": db.new_id(), "title": body.title.strip() or "Untitled notebook", "questions": [],
          "created_at": db.now(), "updated_at": db.now()}
    db.insert("notebooks", nb)
    return notebook_or_404(nb["id"])


@router.get("/notebooks/{notebook_id}")
def get_notebook(notebook_id: str) -> dict:
    return notebook_or_404(notebook_id)


@router.patch("/notebooks/{notebook_id}")
def rename_notebook(notebook_id: str, body: NotebookPatch) -> dict:
    notebook_or_404(notebook_id)
    values: dict = {"updated_at": db.now()}
    if body.title is not None:
        values["title"] = body.title.strip()[:200] or "Untitled notebook"
    if body.chat_config is not None:
        values["chat_config"] = body.chat_config.model_dump()
    db.update("notebooks", notebook_id, values)
    return notebook_or_404(notebook_id)


@router.delete("/notebooks/{notebook_id}")
def delete_notebook(notebook_id: str) -> dict:
    notebook_or_404(notebook_id)
    db.execute("DELETE FROM notebooks WHERE id=?", (notebook_id,))
    shutil.rmtree(get_config().files_dir / notebook_id, ignore_errors=True)
    return {"ok": True}


# ------------------------------------------------------------------ sources

def _start_processing(source_id: str, notebook_id: str) -> None:
    db.update("notebooks", notebook_id, {"overview_pending": 1})

    async def work() -> None:
        try:
            await ingest.process_source(source_id)
            await chat.refresh_overview(notebook_id)
        except ingest.IngestError:
            raise
        except LookupError as exc:  # no model configured yet: the source is still usable for search
            log.warning("notebook overview skipped: %s", exc)
        finally:
            db.update("notebooks", notebook_id, {"overview_pending": 0})

    def fail(err: str) -> None:
        if db.fetch_one("SELECT status FROM sources WHERE id=?", (source_id,))["status"] != "ready":
            db.update("sources", source_id, {"status": "failed", "error": err})
        else:
            log.warning("notebook overview failed: %s", err)

    jobs.spawn("ingest", work, fail)


def _new_source(notebook_id: str, kind: str, title: str, uri: str | None = None, text: str | None = None,
                meta: dict | None = None) -> dict:
    src = {"id": db.new_id(), "notebook_id": notebook_id, "kind": kind, "title": title[:300], "uri": uri,
           "status": "queued", "text": text, "selected": 1, "meta": meta or {}, "created_at": db.now()}
    db.insert("sources", src)
    touch(notebook_id)
    return src


def public_source(src: dict) -> dict:
    return {k: v for k, v in src.items() if k != "text"}


@router.get("/notebooks/{notebook_id}/sources")
def list_sources(notebook_id: str) -> list[dict]:
    return db.fetch_all(
        "SELECT id, notebook_id, kind, title, uri, status, error, summary, selected, meta, created_at "
        "FROM sources WHERE notebook_id=? ORDER BY created_at", (notebook_id,))


@router.post("/notebooks/{notebook_id}/sources/upload")
async def upload_sources(notebook_id: str, files: list[UploadFile] = File(...)) -> list[dict]:
    notebook_or_404(notebook_id)
    created = []
    for upload in files:
        name = Path(upload.filename or "upload").name
        try:
            kind = ingest.kind_for_filename(name)
        except ingest.IngestError as exc:
            raise HTTPException(400, str(exc)) from exc
        src = _new_source(notebook_id, "file-text" if kind == "text" else kind, name)
        dest = ingest.source_dir(notebook_id, src["id"]) / name
        size = 0
        with dest.open("wb") as fh:
            while chunk := await upload.read(1 << 20):
                size += len(chunk)
                if size > MAX_UPLOAD:
                    raise HTTPException(413, f"{name} is larger than 500 MB.")
                fh.write(chunk)
        db.update("sources", src["id"], {"meta": {"path": str(dest), "size": size}})
        _start_processing(src["id"], notebook_id)
        created.append(public_source(source_or_404(src["id"])))
    return created


class LinkIn(BaseModel):
    url: str


@router.post("/notebooks/{notebook_id}/sources/link")
def add_link(notebook_id: str, body: LinkIn) -> dict:
    notebook_or_404(notebook_id)
    url = body.url.strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    vid = ingest.youtube_id(url)
    if vid:
        src = _new_source(notebook_id, "youtube", f"YouTube {vid}", uri=url, meta={"video_id": vid})
    else:
        src = _new_source(notebook_id, "web", url, uri=url)
    _start_processing(src["id"], notebook_id)
    return public_source(src)


class TextIn(BaseModel):
    title: str = "Pasted text"
    text: str


@router.post("/notebooks/{notebook_id}/sources/text")
def add_text(notebook_id: str, body: TextIn) -> dict:
    notebook_or_404(notebook_id)
    if not body.text.strip():
        raise HTTPException(400, "The text is empty.")
    src = _new_source(notebook_id, "text", body.title.strip() or "Pasted text", text=body.text)
    _start_processing(src["id"], notebook_id)
    return public_source(src)


@router.get("/discover")
async def discover(q: str) -> list[dict]:
    try:
        return await ingest.discover(q)
    except ingest.IngestError as exc:
        raise HTTPException(400, str(exc)) from exc


class SourcePatch(BaseModel):
    title: str | None = None
    selected: bool | None = None


@router.get("/sources/{source_id}")
def get_source(source_id: str) -> dict:
    return source_or_404(source_id)


@router.patch("/sources/{source_id}")
def patch_source(source_id: str, body: SourcePatch) -> dict:
    source_or_404(source_id)
    values: dict = {}
    if body.title is not None:
        values["title"] = body.title.strip()[:300]
    if body.selected is not None:
        values["selected"] = int(body.selected)
    db.update("sources", source_id, values)
    return public_source(source_or_404(source_id))


class SelectAllIn(BaseModel):
    selected: bool


@router.post("/notebooks/{notebook_id}/sources/select")
def select_all(notebook_id: str, body: SelectAllIn) -> dict:
    db.execute("UPDATE sources SET selected=? WHERE notebook_id=?", (int(body.selected), notebook_id))
    return {"ok": True}


@router.post("/sources/{source_id}/retry")
def retry_source(source_id: str) -> dict:
    src = source_or_404(source_id)
    db.update("sources", source_id, {"status": "queued", "error": None})
    _start_processing(source_id, src["notebook_id"])
    return {"ok": True}


@router.delete("/sources/{source_id}")
def delete_source(source_id: str) -> dict:
    src = source_or_404(source_id)
    db.execute("DELETE FROM sources WHERE id=?", (source_id,))
    shutil.rmtree(get_config().files_dir / src["notebook_id"] / "sources" / source_id, ignore_errors=True)
    return {"ok": True}


# ------------------------------------------------------------------ chat

class ChatIn(BaseModel):
    message: str


@router.get("/notebooks/{notebook_id}/messages")
def list_messages(notebook_id: str) -> list[dict]:
    return db.fetch_all("SELECT * FROM messages WHERE notebook_id=? ORDER BY created_at", (notebook_id,))


@router.delete("/notebooks/{notebook_id}/messages")
def clear_messages(notebook_id: str) -> dict:
    db.execute("DELETE FROM messages WHERE notebook_id=?", (notebook_id,))
    return {"ok": True}


@router.post("/notebooks/{notebook_id}/chat")
async def send_chat(notebook_id: str, body: ChatIn) -> StreamingResponse:
    notebook_or_404(notebook_id)
    if not body.message.strip():
        raise HTTPException(400, "Ask a question first.")

    async def events():
        try:
            async for event in chat.answer(notebook_id, body.message.strip()):
                yield chat.to_json_line(event)
        except LookupError as exc:
            yield chat.to_json_line({"type": "error", "message": str(exc)})
        touch(notebook_id)

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@router.post("/notebooks/{notebook_id}/overview")
async def refresh_overview(notebook_id: str) -> dict:
    notebook_or_404(notebook_id)
    try:
        await chat.refresh_overview(notebook_id)
    except (LookupError, ValueError, RuntimeError) as exc:
        raise HTTPException(400, str(exc)) from exc
    return notebook_or_404(notebook_id)


# ------------------------------------------------------------------ notes

class NoteIn(BaseModel):
    title: str = "Untitled note"
    content: str = ""


@router.get("/notebooks/{notebook_id}/notes")
def list_notes(notebook_id: str) -> list[dict]:
    return db.fetch_all("SELECT * FROM notes WHERE notebook_id=? ORDER BY updated_at DESC", (notebook_id,))


@router.post("/notebooks/{notebook_id}/notes")
def create_note(notebook_id: str, body: NoteIn) -> dict:
    notebook_or_404(notebook_id)
    note = {"id": db.new_id(), "notebook_id": notebook_id, "title": body.title[:200], "content": body.content,
            "created_at": db.now(), "updated_at": db.now()}
    db.insert("notes", note)
    return note


@router.put("/notes/{note_id}")
def update_note(note_id: str, body: NoteIn) -> dict:
    db.update("notes", note_id, {"title": body.title[:200], "content": body.content, "updated_at": db.now()})
    note = db.fetch_one("SELECT * FROM notes WHERE id=?", (note_id,))
    if not note:
        raise HTTPException(404, "Note not found.")
    return note


@router.delete("/notes/{note_id}")
def delete_note(note_id: str) -> dict:
    db.execute("DELETE FROM notes WHERE id=?", (note_id,))
    return {"ok": True}


# ------------------------------------------------------------------ studio artifacts

class ArtifactIn(BaseModel):
    kind: str
    title: str | None = None
    options: dict = {}


def _run_artifact(artifact_id: str, kind: str, start_at: str = "script") -> None:
    def fail(err: str) -> None:
        db.update("artifacts", artifact_id, {"status": "failed", "error": err, "updated_at": db.now()})

    if kind == "audio":
        jobs.spawn("audio", lambda: podcast.generate(artifact_id), fail)
    elif kind == "video":
        jobs.spawn("video", lambda: video.generate(artifact_id, start_at), fail)
    elif kind == "research":
        jobs.spawn("studio", lambda: research.generate(artifact_id), fail)
    else:
        jobs.spawn("studio", lambda: studio.generate(artifact_id), fail)


@router.get("/notebooks/{notebook_id}/artifacts")
def list_artifacts(notebook_id: str) -> list[dict]:
    return db.fetch_all("SELECT * FROM artifacts WHERE notebook_id=? ORDER BY created_at DESC", (notebook_id,))


@router.post("/notebooks/{notebook_id}/artifacts")
def create_artifact(notebook_id: str, body: ArtifactIn) -> dict:
    notebook_or_404(notebook_id)
    if body.kind not in ARTIFACT_KINDS:
        raise HTTPException(400, f"Unknown output type: {body.kind}")
    default = {"audio": "Audio overview", "video": "Video overview", "research": "Research"}.get(body.kind) \
        or studio.default_title(body.kind)
    art = {"id": db.new_id(), "notebook_id": notebook_id, "kind": body.kind, "title": body.title or default,
           "status": "queued", "progress": {}, "options": body.options, "data": {}, "error": None,
           "created_at": db.now(), "updated_at": db.now()}
    db.insert("artifacts", art)
    touch(notebook_id)
    _run_artifact(art["id"], body.kind)
    return artifact_or_404(art["id"])


@router.get("/artifacts/{artifact_id}")
def get_artifact(artifact_id: str) -> dict:
    return artifact_or_404(artifact_id)


@router.delete("/artifacts/{artifact_id}")
def delete_artifact(artifact_id: str) -> dict:
    art = artifact_or_404(artifact_id)
    db.execute("DELETE FROM artifacts WHERE id=?", (artifact_id,))
    shutil.rmtree(get_config().files_dir / art["notebook_id"] / "artifacts" / artifact_id, ignore_errors=True)
    return {"ok": True}


@router.post("/artifacts/{artifact_id}/to-note")
def artifact_to_note(artifact_id: str) -> dict:
    art = artifact_or_404(artifact_id)
    if "markdown" not in art["data"]:
        raise HTTPException(400, "Only text outputs can be saved as notes.")
    return create_note(art["notebook_id"], NoteIn(title=art["title"], content=art["data"]["markdown"]))


@router.post("/artifacts/{artifact_id}/interject")
async def interject(artifact_id: str, position: float = Form(0), text: str = Form(""),
                    audio: UploadFile | None = File(None)) -> dict:
    """Interactive mode: the listener asks a question by voice or text."""
    artifact_or_404(artifact_id)
    question = text.strip()
    if audio is not None:
        suffix = Path(audio.filename or "q.webm").suffix or ".webm"
        with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
            tmp.write(await audio.read())
            tmp.flush()
            try:
                question = (await voice.transcribe(Path(tmp.name)))["text"].strip()
            except voice.VoiceError as exc:
                raise HTTPException(400, str(exc)) from exc
    if not question:
        raise HTTPException(400, "We didn't catch a question. Try again.")
    try:
        return await podcast.interject(artifact_id, question, position)
    except (ValueError, LookupError, voice.VoiceError) as exc:
        raise HTTPException(400, str(exc)) from exc


class ScenePatch(BaseModel):
    lines: list[str] | None = None
    props: dict | None = None
    title: str | None = None


@router.patch("/artifacts/{artifact_id}/video/scenes/{index}")
def edit_scene(artifact_id: str, index: int, body: ScenePatch) -> dict:
    art = artifact_or_404(artifact_id)
    spec = art["data"].get("spec")
    if not spec or not 0 <= index < len(spec["scenes"]):
        raise HTTPException(404, "Scene not found.")
    scene = spec["scenes"][index]
    if body.lines is not None:
        lines = [ln.strip() for ln in body.lines if ln.strip()]
        if not lines:
            raise HTTPException(400, "A scene needs at least one line.")
        scene["lines"] = lines
    if body.props is not None:
        scene["props"] = body.props
    if body.title is not None:
        scene["title"] = body.title
    db.update("artifacts", artifact_id, {"data": {**art["data"], "spec": spec}, "updated_at": db.now()})
    return scene


class RedrawIn(BaseModel):
    instruction: str = ""


@router.post("/artifacts/{artifact_id}/video/scenes/{index}/redraw")
async def redraw(artifact_id: str, index: int, body: RedrawIn) -> dict:
    art = artifact_or_404(artifact_id)
    if art["status"] in ("queued", "running"):
        raise HTTPException(409, "Wait for the current run to finish.")
    try:
        return await video.redraw_scene(artifact_id, index, body.instruction)
    except (ValueError, LookupError, RuntimeError) as exc:
        raise HTTPException(400, str(exc)) from exc


class RerunIn(BaseModel):
    start_at: str = "narration"


@router.post("/artifacts/{artifact_id}/rerun")
def rerun(artifact_id: str, body: RerunIn) -> dict:
    art = artifact_or_404(artifact_id)
    if art["status"] in ("queued", "running"):
        raise HTTPException(409, "Already running.")
    start = body.start_at if art["kind"] == "video" and art["data"].get("spec") else "script"
    db.update("artifacts", artifact_id, {"status": "queued", "error": None, "updated_at": db.now()})
    _run_artifact(artifact_id, art["kind"], start)
    return artifact_or_404(artifact_id)


# ------------------------------------------------------------------ export and share

def _download(content: bytes, filename: str, media_type: str) -> Response:
    from urllib.parse import quote

    return Response(content, media_type=media_type,
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"})


@router.get("/artifacts/{artifact_id}/export/pptx")
def export_pptx(artifact_id: str) -> Response:
    art = artifact_or_404(artifact_id)
    if art["kind"] != "slides" or art["status"] != "done":
        raise HTTPException(400, "Only finished slide decks can be downloaded as PowerPoint.")
    return _download(exporters.build_pptx(art["data"]), f"{exporters.safe_name(art['title'], 'slides')}.pptx",
                     "application/vnd.openxmlformats-officedocument.presentationml.presentation")


@router.get("/notebooks/{notebook_id}/export")
def export_notebook(notebook_id: str) -> Response:
    notebook_or_404(notebook_id)
    name, content = exporters.notebook_zip(notebook_id)
    return _download(content, name, "application/zip")


@router.get("/artifacts/{artifact_id}/share")
def get_share(artifact_id: str) -> dict:
    artifact_or_404(artifact_id)
    row = db.fetch_one("SELECT token FROM shares WHERE artifact_id=?", (artifact_id,))
    return {"token": row["token"] if row else None}


@router.post("/artifacts/{artifact_id}/share")
def create_share(artifact_id: str) -> dict:
    art = artifact_or_404(artifact_id)
    if art["status"] != "done":
        raise HTTPException(400, "Wait until it's finished before sharing.")
    row = db.fetch_one("SELECT token FROM shares WHERE artifact_id=?", (artifact_id,))
    if row:
        return {"token": row["token"]}
    token = secrets.token_urlsafe(18)
    db.insert("shares", {"token": token, "artifact_id": artifact_id, "created_at": db.now()})
    return {"token": token}


@router.delete("/artifacts/{artifact_id}/share")
def delete_share(artifact_id: str) -> dict:
    db.execute("DELETE FROM shares WHERE artifact_id=?", (artifact_id,))
    return {"ok": True}


# ------------------------------------------------------------------ files

@router.get("/files/{path:path}")
def get_file(path: str) -> FileResponse:
    root = get_config().files_dir.resolve()
    target = (root / path).resolve()
    if root not in target.parents or not target.is_file():
        raise HTTPException(404, "File not found.")
    return FileResponse(target)
