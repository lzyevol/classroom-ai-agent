from __future__ import annotations

import logging

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import require_roles
from app.schemas.practice import (
    PracticeGenerateRequest,
    PracticeSessionResponse,
    PracticeSubmitRequest,
    PracticeSubmitResponse,
)
from app.services.practice_service import (
    PracticeConflictError,
    PracticeNotFoundError,
    PracticeValidationError,
    generate_practice,
    submit_practice,
)


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/practice")


@router.post("/generate", response_model=PracticeSessionResponse)
async def post_generate(
    request: PracticeGenerateRequest,
    current_user: dict[str, Any] = Depends(require_roles("student")),
):
    try:
        return await generate_practice(request, current_user["id"])
    except PracticeNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Practice generation error")
        raise HTTPException(status_code=500, detail="练习生成失败，请稍后重试") from exc


@router.post("/{session_id}/submit", response_model=PracticeSubmitResponse)
async def post_submit(
    session_id: str,
    request: PracticeSubmitRequest,
    current_user: dict[str, Any] = Depends(require_roles("student")),
):
    try:
        return await submit_practice(session_id, request, current_user["id"])
    except PracticeNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PracticeConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except PracticeValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Practice submission error")
        raise HTTPException(status_code=500, detail="练习提交失败，请稍后重试") from exc
