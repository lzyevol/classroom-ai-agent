from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.clients.deepseek import DeepSeekClient
from app.config import settings
from app.db.neo4j import get_driver
from app.db.sqlite import get_db
from app.schemas.practice import PracticeGenerateRequest
from app.services.practice_service import (
    QUERY_SECTION_MATERIAL,
    build_material_context,
    clean_analysis,
    load_practice_prompt,
    normalize_generated_questions,
)

logger = logging.getLogger(__name__)


class QuestionNotFoundError(Exception):
    pass


class QuestionValidationError(Exception):
    pass


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_json(value: Any, fallback: Any) -> Any:
    """Decode a stored JSON column, tolerating legacy or malformed rows."""
    if value in (None, ""):
        return fallback
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        logger.warning("Question bank row holds invalid JSON; falling back")
        return fallback


def _to_teacher_view(row: Any) -> dict[str, Any]:
    """Expose a bank row for teacher review, answers and rubric included."""
    keys = row.keys()
    return {
        "id": row["id"],
        "section_key": row["section_key"],
        "chapter_title": row["chapter_title"],
        "section_number": row["section_number"],
        "section_title": row["section_title"],
        "type": row["type"],
        "stem": row["stem"],
        "options": _load_json(row["options_json"], []),
        "correct_answer": _load_json(row["correct_answer_json"], None),
        "analysis": row["analysis"] or "",
        "rubric": _load_json(row["rubric_json"], []),
        "difficulty": row["difficulty"],
        "knowledge_point": row["knowledge_point"] or "",
        "source_chunk_id": row["source_chunk_id"] or "",
        "citation": _load_json(row["citation_json"], None),
        "status": row["status"],
        "created_at": row["created_at"],
        # Both columns arrived with the teacher-review migration.
        "updated_at": row["updated_at"] if "updated_at" in keys else None,
        "replaced_from": row["replaced_from"] if "replaced_from" in keys else None,
    }


def list_section_questions(
    section_key: str,
    *,
    include_archived: bool = False,
) -> list[dict[str, Any]]:
    """List a section's bank questions with answers, newest last."""
    db = get_db()
    sql = "SELECT * FROM question_bank WHERE section_key = ?"
    params: list[Any] = [section_key]
    if not include_archived:
        sql += " AND status = 'active'"
    sql += " ORDER BY created_at, id"
    rows = db.execute(sql, params).fetchall()
    return [_to_teacher_view(row) for row in rows]


def get_question(question_id: str) -> dict[str, Any]:
    db = get_db()
    row = db.execute(
        "SELECT * FROM question_bank WHERE id = ?", (question_id,)
    ).fetchone()
    if row is None:
        raise QuestionNotFoundError("未找到指定题目")
    return _to_teacher_view(row)


def count_section_questions(section_key: str) -> dict[str, int]:
    """Per-status counts used by the teacher sidebar."""
    db = get_db()
    rows = db.execute(
        """SELECT status, COUNT(*) AS total FROM question_bank
           WHERE section_key = ? GROUP BY status""",
        (section_key,),
    ).fetchall()
    counts = {row["status"]: row["total"] for row in rows}
    return {
        "active": counts.get("active", 0),
        "archived": counts.get("archived", 0),
        "total": sum(counts.values()),
    }


REGENERATE_INSTRUCTION = (
    "章节：{section_number} {section_title}\n"
    "难度：{difficulty}\n"
    "题型：{type_name}\n"
    "题目数量：1\n"
    "指定知识点：{knowledge_point}\n\n"
    "下面这道题需要重新出一道替换它：\n"
    "[原题干] {old_stem}\n"
    "[原答案] {old_answer}\n\n"
    "要求：考查同一个知识点，但提问角度或表述方式必须与原题明显不同，"
    "不要只是改写原题的措辞。\n\n"
    "教材片段：\n{material}"
)

TYPE_NAMES = {
    "single_choice": "单选题",
    "true_false": "判断题",
    "short_answer": "简答题",
}


QUERY_SECTION_EXISTS = """
MATCH (c:Chunk)-[:BELONGS_TO]->(:Section {section_key: $key})
RETURN count(c) > 0 AS has_material
"""


def section_has_material(section_key: str) -> bool:
    """Cheap existence check so callers can fail fast on unknown sections."""
    try:
        driver = get_driver()
        with driver.session(database=settings.neo4j_database) as session:
            record = session.run(QUERY_SECTION_EXISTS, key=section_key).single()
        return bool(record and record["has_material"])
    except Exception as exc:
        # A graph outage should not block queueing; the job reports the real error.
        logger.warning("Section material check failed: %s", type(exc).__name__)
        return True


