from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.dependencies import require_roles
from app.schemas.assignment import (
    AssignmentCreateRequest,
    AssignmentDetail,
    AssignmentPage,
    AssignmentSummary,
)
from app.schemas.teacher import (
    TeacherClassOverview,
    TeacherClassPage,
    ClassSectionMasteryPage,
    TeacherStudentDetail,
    TeacherStudentPage,
    WeakKnowledgePage,
)
from app.services.auth_service import PermissionDeniedError
from app.services.assignment_service import (
    AssignmentConflictError,
    AssignmentNotFoundError,
    close_assignment,
    create_assignment,
    delete_assignment,
    get_assignment_detail,
    list_assignments,
)
from app.services.teacher_service import (
    TeacherStudentNotFoundError,
    get_teacher_class_overview,
    get_teacher_student_detail,
    list_teacher_class_students,
    list_teacher_classes,
    list_class_section_mastery,
    list_weak_knowledge_points,
)


router = APIRouter(prefix="/api/teacher", tags=["teacher"])


def _raise_teacher_error(exc: Exception) -> None:
    if isinstance(exc, PermissionDeniedError):
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if isinstance(exc, AssignmentConflictError):
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/classes", response_model=TeacherClassPage)
def get_classes(
    q: str | None = Query(default=None, max_length=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: dict[str, Any] = Depends(require_roles("teacher", "admin")),
):
    return list_teacher_classes(
        current_user,
        query=q,
        page=page,
        page_size=page_size,
    )


@router.get("/classes/{class_id}/overview", response_model=TeacherClassOverview)
def get_class_overview(
    class_id: str,
    current_user: dict[str, Any] = Depends(require_roles("teacher", "admin")),
):
    try:
        return get_teacher_class_overview(current_user, class_id)
    except PermissionDeniedError as exc:
        _raise_teacher_error(exc)


@router.get("/classes/{class_id}/students", response_model=TeacherStudentPage)
def get_class_students(
    class_id: str,
    q: str | None = Query(default=None, max_length=100),
    student_status: Literal["all", "active", "inactive"] = Query(
        default="all", alias="status"
    ),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: dict[str, Any] = Depends(require_roles("teacher", "admin")),
):
    try:
        return list_teacher_class_students(
            current_user,
            class_id,
            query=q,
            status=student_status,
            page=page,
            page_size=page_size,
        )
    except PermissionDeniedError as exc:
        _raise_teacher_error(exc)


@router.get(
    "/classes/{class_id}/students/{student_id}",
    response_model=TeacherStudentDetail,
)
def get_student_detail(
    class_id: str,
    student_id: str,
    current_user: dict[str, Any] = Depends(require_roles("teacher", "admin")),
):
    try:
        return get_teacher_student_detail(current_user, class_id, student_id)
    except (PermissionDeniedError, TeacherStudentNotFoundError) as exc:
        _raise_teacher_error(exc)


@router.get(
    "/classes/{class_id}/section-mastery",
    response_model=ClassSectionMasteryPage,
)
def get_section_mastery(
    class_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: dict[str, Any] = Depends(require_roles("teacher", "admin")),
):
    try:
        return list_class_section_mastery(
            current_user,
            class_id,
            page=page,
            page_size=page_size,
        )
    except PermissionDeniedError as exc:
        _raise_teacher_error(exc)


@router.get(
    "/classes/{class_id}/weak-knowledge",
    response_model=WeakKnowledgePage,
)
def get_weak_knowledge(
    class_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: dict[str, Any] = Depends(require_roles("teacher", "admin")),
):
    try:
        return list_weak_knowledge_points(
            current_user,
            class_id,
            page=page,
            page_size=page_size,
        )
    except PermissionDeniedError as exc:
        _raise_teacher_error(exc)



@router.post(
    "/classes/{class_id}/assignments",
    response_model=AssignmentSummary,
    status_code=201,
)
def post_assignment(
    class_id: str,
    request: AssignmentCreateRequest,
    current_user: dict[str, Any] = Depends(require_roles("teacher", "admin")),
):
    try:
        return create_assignment(current_user, class_id, request)
    except (PermissionDeniedError, AssignmentConflictError) as exc:
        _raise_teacher_error(exc)


@router.get("/classes/{class_id}/assignments", response_model=AssignmentPage)
def get_assignments(
    class_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: dict[str, Any] = Depends(require_roles("teacher", "admin")),
):
    try:
        return list_assignments(
            current_user,
            class_id,
            page=page,
            page_size=page_size,
        )
    except PermissionDeniedError as exc:
        _raise_teacher_error(exc)


@router.get(
    "/classes/{class_id}/assignments/{assignment_id}",
    response_model=AssignmentDetail,
)
def get_assignment(
    class_id: str,
    assignment_id: str,
    current_user: dict[str, Any] = Depends(require_roles("teacher", "admin")),
):
    try:
        return get_assignment_detail(current_user, class_id, assignment_id)
    except (PermissionDeniedError, AssignmentNotFoundError) as exc:
        _raise_teacher_error(exc)


@router.post(
    "/classes/{class_id}/assignments/{assignment_id}/close",
    response_model=AssignmentSummary,
)
def post_close_assignment(
    class_id: str,
    assignment_id: str,
    current_user: dict[str, Any] = Depends(require_roles("teacher", "admin")),
):
    try:
        return close_assignment(current_user, class_id, assignment_id)
    except (PermissionDeniedError, AssignmentNotFoundError) as exc:
        _raise_teacher_error(exc)


@router.delete(
    "/classes/{class_id}/assignments/{assignment_id}",
    status_code=204,
)
def remove_assignment(
    class_id: str,
    assignment_id: str,
    current_user: dict[str, Any] = Depends(require_roles("teacher", "admin")),
) -> Response:
    try:
        delete_assignment(current_user, class_id, assignment_id)
        return Response(status_code=204)
    except (PermissionDeniedError, AssignmentNotFoundError) as exc:
        _raise_teacher_error(exc)
