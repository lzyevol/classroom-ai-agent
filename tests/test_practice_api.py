from __future__ import annotations

import json
import sqlite3
from unittest.mock import AsyncMock, patch

import pytest

from app.db.sqlite import initialize_schema
from app.schemas.practice import PracticeGenerateRequest, PracticeSubmitRequest
from app.services.practice_service import (
    PracticeNotFoundError,
    _grade_objective,
    _normalize_generated_questions,
    _select_bank_questions,
    generate_practice,
    submit_practice,
)


GENERATED_SESSION = {
    "session_id": "practice-1",
    "section_key": "book:1.1",
    "chapter_title": "具身智能概述",
    "section_number": "1.1",
    "section_title": "引言",
    "difficulty": "medium",
    "status": "active",
    "created_at": "2026-07-24T00:00:00+00:00",
    "questions": [
        {
            "id": "question-1",
            "type": "single_choice",
            "stem": "具身智能强调什么？",
            "options": ["身体与环境交互", "只进行符号推理", "不需要感知", "不需要行动"],
            "difficulty": "medium",
            "knowledge_point": "具身智能",
            "max_score": 100,
        }
    ],
}


SUBMIT_RESULT = {
    "session_id": "practice-1",
    "status": "submitted",
    "total_score": 100,
    "max_score": 100,
    "correct_count": 1,
    "question_count": 1,
    "submitted_at": "2026-07-24T00:05:00+00:00",
    "results": [
        {
            "question_id": "question-1",
            "type": "single_choice",
            "stem": "具身智能强调什么？",
            "options": ["身体与环境交互", "只进行符号推理", "不需要感知", "不需要行动"],
            "answer": "A",
            "correct_answer": "A",
            "score": 100,
            "max_score": 100,
            "is_correct": True,
            "analysis": "具身智能强调身体、感知、行动和环境之间的交互。",
            "feedback": "回答正确。",
            "knowledge_point": "具身智能",
            "citation": {
                "chunk_id": "chunk-1",
                "book": "具身智能导论",
                "chapter_title": "具身智能概述",
                "section_number": "1.1",
                "section_title": "引言",
                "quote": "具身智能强调身体与环境交互。",
            },
        }
    ],
}


def test_generate_practice_endpoint_hides_answers(client):
    with patch(
        "app.api.practice.generate_practice",
        new_callable=AsyncMock,
        return_value=GENERATED_SESSION,
    ) as mock_generate:
        response = client.post(
            "/api/practice/generate",
            json={
                "section_key": "book:1.1",
                "question_types": ["single_choice"],
                "difficulty": "medium",
                "question_count": 1,
                "user_id": "other_student",
            },
        )

    assert response.status_code == 200
    mock_generate.assert_awaited_once()
    assert mock_generate.await_args.args[1] == "demo_student"
    question = response.json()["questions"][0]
    assert "correct_answer" not in question
    assert "analysis" not in question
    assert "citation" not in question


def test_submit_practice_endpoint_returns_grading(client):
    with patch(
        "app.api.practice.submit_practice",
        new_callable=AsyncMock,
        return_value=SUBMIT_RESULT,
    ) as mock_submit:
        response = client.post(
            "/api/practice/practice-1/submit",
            json={
                "user_id": "other_student",
                "answers": [{"question_id": "question-1", "answer": "A"}],
            },
        )

    assert response.status_code == 200
    mock_submit.assert_awaited_once()
    assert mock_submit.await_args.args[2] == "demo_student"
    assert response.json()["total_score"] == 100
    assert response.json()["results"][0]["options"][0] == "身体与环境交互"
    assert response.json()["results"][0]["citation"]["quote"] == "具身智能强调身体与环境交互。"


