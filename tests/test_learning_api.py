from __future__ import annotations

import json
import sqlite3
from unittest.mock import patch

from app.db.sqlite import initialize_schema
from app.schemas.learning import SectionAccessRequest
from app.services.learning_service import (
    get_knowledge_review,
    get_learning_dashboard,
    record_section_access,
)


def _memory_db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    initialize_schema(conn)
    return conn


def test_record_section_access_upserts_progress():
    conn = _memory_db()
    request = SectionAccessRequest(
        section_key="book:1.1",
        chapter_title="具身智能概述",
        section_number="1.1",
        section_title="引言",
    )
    with patch("app.services.learning_service.get_db", return_value=conn):
        first = record_section_access(request, "demo_student")
        second = record_section_access(request, "demo_student")

    assert first["access_count"] == 1
    assert second["access_count"] == 2
    assert second["first_accessed_at"] == first["first_accessed_at"]
    conn.close()


def test_learning_dashboard_aggregates_mastery_mistakes_and_recommendations():
    conn = _memory_db()
    conn.execute(
        """INSERT INTO section_learning_progress (
               user_id, section_key, chapter_title, section_number, section_title,
               access_count, first_accessed_at, last_accessed_at
           ) VALUES ('demo_student', 'book:1.1', '具身智能概述', '1.1', '引言',
                     2, '2026-07-24T00:00:00+00:00', '2026-07-24T00:10:00+00:00')"""
    )
    conn.execute(
        """INSERT INTO practice_sessions (
               id, user_id, section_key, chapter_title, section_number,
               section_title, difficulty, question_types_json,
               question_count, status, total_score, max_score, created_at, submitted_at
           ) VALUES ('practice-1', 'demo_student', 'book:1.1', '具身智能概述', '1.1',
                     '引言', 'medium', '["single_choice"]', 2, 'submitted',
                     50, 100, '2026-07-24T00:00:00+00:00', '2026-07-24T00:20:00+00:00')"""
    )
    citation = {
        "chunk_id": "chunk-1",
        "book": "具身智能导论",
        "chapter_title": "具身智能概述",
        "section_number": "1.1",
        "section_title": "引言",
        "quote": "具身智能强调身体与环境之间的交互。",
    }
    questions = [
        ("q1", "身体与环境交互", "A", "身体与环境交互"),
        ("q2", "符号主义", "B", "符号主义"),
    ]
    for order, (question_id, knowledge_point, correct_answer, stem) in enumerate(questions, 1):
        conn.execute(
            """INSERT INTO questions (
                   id, session_id, type, stem, options_json, correct_answer_json,
                   analysis, rubric_json, difficulty, knowledge_point,
                   source_chunk_id, citation_json, max_score, sort_order
               ) VALUES (?, 'practice-1', 'single_choice', ?, ?, ?, '教材解析', '[]',
                         'medium', ?, 'chunk-1', ?, 50, ?)""",
            (
                question_id,
                stem,
                json.dumps(["选项一", "选项二", "选项三", "选项四"], ensure_ascii=False),
                json.dumps(correct_answer),
                knowledge_point,
                json.dumps(citation, ensure_ascii=False),
                order,
            ),
        )
    answer_rows = [
        ("a1", "q1", "A", 50, 1, "回答正确。"),
        ("a2", "q2", "A", 0, 0, "回答不正确。"),
    ]
    for answer_id, question_id, answer, score, is_correct, feedback in answer_rows:
        conn.execute(
            """INSERT INTO answer_records (
                   id, session_id, question_id, user_id, answer_json,
                   score, is_correct, feedback_json, submitted_at
               ) VALUES (?, 'practice-1', ?, 'demo_student', ?, ?, ?, ?,
                         '2026-07-24T00:20:00+00:00')""",
            (
                answer_id,
                question_id,
                json.dumps(answer),
                score,
                is_correct,
                json.dumps({"feedback": feedback}, ensure_ascii=False),
            ),
        )
    conn.commit()
    toc = [
        {
            "section_key": "book:1.1",
            "chapter_number": 1,
            "chapter_title": "具身智能概述",
            "section_number": "1.1",
            "section_title": "引言",
        },
        {
            "section_key": "book:1.2",
            "chapter_number": 1,
            "chapter_title": "具身智能概述",
            "section_number": "1.2",
            "section_title": "发展历程",
        },
    ]
    with patch("app.services.learning_service.get_db", return_value=conn):
        dashboard = get_learning_dashboard(user_id="demo_student", toc=toc)
        review = get_knowledge_review(
            section_key="book:1.1",
            knowledge_point="符号主义",
            user_id="demo_student",
        )

    assert dashboard["summary"] == {
        "learned_sections": 1,
        "completed_practices": 1,
        "answered_questions": 2,
        "correct_questions": 1,
        "overall_accuracy": 50.0,
        "overall_score_rate": 50.0,
        "mistake_count": 1,
        "last_activity_at": "2026-07-24T00:20:00+00:00",
    }
    assert dashboard["learning_records"] == [
        {
            "section_key": "book:1.1",
            "chapter_title": "具身智能概述",
            "section_number": "1.1",
            "section_title": "引言",
            "access_count": 2,
            "first_accessed_at": "2026-07-24T00:00:00+00:00",
            "last_accessed_at": "2026-07-24T00:10:00+00:00",
        }
    ]
    assert dashboard["section_mastery"][0]["mastery_level"] == "needs_review"
    assert dashboard["mistakes"][0]["answer"] == "A"
    assert dashboard["mistakes"][0]["correct_answer"] == "B"
    assert dashboard["mistakes"][0]["options"][1] == "选项二"
    review_recommendation = next(
        item for item in dashboard["recommendations"]
        if item["type"] == "review_knowledge"
    )
    assert review_recommendation["action_label"] == "开始复习"
    assert review_recommendation["href"].startswith("/learning/review?")
    assert "knowledge_point=%E7%AC%A6%E5%8F%B7%E4%B8%BB%E4%B9%89" in review_recommendation["href"]
    assert any(item["type"] == "retry_mistakes" for item in dashboard["recommendations"])
    assert review["mastery"]["score_rate"] == 0.0
    assert review["key_points"] == ["教材解析"]
    assert review["sources"][0]["quote"] == "具身智能强调身体与环境之间的交互。"
    assert review["related_mistakes"][0]["question_id"] == "q2"
    assert review["practice_href"].startswith("/practice?mode=knowledge_check&")
    assert "knowledge_point=%E7%AC%A6%E5%8F%B7%E4%B8%BB%E4%B9%89" in review["practice_href"]
    conn.close()


