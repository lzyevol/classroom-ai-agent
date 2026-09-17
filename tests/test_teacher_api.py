from __future__ import annotations

import sqlite3
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.auth import router as auth_router
from app.api.teacher import router as teacher_router
from app.db.sqlite import initialize_schema
from app.security import hash_password


NOW = "2026-07-25T00:00:00+00:00"


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
    conn.execute(
        """INSERT INTO users (
               id, username, password_hash, display_name, role,
               is_active, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)""",
        (
            "teacher_two",
            "teacher_two",
            hash_password("teacher234"),
            "教师二",
            "teacher",
            NOW,
            NOW,
        ),
    )
    conn.execute(
        """INSERT INTO users (
               id, username, password_hash, display_name, role,
               is_active, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)""",
        (
            "student_two",
            "student_two",
            hash_password("student234"),
            "学生二",
            "student",
            NOW,
            NOW,
        ),
    )
    conn.execute(
        "INSERT INTO classes (id, name, course_name, created_at) VALUES (?, ?, ?, ?)",
        ("class_two", "二班", "具身智能导论", NOW),
    )
    conn.execute(
        "INSERT INTO class_teachers (class_id, teacher_id, assigned_at) VALUES (?, ?, ?)",
        ("class_two", "teacher_two", NOW),
    )
    conn.execute(
        "INSERT INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)",
        ("class_two", "student_two", NOW),
    )
    conn.execute(
        """INSERT INTO section_learning_progress (
               user_id, section_key, chapter_title, section_number, section_title,
               access_count, first_accessed_at, last_accessed_at
           ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)""",
        (
            "demo_student",
            "book:1.1",
            "绪论",
            "1.1",
            "具身智能概述",
            NOW,
            NOW,
        ),
    )
    conn.execute(
        """INSERT INTO practice_sessions (
               id, user_id, section_key, chapter_title, section_number, section_title,
               difficulty, question_types_json, question_count, status,
               total_score, max_score, created_at, submitted_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'submitted', 50, 100, ?, ?)""",
        (
            "session_demo",
            "demo_student",
            "book:1.1",
            "绪论",
            "1.1",
            "具身智能概述",
            "medium",
            '["single_choice"]',
            NOW,
            NOW,
        ),
    )
    conn.execute(
        """INSERT INTO questions (
               id, session_id, type, stem, options_json, correct_answer_json,
               analysis, rubric_json, difficulty, knowledge_point,
               source_chunk_id, citation_json, max_score, sort_order
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 10, 1)""",
        (
            "question_demo",
            "session_demo",
            "single_choice",
            "测试题",
            '["选项A", "选项B"]',
            '"A"',
            "解析",
            "{}",
            "medium",
            "感知与行动闭环",
            "chunk_1",
            "{}",
        ),
    )
    conn.execute(
        """INSERT INTO answer_records (
               id, session_id, question_id, user_id, answer_json,
               score, is_correct, feedback_json, submitted_at
           ) VALUES (?, ?, ?, ?, ?, 5, 1, ?, ?)""",
        (
            "answer_demo",
            "session_demo",
            "question_demo",
            "demo_student",
            '"A"',
            '{"feedback":"继续巩固"}',
            NOW,
        ),
    )
    conn.commit()
    return conn


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(auth_router)
    app.include_router(teacher_router)
    return app


def _login(client: TestClient, username: str, password: str) -> str:
    response = client.post(
        "/api/auth/login", json={"username": username, "password": password}
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_teacher_dashboard_uses_real_learning_data_and_class_scope():
    conn = _memory_db()
    with (
        patch("app.services.auth_service.get_db", return_value=conn),
        patch("app.services.teacher_service.get_db", return_value=conn),
        patch("app.services.learning_service.get_db", return_value=conn),
        TestClient(_app()) as client,
    ):
        teacher_token = _login(client, "teacher", "teacher123")
        other_teacher_token = _login(client, "teacher_two", "teacher234")
        student_token = _login(client, "student", "student123")

        own_classes = client.get(
            "/api/teacher/classes", headers=_headers(teacher_token)
        )
        assert own_classes.status_code == 200
        assert [item["id"] for item in own_classes.json()["items"]] == ["demo_class"]
        overview = own_classes.json()["items"][0]
        assert overview["student_count"] == 1
        assert overview["engaged_student_count"] == 1
        assert overview["completed_practices"] == 1
        assert overview["average_score_rate"] == 50.0

        other_classes = client.get(
            "/api/teacher/classes", headers=_headers(other_teacher_token)
        )
        assert [item["id"] for item in other_classes.json()["items"]] == ["class_two"]
        assert client.get(
            "/api/teacher/classes/class_two/overview",
            headers=_headers(teacher_token),
        ).status_code == 403
        assert client.get(
            "/api/teacher/classes", headers=_headers(student_token)
        ).status_code == 403

        students = client.get(
            "/api/teacher/classes/demo_class/students?page=1&page_size=10",
            headers=_headers(teacher_token),
        )
        assert students.status_code == 200
        assert students.json()["items"][0]["overall_score_rate"] == 50.0

        detail = client.get(
            "/api/teacher/classes/demo_class/students/demo_student",
            headers=_headers(teacher_token),
        )
        assert detail.status_code == 200
        assert detail.json()["learning"]["summary"]["completed_practices"] == 1

        weak = client.get(
            "/api/teacher/classes/demo_class/weak-knowledge",
            headers=_headers(teacher_token),
        )
        assert weak.status_code == 200
        assert weak.json()["items"][0]["knowledge_point"] == "感知与行动闭环"
        assert weak.json()["items"][0]["score_rate"] == 50.0
    conn.close()
