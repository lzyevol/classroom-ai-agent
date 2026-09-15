from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import get_current_token, get_current_user, require_roles
from app.schemas.auth import (
    AuthUser,
    ClassStudent,
    ClassSummary,
    LoginRequest,
    LoginResponse,
    LogoutResponse,
)
from app.services.auth_service import (
    InvalidCredentialsError,
    PermissionDeniedError,
    list_accessible_classes,
    list_class_students,
    list_users,
    login,
    logout,
)


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def post_login(request: LoginRequest):
    try:
        return login(request.username, request.password)
    except InvalidCredentialsError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@router.get("/me", response_model=AuthUser)
def get_me(current_user: dict[str, Any] = Depends(get_current_user)):
    return current_user


@router.post("/logout", response_model=LogoutResponse)
def post_logout(
    token: str = Depends(get_current_token),
    _current_user: dict[str, Any] = Depends(get_current_user),
):
    logout(token)
    return {"success": True}


@router.get("/users", response_model=list[AuthUser])
def get_users(_current_user: dict[str, Any] = Depends(require_roles("admin"))):
    return list_users()


@router.get("/classes", response_model=list[ClassSummary])
def get_classes(current_user: dict[str, Any] = Depends(get_current_user)):
    return list_accessible_classes(current_user)


@router.get("/classes/{class_id}/students", response_model=list[ClassStudent])
def get_class_students(
    class_id: str,
    current_user: dict[str, Any] = Depends(require_roles("teacher", "admin")),
):
    try:
        return list_class_students(current_user, class_id)
    except PermissionDeniedError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
