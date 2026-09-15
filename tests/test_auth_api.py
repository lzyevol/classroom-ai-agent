from __future__ import annotations

import sqlite3
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.auth import router as auth_router
from app.api.learning import router as learning_router
from app.api.practice import router as practice_router
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


def _test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(auth_router)
    app.include_router(learning_router)
    app.include_router(practice_router)
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


def test_login_current_user_and_logout():
    conn = _memory_db()
    app = _test_app()
    with patch("app.services.auth_service.get_db", return_value=conn):
        with TestClient(app) as client:
            token = _login(client, "student", "student123")

            me = client.get("/api/auth/me", headers=_headers(token))
            assert me.status_code == 200
            assert me.json() == {
                "id": "demo_student",
                "username": "student",
                "display_name": "演示学生",
                "role": "student",
                "is_active": True,
            }

            logout = client.post("/api/auth/logout", headers=_headers(token))
            assert logout.status_code == 200
            assert client.get("/api/auth/me", headers=_headers(token)).status_code == 401
    conn.close()


def test_admin_only_user_list_and_teacher_class_scope():
    conn = _memory_db()
    now = "2026-07-24T00:00:00+00:00"
    conn.execute(
        "INSERT INTO classes (id, name, course_name, created_at) VALUES (?, ?, ?, ?)",
        ("other_class", "其他班级", "具身智能导论", now),
    )
    conn.commit()
    app = _test_app()
    with patch("app.services.auth_service.get_db", return_value=conn):
        with TestClient(app) as client:
            student_token = _login(client, "student", "student123")
            teacher_token = _login(client, "teacher", "teacher123")
            admin_token = _login(client, "admin", "admin123")

            assert client.get("/api/auth/users", headers=_headers(student_token)).status_code == 403
            users = client.get("/api/auth/users", headers=_headers(admin_token))
            assert users.status_code == 200
            assert {item["role"] for item in users.json()} == {"student", "teacher", "admin"}

            classes = client.get("/api/auth/classes", headers=_headers(teacher_token))
            assert classes.status_code == 200
            assert [item["id"] for item in classes.json()] == ["demo_class"]

            students = client.get(
                "/api/auth/classes/demo_class/students",
                headers=_headers(teacher_token),
            )
            assert students.status_code == 200
            assert [item["id"] for item in students.json()] == ["demo_student"]
            assert client.get(
                "/api/auth/classes/other_class/students",
                headers=_headers(teacher_token),
            ).status_code == 403
    conn.close()


def test_student_cannot_view_others_and_teacher_only_views_assigned_class():
    conn = _memory_db()
    now = "2026-07-24T00:00:00+00:00"
    conn.execute(
        """INSERT INTO users (
               id, username, password_hash, display_name, role,
               is_active, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'student', 1, ?, ?)""",
        ("other_student", "other", hash_password("other123"), "其他学生", now, now),
    )
    conn.commit()
    app = _test_app()
    with (
        patch("app.services.auth_service.get_db", return_value=conn),
        patch("app.services.learning_service.get_db", return_value=conn),
        patch("app.api.learning.CourseService.get_toc", return_value=[]),
    ):
        with TestClient(app) as client:
            student_token = _login(client, "student", "student123")
            teacher_token = _login(client, "teacher", "teacher123")
            admin_token = _login(client, "admin", "admin123")

            own = client.get("/api/learning/dashboard", headers=_headers(student_token))
            assert own.status_code == 200
            assert own.json()["user_id"] == "demo_student"

            assert client.get(
                "/api/learning/dashboard?user_id=other_student",
                headers=_headers(student_token),
            ).status_code == 403

            assigned = client.get(
                "/api/learning/dashboard?user_id=demo_student",
                headers=_headers(teacher_token),
            )
            assert assigned.status_code == 200
            assert assigned.json()["user_id"] == "demo_student"

            assert client.get(
                "/api/learning/dashboard?user_id=other_student",
                headers=_headers(teacher_token),
            ).status_code == 403
            assert client.get(
                "/api/learning/dashboard?user_id=other_student",
                headers=_headers(admin_token),
            ).status_code == 200

            teacher_practice = client.post(
                "/api/practice/generate",
                headers=_headers(teacher_token),
                json={
                    "section_key": "book:1.1",
                    "question_types": ["single_choice"],
                    "difficulty": "medium",
                    "question_count": 1,
                },
            )
            assert teacher_practice.status_code == 403
    conn.close()
