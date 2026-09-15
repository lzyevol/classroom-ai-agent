from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


UserRole = Literal["student", "teacher", "admin"]


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=1, max_length=200)


class AuthUser(BaseModel):
    id: str
    username: str
    display_name: str
    role: UserRole
    is_active: bool


class LoginResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_at: str
    user: AuthUser


class LogoutResponse(BaseModel):
    success: bool = True


class ClassSummary(BaseModel):
    id: str
    name: str
    course_name: str
    student_count: int


class ClassStudent(BaseModel):
    id: str
    username: str
    display_name: str
    is_active: bool
