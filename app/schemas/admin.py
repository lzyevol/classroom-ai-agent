from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.auth import UserRole


UserStatusFilter = Literal["all", "active", "inactive", "deleted"]


class AdminUser(BaseModel):
    id: str
    username: str
    display_name: str
    role: UserRole
    is_active: bool
    created_at: str
    updated_at: str
    deleted_at: str | None = None


class AdminUserPage(BaseModel):
    items: list[AdminUser]
    total: int
    page: int
    page_size: int


class AdminUserCreate(BaseModel):
    username: str = Field(
        ..., min_length=3, max_length=50, pattern=r"^[A-Za-z0-9_.-]+$"
    )
    display_name: str = Field(..., min_length=1, max_length=100)
    role: UserRole
    password: str = Field(..., min_length=8, max_length=200)
    is_active: bool = True


class AdminUserUpdate(BaseModel):
    username: str | None = Field(
        default=None, min_length=3, max_length=50, pattern=r"^[A-Za-z0-9_.-]+$"
    )
    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    role: UserRole | None = None


class PasswordResetRequest(BaseModel):
    password: str = Field(..., min_length=8, max_length=200)


class UserStatusRequest(BaseModel):
    is_active: bool


class AdminActionResponse(BaseModel):
    success: bool = True
