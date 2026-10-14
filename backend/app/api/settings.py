"""Provider settings, model listing, voice catalogue, cloning and health."""

from __future__ import annotations

import tempfile
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .. import embeddings, ingest, jobs, llm, presets, security, settings_store, voice
from ..config import get_config

router = APIRouter(prefix="/api", dependencies=[Depends(security.require_session)])


@router.get("/settings")
def get_settings() -> dict:
    return {"settings": settings_store.public(), "presets": presets.all_presets()}


@router.put("/settings")
def put_settings(body: dict) -> dict:
    before = settings_store.load()["embeddings"]
    saved = settings_store.save(body)
    after = settings_store.load()["embeddings"]
    if (before.get("base_url"), before.get("model"), before.get("kind")) != (
        after.get("base_url"), after.get("model"), after.get("kind")
    ):
        # Vectors from another model can't be compared; rebuild them in the background.
        jobs.spawn("ingest", ingest.reembed_all, lambda err: None)
    return {"settings": saved, "presets": presets.all_presets()}


class ConnectionIn(BaseModel):
    connection_id: str | None = None
    kind: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    name: str | None = None


def _resolve_connection(body: ConnectionIn) -> dict:
    """A saved connection, overlaid with unsaved edits from the form."""
    stored = settings_store.load()["connections"].get(body.connection_id or "", {})
    conn = dict(stored)
    for field in ("kind", "base_url", "name"):
        if getattr(body, field):
            conn[field] = getattr(body, field)
    if body.api_key:
        conn["api_key"] = body.api_key
    if not conn.get("base_url") and conn.get("kind") != "anthropic":
        raise HTTPException(400, "Enter the provider's base URL.")
    return conn


@router.post("/llm/models")
async def llm_models(body: ConnectionIn) -> dict:
    try:
        return {"models": await llm.list_models(_resolve_connection(body))}
    except llm.LLMError as exc:
        raise HTTPException(400, str(exc)) from exc


class TestIn(ConnectionIn):
    model: str


@router.post("/llm/test")
async def llm_test(body: TestIn) -> dict:
    conn = _resolve_connection(body)
    try:
        reply = await llm.complete(conn, body.model, "", [{"role": "user", "content": "Reply with the single word: ready"}],
                                   effort="low")
    except llm.LLMError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True, "reply": reply[:200]}


@router.post("/embeddings/test")
async def embeddings_test() -> dict:
    try:
        vec = await embeddings.embed(["hello world"])
    except (embeddings.EmbeddingError, httpx.HTTPError) as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True, "dimensions": 0 if vec is None else int(vec.shape[1])}


@router.get("/voice/voices")
async def voices() -> dict:
    try:
        return {"voices": await voice.list_voices()}
    except (voice.VoiceError, httpx.HTTPError) as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/voice/projects")
async def voice_projects() -> dict:
    try:
        return {"projects": await voice.list_projects()}
    except (voice.VoiceError, httpx.HTTPError) as exc:
        raise HTTPException(400, str(exc)) from exc


class PreviewIn(BaseModel):
    voice_id: str
    text: str = "Hi! This is how I sound reading your notebook."


@router.post("/voice/preview")
async def preview(body: PreviewIn) -> FileResponse:
    out = Path(tempfile.mkdtemp(dir=get_config().data_dir)) / "preview.mp3"
    try:
        await voice.synthesize(body.text[:300], body.voice_id, out)
    except (voice.VoiceError, httpx.HTTPError) as exc:
        raise HTTPException(400, str(exc)) from exc
    return FileResponse(out, media_type="audio/mpeg")


@router.post("/voice/clone")
async def clone(name: str = Form(...), description: str = Form(""), consent: bool = Form(False),
                remove_background_noise: bool = Form(True), files: list[UploadFile] = File(...)) -> dict:
    if not consent:
        raise HTTPException(400, "Confirm the recording is your own voice or one you have permission to clone.")
    samples = [(f.filename or "sample.wav", await f.read(), f.content_type or "application/octet-stream") for f in files]
    try:
        return await voice.clone_voice(name, samples, description=description,
                                       remove_background_noise=remove_background_noise)
    except (voice.VoiceError, httpx.HTTPError) as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/health")
async def health() -> dict:
    out: dict = {}
    async with httpx.AsyncClient(timeout=5) as client:
        try:
            resp = await client.get(get_config().renderer_url.rstrip("/") + "/health")
            out["renderer"] = resp.status_code == 200
        except httpx.HTTPError:
            out["renderer"] = False
    settings = settings_store.load()
    out["llm"] = bool(settings["connections"])
    out["voice"] = settings["voice"].get("preset")
    out["embeddings"] = settings["embeddings"].get("kind")
    return out
