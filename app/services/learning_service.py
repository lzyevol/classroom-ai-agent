from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

from app.db.sqlite import get_db
from app.schemas.learning import SectionAccessRequest


class KnowledgeReviewNotFoundError(Exception):
    pass


_MASTERY_WINDOW_SIZE = 5
_RECENT_ATTEMPT_COUNT = 2
_RECENT_WEIGHT = 0.7
_WINDOW_WEIGHT = 0.3


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _rate(value: float, maximum: float) -> float:
    if maximum <= 0:
        return 0.0
    return round(value / maximum * 100, 1)


def _mastery_level(score_rate: float) -> str:
    if score_rate >= 80:
        return "mastered"
    if score_rate >= 60:
        return "developing"
    return "needs_review"


def _attempt_score_rate(score: float, maximum: float) -> float:
    if maximum <= 0:
        return 0.0
    return max(0.0, min(score / maximum * 100, 100.0))


def _current_mastery_score(attempts: list[dict[str, Any]]) -> float:
    """Calculate current mastery from a bounded, recency-focused attempt window."""
    if not attempts:
        return 0.0

    window = attempts[-_MASTERY_WINDOW_SIZE:]
    window_scores = [
        _attempt_score_rate(float(item["score"]), float(item["max_score"]))
        for item in window
    ]
    recent = window[-_RECENT_ATTEMPT_COUNT:]
    recent_scores = window_scores[-_RECENT_ATTEMPT_COUNT:]
    window_average = sum(window_scores) / len(window_scores)
    recent_average = sum(recent_scores) / len(recent_scores)
    score_rate = (
        recent_average * _RECENT_WEIGHT
        + window_average * _WINDOW_WEIGHT
    )

    # Two consecutive fully-correct attempts are enough to confirm current mastery.
    if len(recent) == _RECENT_ATTEMPT_COUNT and all(
        bool(item["is_correct"]) for item in recent
    ):
        score_rate = max(score_rate, 80.0)
    return round(score_rate, 1)


def _json_load(value: str, fallback: Any) -> Any:
    try:
        return json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return fallback


def record_section_access(request: SectionAccessRequest, user_id: str) -> dict[str, Any]:
    now = _utc_now()
    db = get_db()
    db.execute(
        """INSERT INTO section_learning_progress (
               user_id, section_key, chapter_title, section_number,
               section_title, access_count, first_accessed_at, last_accessed_at
           ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
           ON CONFLICT(user_id, section_key) DO UPDATE SET
               chapter_title = excluded.chapter_title,
               section_number = excluded.section_number,
               section_title = excluded.section_title,
               access_count = section_learning_progress.access_count + 1,
               last_accessed_at = excluded.last_accessed_at""",
        (
            user_id,
            request.section_key,
            request.chapter_title,
            request.section_number,
            request.section_title,
            now,
            now,
        ),
    )
    db.commit()
    row = db.execute(
        """SELECT user_id, section_key, access_count,
                  first_accessed_at, last_accessed_at
           FROM section_learning_progress
           WHERE user_id = ? AND section_key = ?""",
        (user_id, request.section_key),
    ).fetchone()
    return dict(row)


