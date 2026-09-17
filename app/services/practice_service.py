from __future__ import annotations

import json
import random
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.clients.deepseek import DeepSeekClient
from app.config import settings
from app.db.neo4j import get_driver
from app.db.sqlite import get_db
from app.schemas.practice import PracticeGenerateRequest, PracticeSubmitRequest


PROMPT_DIR = Path(__file__).resolve().parent.parent / "prompts"

QUERY_SECTION_MATERIAL = """
MATCH (c:Chunk)-[:BELONGS_TO]->(s:Section {section_key: $key})
OPTIONAL MATCH (e:KnowledgeEntity)-[:EVIDENCED_BY]->(c)
RETURN c.chunk_id AS chunk_id, c.content_clean AS content_clean,
       c.quote_original AS quote_original,
       s.chapter_title AS chapter_title, s.section_number AS section_number,
       s.section_title AS section_title,
       collect(DISTINCT e.name) AS entity_names
ORDER BY c.chunk_id
"""


class PracticeNotFoundError(Exception):
    pass


class PracticeConflictError(Exception):
    pass


class PracticeValidationError(Exception):
    pass


TYPE_NAMES = {
    "single_choice": "单选题",
    "true_false": "判断题",
    "short_answer": "简答题",
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_prompt(name: str) -> str:
    return (PROMPT_DIR / name).read_text(encoding="utf-8")


def _json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _build_material_context(records: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    total_length = 0
    for record in records:
        content = str(record.get("content_clean") or record.get("quote_original") or "").strip()
        if not content:
            continue
        entity_names = [
            str(name).strip()
            for name in (record.get("entity_names") or [])
            if str(name).strip()
        ]
        part = (
            f"[片段编号] {record.get('chunk_id', '')}\n"
            f"[知识点] {', '.join(entity_names) or '未标注'}\n"
            f"[教材内容] {content}"
        )
        remaining = 10000 - total_length
        if remaining <= 0:
            break
        if len(part) > remaining:
            part = part[:remaining]
        parts.append(part)
        total_length += len(part)
    return "\n\n".join(parts)


# Chunk ids appear in the prompt's material listing, so the model sometimes
# quotes them back inside the analysis. They are internal identifiers and mean
# nothing to a student, so strip them before the text is stored.

# Matches a chunk id with or without its book/section prefix, since the model
# quotes them in several shapes ("book_x:1.2:chunk-003", "2.5:chunk-001",
# or a bare "chunk-003").
_CHUNK_ID_RE = re.compile(r"(?:[A-Za-z0-9_.]+:)*chunk-[0-9]+")
# The id usually arrives inside a phrase like "教材片段<id>提到"; replacing the
# whole phrase keeps the sentence readable instead of leaving a dangling "片段".
_CHUNK_PHRASE_RE = re.compile(
    r"(?:根据|结合|参考)?\s*(?:教材|原文)?片段\s*(?:编号)?\s*"
    r"(?:[A-Za-z0-9_.]+:)*chunk-[0-9]+"
)


def _clean_analysis(value: str) -> str:
    """Remove internal chunk identifiers from student-facing analysis text."""
    cleaned = _CHUNK_PHRASE_RE.sub("教材", value)
    cleaned = _CHUNK_ID_RE.sub("教材", cleaned)
    # Tidy up artifacts left behind by the substitutions.
    cleaned = re.sub(r"(教材\s*){2,}", "教材", cleaned)
    cleaned = re.sub(r"教材\s*[，,、]\s*", "教材", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    return cleaned.strip()


def _normalize_question_type(value: Any) -> str:
    normalized = str(value or "").strip().lower().replace("-", "_")
    aliases = {
        "single": "single_choice",
        "choice": "single_choice",
        "single_choice": "single_choice",
        "单选": "single_choice",
        "单选题": "single_choice",
        "true_false": "true_false",
        "boolean": "true_false",
        "判断": "true_false",
        "判断题": "true_false",
        "short_answer": "short_answer",
        "short": "short_answer",
        "简答": "short_answer",
        "简答题": "short_answer",
    }
    return aliases.get(normalized, normalized)


def _normalize_choice_answer(value: Any, options: list[str]) -> str | None:
    if isinstance(value, int) and not isinstance(value, bool):
        if 0 <= value < len(options):
            return chr(65 + value)
        if 1 <= value <= len(options):
            return chr(64 + value)
    text = str(value or "").strip()
    if not text:
        return None
    upper = text.upper()
    if upper[0] in "ABCD":
        return upper[0]
    for index, option in enumerate(options):
        if text == option.strip():
            return chr(65 + index)
    return None


def _normalize_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in (0, 1):
        return bool(value)
    text = str(value or "").strip().lower()
    if text in {"true", "正确", "对", "是", "1", "a"}:
        return True
    if text in {"false", "错误", "错", "否", "0", "b"}:
        return False
    return None


def _normalize_rubric(value: Any, correct_answer: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    if isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                point = str(item.get("point") or item.get("criterion") or "").strip()
                raw_weight = item.get("weight", item.get("score", 0))
            else:
                point = str(item).strip()
                raw_weight = 0
            if not point:
                continue
            try:
                weight = max(float(raw_weight), 0.0)
            except (TypeError, ValueError):
                weight = 0.0
            items.append({"point": point, "weight": weight})

    if not items:
        return [{"point": correct_answer, "weight": 1.0}]

    total = sum(item["weight"] for item in items)
    if total <= 0:
        equal_weight = 1.0 / len(items)
        for item in items:
            item["weight"] = equal_weight
    else:
        for item in items:
            item["weight"] = item["weight"] / total
    return items


def _score_distribution(count: int) -> list[float]:
    if count <= 0:
        return []
    base = round(100.0 / count, 2)
    scores = [base for _ in range(count)]
    scores[-1] = round(100.0 - sum(scores[:-1]), 2)
    return scores


def _citation_from_record(record: dict[str, Any]) -> dict[str, str]:
    return {
        "chunk_id": str(record.get("chunk_id") or ""),
        "book": "具身智能导论",
        "chapter_title": str(record.get("chapter_title") or ""),
        "section_number": str(record.get("section_number") or ""),
        "section_title": str(record.get("section_title") or ""),
        "quote": str(record.get("quote_original") or record.get("content_clean") or ""),
    }


def _normalize_generated_questions(
    payload: dict[str, Any],
    request: PracticeGenerateRequest,
    records: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    raw_questions = payload.get("questions")
    if not isinstance(raw_questions, list):
        raise RuntimeError("AI 返回的题目格式不正确")

    records_by_id = {
        str(record.get("chunk_id")): record
        for record in records
        if record.get("chunk_id")
    }
    fallback_record = records[0]
    allowed_types = set(request.question_types)
    normalized_questions: list[dict[str, Any]] = []
    seen_stems: set[str] = set()

    for raw in raw_questions:
        if not isinstance(raw, dict):
            continue
        question_type = _normalize_question_type(raw.get("type"))
        if question_type not in allowed_types:
            continue
        stem = str(raw.get("stem") or "").strip()
        if not stem or stem in seen_stems:
            continue

        options = [str(item).strip() for item in (raw.get("options") or []) if str(item).strip()]
        correct_answer: str | bool
        rubric: list[dict[str, Any]] = []
        if question_type == "single_choice":
            if len(options) != 4:
                continue
            normalized_answer = _normalize_choice_answer(raw.get("correct_answer"), options)
            if normalized_answer is None:
                continue
            correct_answer = normalized_answer
        elif question_type == "true_false":
            options = ["正确", "错误"]
            normalized_answer = _normalize_bool(raw.get("correct_answer"))
            if normalized_answer is None:
                continue
            correct_answer = normalized_answer
        else:
            options = []
            correct_answer = str(raw.get("correct_answer") or "").strip()
            if not correct_answer:
                continue
            rubric = _normalize_rubric(raw.get("rubric"), correct_answer)

        source_chunk_id = str(raw.get("source_chunk_id") or "")
        source_record = records_by_id.get(source_chunk_id, fallback_record)
        entity_names = [
            str(name).strip()
            for name in (source_record.get("entity_names") or [])
            if str(name).strip()
        ]
        knowledge_point = (
            (request.knowledge_point or "").strip()
            or str(raw.get("knowledge_point") or "").strip()
            or (entity_names[0] if entity_names else "本节核心知识")
        )
        analysis = (
            _clean_analysis(str(raw.get("analysis") or ""))
            or "请结合教材原文理解该知识点。"
        )
        normalized_questions.append(
            {
                "type": question_type,
                "stem": stem,
                "options": options,
                "correct_answer": correct_answer,
                "analysis": analysis,
                "rubric": rubric,
                "difficulty": (
                    str(raw.get("difficulty") or "").strip().lower()
                    if str(raw.get("difficulty") or "").strip().lower()
                    in {"easy", "medium", "hard"}
                    else request.difficulty
                ),
                "knowledge_point": knowledge_point,
                "source_chunk_id": str(source_record.get("chunk_id") or ""),
                "citation": _citation_from_record(source_record),
            }
        )
        seen_stems.add(stem)
        if len(normalized_questions) >= request.question_count:
            break

    if not normalized_questions:
        raise RuntimeError("没有生成可用题目，请调整条件后重试")

    scores = _score_distribution(len(normalized_questions))
    for question, score in zip(normalized_questions, scores, strict=True):
        question["max_score"] = score
    return normalized_questions


async def generate_question_bank(
    request: PracticeGenerateRequest,
    *,
    mixed_difficulty: bool = False,
) -> dict[str, Any]:
    driver = get_driver()
    with driver.session(database=settings.neo4j_database) as session:
        records = session.run(QUERY_SECTION_MATERIAL, key=request.section_key).data()
    if not records:
        raise PracticeNotFoundError("没有找到该章节的教材内容")
    if not settings.deepseek_api_key:
        raise RuntimeError("尚未配置用于生成练习的语言模型")

    first = records[0]
    material_context = _build_material_context(records)
    type_names = TYPE_NAMES
    requested_types = "、".join(type_names[item] for item in request.question_types)
    user_prompt = (
        f"章节：{first.get('section_number', '')} {first.get('section_title', '')}\n"
        f"难度：{'混合（easy、medium、hard 尽量均衡）' if mixed_difficulty else request.difficulty}\n"
        f"题型：{requested_types}\n"
        f"题目数量：{request.question_count}\n"
        f"指定知识点：{request.knowledge_point or '不限'}\n\n"
        f"教材片段：\n{material_context}"
    )
    client: DeepSeekClient | None = None
    try:
        client = DeepSeekClient(
            settings.deepseek_api_key,
            settings.deepseek_base_url,
            settings.deepseek_model,
        )
        payload = await client.generate_json(
            _load_prompt("practice_generate.txt"),
            user_prompt,
            temperature=0.4,
            read_timeout=90.0,
        )
    finally:
        if client is not None:
            await client.close()

    questions = _normalize_generated_questions(payload, request, records)
    created_at = _utc_now()
    db = get_db()
    inserted_count = 0
    try:
        db.execute("BEGIN")
        for question in questions:
            cursor = db.execute(
                """INSERT OR IGNORE INTO question_bank (
                       id, section_key, chapter_title, section_number,
                       section_title, type, stem, options_json,
                       correct_answer_json, analysis, rubric_json, difficulty,
                       knowledge_point, source_chunk_id, citation_json,
                       status, created_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)""",
                (
                    f"bank-{uuid4().hex}",
                    request.section_key,
                    str(first.get("chapter_title") or ""),
                    str(first.get("section_number") or ""),
                    str(first.get("section_title") or ""),
                    question["type"],
                    question["stem"],
                    _json_dump(question["options"]),
                    _json_dump(question["correct_answer"]),
                    question["analysis"],
                    _json_dump(question["rubric"]),
                    question["difficulty"],
                    question["knowledge_point"],
                    question["source_chunk_id"],
                    _json_dump(question["citation"]),
                    created_at,
                ),
            )
            inserted_count += max(cursor.rowcount, 0)
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "section_key": request.section_key,
        "chapter_title": str(first.get("chapter_title") or ""),
        "section_number": str(first.get("section_number") or ""),
        "section_title": str(first.get("section_title") or ""),
        "generated_count": len(questions),
        "inserted_count": inserted_count,
        # UNIQUE(section_key, stem) makes INSERT OR IGNORE drop duplicates
        # silently, so report them instead of letting the count look wrong.
        "skipped_count": len(questions) - inserted_count,
    }


def _select_bank_questions(request: PracticeGenerateRequest) -> list[dict[str, Any]]:
    db = get_db()
    # Distinguish "section has no questions at all" from "section has questions
    # but none of the requested types": both are locatable 404s with different
    # messages so clients can react.
    section_total = db.execute(
        "SELECT COUNT(*) AS total FROM question_bank "
        "WHERE section_key = ? AND status = 'active'",
        (request.section_key,),
    ).fetchone()["total"]
    if section_total == 0:
        raise PracticeNotFoundError("该章节暂无可用练习题，请稍后再试或联系任课教师")

    placeholders = ", ".join("?" for _ in request.question_types)
    rows = db.execute(
        f"""SELECT * FROM question_bank
            WHERE section_key = ? AND status = 'active'
              AND type IN ({placeholders})""",
        (request.section_key, *request.question_types),
    ).fetchall()
    candidates = [dict(row) for row in rows]
    if not candidates:
        missing_labels = "、".join(
            TYPE_NAMES.get(question_type, question_type)
            for question_type in request.question_types
        )
        raise PracticeNotFoundError(
            f"题库中暂无“{missing_labels}”题目，无法满足题型要求，"
            "请调整题型后重试或联系任课教师"
        )

    knowledge_point = (request.knowledge_point or "").strip().lower()
    random.shuffle(candidates)
    if knowledge_point:
        candidates = [
            row
            for row in candidates
            if knowledge_point in str(row["knowledge_point"]).strip().lower()
            or str(row["knowledge_point"]).strip().lower() in knowledge_point
            or knowledge_point in str(row["stem"]).lower()
        ]
        if not candidates:
            raise PracticeNotFoundError(
                f"题库中暂无“{request.knowledge_point}”的专项题目"
            )
    candidates.sort(
        key=lambda row: (
            0
            if not knowledge_point
            or knowledge_point in str(row["knowledge_point"]).lower()
            or knowledge_point in str(row["stem"]).lower()
            else 1,
            0 if row["difficulty"] == request.difficulty else 1,
        )
    )

    by_type: dict[str, list[dict[str, Any]]] = {
        question_type: [] for question_type in request.question_types
    }
    for row in candidates:
        by_type[row["type"]].append(row)

    for question_type in request.question_types:
        if not by_type[question_type]:
            label = TYPE_NAMES.get(question_type, question_type)
            raise PracticeNotFoundError(
                f"题库中暂无“{label}”题目，无法满足题型要求，"
                "请调整题型后重试或联系任课教师"
            )

    selected: list[dict[str, Any]] = []
    while len(selected) < request.question_count:
        added = False
        for question_type in request.question_types:
            group = by_type[question_type]
            if group and len(selected) < request.question_count:
                selected.append(group.pop(0))
                added = True
        if not added:
            break
    # Contract: a fixed bank shortage must fail explicitly; never duplicate the
    # same question or pad from unrelated knowledge points.
    if len(selected) < request.question_count:
        raise PracticeNotFoundError(
            f"题库不足：该章节当前仅有 {len(selected)} 道符合条件"
            f"（题型/难度/知识点）的题目，无法满足请求的 {request.question_count} 道，"
            "请减少题目数量或联系任课教师补充题库"
        )
    return selected


async def generate_practice(
    request: PracticeGenerateRequest,
    user_id: str,
    assignment_id: str | None = None,
) -> dict[str, Any]:
    bank_questions = _select_bank_questions(request)
    first = bank_questions[0]
    session_id = f"practice-{uuid4().hex}"
    created_at = _utc_now()
    scores = _score_distribution(len(bank_questions))
    db = get_db()
    try:
        db.execute("BEGIN")
        db.execute(
            """INSERT INTO practice_sessions (
                   id, user_id, section_key, chapter_title, section_number,
                   section_title, difficulty, question_types_json,
                   question_count, status, max_score, created_at, assignment_id
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 100, ?, ?)""",
            (
                session_id,
                user_id,
                request.section_key,
                first["chapter_title"],
                first["section_number"],
                first["section_title"],
                request.difficulty,
                _json_dump(request.question_types),
                len(bank_questions),
                created_at,
                assignment_id,
            ),
        )
        public_questions: list[dict[str, Any]] = []
        for index, (bank_question, max_score) in enumerate(
            zip(bank_questions, scores, strict=True),
            1,
        ):
            question_id = f"question-{uuid4().hex}"
            db.execute(
                """INSERT INTO questions (
                       id, session_id, bank_question_id, type, stem,
                       options_json, correct_answer_json, analysis, rubric_json,
                       difficulty, knowledge_point, source_chunk_id,
                       citation_json, max_score, sort_order
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    question_id,
                    session_id,
                    bank_question["id"],
                    bank_question["type"],
                    bank_question["stem"],
                    bank_question["options_json"],
                    bank_question["correct_answer_json"],
                    bank_question["analysis"],
                    bank_question["rubric_json"],
                    bank_question["difficulty"],
                    bank_question["knowledge_point"],
                    bank_question["source_chunk_id"],
                    bank_question["citation_json"],
                    max_score,
                    index,
                ),
            )
            public_questions.append(
                {
                    "id": question_id,
                    "type": bank_question["type"],
                    "stem": bank_question["stem"],
                    "options": json.loads(bank_question["options_json"]),
                    "difficulty": bank_question["difficulty"],
                    "knowledge_point": bank_question["knowledge_point"],
                    "max_score": max_score,
                }
            )
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "session_id": session_id,
        "section_key": request.section_key,
        "chapter_title": first["chapter_title"],
        "section_number": first["section_number"],
        "section_title": first["section_title"],
        "difficulty": request.difficulty,
        "status": "active",
        "created_at": created_at,
        "questions": public_questions,
    }

def get_practice_session(session_id: str, user_id: str) -> dict[str, Any]:
    session, questions = _load_session_questions(session_id)
    if session["user_id"] != user_id or session["status"] != "active":
        raise PracticeNotFoundError("\u7ec3\u4e60\u4e0d\u5b58\u5728")
    return {
        "session_id": session["id"],
        "section_key": session["section_key"],
        "chapter_title": session["chapter_title"],
        "section_number": session["section_number"],
        "section_title": session["section_title"],
        "difficulty": session["difficulty"],
        "status": session["status"],
        "created_at": session["created_at"],
        "questions": [
            {
                "id": question["id"],
                "type": question["type"],
                "stem": question["stem"],
                "options": json.loads(question["options_json"]),
                "difficulty": question["difficulty"],
                "knowledge_point": question["knowledge_point"],
                "max_score": float(question["max_score"]),
            }
            for question in questions
        ],
    }


def _load_session_questions(session_id: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    db = get_db()
    session_row = db.execute(
        "SELECT * FROM practice_sessions WHERE id = ?",
        (session_id,),
    ).fetchone()
    if session_row is None:
        raise PracticeNotFoundError("练习不存在")
    question_rows = db.execute(
        "SELECT * FROM questions WHERE session_id = ? ORDER BY sort_order",
        (session_id,),
    ).fetchall()
    return dict(session_row), [dict(row) for row in question_rows]


def _grade_objective(
    question_type: str,
    submitted_answer: str | bool,
    correct_answer: str | bool,
    max_score: float,
) -> dict[str, Any]:
    if question_type == "single_choice":
        submitted = _normalize_choice_answer(submitted_answer, [])
        expected = str(correct_answer).upper()
        is_correct = submitted == expected
        normalized_submitted: str | bool = submitted or str(submitted_answer)
    else:
        submitted_bool = _normalize_bool(submitted_answer)
        expected_bool = _normalize_bool(correct_answer)
        is_correct = submitted_bool is not None and submitted_bool == expected_bool
        normalized_submitted = submitted_bool if submitted_bool is not None else str(submitted_answer)
    return {
        "answer": normalized_submitted,
        "score": max_score if is_correct else 0.0,
        "is_correct": is_correct,
        "feedback": "回答正确。" if is_correct else "回答不正确，请结合解析和教材原文复习。",
        "covered_points": [],
        "missing_points": [],
        "errors": [],
        "review_required": False,
    }


async def _grade_short_answers(
    questions: list[dict[str, Any]],
    answers_by_id: dict[str, str | bool],
) -> dict[str, dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for question in questions:
        question_id = question["id"]
        answer = str(answers_by_id[question_id]).strip()
        if not answer:
            continue
        items.append(
            {
                "question_id": question_id,
                "stem": question["stem"],
                "standard_answer": json.loads(question["correct_answer_json"]),
                "rubric": json.loads(question["rubric_json"]),
                "max_score": question["max_score"],
                "student_answer": answer,
                "textbook_quote": json.loads(question["citation_json"])["quote"],
            }
        )
    if not items:
        return {}

    client: DeepSeekClient | None = None
    try:
        client = DeepSeekClient(
            settings.deepseek_api_key,
            settings.deepseek_base_url,
            settings.deepseek_model,
        )
        payload = await client.generate_json(
            _load_prompt("practice_grade.txt"),
            "请批改以下简答题：\n" + _json_dump(items),
            temperature=0.1,
            read_timeout=90.0,
        )
    except RuntimeError:
        return {
            item["question_id"]: {
                "score": 0.0,
                "is_correct": False,
                "feedback": "简答题自动批改暂时不可用，建议教师复核。",
                "covered_points": [],
                "missing_points": [entry["point"] for entry in item["rubric"]],
                "errors": [],
                "review_required": True,
            }
            for item in items
        }
    finally:
        if client is not None:
            await client.close()

    raw_results = payload.get("results")
    if not isinstance(raw_results, list):
        raw_results = []
    raw_by_id = {
        str(item.get("question_id")): item
        for item in raw_results
        if isinstance(item, dict) and item.get("question_id")
    }
    normalized: dict[str, dict[str, Any]] = {}
    for item in items:
        question_id = item["question_id"]
        raw = raw_by_id.get(question_id, {})
        try:
            score = float(raw.get("awarded_score", 0))
        except (TypeError, ValueError):
            score = 0.0
        score = round(min(max(score, 0.0), float(item["max_score"])), 2)
        normalized[question_id] = {
            "score": score,
            "is_correct": score >= float(item["max_score"]) * 0.6,
            "feedback": str(raw.get("feedback") or "请对照评分点继续完善答案。"),
            "covered_points": [str(value) for value in (raw.get("covered_points") or [])],
            "missing_points": [str(value) for value in (raw.get("missing_points") or [])],
            "errors": [str(value) for value in (raw.get("errors") or [])],
            "review_required": bool(raw.get("review_required", False)),
        }
    return normalized


async def submit_practice(
    session_id: str,
    request: PracticeSubmitRequest,
    user_id: str,
) -> dict[str, Any]:
    session, questions = _load_session_questions(session_id)
    # Contract: verify ownership before session state so a foreign user's
    # repeated attempt at another user's submitted session returns 404 and
    # never leaks that session's submitted state (which a 409 would reveal).
    if session["user_id"] != user_id:
        raise PracticeNotFoundError("练习不存在")
    if session["status"] == "submitted":
        raise PracticeConflictError("该练习已经提交，请勿重复提交")

    answers_by_id = {item.question_id: item.answer for item in request.answers}
    question_ids = {question["id"] for question in questions}
    if set(answers_by_id) != question_ids:
        raise PracticeValidationError("请完成全部题目后再提交")

    # Contract: single choice answers are A/B/C/D letters matching the option
    # order; anything outside the options is a client error (422), not a wrong
    # answer to grade.
    for question in questions:
        submitted_answer = answers_by_id[question["id"]]
        if question["type"] == "single_choice":
            options = json.loads(question["options_json"])
            if _normalize_choice_answer(submitted_answer, options) is None:
                raise PracticeValidationError(
                    "选择题答案超出选项范围，请提交 A/B/C/D 之一"
                )
        elif question["type"] == "true_false":
            if _normalize_bool(submitted_answer) is None:
                raise PracticeValidationError(
                    "判断题答案必须是布尔值或“正确/错误”"
                )

    short_questions = [question for question in questions if question["type"] == "short_answer"]
    short_grades = await _grade_short_answers(short_questions, answers_by_id)

    results: list[dict[str, Any]] = []
    submitted_at = _utc_now()
    for question in questions:
        question_id = question["id"]
        submitted_answer = answers_by_id[question_id]
        correct_answer = json.loads(question["correct_answer_json"])
        max_score = float(question["max_score"])
        if question["type"] == "short_answer":
            grade = short_grades.get(
                question_id,
                {
                    "score": 0.0,
                    "is_correct": False,
                    "feedback": "未获得有效批改结果，建议教师复核。",
                    "covered_points": [],
                    "missing_points": [],
                    "errors": [],
                    "review_required": True,
                },
            )
            grade["answer"] = submitted_answer
        else:
            grade = _grade_objective(
                question["type"],
                submitted_answer,
                correct_answer,
                max_score,
            )
        results.append(
            {
                "question_id": question_id,
                "type": question["type"],
                "stem": question["stem"],
                "options": json.loads(question["options_json"]),
                "answer": grade["answer"],
                "correct_answer": correct_answer,
                "score": round(float(grade["score"]), 2),
                "max_score": max_score,
                "is_correct": bool(grade["is_correct"]),
                "analysis": question["analysis"],
                "feedback": grade["feedback"],
                "covered_points": grade["covered_points"],
                "missing_points": grade["missing_points"],
                "errors": grade["errors"],
                "review_required": bool(grade["review_required"]),
                "knowledge_point": question["knowledge_point"],
                "citation": json.loads(question["citation_json"]),
            }
        )

    total_score = round(sum(item["score"] for item in results), 2)
    max_score = round(sum(item["max_score"] for item in results), 2)
    db = get_db()
    try:
        db.execute("BEGIN")
        for result in results:
            feedback_payload = {
                "feedback": result["feedback"],
                "covered_points": result["covered_points"],
                "missing_points": result["missing_points"],
                "errors": result["errors"],
                "review_required": result["review_required"],
            }
            db.execute(
                """INSERT INTO answer_records (
                       id, session_id, question_id, user_id, answer_json,
                       score, is_correct, feedback_json, submitted_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    f"answer-{uuid4().hex}",
                    session_id,
                    result["question_id"],
                    user_id,
                    _json_dump(result["answer"]),
                    result["score"],
                    int(result["is_correct"]),
                    _json_dump(feedback_payload),
                    submitted_at,
                ),
            )
        db.execute(
            """UPDATE practice_sessions
               SET status = 'submitted', total_score = ?, max_score = ?, submitted_at = ?
               WHERE id = ?""",
            (total_score, max_score, submitted_at, session_id),
        )
        db.commit()
    except Exception:
        db.rollback()
        raise

    assignment_id = session.get("assignment_id")
    if assignment_id:
        from app.services.assignment_service import complete_assignment_for_session

        complete_assignment_for_session(str(assignment_id), user_id, session_id)

    return {
        "session_id": session_id,
        "status": "submitted",
        "total_score": total_score,
        "max_score": max_score,
        "correct_count": sum(1 for item in results if item["is_correct"]),
        "question_count": len(results),
        "submitted_at": submitted_at,
        "results": results,
    }


# Public aliases so the teacher-facing question bank service can reuse the same
# material assembly, prompt, and normalization without touching private names.
build_material_context = _build_material_context
clean_analysis = _clean_analysis
load_practice_prompt = _load_prompt
normalize_generated_questions = _normalize_generated_questions