def test_mistakes_deduplicate_repeated_bank_question_and_keep_latest_attempt():
    conn = _memory_db()
    for index, submitted_at in enumerate(
        ("2026-07-24T00:10:00+00:00", "2026-07-24T00:20:00+00:00"),
        1,
    ):
        session_id = f"practice-{index}"
        question_id = f"question-{index}"
        conn.execute(
            """INSERT INTO practice_sessions (
                   id, user_id, section_key, chapter_title, section_number,
                   section_title, difficulty, question_types_json,
                   question_count, status, total_score, max_score,
                   created_at, submitted_at
               ) VALUES (?, 'demo_student', 'book:1.1', '具身智能概述', '1.1',
                         '引言', 'medium', '["single_choice"]', 1, 'submitted',
                         0, 100, ?, ?)""",
            (session_id, submitted_at, submitted_at),
        )
        conn.execute(
            """INSERT INTO questions (
                   id, session_id, bank_question_id, type, stem, options_json,
                   correct_answer_json, analysis, rubric_json, difficulty,
                   knowledge_point, source_chunk_id, citation_json,
                   max_score, sort_order
               ) VALUES (?, ?, 'bank-repeat', 'single_choice', '重复题目',
                         '["选项一", "选项二", "选项三"]', '"B"', '教材解析',
                         '[]', 'medium', '测试知识点', 'chunk-1', '{}', 100, 1)""",
            (question_id, session_id),
        )
        conn.execute(
            """INSERT INTO answer_records (
                   id, session_id, question_id, user_id, answer_json,
                   score, is_correct, feedback_json, submitted_at
               ) VALUES (?, ?, ?, 'demo_student', ?, 0, 0, ?, ?)""",
            (
                f"answer-{index}",
                session_id,
                question_id,
                json.dumps("A" if index == 1 else "C"),
                json.dumps({"feedback": f"第 {index} 次答错"}, ensure_ascii=False),
                submitted_at,
            ),
        )
    conn.commit()

    with patch("app.services.learning_service.get_db", return_value=conn):
        dashboard = get_learning_dashboard(user_id="demo_student", toc=[])

    assert dashboard["summary"]["answered_questions"] == 2
    assert dashboard["summary"]["mistake_count"] == 1
    assert len(dashboard["mistakes"]) == 1
    assert dashboard["mistakes"][0]["session_id"] == "practice-2"
    assert dashboard["mistakes"][0]["answer"] == "C"
    assert dashboard["mistakes"][0]["feedback"] == "第 2 次答错"
    conn.close()


