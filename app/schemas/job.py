from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel

JobStatus = Literal["pending", "running", "done", "failed"]


class JobAccepted(BaseModel):
    """Returned immediately when a long-running task is queued."""

    job_id: str
    status: JobStatus = "pending"


class JobResponse(BaseModel):
    job_id: str
    type: str
    status: JobStatus
    meta: dict[str, Any] = {}
    result: Any | None = None
    error: str | None = None
    created_at: str
    updated_at: str