def _learning_summary(user_id: str) -> dict[str, Any]:
    db = get_db()
    learned_rows = db.execute(
        """SELECT section_key FROM section_learning_progress WHERE user_id = ?
           UNION
           SELECT section_key FROM practice_sessions
           WHERE user_id = ? AND status = 'submitted'""",
        (user_id, user_id),
    ).fetchall()
    practice_row = db.execute(
        """SELECT COUNT(*) AS completed_practices, MAX(submitted_at) AS last_practice_at
           FROM practice_sessions
           WHERE user_id = ? AND status = 'submitted'""",
        (user_id,),
    ).fetchone()
    answer_row = db.execute(
        """SELECT COUNT(*) AS answered_questions,
                  COALESCE(SUM(ar.is_correct), 0) AS correct_questions,
                  COALESCE(SUM(ar.score), 0) AS earned_score,
                  COALESCE(SUM(q.max_score), 0) AS available_score,
                  COALESCE(SUM(CASE WHEN ar.is_correct = 0 THEN 1 ELSE 0 END), 0) AS mistake_count
           FROM answer_records ar
           JOIN questions q ON q.id = ar.question_id
           WHERE ar.user_id = ?""",
        (user_id,),
    ).fetchone()
    access_row = db.execute(
        """SELECT MAX(last_accessed_at) AS last_access_at
           FROM section_learning_progress WHERE user_id = ?""",
        (user_id,),
    ).fetchone()

    completed_practices = (
        int(practice_row["completed_practices"] or 0) if practice_row else 0
    )
    last_practice_at = practice_row["last_practice_at"] if practice_row else None
    answered = int(answer_row["answered_questions"] or 0) if answer_row else 0
    correct = int(answer_row["correct_questions"] or 0) if answer_row else 0
    earned_score = float(answer_row["earned_score"] or 0) if answer_row else 0.0
    available_score = (
        float(answer_row["available_score"] or 0) if answer_row else 0.0
    )
    mistake_count = int(answer_row["mistake_count"] or 0) if answer_row else 0
    last_access_at = access_row["last_access_at"] if access_row else None
    timestamps = [
        value
        for value in (last_practice_at, last_access_at)
        if value
    ]
    return {
        "learned_sections": len(learned_rows),
        "completed_practices": completed_practices,
        "answered_questions": answered,
        "correct_questions": correct,
        "overall_accuracy": _rate(correct, answered),
        "overall_score_rate": _rate(earned_score, available_score),
        "mistake_count": mistake_count,
        "last_activity_at": max(timestamps) if timestamps else None,
    }


