from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.dependencies import require_roles
from app.schemas.admin import (
    AdminActionResponse,
    AdminUser,
    AdminUserCreate,
    AdminUserPage,
    AdminUserUpdate,
    PasswordResetRequest,
    UserStatusFilter,
    UserStatusRequest,
)
from app.schemas.auth import UserRole
from app.services.admin_service import (
    AdminUserConflictError,
    AdminUserNotFoundError,
    InvalidAdminOperationError,
    create_admin_user,
    get_admin_user,
    list_admin_users,
    reset_admin_user_password,
    set_admin_user_status,
    soft_delete_admin_user,
    update_admin_user,
)


router = APIRouter(prefix="/api/admin", tags=["admin"])


def _raise_admin_error(exc: Exception) -> None:
    if isinstance(exc, AdminUserNotFoundError):
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if isinstance(exc, AdminUserConflictError):
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/users", response_model=AdminUserPage)
def get_users(
    q: str | None = Query(default=None, max_length=100),
    role: UserRole | None = Query(default=None),
    user_status: UserStatusFilter = Query(default="all", alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    _current_admin: dict[str, Any] = Depends(require_roles("admin")),
):
    return list_admin_users(
        query=q,
        role=role,
        status=user_status,
        page=page,
        page_size=page_size,
    )


@router.get("/users/{user_id}", response_model=AdminUser)
def get_user(
    user_id: str,
    _current_admin: dict[str, Any] = Depends(require_roles("admin")),
):
    try:
        return get_admin_user(user_id)
    except AdminUserNotFoundError as exc:
        _raise_admin_error(exc)


@router.post("/users", response_model=AdminUser, status_code=status.HTTP_201_CREATED)
def post_user(
    request: AdminUserCreate,
    _current_admin: dict[str, Any] = Depends(require_roles("admin")),
):
    try:
        return create_admin_user(request)
    except (AdminUserConflictError, InvalidAdminOperationError) as exc:
        _raise_admin_error(exc)


@router.patch("/users/{user_id}", response_model=AdminUser)
def patch_user(
    user_id: str,
    request: AdminUserUpdate,
    current_admin: dict[str, Any] = Depends(require_roles("admin")),
):
    try:
        return update_admin_user(current_admin, user_id, request)
    except (
        AdminUserNotFoundError,
        AdminUserConflictError,
        InvalidAdminOperationError,
    ) as exc:
        _raise_admin_error(exc)


@router.post("/users/{user_id}/reset-password", response_model=AdminActionResponse)
def post_reset_password(
    user_id: str,
    request: PasswordResetRequest,
    _current_admin: dict[str, Any] = Depends(require_roles("admin")),
):
    try:
        reset_admin_user_password(user_id, request.password)
    except AdminUserNotFoundError as exc:
        _raise_admin_error(exc)
    return {"success": True}


@router.post("/users/{user_id}/status", response_model=AdminUser)
def post_user_status(
    user_id: str,
    request: UserStatusRequest,
    current_admin: dict[str, Any] = Depends(require_roles("admin")),
):
    try:
        return set_admin_user_status(current_admin, user_id, request.is_active)
    except (AdminUserNotFoundError, InvalidAdminOperationError) as exc:
        _raise_admin_error(exc)


@router.delete("/users/{user_id}", response_model=AdminActionResponse)
def delete_user(
    user_id: str,
    current_admin: dict[str, Any] = Depends(require_roles("admin")),
):
    try:
        soft_delete_admin_user(current_admin, user_id)
    except (AdminUserNotFoundError, InvalidAdminOperationError) as exc:
        _raise_admin_error(exc)
    return {"success": True}