def test_generated_questions_use_real_chunk_citation():
    request = PracticeGenerateRequest(
        section_key="book:1.1",
        question_types=["single_choice", "true_false", "short_answer"],
        question_count=3,
    )
    records = [
        {
            "chunk_id": "chunk-1",
            "content_clean": "具身智能强调身体与环境交互。",
            "quote_original": "具身智能，顾名思义就是具备了身体的智能。",
            "chapter_title": "具身智能概述",
            "section_number": "1.1",
            "section_title": "引言",
            "entity_names": ["具身智能"],
        }
    ]
    payload = {
        "questions": [
            {
                "type": "single_choice",
                "stem": "具身智能强调什么？",
                "options": ["身体与环境交互", "纯符号推理", "固定规则", "脱离环境"],
                "correct_answer": "A",
                "analysis": "强调身体与环境交互。",
                "knowledge_point": "具身智能",
                "source_chunk_id": "chunk-1",
            },
            {
                "type": "true_false",
                "stem": "具身智能可以完全脱离环境。",
                "correct_answer": False,
                "analysis": "具身智能离不开环境交互。",
                "knowledge_point": "具身智能",
                "source_chunk_id": "model-invented-chunk",
            },
            {
                "type": "short_answer",
                "stem": "简述具身智能的核心特点。",
                "correct_answer": "身体、感知、行动与环境形成交互闭环。",
                "analysis": "核心是身体与环境交互。",
                "rubric": [
                    {"point": "提到身体", "weight": 0.4},
                    {"point": "提到环境交互", "weight": 0.6},
                ],
                "knowledge_point": "具身智能",
                "source_chunk_id": "chunk-1",
            },
        ]
    }

    questions = _normalize_generated_questions(payload, request, records)

    assert len(questions) == 3
    assert round(sum(item["max_score"] for item in questions), 2) == 100
    assert all(item["citation"]["chunk_id"] == "chunk-1" for item in questions)
    assert all(item["citation"]["quote"] == records[0]["quote_original"] for item in questions)


def test_objective_grading_is_deterministic():
    correct = _grade_objective("single_choice", "A", "A", 25)
    wrong = _grade_objective("true_false", "错误", True, 25)

    assert correct["score"] == 25
    assert correct["is_correct"] is True
    assert wrong["score"] == 0
    assert wrong["is_correct"] is False


@pytest.mark.asyncio
async def test_generate_practice_draws_from_saved_question_bank():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    initialize_schema(conn)
    citation = {
        "chunk_id": "chunk-1",
        "book": "具身智能导论",
        "chapter_title": "具身智能概述",
        "section_number": "1.1",
        "section_title": "引言",
        "quote": "具身智能强调身体与环境交互。",
    }
    bank_rows = [
        (
            "bank-1",
            "single_choice",
            "具身智能强调什么？",
            ["身体与环境交互", "脱离环境", "只用符号", "不需要行动"],
            "A",
            "medium",
        ),
        (
            "bank-2",
            "true_false",
            "具身智能可以完全脱离环境。",
            ["正确", "错误"],
            False,
            "easy",
        ),
    ]
    for bank_id, question_type, stem, options, answer, difficulty in bank_rows:
        conn.execute(
            """INSERT INTO question_bank (
                   id, section_key, chapter_title, section_number,
                   section_title, type, stem, options_json,
                   correct_answer_json, analysis, rubric_json, difficulty,
                   knowledge_point, source_chunk_id, citation_json,
                   status, created_at
               ) VALUES (?, 'book:1.1', '具身智能概述', '1.1', '引言', ?, ?, ?, ?,
                         '教材解析', '[]', ?, '具身智能', 'chunk-1', ?, 'active', ?)""",
            (
                bank_id,
                question_type,
                stem,
                json.dumps(options, ensure_ascii=False),
                json.dumps(answer, ensure_ascii=False),
                difficulty,
                json.dumps(citation, ensure_ascii=False),
                "2026-07-24T00:00:00+00:00",
            ),
        )
    conn.commit()
    request = PracticeGenerateRequest(
        section_key="book:1.1",
        question_types=["single_choice", "true_false"],
        difficulty="medium",
        question_count=2,
    )

    with (
        patch("app.services.practice_service.get_db", return_value=conn),
        patch(
            "app.services.practice_service.get_driver",
            side_effect=AssertionError("组卷时不应访问 Neo4j 或调用模型"),
        ),
    ):
        result = await generate_practice(request, "demo_student")

    assert len(result["questions"]) == 2
    assert sum(question["max_score"] for question in result["questions"]) == 100
    assert conn.execute("SELECT COUNT(*) FROM question_bank").fetchone()[0] == 2
    copied = conn.execute(
        "SELECT bank_question_id FROM questions ORDER BY sort_order"
    ).fetchall()
    assert {row["bank_question_id"] for row in copied} == {"bank-1", "bank-2"}
    conn.close()