def _learning_records(user_id: str) -> list[dict[str, Any]]:
    rows = get_db().execute(
        """SELECT section_key, chapter_title, section_number, section_title,
                  access_count, first_accessed_at, last_accessed_at
           FROM section_learning_progress
           WHERE user_id = ?
           ORDER BY last_accessed_at DESC""",
        (user_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def _section_mastery(
    user_id: str,
    knowledge_mastery: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    rows = get_db().execute(
        """SELECT ps.section_key, ps.chapter_title, ps.section_number, ps.section_title,
                  COUNT(DISTINCT ps.id) AS practice_count,
                  COUNT(*) AS answered_questions,
                  COALESCE(SUM(ar.is_correct), 0) AS correct_questions,
                  MAX(ar.submitted_at) AS last_practiced_at
           FROM answer_records ar
           JOIN questions q ON q.id = ar.question_id
           JOIN practice_sessions ps ON ps.id = ar.session_id
           WHERE ar.user_id = ? AND ps.status = 'submitted'
           GROUP BY ps.section_key, ps.chapter_title, ps.section_number, ps.section_title
           ORDER BY MAX(ar.submitted_at) DESC""",
        (user_id,),
    ).fetchall()
    knowledge_items = (
        knowledge_mastery
        if knowledge_mastery is not None
        else _knowledge_mastery(user_id)
    )
    scores_by_section: dict[str, list[float]] = {}
    for item in knowledge_items:
        scores_by_section.setdefault(item["section_key"], []).append(
            float(item["score_rate"])
        )

    result = []
    for row in rows:
        answered = int(row["answered_questions"] or 0)
        correct = int(row["correct_questions"] or 0)
        knowledge_scores = scores_by_section.get(str(row["section_key"]), [])
        score_rate = (
            round(sum(knowledge_scores) / len(knowledge_scores), 1)
            if knowledge_scores
            else 0.0
        )
        result.append(
            {
                "section_key": row["section_key"],
                "chapter_title": row["chapter_title"],
                "section_number": row["section_number"],
                "section_title": row["section_title"],
                "practice_count": int(row["practice_count"]),
                "answered_questions": answered,
                "correct_questions": correct,
                "accuracy": _rate(correct, answered),
                "score_rate": score_rate,
                "mastery_level": _mastery_level(score_rate),
                "last_practiced_at": row["last_practiced_at"],
            }
        )
    return result


def _knowledge_mastery(user_id: str) -> list[dict[str, Any]]:
    rows = get_db().execute(
        """SELECT q.knowledge_point, ps.section_key, ps.chapter_title,
                  ps.section_number, ps.section_title, ar.score, q.max_score,
                  ar.is_correct, ar.submitted_at, ar.rowid AS answer_rowid
           FROM answer_records ar
           JOIN questions q ON q.id = ar.question_id
           JOIN practice_sessions ps ON ps.id = ar.session_id
           WHERE ar.user_id = ? AND ps.status = 'submitted'
                 AND TRIM(q.knowledge_point) <> ''
           ORDER BY ps.section_key, q.knowledge_point,
                    ar.submitted_at ASC, ar.rowid ASC""",
        (user_id,),
    ).fetchall()

    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        group_key = (str(row["section_key"]), str(row["knowledge_point"]))
        item = grouped.setdefault(
            group_key,
            {
                "knowledge_point": row["knowledge_point"],
                "section_key": row["section_key"],
                "chapter_title": row["chapter_title"],
                "section_number": row["section_number"],
                "section_title": row["section_title"],
                "attempt_rows": [],
            },
        )
        item["attempt_rows"].append(
            {
                "score": float(row["score"] or 0),
                "max_score": float(row["max_score"] or 0),
                "is_correct": bool(row["is_correct"]),
                "submitted_at": row["submitted_at"],
            }
        )

    result = []
    for item in grouped.values():
        attempt_rows = item.pop("attempt_rows")
        attempts = len(attempt_rows)
        correct = sum(1 for attempt in attempt_rows if attempt["is_correct"])
        score_rate = _current_mastery_score(attempt_rows)
        result.append(
            {
                **item,
                "attempts": attempts,
                "correct_count": correct,
                "accuracy": _rate(correct, attempts),
                "score_rate": score_rate,
                "mastery_level": _mastery_level(score_rate),
                "last_practiced_at": attempt_rows[-1]["submitted_at"],
            }
        )
    result.sort(key=lambda item: item["last_practiced_at"], reverse=True)
    result.sort(key=lambda item: item["attempts"], reverse=True)
    result.sort(key=lambda item: item["score_rate"])
    return result


def get_mastery_snapshot(
    user_id: str,
    section_key: str,
    knowledge_point: str | None = None,
) -> dict[str, Any]:
    """Return the canonical current mastery signal for a section/knowledge point.

    Teaching assignments will persist this value at publish time and compare it
    with a later snapshot after the assigned practice is submitted.  It uses the
    same knowledge-level mastery calculation already exposed by the learning
    dashboard, rather than the class-wide score or wrong-answer counters.
    """
    normalized_point = (knowledge_point or "").strip()
    items = [
        item
        for item in _knowledge_mastery(user_id)
        if item["section_key"] == section_key
        and (
            not normalized_point
            or str(item["knowledge_point"]).strip() == normalized_point
        )
    ]
    if not items:
        return {
            "score_rate": 0.0,
            "attempts": 0,
            "mastery_level": "needs_review",
        }

    score_rate = round(
        sum(float(item["score_rate"]) for item in items) / len(items), 1
    )
    return {
        "score_rate": score_rate,
        "attempts": sum(int(item["attempts"]) for item in items),
        "mastery_level": _mastery_level(score_rate),
    }


def _recent_practices(user_id: str) -> list[dict[str, Any]]:
    rows = get_db().execute(
        """SELECT id, section_key, section_number, section_title, difficulty,
                  total_score, max_score, submitted_at
           FROM practice_sessions
           WHERE user_id = ? AND status = 'submitted'
           ORDER BY submitted_at DESC""",
        (user_id,),
    ).fetchall()
    return [
        {
            "session_id": row["id"],
            "section_key": row["section_key"],
            "section_number": row["section_number"],
            "section_title": row["section_title"],
            "difficulty": row["difficulty"],
            "total_score": float(row["total_score"] or 0),
            "max_score": float(row["max_score"] or 0),
            "score_rate": _rate(float(row["total_score"] or 0), float(row["max_score"] or 0)),
            "submitted_at": row["submitted_at"],
        }
        for row in rows
    ]


def _mistakes(
    user_id: str,
    knowledge_mastery: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    mastery_items = (
        knowledge_mastery
        if knowledge_mastery is not None
        else _knowledge_mastery(user_id)
    )
    mastered_keys = {
        (item["section_key"], item["knowledge_point"])
        for item in mastery_items
        if item["mastery_level"] == "mastered"
    }
    rows = get_db().execute(
        """SELECT q.id AS question_id, q.bank_question_id,
                  ps.id AS session_id, q.type, q.stem,
                  q.options_json, ar.answer_json, q.correct_answer_json,
                  q.analysis, ar.feedback_json, q.knowledge_point,
                  ps.section_key, ps.chapter_title, ps.section_number, ps.section_title,
                  q.citation_json, ar.submitted_at
           FROM answer_records ar
           JOIN questions q ON q.id = ar.question_id
           JOIN practice_sessions ps ON ps.id = ar.session_id
           WHERE ar.user_id = ? AND ar.is_correct = 0
           ORDER BY ar.submitted_at DESC, ar.rowid DESC""",
        (user_id,),
    ).fetchall()
    result = []
    seen_questions: set[tuple[str, ...]] = set()
    for row in rows:
        if (row["section_key"], row["knowledge_point"]) in mastered_keys:
            continue
        if row["bank_question_id"]:
            question_key = ("bank", str(row["bank_question_id"]))
        else:
            question_key = (
                "legacy",
                str(row["section_key"]),
                str(row["type"]),
                str(row["stem"]),
            )
        if question_key in seen_questions:
            continue
        seen_questions.add(question_key)
        feedback = _json_load(row["feedback_json"], {})
        result.append(
            {
                "question_id": row["question_id"],
                "session_id": row["session_id"],
                "type": row["type"],
                "stem": row["stem"],
                "options": _json_load(row["options_json"], []),
                "answer": _json_load(row["answer_json"], ""),
                "correct_answer": _json_load(row["correct_answer_json"], ""),
                "analysis": row["analysis"],
                "feedback": str(feedback.get("feedback") or ""),
                "knowledge_point": row["knowledge_point"],
                "section_key": row["section_key"],
                "chapter_title": row["chapter_title"],
                "section_number": row["section_number"],
                "section_title": row["section_title"],
                "citation": _json_load(row["citation_json"], {}),
                "submitted_at": row["submitted_at"],
            }
        )
    return result


def _latest_access(user_id: str) -> dict[str, Any] | None:
    row = get_db().execute(
        """SELECT section_key, chapter_title, section_number, section_title,
                  last_accessed_at
           FROM section_learning_progress
           WHERE user_id = ? ORDER BY last_accessed_at DESC LIMIT 1""",
        (user_id,),
    ).fetchone()
    return dict(row) if row else None


def _practice_href(section_key: str, knowledge_point: str | None = None) -> str:
    params = {"section_key": section_key}
    if knowledge_point:
        params["knowledge_point"] = knowledge_point
    return f"/practice?{urlencode(params)}"


def _review_href(section_key: str, knowledge_point: str) -> str:
    return f"/learning/review?{urlencode({'section_key': section_key, 'knowledge_point': knowledge_point})}"


def _knowledge_check_href(section_key: str, knowledge_point: str) -> str:
    params = {
        "mode": "knowledge_check",
        "section_key": section_key,
        "knowledge_point": knowledge_point,
    }
    return f"/practice?{urlencode(params)}"


def _knowledge_matches(candidate: str, expected: str) -> bool:
    candidate_normalized = candidate.strip().casefold()
    expected_normalized = expected.strip().casefold()
    if not candidate_normalized or not expected_normalized:
        return False
    return (
        candidate_normalized == expected_normalized
        or candidate_normalized in expected_normalized
        or expected_normalized in candidate_normalized
    )


def _append_unique_text(items: list[str], value: Any, limit: int) -> None:
    text = str(value or "").strip()
    if text and text not in items and len(items) < limit:
        items.append(text)


def get_knowledge_review(
    section_key: str,
    knowledge_point: str,
    user_id: str,
    section: dict[str, Any] | None = None,
) -> dict[str, Any]:
    db = get_db()
    question_rows = db.execute(
        """SELECT knowledge_point, analysis, citation_json
           FROM question_bank
           WHERE section_key = ? AND status = 'active'
           ORDER BY created_at DESC""",
        (section_key,),
    ).fetchall()
    matching_questions = [
        dict(row)
        for row in question_rows
        if _knowledge_matches(str(row["knowledge_point"] or ""), knowledge_point)
    ]

    knowledge_mastery = _knowledge_mastery(user_id)
    mastery = next(
        (
            item
            for item in knowledge_mastery
            if item["section_key"] == section_key
            and _knowledge_matches(str(item["knowledge_point"] or ""), knowledge_point)
        ),
        None,
    )
    related_mistakes = [
        item
        for item in _mistakes(user_id, knowledge_mastery)
        if item["section_key"] == section_key
        and _knowledge_matches(str(item["knowledge_point"] or ""), knowledge_point)
    ]

    section_data = section or {}
    fallback = (
        mastery
        or (related_mistakes[0] if related_mistakes else None)
        or (_json_load(matching_questions[0]["citation_json"], {}) if matching_questions else {})
    )
    if not section_data and isinstance(fallback, dict):
        section_data = fallback

    sources: list[dict[str, str]] = []
    seen_sources: set[str] = set()

    def add_source(citation: Any) -> None:
        if not isinstance(citation, dict):
            return
        quote = str(citation.get("quote") or "").strip()
        if not quote:
            return
        source_key = str(citation.get("chunk_id") or quote)
        if source_key in seen_sources or len(sources) >= 4:
            return
        seen_sources.add(source_key)
        sources.append(
            {
                "chunk_id": str(citation.get("chunk_id") or ""),
                "book": str(citation.get("book") or "具身智能导论"),
                "chapter_title": str(
                    citation.get("chapter_title") or section_data.get("chapter_title") or ""
                ),
                "section_number": str(
                    citation.get("section_number") or section_data.get("section_number") or ""
                ),
                "section_title": str(
                    citation.get("section_title") or section_data.get("section_title") or ""
                ),
                "quote": quote,
            }
        )

    for question in matching_questions:
        add_source(_json_load(question["citation_json"], {}))
    for mistake in related_mistakes:
        add_source(mistake.get("citation"))
    for chunk in section_data.get("chunks") or []:
        quote = str(chunk.get("quote_original") or "").strip()
        entity_names = [
            str(entity.get("name") or "")
            for entity in (chunk.get("entities") or [])
            if isinstance(entity, dict)
        ]
        if knowledge_point.casefold() in quote.casefold() or any(
            _knowledge_matches(name, knowledge_point) for name in entity_names
        ):
            add_source(
                {
                    "chunk_id": chunk.get("chunk_id"),
                    "book": "具身智能导论",
                    "chapter_title": section_data.get("chapter_title"),
                    "section_number": section_data.get("section_number"),
                    "section_title": section_data.get("section_title"),
                    "quote": quote,
                }
            )

    key_points: list[str] = []
    for question in matching_questions:
        _append_unique_text(key_points, question["analysis"], 4)
    for mistake in related_mistakes:
        _append_unique_text(key_points, mistake.get("analysis"), 4)

    common_mistakes: list[str] = []
    for mistake in related_mistakes:
        _append_unique_text(common_mistakes, mistake.get("feedback"), 3)

    if not matching_questions and not related_mistakes and not mastery and not sources:
        raise KnowledgeReviewNotFoundError("暂未找到该知识点的复习资料")

    if mastery:
        reason = (
            f"你在该知识点上已作答 {mastery['attempts']} 次，"
            f"当前得分率为 {mastery['score_rate']}%。"
        )
    else:
        reason = "系统已根据对应章节和题库整理了这份知识点复习内容。"

    overview = (
        key_points[0]
        if key_points
        else sources[0]["quote"]
        if sources
        else f"请结合教材内容理解“{knowledge_point}”的核心含义和适用场景。"
    )
    return {
        "section_key": section_key,
        "chapter_title": str(section_data.get("chapter_title") or ""),
        "section_number": str(section_data.get("section_number") or ""),
        "section_title": str(section_data.get("section_title") or ""),
        "knowledge_point": knowledge_point,
        "reason": reason,
        "overview": overview,
        "key_points": key_points,
        "common_mistakes": common_mistakes,
        "sources": sources,
        "related_mistakes": related_mistakes,
        "mastery": mastery,
        "practice_href": _knowledge_check_href(section_key, knowledge_point),
    }


def _recommendations(
    knowledge_mastery: list[dict[str, Any]],
    section_mastery: list[dict[str, Any]],
    mistakes: list[dict[str, Any]],
    latest_access: dict[str, Any] | None,
    toc: list[dict[str, Any]],
    limit: int = 4,
) -> list[dict[str, Any]]:
    recommendations: list[dict[str, Any]] = []
    weak_points = [
        item for item in knowledge_mastery
        if item["mastery_level"] != "mastered"
    ]
    for index, item in enumerate(weak_points[:2]):
        priority = "high" if item["score_rate"] < 60 else "medium"
        recommendations.append(
            {
                "id": f"review-{index}-{item['section_key']}-{item['knowledge_point']}",
                "type": "review_knowledge",
                "priority": priority,
                "title": f"复习：{item['knowledge_point']}",
                "reason": (
                    f"已练习 {item['attempts']} 题，当前掌握度 {item['score_rate']}%，"
                    f"位于 {item['section_number']} {item['section_title']}。"
                ),
                "action_label": "开始复习",
                "href": _review_href(item["section_key"], item["knowledge_point"]),
                "section_key": item["section_key"],
                "knowledge_point": item["knowledge_point"],
            }
        )

    weak_keys = {
        (item["section_key"], item["knowledge_point"])
        for item in weak_points
    }
    pending_mistakes = [
        item for item in mistakes
        if (item["section_key"], item["knowledge_point"]) in weak_keys
    ]
    if pending_mistakes:
        recommendations.append(
            {
                "id": "retry-recent-mistakes",
                "type": "retry_mistakes",
                "priority": "high" if len(pending_mistakes) >= 3 else "medium",
                "title": f"回顾最近 {len(pending_mistakes)} 道错题",
                "reason": "这些题目已经记录到错题本，建议先理解解析和教材依据，再回到对应章节练习。",
                "action_label": "查看错题本",
                "href": "/learning#mistakes",
                "section_key": pending_mistakes[0]["section_key"],
                "knowledge_point": pending_mistakes[0]["knowledge_point"],
            }
        )

    current = section_mastery[0] if section_mastery else latest_access
    if current:
        current_key = current["section_key"]
        current_index = next(
            (index for index, item in enumerate(toc) if item.get("section_key") == current_key),
            -1,
        )
        current_score = float(current.get("score_rate", 0))
        if current_score >= 80 and 0 <= current_index < len(toc) - 1:
            next_section = toc[current_index + 1]
            recommendations.append(
                {
                    "id": f"next-{next_section['section_key']}",
                    "type": "next_section",
                    "priority": "low",
                    "title": f"学习下一节：{next_section['section_number']} {next_section['section_title']}",
                    "reason": f"当前章节掌握度达到 {current_score}%，可以继续推进课程。",
                    "action_label": "进入课堂",
                    "href": f"/lesson?section_key={next_section['section_key']}",
                    "section_key": next_section["section_key"],
                    "knowledge_point": None,
                }
            )
        elif not weak_points:
            recommendations.append(
                {
                    "id": f"continue-{current_key}",
                    "type": "continue_learning",
                    "priority": "low",
                    "title": f"继续巩固：{current['section_number']} {current['section_title']}",
                    "reason": "完成一次章节练习可以让系统获得更稳定的掌握度判断。",
                    "action_label": "继续练习",
                    "href": _practice_href(current_key),
                    "section_key": current_key,
                    "knowledge_point": None,
                }
            )
    else:
        first = toc[0] if toc else None
        recommendations.append(
            {
                "id": "start-course",
                "type": "start_learning",
                "priority": "low",
                "title": (
                    f"从 {first['section_number']} {first['section_title']} 开始学习"
                    if first
                    else "开始第一节课程学习"
                ),
                "reason": "完成课堂学习和章节练习后，系统会根据作答数据生成个性化推荐。",
                "action_label": "开始上课",
                "href": f"/lesson?section_key={first['section_key']}" if first else "/lesson",
                "section_key": first["section_key"] if first else None,
                "knowledge_point": None,
            }
        )
    return recommendations[:limit]


def get_learning_dashboard(
    user_id: str,
    toc: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    knowledge_mastery = _knowledge_mastery(user_id)
    section_mastery = _section_mastery(user_id, knowledge_mastery)
    mistakes = _mistakes(user_id, knowledge_mastery)
    summary = _learning_summary(user_id)
    summary["overall_score_rate"] = (
        round(
            sum(float(item["score_rate"]) for item in section_mastery)
            / len(section_mastery),
            1,
        )
        if section_mastery
        else 0.0
    )
    summary["mistake_count"] = len(mistakes)
    latest_access = _latest_access(user_id)
    return {
        "user_id": user_id,
        "generated_at": _utc_now(),
        "summary": summary,
        "learning_records": _learning_records(user_id),
        "section_mastery": section_mastery,
        "knowledge_mastery": knowledge_mastery,
        "recent_practices": _recent_practices(user_id),
        "mistakes": mistakes,
        "recommendations": _recommendations(
            knowledge_mastery,
            section_mastery,
            mistakes,
            latest_access,
            toc or [],
        ),
    }
