from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import require_roles
from app.schemas.job import JobAccepted
from app.schemas.lesson import LessonGenerateRequest, LessonResponse, LessonListItem
from app.services.job_service import enqueue
from app.services.lesson_service import (
    generate_lesson,
    get_cached_lesson,
    list_lessons,
    regenerate_slide,
    update_slide,
)

router = APIRouter(prefix="/api/lesson")


@router.post("/generate", response_model=LessonResponse)
async def post_generate(request: LessonGenerateRequest):
    try:
        result = await generate_lesson(request.section_key, request.force_regenerate)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception:
        import logging
        logging.getLogger(__name__).exception("Lesson generation error")
        raise HTTPException(status_code=500, detail="课件生成失败，请稍后重试")
    return result


@router.post("/generate-async", response_model=JobAccepted, status_code=202)
async def post_generate_async(
    request: LessonGenerateRequest,
    _current_user: dict[str, Any] = Depends(require_roles("teacher", "admin")),
):
    """Queue courseware generation and return a job id without waiting for it."""
    section_key = request.section_key
    force = request.force_regenerate
    job_id = await enqueue(
        "lesson_generate",
        lambda: generate_lesson(section_key, force),
        meta={"section_key": section_key, "force_regenerate": force},
    )
    return {"job_id": job_id}


@router.get("/list", response_model=list[LessonListItem])
def get_list():
    return list_lessons()


@router.get("/{section_key:path}", response_model=LessonResponse)
def get_lesson(section_key: str):
    result = get_cached_lesson(section_key)
    if result is None:
        raise HTTPException(status_code=404, detail="该章节尚未生成课件")
    return result


@router.post(
    "/{section_key:path}/slides/{slide_id}/regenerate",
    response_model=JobAccepted,
    status_code=202,
)
async def post_regenerate_slide(
    section_key: str,
    slide_id: str,
    _current_user: dict[str, Any] = Depends(require_roles("teacher", "admin")),
):
    """Queue a single-slide regeneration without touching its siblings."""
    if get_cached_lesson(section_key) is None:
        raise HTTPException(status_code=404, detail="该章节尚未生成课件")

    async def run() -> dict:
        slide = await regenerate_slide(section_key, slide_id)
        if slide is None:
            raise RuntimeError("未找到指定幻灯片")
        return slide

    job_id = await enqueue(
        "slide_regenerate",
        run,
        meta={"section_key": section_key, "slide_id": slide_id},
    )
    return {"job_id": job_id}


@router.put("/{section_key:path}/slides/{slide_id}")
def put_slide(
    section_key: str,
    slide_id: str,
    slide_data: dict,
    _current_user: dict[str, Any] = Depends(require_roles("teacher", "admin")),
):
    result = update_slide(section_key, slide_id, slide_data)
    if result is None:
        raise HTTPException(status_code=404, detail="未找到指定幻灯片")
    return result
