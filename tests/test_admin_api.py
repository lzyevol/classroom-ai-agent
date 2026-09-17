from __future__ import annotations

import sqlite3
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.admin import router as admin_router
from app.api.auth import router as auth_router
from app.db.sqlite import initialize_schema
from app.security import hash_password


def _memory_db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    initialize_schema(conn)
    for user_id, password in (
        ("demo_student", "student123"),
        ("demo_teacher", "teacher123"),
        ("demo_admin", "admin123"),
    ):
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (hash_password(password), user_id),
        )
    conn.commit()
    return conn


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(auth_router)
    app.include_router(admin_router)
    return app


def _login(client: TestClient, username: str, password: str) -> str:
    response = client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_admin_user_lifecycle_and_session_invalidation():
    conn = _memory_db()
    with (
        patch("app.services.auth_service.get_db", return_value=conn),
        patch("app.services.admin_service.get_db", return_value=conn),
        TestClient(_app()) as client,
    ):
        admin_token = _login(client, "admin", "admin123")
        student_token = _login(client, "student", "student123")
        teacher_token = _login(client, "teacher", "teacher123")
        assert client.get(
            "/api/admin/users", headers=_headers(student_token)
        ).status_code == 403
        assert client.get(
            "/api/admin/users", headers=_headers(teacher_token)
        ).status_code == 403

        created = client.post(
            "/api/admin/users",
            headers=_headers(admin_token),
            json={
                "username": "student_new",
                "display_name": "新学生",
                "role": "student",
                "password": "initial123",
            },
        )
        assert created.status_code == 201
        user_id = created.json()["id"]
        assert created.json()["is_active"] is True

        duplicate = client.post(
            "/api/admin/users",
            headers=_headers(admin_token),
            json={
                "username": "STUDENT_NEW",
                "display_name": "重复账号",
                "role": "student",
                "password": "initial123",
            },
        )
        assert duplicate.status_code == 409

        user_token = _login(client, "student_new", "initial123")
        updated = client.patch(
            f"/api/admin/users/{user_id}",
            headers=_headers(admin_token),
            json={"display_name": "更新后的学生"},
        )
        assert updated.status_code == 200
        assert updated.json()["display_name"] == "更新后的学生"

        reset = client.post(
            f"/api/admin/users/{user_id}/reset-password",
            headers=_headers(admin_token),
            json={"password": "changed123"},
        )
        assert reset.status_code == 200
        assert client.get("/api/auth/me", headers=_headers(user_token)).status_code == 401
        user_token = _login(client, "student_new", "changed123")

        disabled = client.post(
            f"/api/admin/users/{user_id}/status",
            headers=_headers(admin_token),
            json={"is_active": False},
        )
        assert disabled.status_code == 200
        assert disabled.json()["is_active"] is False
        assert client.get("/api/auth/me", headers=_headers(user_token)).status_code == 401
        assert client.post(
            "/api/auth/login",
            json={"username": "student_new", "password": "changed123"},
        ).status_code == 401

        assert client.post(
            f"/api/admin/users/{user_id}/status",
            headers=_headers(admin_token),
            json={"is_active": True},
        ).status_code == 200
        _login(client, "student_new", "changed123")

        deleted = client.delete(
            f"/api/admin/users/{user_id}",
            headers=_headers(admin_token),
        )
        assert deleted.status_code == 200
        assert client.post(
            "/api/auth/login",
            json={"username": "student_new", "password": "changed123"},
        ).status_code == 401
        deleted_page = client.get(
            "/api/admin/users?status=deleted&q=student_new",
            headers=_headers(admin_token),
        )
        assert deleted_page.status_code == 200
        assert deleted_page.json()["total"] == 1
        assert deleted_page.json()["items"][0]["deleted_at"] is not None
    conn.close()


def test_admin_cannot_disable_delete_or_demote_self():
    conn = _memory_db()
    with (
        patch("app.services.auth_service.get_db", return_value=conn),
        patch("app.services.admin_service.get_db", return_value=conn),
        TestClient(_app()) as client,
    ):
        token = _login(client, "admin", "admin123")
        headers = _headers(token)
        assert client.post(
            "/api/admin/users/demo_admin/status",
            headers=headers,
            json={"is_active": False},
        ).status_code == 400
        assert client.patch(
            "/api/admin/users/demo_admin",
            headers=headers,
            json={"role": "teacher"},
        ).status_code == 400
        assert client.delete(
            "/api/admin/users/demo_admin", headers=headers
        ).status_code == 400
    conn.close()