def test_current_mastery_prioritizes_recent_success_and_sections_average_knowledge_points():
    conn = _memory_db()
    attempts = [
        ("mastered", "已掌握知识点", 0, 0),
        ("mastered", "已掌握知识点", 0, 0),
        ("mastered", "已掌握知识点", 100, 1),
        ("mastered", "已掌握知识点", 100, 1),
        ("weak", "待复习知识点", 0, 0),
    ]
    for index, (bank_id, knowledge_point, score, is_correct) in enumerate(attempts, 1):
        submitted_at = f"2026-07-24T00:{index:02d}:00+00:00"
        session_id = f"practice-{index}"
        question_id = f"question-{index}"
        conn.execute(
            """INSERT INTO practice_sessions (
                   id, user_id, section_key, chapter_title, section_number,
                   section_title, difficulty, question_types_json,
                   question_count, status, total_score, max_score,
                   created_at, submitted_at
               ) VALUES (?, 'demo_student', 'book:1.1', '具身智能概述', '1.1',
                         '引言', 'medium', '["single_choice"]', 1, 'submitted',
                         ?, 100, ?, ?)""",
            (session_id, score, submitted_at, submitted_at),
        )
        conn.execute(
            """INSERT INTO questions (
                   id, session_id, bank_question_id, type, stem, options_json,
                   correct_answer_json, analysis, rubric_json, difficulty,
                   knowledge_point, source_chunk_id, citation_json,
                   max_score, sort_order
               ) VALUES (?, ?, ?, 'single_choice', ?, '["A", "B"]', '"B"',
                         '教材解析', '[]', 'medium', ?, 'chunk-1', '{}', 100, 1)""",
            (question_id, session_id, bank_id, f"{knowledge_point}题目", knowledge_point),
        )
        conn.execute(
            """INSERT INTO answer_records (
                   id, session_id, question_id, user_id, answer_json,
                   score, is_correct, feedback_json, submitted_at
               ) VALUES (?, ?, ?, 'demo_student', ?, ?, ?, '{}', ?)""",
            (
                f"answer-{index}",
                session_id,
                question_id,
                json.dumps("B" if is_correct else "A"),
                score,
                is_correct,
                submitted_at,
            ),
        )
    conn.commit()

    with patch("app.services.learning_service.get_db", return_value=conn):
        dashboard = get_learning_dashboard(user_id="demo_student", toc=[])

    mastery_by_name = {
        item["knowledge_point"]: item
        for item in dashboard["knowledge_mastery"]
    }
    assert mastery_by_name["已掌握知识点"]["score_rate"] == 85.0
    assert mastery_by_name["已掌握知识点"]["mastery_level"] == "mastered"
    assert mastery_by_name["待复习知识点"]["score_rate"] == 0.0
    assert dashboard["section_mastery"][0]["score_rate"] == 42.5
    assert dashboard["summary"]["overall_score_rate"] == 42.5
    assert dashboard["summary"]["mistake_count"] == 1
    assert {
        item["knowledge_point"] for item in dashboard["mistakes"]
    } == {"待复习知识点"}

    review_points = {
        item["knowledge_point"]
        for item in dashboard["recommendations"]
        if item["type"] == "review_knowledge"
    }
    assert review_points == {"待复习知识点"}
    retry = next(
        item for item in dashboard["recommendations"]
        if item["type"] == "retry_mistakes"
    )
    assert retry["title"] == "回顾最近 1 道错题"
    conn.close()


def test_learning_dashboard_endpoint_returns_empty_state(client):
    conn = _memory_db()
    with (
        patch("app.services.learning_service.get_db", return_value=conn),
        patch("app.api.learning.CourseService.get_toc", return_value=[]),
    ):
        response = client.get("/api/learning/dashboard")

    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["completed_practices"] == 0
    assert body["learning_records"] == []
    assert body["recommendations"][0]["type"] == "start_learning"
    conn.close()