def test_knowledge_point_selection_never_fills_with_unrelated_questions():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    initialize_schema(conn)
    rows = [
        ("bank-target-1", "目标知识点", "目标知识点题目一"),
        ("bank-target-2", "目标知识点的扩展", "目标知识点题目二"),
        ("bank-unrelated", "无关知识点", "同章节但内容无关的题目"),
    ]
    for bank_id, knowledge_point, stem in rows:
        conn.execute(
            """INSERT INTO question_bank (
                   id, section_key, chapter_title, section_number,
                   section_title, type, stem, options_json,
                   correct_answer_json, analysis, rubric_json, difficulty,
                   knowledge_point, source_chunk_id, citation_json,
                   status, created_at
               ) VALUES (?, 'book:1.1', '具身智能概述', '1.1', '引言',
                         'single_choice', ?, '["选项一", "选项二"]', '"A"',
                         '教材解析', '[]', 'medium', ?, 'chunk-1', '{}',
                         'active', '2026-07-24T00:00:00+00:00')""",
            (bank_id, stem, knowledge_point),
        )
    conn.commit()

    request = PracticeGenerateRequest(
        section_key="book:1.1",
        question_types=["single_choice"],
        difficulty="medium",
        question_count=3,
        knowledge_point="目标知识点",
    )
    missing_request = request.model_copy(update={"knowledge_point": "不存在的知识点"})

    with patch("app.services.practice_service.get_db", return_value=conn):
        selected = _select_bank_questions(request)
        with pytest.raises(PracticeNotFoundError, match="暂无.*专项题目"):
            _select_bank_questions(missing_request)

    assert len(selected) == 2
    assert {item["id"] for item in selected} == {"bank-target-1", "bank-target-2"}
    assert all(item["id"] != "bank-unrelated" for item in selected)
    conn.close()


@pytest.mark.asyncio
async def test_submit_practice_persists_objective_and_short_results():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    initialize_schema(conn)
    conn.execute(
        """INSERT INTO practice_sessions (
               id, user_id, section_key, chapter_title, section_number,
               section_title, difficulty, question_types_json,
               question_count, status, max_score, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 100, ?)""",
        (
            "practice-test",
            "demo_student",
            "book:1.1",
            "具身智能概述",
            "1.1",
            "引言",
            "medium",
            json.dumps(["single_choice", "short_answer"]),
            2,
            "2026-07-24T00:00:00+00:00",
        ),
    )
    citation = {
        "chunk_id": "chunk-1",
        "book": "具身智能导论",
        "chapter_title": "具身智能概述",
        "section_number": "1.1",
        "section_title": "引言",
        "quote": "具身智能强调身体与环境交互。",
    }
    question_rows = [
        (
            "q1", "single_choice", "核心特点是什么？",
            ["身体与环境交互", "脱离环境", "只用规则", "不需要感知"],
            "A", [], 50, 1,
        ),
        (
            "q2", "short_answer", "简述核心特点。", [],
            "身体与环境交互。", [{"point": "提到环境交互", "weight": 1}], 50, 2,
        ),
    ]
    for question_id, question_type, stem, options, answer, rubric, score, order in question_rows:
        conn.execute(
            """INSERT INTO questions (
                   id, session_id, type, stem, options_json,
                   correct_answer_json, analysis, rubric_json, difficulty,
                   knowledge_point, source_chunk_id, citation_json,
                   max_score, sort_order
               ) VALUES (?, 'practice-test', ?, ?, ?, ?, ?, ?, 'medium', ?, 'chunk-1', ?, ?, ?)""",
            (
                question_id,
                question_type,
                stem,
                json.dumps(options, ensure_ascii=False),
                json.dumps(answer, ensure_ascii=False),
                "教材解析",
                json.dumps(rubric, ensure_ascii=False),
                "具身智能",
                json.dumps(citation, ensure_ascii=False),
                score,
                order,
            ),
        )
    conn.commit()

    short_grade = {
        "q2": {
            "score": 40.0,
            "is_correct": True,
            "feedback": "覆盖了核心评分点。",
            "covered_points": ["提到环境交互"],
            "missing_points": [],
            "errors": [],
            "review_required": False,
        }
    }
    request = PracticeSubmitRequest(
        answers=[
            {"question_id": "q1", "answer": "A"},
            {"question_id": "q2", "answer": "智能体通过身体和环境交互。"},
        ]
    )
    with (
        patch("app.services.practice_service.get_db", return_value=conn),
        patch(
            "app.services.practice_service._grade_short_answers",
            new_callable=AsyncMock,
            return_value=short_grade,
        ),
    ):
        result = await submit_practice("practice-test", request, "demo_student")

    assert result["total_score"] == 90
    assert result["correct_count"] == 2
    assert result["results"][0]["options"] == [
        "身体与环境交互", "脱离环境", "只用规则", "不需要感知"
    ]
    assert conn.execute("SELECT COUNT(*) FROM answer_records").fetchone()[0] == 2
    status = conn.execute(
        "SELECT status, total_score FROM practice_sessions WHERE id='practice-test'"
    ).fetchone()
    assert status["status"] == "submitted"
    assert status["total_score"] == 90
    conn.close()
