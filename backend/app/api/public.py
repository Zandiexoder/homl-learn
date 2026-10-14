"""Read-only share links for single Studio outputs. No sign-in; access is limited to the shared output."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from .. import db
from ..config import get_config

router = APIRouter(prefix="/api/public")

FILE_KEYS = ("audio", "video", "image", "subtitles")
PRIVATE_KEYS = {"spec", "custom_errors", "timeline", "render_stage", "flagged_lines", "voices", "provider"}


def shared(token: str) -> dict:
    row = db.fetch_one(
        "SELECT a.* FROM shares s JOIN artifacts a ON a.id = s.artifact_id WHERE s.token=? AND a.status='done'", (token,))
    if not row:
        raise HTTPException(404, "This link doesn't exist or was turned off.")
    return row


def public_url(token: str, rel: str, artifact: dict) -> str:
    prefix = f"{artifact['notebook_id']}/artifacts/{artifact['id']}/"
    return f"/api/public/{token}/file/{rel[len(prefix):]}" if rel.startswith(prefix) else ""


@router.get("/{token}")
def get_shared(token: str) -> dict:
    art = shared(token)
    data = {k: v for k, v in art["data"].items() if k not in PRIVATE_KEYS}
    for key in FILE_KEYS:
        if isinstance(data.get(key), str):
            data[key] = public_url(token, data[key], art)
    if isinstance(data.get("stills"), list):
        data["stills"] = [public_url(token, s, art) for s in data["stills"]]
    notebook = db.fetch_one("SELECT title FROM notebooks WHERE id=?", (art["notebook_id"],))
    return {"kind": art["kind"], "title": art["title"], "notebook": notebook["title"] if notebook else "",
            "data": data, "created_at": art["created_at"]}


@router.get("/{token}/file/{path:path}")
def shared_file(token: str, path: str) -> FileResponse:
    art = shared(token)
    folder = (get_config().files_dir / art["notebook_id"] / "artifacts" / art["id"]).resolve()
    target = (folder / path).resolve()
    if folder not in target.parents or not target.is_file():
        raise HTTPException(404, "File not found.")
    return FileResponse(target)
