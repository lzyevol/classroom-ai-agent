from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.config import settings
from app.db.redis import get_client

logger = logging.getLogger(__name__)

JOB_KEY_PREFIX = "job:"

# Tasks are fire-and-forget, so hold strong references until they settle.
# Without this the event loop may garbage-collect a running task mid-flight.
_running: set[asyncio.Task[None]] = set()


class JobNotFoundError(Exception):
    """Raised when a job id has expired or never existed."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _job_key(job_id: str) -> str:
    return f"{JOB_KEY_PREFIX}{job_id}"


async def _write(job_id: str, payload: dict[str, Any]) -> None:
    await get_client().set(
        _job_key(job_id),
        json.dumps(payload, ensure_ascii=False),
        ex=settings.job_ttl_seconds,
    )


async def _read(job_id: str) -> dict[str, Any]:
    raw = await get_client().get(_job_key(job_id))
    if raw is None:
        raise JobNotFoundError(job_id)
    return json.loads(raw)


async def _patch(job_id: str, **changes: Any) -> dict[str, Any]:
    """Merge changes into an existing job record, tolerating expiry."""
    try:
        payload = await _read(job_id)
    except JobNotFoundError:
        # The record expired while the task was still running; nothing to update.
        logger.warning("Job %s expired before its status could be updated", job_id)
        return {}
    payload.update(changes)
    payload["updated_at"] = _utc_now()
    await _write(job_id, payload)
    return payload


async def enqueue(
    job_type: str,
    factory: Callable[[], Awaitable[Any]],
    *,
    meta: dict[str, Any] | None = None,
) -> str:
    """Register a job, start it in the background, and return its id at once.

    `factory` is called (not awaited) inside the background task so the caller
    never blocks on the work itself.
    """
    job_id = str(uuid4())
    now = _utc_now()
    await _write(
        job_id,
        {
            "job_id": job_id,
            "type": job_type,
            "status": "pending",
            "meta": meta or {},
            "result": None,
            "error": None,
            "created_at": now,
            "updated_at": now,
        },
    )

    task = asyncio.create_task(_run(job_id, factory))
    _running.add(task)
    task.add_done_callback(_running.discard)
    return job_id


async def _run(job_id: str, factory: Callable[[], Awaitable[Any]]) -> None:
    await _patch(job_id, status="running")
    try:
        result = await factory()
    except Exception as exc:
        # Long-running generation failing must not take the server down, so the
        # error is recorded on the job and swallowed here.
        logger.exception("Job %s failed", job_id)
        await _patch(job_id, status="failed", error=str(exc))
        return
    await _patch(job_id, status="done", result=result)


async def get_job(job_id: str) -> dict[str, Any]:
    """Return a job record, raising JobNotFoundError when it is gone."""
    return await _read(job_id)
