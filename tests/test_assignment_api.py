from __future__ import annotations

import json
import sqlite3
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.auth import router as auth_router
from app.api.learning import router as learning_router
from app.api.practice import router as practice_router
from app.api.teacher import router as teacher_router
from app.db.sqlite import initialize_schema


SECTION_KEY = "book:1.1"
KNOWLEDGE_POINT = "Target Knowledge"


def _memory_db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    initialize_schema(conn)
    conn.execute(
        "INSERT INTO classes (id, name, course_name, created_at) VALUES ('class_two', 'Other', 'Course', '2026-08-05T00:00:00+00:00')"
    )
    conn.execute(
        """INSERT INTO users (
               id, username, password_hash, display_name, role, is_active, created_at, updated_at
           ) VALUES ('teacher_two', 'teacher_two', ?, 'Teacher Two', 'teacher', 1, ?, ?)""",
        (
            conn.execute("SELECT password_hash FROM users WHERE id = 'demo_teacher'").fetchone()[0],
            "2026-08-05T00:00:00+00:00",
            "2026-08-05T00:00:00+00:00",
        ),
    )
    conn.execute(
        """INSERT INTO users (
               id, username, password_hash, display_name, role, is_active, created_at, updated_at
           ) VALUES ('student_two', 'student_two', ?, 'Student Two', 'student', 1, ?, ?)""",
        (
            conn.execute("SELECT password_hash FROM users WHERE id = 'demo_student'").fetchone()[0],
            "2026-08-05T00:00:00+00:00",
            "2026-08-05T00:00:00+00:00",
        ),
    )
    conn.execute(
        "INSERT INTO class_teachers (class_id, teacher_id, assigned_at) VALUES ('class_two', 'teacher_two', '2026-08-05T00:00:00+00:00')"
    )
    conn.execute(
        "INSERT INTO class_students (class_id, student_id, joined_at) VALUES ('class_two', 'student_two', '2026-08-05T00:00:00+00:00')"
    )

    citation = json.dumps(
        {
            "chunk_id": "chunk-1",
            "book": "book",
            "chapter_title": "chapter",
            "section_number": "1.1",
            "section_title": "section",
            "quote": "quote",
        }
    )
    bank_rows = [
        (
            "bank-choice",
            "single_choice",
            "Choice question",
            '["A", "B"]',
            '"A"',
        ),
        (
            "bank-boolean",
            "true_false",
            "Boolean question",
            "[]",
            "true",
        ),
    ]
    for question_id, question_type, stem, options, answer in bank_rows:
        conn.execute(
            """INSERT INTO question_bank (
                   id, section_key, chapter_title, section_number, section_title,
                   type, stem, options_json, correct_answer_json, analysis, rubric_json,
                   difficulty, knowledge_point, source_chunk_id, citation_json, status, created_at
               ) VALUES (?, ?, 'chapter', '1.1', 'section', ?, ?, ?, ?, 'analysis', '[]',
                         'medium', ?, 'chunk-1', ?, 'active', '2026-08-05T00:00:00+00:00')""",
            (question_id, SECTION_KEY, question_type, stem, options, answer, KNOWLEDGE_POINT, citation),
        )
    conn.commit()
    return conn


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(auth_router)
    app.include_router(teacher_router)
    app.include_router(learning_router)
    app.include_router(practice_router)
    return app


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _login(client: TestClient, username: str, password: str) -> str:
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200
    return response.json()["access_token"]


def _assignment_payload(question_count: int = 2) -> dict[str, object]:
    return {
        "title": "Target Knowledge Review",
        "description": "Practice the identified knowledge gap.",
        "section_key": SECTION_KEY,
        "chapter_title": "chapter",
        "section_number": "1.1",
        "section_title": "section",
        "knowledge_point": KNOWLEDGE_POINT,
        "difficulty": "medium",
        "question_types": ["single_choice", "true_false"],
        "question_count": question_count,
        "due_at": None,
    }


def _section_assignment_payload(question_count: int = 2) -> dict[str, object]:
    payload = _assignment_payload(question_count)
    payload.update(
        {
            "title": "Section Practice",
            "description": "Practice the full course section.",
            "knowledge_point": "",
        }
    )
    return payload


def _patched_client(conn: sqlite3.Connection):
    return (
        patch("app.services.auth_service.get_db", return_value=conn),
        patch("app.services.teacher_service.get_db", return_value=conn),
        patch("app.services.learning_service.get_db", return_value=conn),
        patch("app.services.practice_service.get_db", return_value=conn),
        patch("app.services.assignment_service.get_db", return_value=conn),
    )


