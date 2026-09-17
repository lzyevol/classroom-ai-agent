from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.db.sqlite import get_db
from app.schemas.assignment import AssignmentCreateRequest
from app.schemas.practice import PracticeGenerateRequest
from app.services.auth_service import PermissionDeniedError, ensure_can_access_class
from app.services.learning_service import get_mastery_snapshot


class AssignmentNotFoundError(Exception):
    pass


class AssignmentConflictError(Exception):
    pass


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _utc_iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat()


def _rate(value: float, maximum: float) -> float:
    return round(value / maximum * 100, 1) if maximum > 0 else 0.0


def _knowledge_point_matches(candidate: str, target: str) -> bool:
    normalized_candidate = candidate.strip().lower()
    normalized_target = target.strip().lower()
    return (
        not normalized_target
        or normalized_candidate == normalized_target
        or normalized_target in normalized_candidate
        or normalized_candidate in normalized_target
    )


def _assignment_row(
    current_user: dict[str, Any], class_id: str, assignment_id: str
) -> Any:
    ensure_can_access_class(current_user, class_id)
    row = get_db().execute(
        """SELECT * FROM teaching_assignments
           WHERE id = ? AND class_id = ? AND deleted_at IS NULL""",
        (assignment_id, class_id),
    ).fetchone()
    if row is None:
        raise AssignmentNotFoundError("\u6559\u5b66\u4efb\u52a1\u4e0d\u5b58\u5728")
    return row


def _available_question_count(
    section_key: str,
    knowledge_point: str,
    question_types: list[str],
) -> int:
    placeholders = ", ".join("?" for _ in question_types)
    rows = get_db().execute(
        f"""SELECT knowledge_point FROM question_bank
             WHERE section_key = ? AND status = 'active'
               AND type IN ({placeholders})""",
        (section_key, *question_types),
    ).fetchall()
    return sum(
        1
        for row in rows
        if _knowledge_point_matches(str(row["knowledge_point"]), knowledge_point)
    )


def _summary(row: Any) -> dict[str, Any]:
    progress = get_db().execute(
        """SELECT COUNT(*) AS total_students,
                  COALESCE(SUM(status = 'assigned'), 0) AS assigned_students,
                  COALESCE(SUM(status = 'in_progress'), 0) AS in_progress_students,
                  COALESCE(SUM(status = 'completed'), 0) AS completed_students,
                  COALESCE(AVG(baseline_score_rate), 0) AS baseline_average,
                  AVG(CASE WHEN status = 'completed' THEN post_score_rate END) AS post_average,
                  AVG(CASE WHEN status = 'completed' THEN improvement END) AS average_improvement,
                  AVG(CASE WHEN status = 'completed' THEN practice_score_rate END) AS average_practice_score,
                  MAX(CASE WHEN status = 'completed' THEN actual_question_count END) AS actual_question_count
           FROM assignment_students WHERE assignment_id = ?""",
        (row["id"],),
    ).fetchone()
    total = int(progress["total_students"] or 0)
    completed = int(progress["completed_students"] or 0)
    return {
        "id": row["id"],
        "class_id": row["class_id"],
        "teacher_id": row["teacher_id"],
        "title": row["title"],
        "description": row["description"],
        "section_key": row["section_key"],
        "chapter_title": row["chapter_title"],
        "section_number": row["section_number"],
        "section_title": row["section_title"],
        "knowledge_point": row["knowledge_point"],
        "difficulty": row["difficulty"],
        "question_types": json.loads(row["question_types_json"]),
        "question_count": int(row["question_count"]),
        "due_at": row["due_at"],
        "status": row["status"],
        "created_at": row["created_at"],
        "closed_at": row["closed_at"],
        "total_students": total,
        "assigned_students": int(progress["assigned_students"] or 0),
        "in_progress_students": int(progress["in_progress_students"] or 0),
        "completed_students": completed,
        "completion_rate": _rate(completed, total),
        "baseline_average": round(float(progress["baseline_average"] or 0), 1),
        "post_average": (
            round(float(progress["post_average"]), 1)
            if progress["post_average"] is not None
            else None
        ),
        "average_improvement": (
            round(float(progress["average_improvement"]), 1)
            if progress["average_improvement"] is not None
            else None
        ),
        "average_practice_score": (
            round(float(progress["average_practice_score"]), 1)
            if progress["average_practice_score"] is not None
            else None
        ),
        "actual_question_count": (
            int(progress["actual_question_count"])
            if progress["actual_question_count"] is not None
            else None
        ),
    }


