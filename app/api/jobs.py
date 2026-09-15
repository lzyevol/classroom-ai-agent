from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import get_current_user
from app.schemas.job import JobResponse
from app.services.job_service import JobNotFoundError, get_job

router = APIRouter(prefix="/api/jobs")


@router.get("/{job_id}", response_model=JobResponse)
async def get_job_status(
    job_id: str,
    _current_user: dict[str, Any] = Depends(get_current_user),
):
    try:
        return await get_job(job_id)
    except JobNotFoundError:
        raise HTTPException(status_code=404, detail="任务不存在或已过期")
