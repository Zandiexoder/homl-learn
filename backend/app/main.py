"""FastAPI entry point. Serves the API and, in production, the built frontend."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import db, jobs
from .api import auth, notebooks, public, settings
from .config import get_config

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init_db()
    jobs.set_loop(asyncio.get_running_loop())
    yield


app = FastAPI(title="Homl Learn", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(notebooks.router)
app.include_router(settings.router)
app.include_router(public.router)


@app.exception_handler(LookupError)
async def lookup_error(_request: Request, exc: LookupError) -> JSONResponse:
    # Raised when a task's model isn't configured yet.
    return JSONResponse({"detail": str(exc)}, status_code=400)


static = get_config().static_dir
if static and static.is_dir():
    app.mount("/assets", StaticFiles(directory=static / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(404, "Not found.")
        candidate = (static / path).resolve()
        if path and static.resolve() in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(Path(static) / "index.html")