def create_assignment(
    current_user: dict[str, Any],
    class_id: str,
    request: AssignmentCreateRequest,
) -> dict[str, Any]:
    ensure_can_access_class(current_user, class_id)
    db = get_db()
    students = db.execute(
        """SELECT u.id FROM class_students cs
           JOIN users u ON u.id = cs.student_id
           WHERE cs.class_id = ? AND u.role = 'student'
             AND u.is_active = 1 AND u.deleted_at IS NULL""",
        (class_id,),
    ).fetchall()
    if not students:
        raise AssignmentConflictError(
            "\u5f53\u524d\u73ed\u7ea7\u6ca1\u6709\u53ef\u63a5\u6536\u4efb\u52a1\u7684\u542f\u7528\u5b66\u751f"
        )

    available_questions = _available_question_count(
        request.section_key,
        request.knowledge_point.strip(),
        list(request.question_types),
    )
    if available_questions < request.question_count:
        raise AssignmentConflictError(
            "\u5f53\u524d\u5c0f\u8282\u548c\u9898\u578b\u53ea\u6709 "
            f"{available_questions} "
            "\u9053\u53ef\u7528\u9898\uff0c\u8bf7\u5c06\u9898\u91cf\u8c03\u6574\u4e3a\u4e0d\u8d85\u8fc7\u8be5\u6570\u91cf"
        )

    assignment_id = f"assignment-{uuid4().hex}"
    now = _utc_now()
    due_at = _utc_iso(request.due_at) if request.due_at else None
    try:
        db.execute("BEGIN")
        db.execute(
            """INSERT INTO teaching_assignments (
                   id, class_id, teacher_id, title, description, section_key,
                   chapter_title, section_number, section_title, knowledge_point,
                   difficulty, question_types_json, question_count, due_at, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                assignment_id,
                class_id,
                current_user["id"],
                request.title.strip(),
                request.description.strip(),
                request.section_key,
                request.chapter_title,
                request.section_number,
                request.section_title,
                request.knowledge_point.strip(),
                request.difficulty,
                json.dumps(request.question_types, ensure_ascii=False),
                request.question_count,
                due_at,
                now,
            ),
        )
        for student in students:
            snapshot = get_mastery_snapshot(
                str(student["id"]),
                request.section_key,
                request.knowledge_point.strip() or None,
            )
            db.execute(
                """INSERT INTO assignment_students (
                       assignment_id, student_id, status, baseline_score_rate,
                       baseline_attempts, assigned_at
                   ) VALUES (?, ?, 'assigned', ?, ?, ?)""",
                (
                    assignment_id,
                    student["id"],
                    snapshot["score_rate"],
                    snapshot["attempts"],
                    now,
                ),
            )
        db.commit()
    except Exception:
        db.rollback()
        raise

    row = db.execute(
        "SELECT * FROM teaching_assignments WHERE id = ?", (assignment_id,)
    ).fetchone()
    return _summary(row)


def list_assignments(
    current_user: dict[str, Any],
    class_id: str,
    *,
    page: int,
    page_size: int,
) -> dict[str, Any]:
    ensure_can_access_class(current_user, class_id)
    db = get_db()
    total = db.execute(
        """SELECT COUNT(*) AS count FROM teaching_assignments
           WHERE class_id = ? AND deleted_at IS NULL""",
        (class_id,),
    ).fetchone()
    rows = db.execute(
        """SELECT * FROM teaching_assignments
           WHERE class_id = ? AND deleted_at IS NULL
           ORDER BY created_at DESC LIMIT ? OFFSET ?""",
        (class_id, page_size, (page - 1) * page_size),
    ).fetchall()
    return {
        "items": [_summary(row) for row in rows],
        "total": int(total["count"] or 0),
        "page": page,
        "page_size": page_size,
    }


def get_assignment_detail(
    current_user: dict[str, Any], class_id: str, assignment_id: str
) -> dict[str, Any]:
    row = _assignment_row(current_user, class_id, assignment_id)
    result = _summary(row)
    students = get_db().execute(
        """SELECT ap.*, u.username, u.display_name
           FROM assignment_students ap JOIN users u ON u.id = ap.student_id
           WHERE ap.assignment_id = ? ORDER BY u.display_name, u.id""",
        (assignment_id,),
    ).fetchall()
    result["students"] = [
        {
            "student_id": item["student_id"],
            "username": item["username"],
            "display_name": item["display_name"],
            "status": item["status"],
            "baseline_score_rate": float(item["baseline_score_rate"]),
            "baseline_attempts": int(item["baseline_attempts"]),
            "practice_session_id": item["practice_session_id"],
            "assigned_at": item["assigned_at"],
            "started_at": item["started_at"],
            "completed_at": item["completed_at"],
            "post_score_rate": item["post_score_rate"],
            "improvement": item["improvement"],
            "practice_score_rate": item["practice_score_rate"],
            "actual_question_count": item["actual_question_count"],
        }
        for item in students
    ]
    return result


def close_assignment(
    current_user: dict[str, Any], class_id: str, assignment_id: str
) -> dict[str, Any]:
    row = _assignment_row(current_user, class_id, assignment_id)
    if row["status"] == "active":
        db = get_db()
        db.execute(
            "UPDATE teaching_assignments SET status = 'closed', closed_at = ? WHERE id = ?",
            (_utc_now(), assignment_id),
        )
        db.commit()
        row = db.execute(
            "SELECT * FROM teaching_assignments WHERE id = ?", (assignment_id,)
        ).fetchone()
    return _summary(row)


def delete_assignment(
    current_user: dict[str, Any], class_id: str, assignment_id: str
) -> None:
    row = _assignment_row(current_user, class_id, assignment_id)
    db = get_db()
    try:
        db.execute("BEGIN")
        db.execute(
            """UPDATE practice_sessions SET assignment_id = NULL
               WHERE assignment_id = ? AND status = 'active'""",
            (assignment_id,),
        )
        db.execute(
            """UPDATE assignment_students
               SET status = 'assigned', practice_session_id = NULL, started_at = NULL
               WHERE assignment_id = ? AND status = 'in_progress'""",
            (assignment_id,),
        )
        db.execute(
            """UPDATE teaching_assignments
               SET deleted_at = ?, deleted_by = ? WHERE id = ?""",
            (_utc_now(), current_user["id"], row["id"]),
        )
        db.commit()
    except Exception:
        db.rollback()
        raise


def list_student_assignments(user_id: str) -> dict[str, Any]:
    rows = get_db().execute(
        """SELECT ta.*, c.name AS class_name, ap.status AS progress_status,
                  ap.baseline_score_rate, ap.post_score_rate, ap.improvement,
                  ap.practice_session_id, ap.completed_at,
                  ap.practice_score_rate, ap.actual_question_count
           FROM assignment_students ap
           JOIN teaching_assignments ta ON ta.id = ap.assignment_id
           JOIN classes c ON c.id = ta.class_id
           WHERE ap.student_id = ? AND ta.deleted_at IS NULL
           ORDER BY CASE ap.status WHEN 'assigned' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
                    ta.created_at DESC""",
        (user_id,),
    ).fetchall()
    items = [
        {
            "id": row["id"],
            "title": row["title"],
            "description": row["description"],
            "class_name": row["class_name"],
            "section_key": row["section_key"],
            "section_number": row["section_number"],
            "section_title": row["section_title"],
            "knowledge_point": row["knowledge_point"],
            "difficulty": row["difficulty"],
            "question_types": json.loads(row["question_types_json"]),
            "question_count": int(row["question_count"]),
            "due_at": row["due_at"],
            "assignment_status": row["status"],
            "progress_status": row["progress_status"],
            "baseline_score_rate": float(row["baseline_score_rate"]),
            "post_score_rate": row["post_score_rate"],
            "improvement": row["improvement"],
            "practice_session_id": row["practice_session_id"],
            "completed_at": row["completed_at"],
            "practice_score_rate": row["practice_score_rate"],
            "actual_question_count": row["actual_question_count"],
        }
        for row in rows
    ]
    return {"items": items, "total": len(items)}


async def start_student_assignment(assignment_id: str, user_id: str) -> dict[str, Any]:
    db = get_db()
    row = db.execute(
        """SELECT ta.*, ap.status AS progress_status, ap.practice_session_id
           FROM teaching_assignments ta
           JOIN assignment_students ap ON ap.assignment_id = ta.id
           WHERE ta.id = ? AND ap.student_id = ? AND ta.deleted_at IS NULL""",
        (assignment_id, user_id),
    ).fetchone()
    if row is None:
        raise AssignmentNotFoundError("\u6559\u5b66\u4efb\u52a1\u4e0d\u5b58\u5728")
    if row["progress_status"] == "completed":
        raise AssignmentConflictError("\u8be5\u6559\u5b66\u4efb\u52a1\u5df2\u7ecf\u5b8c\u6210")
    if row["status"] != "active":
        raise AssignmentConflictError("\u8be5\u6559\u5b66\u4efb\u52a1\u5df2\u7ecf\u5173\u95ed")
    if row["due_at"] and str(row["due_at"]) < _utc_now():
        raise AssignmentConflictError("\u8be5\u6559\u5b66\u4efb\u52a1\u5df2\u7ecf\u622a\u6b62")

    from app.services.practice_service import generate_practice, get_practice_session

    if row["practice_session_id"]:
        session = get_practice_session(str(row["practice_session_id"]), user_id)
    else:
        request = PracticeGenerateRequest(
            section_key=row["section_key"],
            question_types=json.loads(row["question_types_json"]),
            difficulty=row["difficulty"],
            question_count=int(row["question_count"]),
            knowledge_point=row["knowledge_point"] or None,
        )
        session = await generate_practice(request, user_id, assignment_id=assignment_id)
        db.execute(
            """UPDATE assignment_students
               SET status = 'in_progress', practice_session_id = ?, started_at = ?
               WHERE assignment_id = ? AND student_id = ?""",
            (session["session_id"], _utc_now(), assignment_id, user_id),
        )
        db.commit()
    return {**session, "assignment_id": assignment_id}


def complete_assignment_for_session(
    assignment_id: str, user_id: str, session_id: str
) -> None:
    db = get_db()
    row = db.execute(
        """SELECT ta.section_key, ta.knowledge_point, ap.baseline_score_rate,
                  ps.total_score, ps.max_score, ps.question_count
           FROM teaching_assignments ta
           JOIN assignment_students ap ON ap.assignment_id = ta.id
           JOIN practice_sessions ps ON ps.id = ap.practice_session_id
           WHERE ta.id = ? AND ap.student_id = ? AND ap.practice_session_id = ?
             AND ta.deleted_at IS NULL""",
        (assignment_id, user_id, session_id),
    ).fetchone()
    if row is None:
        return

    snapshot = get_mastery_snapshot(
        user_id,
        str(row["section_key"]),
        str(row["knowledge_point"] or "") or None,
    )
    post_score = float(snapshot["score_rate"])
    baseline_score = float(row["baseline_score_rate"])
    db.execute(
        """UPDATE assignment_students
           SET status = 'completed', completed_at = ?, post_score_rate = ?, improvement = ?,
               practice_score_rate = ?, actual_question_count = ?
           WHERE assignment_id = ? AND student_id = ?""",
        (
            _utc_now(),
            post_score,
            round(post_score - baseline_score, 1),
            _rate(float(row["total_score"] or 0), float(row["max_score"] or 0)),
            int(row["question_count"] or 0),
            assignment_id,
            user_id,
        ),
    )
    db.commit()
