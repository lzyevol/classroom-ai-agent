from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.dependencies import require_roles
from app.schemas.job import JobAccepted
from app.schemas.practice import PracticeGenerateRequest
from app.schemas.question_bank import (
    BankQuestion,
    BankQuestionPage,
    QuestionBankGenerateRequest,
    QuestionUpdateRequest,
)
from app.services.job_service import enqueue
from app.services.practice_service import (
    PracticeNotFoundError,
    generate_question_bank,
)
from app.services.question_bank_service import (
    QuestionNotFoundError,
    QuestionValidationError,
    archive_question,
    count_section_questions,
    get_question,
    list_section_questions,
    regenerate_question,
    section_has_material,
    update_question,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/questions")

TeacherUser = Depends(require_roles("teacher", "admin"))


@router.get("/section/{section_key:path}", response_model=BankQuestionPage)
def get_section_questions(
    section_key: str,
    include_archived: bool = Query(default=False),
    _current_user: dict[str, Any] = TeacherUser,
):
    """List a section's question bank, answers and rubric included."""
    counts = count_section_questions(section_key)
    return {
        "section_key": section_key,
        "questions": list_section_questions(
            section_key, include_archived=include_archived
        ),
        "active_count": counts["active"],
        "archived_count": counts["archived"],
    }


@router.post(
    "/section/{section_key:path}/generate-async",
    response_model=JobAccepted,
    status_code=202,
)
async def post_generate_questions(
    section_key: str,
    request: QuestionBankGenerateRequest,
    _current_user: dict[str, Any] = TeacherUser,
):
    """Queue question generation for one section and return a job id."""
    # Reject an unknown section up front instead of letting the job spend ~15s
    # reaching the same conclusion.
    if not section_has_material(section_key):
        raise HTTPException(status_code=404, detail="没有找到该章节的教材内容")

    generate_request = PracticeGenerateRequest(
        section_key=section_key,
        question_types=request.question_types,
        difficulty=request.difficulty,
        question_count=request.question_count,
        knowledge_point=request.knowledge_point,
    )
    mixed = request.mixed_difficulty

    async def run() -> dict[str, Any]:
        try:
            return await generate_question_bank(
                generate_request, mixed_difficulty=mixed
            )
        except PracticeNotFoundError as exc:
            # Surface as a job error rather than an unhandled crash.
            raise RuntimeError(str(exc)) from exc

    job_id = await enqueue(
        "question_bank_generate",
        run,
        meta={
            "section_key": section_key,
            "question_count": request.question_count,
            "difficulty": request.difficulty,
        },
    )
    return {"job_id": job_id}


@router.post(
    "/{question_id}/regenerate",
    response_model=JobAccepted,
    status_code=202,
)
async def post_regenerate_question(
    question_id: str,
    _current_user: dict[str, Any] = TeacherUser,
):
    """Queue a same-knowledge-point replacement for one question."""
    try:
        original = get_question(question_id)
    except QuestionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    async def run() -> dict[str, Any]:
        try:
            return await regenerate_question(question_id)
        except (QuestionNotFoundError, QuestionValidationError) as exc:
            raise RuntimeError(str(exc)) from exc

    job_id = await enqueue(
        "question_regenerate",
        run,
        meta={
            "question_id": question_id,
            "section_key": original["section_key"],
            "type": original["type"],
        },
    )
    return {"job_id": job_id}


@router.patch("/{question_id}", response_model=BankQuestion)
def patch_question(
    question_id: str,
    request: QuestionUpdateRequest,
    _current_user: dict[str, Any] = TeacherUser,
):
    """Apply a partial edit to one question."""
    # exclude_unset keeps an omitted field from clobbering the stored value.
    changes = request.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=422, detail="没有需要更新的字段")
    if "rubric" in changes and changes["rubric"] is not None:
        changes["rubric"] = [dict(item) for item in changes["rubric"]]

    try:
        return update_question(question_id, changes)
    except QuestionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except QuestionValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete("/{question_id}", response_model=BankQuestion)
def delete_question(
    question_id: str,
    _current_user: dict[str, Any] = TeacherUser,
):
    """Archive a question; student answer records keep referencing it."""
    try:
        return archive_question(question_id)
    except QuestionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
