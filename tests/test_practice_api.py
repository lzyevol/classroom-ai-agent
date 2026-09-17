from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import app.db.sqlite as sqlite_module
from app.security import hash_password
from scripts.seed_practice_bank import seed

SECTION_1_1 = "book_embodied_ai_intro_2024:1.1"
SECTION_1_2 = "book_embodied_ai_intro_2024:1.2"


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _login(client: TestClient, username: str = "student", password: str = "student123") -> str:
    response = client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def _seed_default_bank() -> sqlite3.Connection:
    conn = sqlite_module.get_db()
    seed(connection=conn)
    return conn


def _generate(client: TestClient, token: str, **overrides) -> dict:
    payload = {
        "section_key": SECTION_1_1,
        "question_types": ["single_choice"],
        "difficulty": "medium",
        "question_count": 3,
    }
    payload.update(overrides)
    response = client.post("/api/practice/generate", headers=_headers(token), json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def _correct_answers(session_id: str) -> list[dict]:
    conn = sqlite_module.get_db()
    rows = conn.execute(
        "SELECT id, correct_answer_json FROM questions WHERE session_id = ? ORDER BY sort_order",
        (session_id,),
    ).fetchall()
    return [
        {"question_id": row["id"], "answer": json.loads(row["correct_answer_json"])}
        for row in rows
    ]


def test_seed_then_generate_and_submit_success(client):
    _seed_default_bank()
    token = _login(client)
    data = _generate(client, token)
    assert data["status"] == "active"
    assert len(data["questions"]) == 3
    assert data["section_number"] == "1.1"

    question = data["questions"][0]
    assert "correct_answer" not in question
    assert "analysis" not in question
    assert "citation" not in question
    assert len(question["options"]) == 4

    answers = _correct_answers(data["session_id"])
    assert len(answers) == 3
    response = client.post(
        f"/api/practice/{data['session_id']}/submit",
        headers=_headers(token),
        json={"answers": answers},
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["status"] == "submitted"
    assert result["question_count"] == 3
    assert result["correct_count"] == 3
    assert result["total_score"] == result["max_score"] == 100
    assert result["results"][0]["review_required"] is False
    # Every result carries the real textbook citation from the seed.
    assert result["results"][0]["citation"]["chunk_id"].startswith("book_embodied_ai_intro_2024:")


def test_generate_requires_auth_401(client):
    response = client.post(
        "/api/practice/generate",
        json={
            "section_key": SECTION_1_1,
            "question_types": ["single_choice"],
            "question_count": 3,
        },
    )
    assert response.status_code == 401

    bad = client.post(
        "/api/practice/generate",
        headers=_headers("not-a-token"),
        json={
            "section_key": SECTION_1_1,
            "question_types": ["single_choice"],
            "question_count": 3,
        },
    )
    assert bad.status_code == 401


def test_generate_forbidden_for_teacher_403(client):
    _seed_default_bank()
    token = _login(client, "teacher", "teacher123")
    response = client.post(
        "/api/practice/generate",
        headers=_headers(token),
        json={
            "section_key": SECTION_1_1,
            "question_types": ["single_choice"],
            "question_count": 3,
        },
    )
    assert response.status_code == 403


def test_submit_unknown_session_404(client):
    _seed_default_bank()
    token = _login(client)
    response = client.post(
        "/api/practice/practice-does-not-exist/submit",
        headers=_headers(token),
        json={"answers": [{"question_id": "q", "answer": "A"}]},
    )
    assert response.status_code == 404


def test_generate_section_without_bank_404(client):
    _seed_default_bank()
    token = _login(client)
    response = client.post(
        "/api/practice/generate",
        headers=_headers(token),
        json={
            "section_key": "book_embodied_ai_intro_2024:9.9",
            "question_types": ["single_choice"],
            "question_count": 3,
        },
    )
    assert response.status_code == 404
    assert "暂无可用练习题" in response.json()["detail"]


def test_generate_insufficient_bank_404(client):
    _seed_default_bank()
    token = _login(client)
    # Section 1.1 has exactly 5 single_choice questions in the seed.
    response = client.post(
        "/api/practice/generate",
        headers=_headers(token),
        json={
            "section_key": SECTION_1_1,
            "question_types": ["single_choice"],
            "question_count": 6,
        },
    )
    assert response.status_code == 404
    assert "题库不足" in response.json()["detail"]


def test_generate_type_with_no_bank_questions_404(client):
    _seed_default_bank()
    token = _login(client)
    response = client.post(
        "/api/practice/generate",
        headers=_headers(token),
        json={
            "section_key": SECTION_1_1,
            "question_types": ["short_answer"],
            "question_count": 1,
        },
    )
    assert response.status_code == 404
    assert "简答题" in response.json()["detail"]


def test_generate_unsupported_type_422(client):
    _seed_default_bank()
    token = _login(client)
    response = client.post(
        "/api/practice/generate",
        headers=_headers(token),
        json={
            "section_key": SECTION_1_1,
            "question_types": ["essay"],
            "question_count": 1,
        },
    )
    assert response.status_code == 422


def test_submit_incomplete_answers_422(client):
    _seed_default_bank()
    token = _login(client)
    data = _generate(client, token)
    answers = _correct_answers(data["session_id"])[:2]
    response = client.post(
        f"/api/practice/{data['session_id']}/submit",
        headers=_headers(token),
        json={"answers": answers},
    )
    assert response.status_code == 422
    # Nothing may be written for a rejected submission.
    conn = sqlite_module.get_db()
    count = conn.execute(
        "SELECT COUNT(*) FROM answer_records WHERE session_id = ?",
        (data["session_id"],),
    ).fetchone()[0]
    assert count == 0


def test_submit_duplicate_question_id_422(client):
    _seed_default_bank()
    token = _login(client)
    data = _generate(client, token)
    question_id = data["questions"][0]["id"]
    response = client.post(
        f"/api/practice/{data['session_id']}/submit",
        headers=_headers(token),
        json={
            "answers": [
                {"question_id": question_id, "answer": "A"},
                {"question_id": question_id, "answer": "B"},
            ]
        },
    )
    assert response.status_code == 422


def test_submit_out_of_range_answer_422(client):
    _seed_default_bank()
    token = _login(client)
    data = _generate(client, token)
    question_id = data["questions"][0]["id"]
    other_ids = [item["id"] for item in data["questions"][1:]]
    answers = [{"question_id": other_id, "answer": "A"} for other_id in other_ids]
    answers.append({"question_id": question_id, "answer": "E"})
    response = client.post(
        f"/api/practice/{data['session_id']}/submit",
        headers=_headers(token),
        json={"answers": answers},
    )
    assert response.status_code == 422
    assert "超出选项范围" in response.json()["detail"]


def test_double_submit_returns_409_without_duplicate_records(client):
    _seed_default_bank()
    token = _login(client)
    data = _generate(client, token)
    answers = _correct_answers(data["session_id"])
    first = client.post(
        f"/api/practice/{data['session_id']}/submit",
        headers=_headers(token),
        json={"answers": answers},
    )
    assert first.status_code == 200
    second = client.post(
        f"/api/practice/{data['session_id']}/submit",
        headers=_headers(token),
        json={"answers": answers},
    )
    assert second.status_code == 409

    conn = sqlite_module.get_db()
    records = conn.execute(
        "SELECT COUNT(*) FROM answer_records WHERE session_id = ?",
        (data["session_id"],),
    ).fetchone()[0]
    assert records == len(answers)


def test_submit_other_users_session_returns_404_even_if_submitted(client):
    _seed_default_bank()
    conn = sqlite_module.get_db()
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT INTO users (
               id, username, password_hash, display_name, role,
               is_active, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'student', 1, ?, ?)""",
        ("student2", "student2", hash_password("student2123"), "学生二", now, now),
    )
    conn.commit()

    token_a = _login(client, "student", "student123")
    token_b = _login(client, "student2", "student2123")

    data = _generate(client, token_a)
    answers = _correct_answers(data["session_id"])
    submitted = client.post(
        f"/api/practice/{data['session_id']}/submit",
        headers=_headers(token_a),
        json={"answers": answers},
    )
    assert submitted.status_code == 200

    # Ownership must be checked before session state: a foreign user must get
    # 404 (resource hidden), never 409 (which would leak the submitted state).
    foreign = client.post(
        f"/api/practice/{data['session_id']}/submit",
        headers=_headers(token_b),
        json={"answers": answers},
    )
    assert foreign.status_code == 404


def test_submitted_session_state_persists_across_connections(client):
    _seed_default_bank()
    token = _login(client)
    data = _generate(client, token)
    answers = _correct_answers(data["session_id"])
    submitted = client.post(
        f"/api/practice/{data['session_id']}/submit",
        headers=_headers(token),
        json={"answers": answers},
    )
    assert submitted.status_code == 200

    # A fresh connection to the same database file must observe the submitted
    # state and the persisted answers (no process restart needed, same file).
    db_path = sqlite_module.DB_PATH
    fresh = sqlite3.connect(str(db_path))
    fresh.row_factory = sqlite3.Row
    try:
        session = fresh.execute(
            "SELECT status, total_score FROM practice_sessions WHERE id = ?",
            (data["session_id"],),
        ).fetchone()
        assert session["status"] == "submitted"
        assert session["total_score"] == 100
        records = fresh.execute(
            "SELECT COUNT(*) AS total FROM answer_records WHERE session_id = ?",
            (data["session_id"],),
        ).fetchone()
        assert records["total"] == len(answers)
    finally:
        fresh.close()


@pytest.mark.asyncio
async def test_generate_draws_from_bank_without_neo4j_or_model():
    conn = _seed_default_bank()
    from app.schemas.practice import PracticeGenerateRequest
    from app.services.practice_service import generate_practice

    request = PracticeGenerateRequest(
        section_key=SECTION_1_2,
        question_types=["single_choice"],
        difficulty="medium",
        question_count=3,
    )
    with (
        patch("app.services.practice_service.get_db", return_value=conn),
        patch(
            "app.services.practice_service.get_driver",
            side_effect=AssertionError("组卷时不应访问 Neo4j 或调用模型"),
        ),
    ):
        result = await generate_practice(request, "demo_student")

    assert len(result["questions"]) == 3
    assert round(sum(item["max_score"] for item in result["questions"]), 2) == 100