def _fetch_chunk_records(section_key: str, chunk_id: str) -> list[dict[str, Any]]:
    """Fetch the section's chunks, narrowed to the one a question came from.

    Regeneration must stay on the original knowledge point, so the source chunk
    is used alone when it can still be found; otherwise the whole section is a
    safe fallback.
    """
    driver = get_driver()
    with driver.session(database=settings.neo4j_database) as session:
        records = session.run(QUERY_SECTION_MATERIAL, key=section_key).data()
    if not records:
        raise QuestionValidationError("该章节缺少教材内容，无法重新出题")

    if chunk_id:
        focused = [r for r in records if str(r.get("chunk_id")) == chunk_id]
        if focused:
            return focused
        logger.warning("Chunk %s missing; regenerating from whole section", chunk_id)
    return records


async def regenerate_question(question_id: str) -> dict[str, Any]:
    """Replace one question with a fresh take on the same knowledge point.

    The old row is archived rather than deleted and the new row records it in
    `replaced_from`, so a teacher can trace what a replacement came from.
    """
    original = get_question(question_id)
    if original["status"] != "active":
        # A double-click could otherwise archive the same question twice and
        # leave two replacements pointing at it.
        raise QuestionValidationError("该题目已被替换或废弃，请刷新后重试")
    if not settings.deepseek_api_key:
        raise RuntimeError("尚未配置用于生成练习的语言模型")

    records = _fetch_chunk_records(
        original["section_key"], original["source_chunk_id"]
    )

    request = PracticeGenerateRequest(
        section_key=original["section_key"],
        question_types=[original["type"]],
        difficulty=original["difficulty"],
        question_count=1,
        knowledge_point=original["knowledge_point"] or None,
    )
    user_prompt = REGENERATE_INSTRUCTION.format(
        section_number=original["section_number"],
        section_title=original["section_title"],
        difficulty=original["difficulty"],
        type_name=TYPE_NAMES.get(original["type"], original["type"]),
        knowledge_point=original["knowledge_point"] or "不限",
        old_stem=original["stem"],
        old_answer=json.dumps(original["correct_answer"], ensure_ascii=False),
        material=build_material_context(records),
    )

    client = DeepSeekClient(
        settings.deepseek_api_key,
        settings.deepseek_base_url,
        settings.deepseek_model,
    )
    try:
        payload = await client.generate_json(
            load_practice_prompt("practice_generate.txt"),
            user_prompt,
            temperature=0.6,
            read_timeout=90.0,
        )
    finally:
        await client.close()

    questions = normalize_generated_questions(payload, request, records)
    fresh = questions[0]
    if fresh["stem"].strip() == original["stem"].strip():
        raise QuestionValidationError("AI 返回的题目与原题相同，请再试一次")

    new_id = f"bank-{uuid4().hex}"
    now = _utc_now()
    db = get_db()
    try:
        db.execute("BEGIN")
        cursor = db.execute(
            """INSERT OR IGNORE INTO question_bank (
                   id, section_key, chapter_title, section_number,
                   section_title, type, stem, options_json,
                   correct_answer_json, analysis, rubric_json, difficulty,
                   knowledge_point, source_chunk_id, citation_json,
                   status, created_at, replaced_from
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)""",
            (
                new_id,
                original["section_key"],
                original["chapter_title"],
                original["section_number"],
                original["section_title"],
                fresh["type"],
                fresh["stem"],
                json.dumps(fresh["options"], ensure_ascii=False),
                json.dumps(fresh["correct_answer"], ensure_ascii=False),
                fresh["analysis"],
                json.dumps(fresh["rubric"], ensure_ascii=False),
                fresh["difficulty"],
                fresh["knowledge_point"],
                fresh["source_chunk_id"],
                json.dumps(fresh["citation"], ensure_ascii=False),
                now,
                question_id,
            ),
        )
        if cursor.rowcount < 1:
            # UNIQUE(section_key, stem) rejected it: an identical question exists.
            db.rollback()
            raise QuestionValidationError("生成的题目与题库中已有题目重复，请再试一次")

        db.execute(
            "UPDATE question_bank SET status = 'archived', updated_at = ? WHERE id = ?",
            (now, question_id),
        )
        db.commit()
    except QuestionValidationError:
        raise
    except Exception:
        db.rollback()
        raise

    return get_question(new_id)