def test_assignment_publish_start_submit_and_effect_tracking():
    conn = _memory_db()
    patches = _patched_client(conn)
    with patches[0], patches[1], patches[2], patches[3], patches[4], TestClient(_app()) as client:
        teacher_token = _login(client, "teacher", "teacher123")
        student_token = _login(client, "student", "student123")

        created = client.post(
            "/api/teacher/classes/demo_class/assignments",
            json=_assignment_payload(),
            headers=_headers(teacher_token),
        )
        assert created.status_code == 201
        assignment = created.json()
        assignment_id = assignment["id"]
        assert assignment["total_students"] == 1
        assert assignment["assigned_students"] == 1
        assert assignment["baseline_average"] == 0.0

        listed = client.get("/api/learning/assignments", headers=_headers(student_token))
        assert listed.status_code == 200
        assert listed.json()["items"][0]["id"] == assignment_id
        assert listed.json()["items"][0]["progress_status"] == "assigned"

        started = client.post(
            f"/api/learning/assignments/{assignment_id}/start",
            headers=_headers(student_token),
        )
        assert started.status_code == 200
        session = started.json()
        assert session["assignment_id"] == assignment_id
        assert len(session["questions"]) == 2

        restarted = client.post(
            f"/api/learning/assignments/{assignment_id}/start",
            headers=_headers(student_token),
        )
        assert restarted.status_code == 200
        assert restarted.json()["session_id"] == session["session_id"]

        answers = []
        for question in session["questions"]:
            answers.append(
                {
                    "question_id": question["id"],
                    "answer": "A" if question["type"] == "single_choice" else True,
                }
            )
        submitted = client.post(
            f"/api/practice/{session['session_id']}/submit",
            json={"answers": answers},
            headers=_headers(student_token),
        )
        assert submitted.status_code == 200
        assert submitted.json()["total_score"] == 100.0

        detail = client.get(
            f"/api/teacher/classes/demo_class/assignments/{assignment_id}",
            headers=_headers(teacher_token),
        )
        assert detail.status_code == 200
        payload = detail.json()
        assert payload["completed_students"] == 1
        assert payload["completion_rate"] == 100.0
        assert payload["average_practice_score"] == 100.0
        assert payload["post_average"] == 100.0
        assert payload["average_improvement"] == 100.0
        assert payload["students"][0]["status"] == "completed"

        section_mastery = client.get(
            "/api/teacher/classes/demo_class/section-mastery",
            headers=_headers(teacher_token),
        )
        assert section_mastery.status_code == 200
        section = section_mastery.json()["items"][0]
        assert section["section_key"] == SECTION_KEY
        assert section["student_count"] == 1
        assert section["attempts"] == 2
        assert section["score_rate"] == 100.0
        assert section["available_question_count"] == 2

        session_row = conn.execute(
            "SELECT assignment_id FROM practice_sessions WHERE id = ?",
            (session["session_id"],),
        ).fetchone()
        assert session_row["assignment_id"] == assignment_id
    conn.close()


def test_section_scoped_assignment_uses_all_selected_section_questions():
    conn = _memory_db()
    patches = _patched_client(conn)
    with patches[0], patches[1], patches[2], patches[3], patches[4], TestClient(_app()) as client:
        teacher_token = _login(client, "teacher", "teacher123")
        student_token = _login(client, "student", "student123")

        mastery = client.get(
            "/api/teacher/classes/demo_class/section-mastery",
            headers=_headers(teacher_token),
        )
        assert mastery.status_code == 200
        assert mastery.json()["items"][0]["section_key"] == SECTION_KEY
        assert mastery.json()["items"][0]["attempts"] == 0
        assert mastery.json()["items"][0]["available_question_count"] == 2

        created = client.post(
            "/api/teacher/classes/demo_class/assignments",
            json=_section_assignment_payload(),
            headers=_headers(teacher_token),
        )
        assert created.status_code == 201
        assert created.json()["knowledge_point"] == ""

        started = client.post(
            f"/api/learning/assignments/{created.json()['id']}/start",
            headers=_headers(student_token),
        )
        assert started.status_code == 200
        assert len(started.json()["questions"]) == 2
    conn.close()


def test_assignment_permissions_question_capacity_close_and_delete_cleanup():
    conn = _memory_db()
    patches = _patched_client(conn)
    with patches[0], patches[1], patches[2], patches[3], patches[4], TestClient(_app()) as client:
        teacher_token = _login(client, "teacher", "teacher123")
        student_token = _login(client, "student", "student123")

        forbidden = client.post(
            "/api/teacher/classes/class_two/assignments",
            json=_assignment_payload(),
            headers=_headers(teacher_token),
        )
        assert forbidden.status_code == 403

        too_many = client.post(
            "/api/teacher/classes/demo_class/assignments",
            json=_assignment_payload(question_count=3),
            headers=_headers(teacher_token),
        )
        assert too_many.status_code == 409

        created = client.post(
            "/api/teacher/classes/demo_class/assignments",
            json=_assignment_payload(),
            headers=_headers(teacher_token),
        )
        assignment_id = created.json()["id"]
        closed = client.post(
            f"/api/teacher/classes/demo_class/assignments/{assignment_id}/close",
            headers=_headers(teacher_token),
        )
        assert closed.status_code == 200
        assert closed.json()["status"] == "closed"
        assert client.post(
            f"/api/learning/assignments/{assignment_id}/start",
            headers=_headers(student_token),
        ).status_code == 409

        active = client.post(
            "/api/teacher/classes/demo_class/assignments",
            json=_assignment_payload(),
            headers=_headers(teacher_token),
        ).json()
        started = client.post(
            f"/api/learning/assignments/{active['id']}/start",
            headers=_headers(student_token),
        )
        assert started.status_code == 200
        session_id = started.json()["session_id"]

        deleted = client.delete(
            f"/api/teacher/classes/demo_class/assignments/{active['id']}",
            headers=_headers(teacher_token),
        )
        assert deleted.status_code == 204
        assert client.get("/api/learning/assignments", headers=_headers(student_token)).json()["total"] == 1
        session_row = conn.execute(
            "SELECT assignment_id, status FROM practice_sessions WHERE id = ?",
            (session_id,),
        ).fetchone()
        assert session_row["assignment_id"] is None
        assert session_row["status"] == "active"
    conn.close()
