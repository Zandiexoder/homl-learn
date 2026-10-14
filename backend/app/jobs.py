"""In-process background jobs. Status lives in the database, so the UI just polls rows."""

from __future__ import annotations

import asyncio
import logging
import traceback
from typing import Awaitable, Callable

log = logging.getLogger("homl.jobs")

_tasks: set[asyncio.Task] = set()
_loop: asyncio.AbstractEventLoop | None = None
# Heavy work (audio and video) runs one or two at a time to protect the GPU and RAM.
_limits: dict[str, asyncio.Semaphore] = {}
LIMITS = {"ingest": 3, "studio": 3, "audio": 1, "video": 1}


def _sem(lane: str) -> asyncio.Semaphore:
    if lane not in _limits:
        _limits[lane] = asyncio.Semaphore(LIMITS.get(lane, 2))
    return _limits[lane]


def set_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Remember the server's event loop so sync endpoints (run in worker threads) can start jobs."""
    global _loop
    _loop = loop


def spawn(lane: str, work: Callable[[], Awaitable[None]], on_error: Callable[[str], None]) -> None:
    async def runner() -> None:
        async with _sem(lane):
            try:
                await work()
            except Exception as exc:  # noqa: BLE001 - every failure is reported to the UI
                log.error("job failed: %s\n%s", exc, traceback.format_exc())
                on_error(str(exc) or exc.__class__.__name__)

    def start() -> None:
        task = asyncio.get_running_loop().create_task(runner())
        _tasks.add(task)
        task.add_done_callback(_tasks.discard)

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        if _loop is None:
            raise RuntimeError("jobs.set_loop() was not called at startup") from None
        _loop.call_soon_threadsafe(start)
    else:
        start()