def _to_option_letter(value: Any, options: list[str]) -> str | None:
    """Resolve an answer to its option letter, or None when it fits no option.

    Single-choice answers are stored as letters ("A".."D") since that is what
    `_grade_objective` compares, but a teacher may submit a letter, a 0/1-based
    index, or the option text.
    """
    limit = len(options)
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        if 0 <= value < limit:
            return chr(65 + value)
        if 1 <= value <= limit:
            return chr(64 + value)
        return None

    text = str(value or "").strip()
    if not text:
        return None
    if len(text) == 1 and text.upper().isalpha():
        index = ord(text.upper()) - 65
        return text.upper() if 0 <= index < limit else None
    for index, option in enumerate(options):
        if text == option.strip():
            return chr(65 + index)
    if text.isdigit():
        return _to_option_letter(int(text), options)
    return None


def _normalize_weights(rubric: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Scale rubric weights to sum to 1.0.

    Teachers care about the wording of each scoring point, not the arithmetic,
    so weights are rescaled instead of rejected.
    """
    points = [
        {"point": str(item.get("point", "")).strip(), "weight": float(item.get("weight") or 0)}
        for item in rubric
        if str(item.get("point", "")).strip()
    ]
    if not points:
        return []
    total = sum(item["weight"] for item in points)
    if total <= 0:
        share = round(1 / len(points), 4)
        return [{**item, "weight": share} for item in points]
    return [{**item, "weight": round(item["weight"] / total, 4)} for item in points]


def update_question(question_id: str, changes: dict[str, Any]) -> dict[str, Any]:
    """Apply a partial edit, keeping the answer consistent with the options."""
    current = get_question(question_id)
    question_type = current["type"]

    stem = changes.get("stem", current["stem"])
    options = changes.get("options", current["options"])
    answer = changes.get("correct_answer", current["correct_answer"])
    rubric = changes.get("rubric", current["rubric"])
    analysis = changes.get("analysis", current["analysis"])
    difficulty = changes.get("difficulty", current["difficulty"])
    knowledge_point = changes.get("knowledge_point", current["knowledge_point"])

    if not str(stem).strip():
        raise QuestionValidationError("题干不能为空")

    if question_type == "single_choice":
        options = [str(item).strip() for item in options if str(item).strip()]
        if len(options) < 2:
            raise QuestionValidationError("单选题至少需要 2 个选项")
        # Answers are stored as option letters because that is what the student
        # grader compares against. Accept a letter, an index, or the option text
        # and settle on the letter.
        letter = _to_option_letter(answer, options)
        if letter is None:
            raise QuestionValidationError("正确答案必须对应其中一个选项")
        answer = letter
        rubric = []
    elif question_type == "true_false":
        options = ["正确", "错误"]
        if isinstance(answer, str):
            lowered = answer.strip().lower()
            if lowered in {"true", "正确", "对", "1"}:
                answer = True
            elif lowered in {"false", "错误", "错", "0"}:
                answer = False
        if not isinstance(answer, bool):
            raise QuestionValidationError("判断题的答案必须是“正确”或“错误”")
        rubric = []
    else:
        options = []
        answer = str(answer or "").strip()
        if not answer:
            raise QuestionValidationError("简答题需要参考答案")
        rubric = _normalize_weights(
            [dict(item) for item in (rubric or [])]
        )

    db = get_db()
    try:
        db.execute(
            """UPDATE question_bank
               SET stem = ?, options_json = ?, correct_answer_json = ?,
                   analysis = ?, rubric_json = ?, difficulty = ?,
                   knowledge_point = ?, updated_at = ?
               WHERE id = ?""",
            (
                str(stem).strip(),
                json.dumps(options, ensure_ascii=False),
                json.dumps(answer, ensure_ascii=False),
                clean_analysis(str(analysis or "")),
                json.dumps(rubric, ensure_ascii=False),
                difficulty,
                str(knowledge_point or "").strip(),
                _utc_now(),
                question_id,
            ),
        )
        db.commit()
    except sqlite3.IntegrityError as exc:
        # UNIQUE(section_key, stem): the edited stem duplicates another question.
        db.rollback()
        raise QuestionValidationError("该章节已存在相同题干的题目") from exc
    return get_question(question_id)


def archive_question(question_id: str) -> dict[str, Any]:
    """Retire a question without deleting it.

    Student answer records reference bank rows, so a hard delete would break
    the class analytics that read those records.
    """
    db = get_db()
    row = db.execute(
        "SELECT status FROM question_bank WHERE id = ?", (question_id,)
    ).fetchone()
    if row is None:
        raise QuestionNotFoundError("未找到指定题目")

    db.execute(
        "UPDATE question_bank SET status = 'archived', updated_at = ? WHERE id = ?",
        (_utc_now(), question_id),
    )
    db.commit()
    return get_question(question_id)
