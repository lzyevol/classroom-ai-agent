from __future__ import annotations

import logging

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.db.neo4j import get_driver
from app.dependencies import get_current_user, require_roles
from app.schemas.assignment import AssignmentStartResponse, StudentAssignmentPage
from app.schemas.learning import (
    KnowledgeReviewResponse,
    LearningDashboardResponse,
    SectionAccessRequest,
    SectionAccessResponse,
)
from app.services.assignment_service import (
    AssignmentConflictError,
    AssignmentNotFoundError,
    list_student_assignments,
    start_student_assignment,
)
from app.services.course_service import CourseService
from app.services.learning_service import (
    KnowledgeReviewNotFoundError,
    get_knowledge_review,
    get_learning_dashboard,
    record_section_access,
)
from app.services.auth_service import (
    PermissionDeniedError,
    UserNotFoundError,
    resolve_accessible_user_id,
)
from app.services.practice_service import PracticeNotFoundError


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/learning")


@router.post("/sections/access", response_model=SectionAccessResponse)
def post_section_access(
    request: SectionAccessRequest,
    current_user: dict[str, Any] = Depends(require_roles("student")),
):
    return record_section_access(request, current_user["id"])


@router.get("/dashboard", response_model=LearningDashboardResponse)
def get_dashboard(
    user_id: str | None = Query(default=None, min_length=1, max_length=100),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    try:
        target_user_id = resolve_accessible_user_id(current_user, user_id)
    except UserNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    toc: list[dict] = []
    try:
        toc = CourseService(get_driver()).get_toc()
    except Exception:
        logger.warning("Course TOC unavailable while building learning recommendations", exc_info=True)
    return get_learning_dashboard(user_id=target_user_id, toc=toc)


@router.get("/review", response_model=KnowledgeReviewResponse)
def get_review(
    section_key: str = Query(..., min_length=1, max_length=200),
    knowledge_point: str = Query(..., min_length=1, max_length=100),
    user_id: str | None = Query(default=None, min_length=1, max_length=100),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    try:
        target_user_id = resolve_accessible_user_id(current_user, user_id)
    except UserNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    section = None
    try:
        section = CourseService(get_driver()).get_section(section_key)
    except Exception:
        logger.warning("Course section unavailable while building knowledge review", exc_info=True)
    try:
        return get_knowledge_review(
            section_key=section_key,
            knowledge_point=knowledge_point,
            user_id=target_user_id,
            section=section,
        )
    except KnowledgeReviewNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/assignments", response_model=StudentAssignmentPage)
def get_student_assignments(
    current_user: dict[str, Any] = Depends(require_roles("student")),
):
    return list_student_assignments(current_user["id"])


@router.post(
    "/assignments/{assignment_id}/start",
    response_model=AssignmentStartResponse,
)
async def post_start_assignment(
    assignment_id: str,
    current_user: dict[str, Any] = Depends(require_roles("student")),
):
    try:
        return await start_student_assignment(assignment_id, current_user["id"])
    except (AssignmentNotFoundError, PracticeNotFoundError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AssignmentConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
