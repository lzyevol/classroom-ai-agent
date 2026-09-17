from __future__ import annotations

import json
import sqlite3
from unittest.mock import patch

from app.db.sqlite import initialize_schema
from app.services.learning_service import get_mastery_snapshot


def _memory_db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    initialize_schema(conn)
    return conn


def test_assignment_schema_migrates_legacy_practice_sessions_idempotently():
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute(
        """CREATE TABLE practice_sessions (
               id TEXT PRIMARY KEY,
               user_id TEXT NOT NULL,
               section_key TEXT NOT NULL,
               chapter_title TEXT NOT NULL,
               section_number TEXT NOT NULL,
               section_title TEXT NOT NULL,
               difficulty TEXT NOT NULL,
               question_types_json TEXT NOT NULL,
               question_count INTEGER NOT NULL,
               status TEXT NOT NULL DEFAULT 'active',
               total_score REAL,
               max_score REAL NOT NULL DEFAULT 100,
               created_at TEXT NOT NULL,
               submitted_at TEXT
           )"""
    )

    initialize_schema(conn)
    initialize_schema(conn)

    practice_columns = {
        row["name"] for row in conn.execute("PRAGMA table_info(practice_sessions)")
    }
    table_names = {
        row["name"]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }
    assignment_columns = {
        row["name"] for row in conn.execute("PRAGMA table_info(assignment_students)")
    }

    assert "assignment_id" in practice_columns
    assert {"teaching_assignments", "assignment_students"} <= table_names
    assert {"practice_score_rate", "actual_question_count"} <= assignment_columns
    assert conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_practice_sessions_assignment'"
    ).fetchone()
    conn.close()


def test_mastery_snapshot_uses_existing_knowledge_mastery_signal():
    conn = _memory_db()
    conn.execute(
        """INSERT INTO practice_sessions (
               id, user_id, section_key, chapter_title, section_number,
               section_title, difficulty, question_types_json, question_count,
               status, total_score, max_score, created_at, submitted_at
           ) VALUES ('practice-snapshot', 'demo_student', 'book:1.1', 'chapter', '1.1',
                     'section', 'medium', '["single_choice"]', 1, 'submitted',
                     20, 20, '2026-08-05T00:00:00+00:00', '2026-08-05T00:10:00+00:00')"""
    )
    conn.execute(
        """INSERT INTO questions (
               id, session_id, type, stem, options_json, correct_answer_json,
               analysis, rubric_json, difficulty, knowledge_point,
               source_chunk_id, citation_json, max_score, sort_order
           ) VALUES ('question-snapshot', 'practice-snapshot', 'single_choice',
                     'stem', '["A", "B"]', '"A"', 'analysis', '{}', 'medium',
                     '?????', 'chunk', ?, 20, 1)""",
        (json.dumps({"chunk_id": "chunk", "book": "book", "chapter_title": "chapter", "section_number": "1.1", "section_title": "section", "quote": "quote"}),),
    )
    conn.execute(
        """INSERT INTO answer_records (
               id, session_id, question_id, user_id, answer_json, score,
               is_correct, feedback_json, submitted_at
           ) VALUES ('answer-snapshot', 'practice-snapshot', 'question-snapshot',
                     'demo_student', '"A"', 20, 1, '{}', '2026-08-05T00:10:00+00:00')"""
    )
    conn.commit()

    with patch("app.services.learning_service.get_db", return_value=conn):
        matched = get_mastery_snapshot(
            "demo_student", "book:1.1", "?????"
        )
        section = get_mastery_snapshot("demo_student", "book:1.1")
        missing = get_mastery_snapshot("demo_student", "book:1.1", "???")

    assert matched == {
        "score_rate": 100.0,
        "attempts": 1,
        "mastery_level": "mastered",
    }
    assert section == matched
    assert missing == {
        "score_rate": 0.0,
        "attempts": 0,
        "mastery_level": "needs_review",
    }
    conn.close()
