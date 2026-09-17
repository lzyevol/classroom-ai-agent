from __future__ import annotations

from typing import Any, Literal

from app.db.sqlite import get_db
from app.services.auth_service import PermissionDeniedError, ensure_can_access_class
from app.services.learning_service import get_learning_dashboard


class TeacherStudentNotFoundError(Exception):
    pass


def _rate(numerator: float, denominator: float) -> float:
    if denominator <= 0:
        return 0.0
    return round(numerator / denominator * 100, 1)


def _student_metrics(row: Any) -> dict[str, Any]:
    db = get_db()
    user_id = str(row["id"])
    learned = db.execute(
        """SELECT COUNT(*) AS count FROM (
               SELECT section_key FROM section_learning_progress WHERE user_id = ?
               UNION
               SELECT section_key FROM practice_sessions
               WHERE user_id = ? AND status = 'submitted'
           )""",
        (user_id, user_id),
    ).fetchone()
    practice = db.execute(
        """SELECT COUNT(*) AS count, MAX(submitted_at) AS last_activity_at
           FROM practice_sessions
           WHERE user_id = ? AND status = 'submitted'""",
        (user_id,),
    ).fetchone()
    answers = db.execute(
        """SELECT COALESCE(SUM(ar.score), 0) AS earned_score,
                  COALESCE(SUM(q.max_score), 0) AS available_score,
                  COALESCE(SUM(CASE WHEN ar.is_correct = 0 THEN 1 ELSE 0 END), 0)
                    AS mistake_count
           FROM answer_records ar
           JOIN questions q ON q.id = ar.question_id
           WHERE ar.user_id = ?""",
        (user_id,),
    ).fetchone()
    access = db.execute(
        """SELECT MAX(last_accessed_at) AS last_activity_at
           FROM section_learning_progress WHERE user_id = ?""",
        (user_id,),
    ).fetchone()
    timestamps = [
        value
        for value in (
            practice["last_activity_at"] if practice else None,
            access["last_activity_at"] if access else None,
        )
        if value
    ]
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "is_active": bool(row["is_active"]),
        "learned_sections": int(learned["count"] or 0),
        "completed_practices": int(practice["count"] or 0),
        "overall_score_rate": _rate(
            float(answers["earned_score"] or 0),
            float(answers["available_score"] or 0),
        ),
        "mistake_count": int(answers["mistake_count"] or 0),
        "last_activity_at": max(timestamps) if timestamps else None,
    }


def _class_row(current_user: dict[str, Any], class_id: str) -> Any:
    ensure_can_access_class(current_user, class_id)
    row = get_db().execute(
        "SELECT id, name, course_name FROM classes WHERE id = ?",
        (class_id,),
    ).fetchone()
    if row is None:
        raise PermissionDeniedError("无权查看该班级")
    return row


def get_teacher_class_overview(
    current_user: dict[str, Any],
    class_id: str,
) -> dict[str, Any]:
    class_row = _class_row(current_user, class_id)
    student_rows = get_db().execute(
        """SELECT u.id, u.username, u.display_name, u.is_active
           FROM class_students cs
           JOIN users u ON u.id = cs.student_id
           WHERE cs.class_id = ? AND u.role = 'student' AND u.deleted_at IS NULL
           ORDER BY u.display_name""",
        (class_id,),
    ).fetchall()
    students = [_student_metrics(row) for row in student_rows]
    practiced = [item for item in students if item["completed_practices"] > 0]
    timestamps = [item["last_activity_at"] for item in students if item["last_activity_at"]]
    return {
        "id": class_row["id"],
        "name": class_row["name"],
        "course_name": class_row["course_name"],
        "student_count": len(students),
        "active_student_count": sum(1 for item in students if item["is_active"]),
        "engaged_student_count": sum(
            1
            for item in students
            if item["learned_sections"] > 0 or item["completed_practices"] > 0
        ),
        "completed_practices": sum(item["completed_practices"] for item in students),
        "average_score_rate": (
            round(
                sum(item["overall_score_rate"] for item in practiced) / len(practiced),
                1,
            )
            if practiced
            else 0.0
        ),
        "mistake_count": sum(item["mistake_count"] for item in students),
        "last_activity_at": max(timestamps) if timestamps else None,
    }


def list_teacher_classes(
    current_user: dict[str, Any],
    *,
    query: str | None,
    page: int,
    page_size: int,
) -> dict[str, Any]:
    conditions: list[str] = []
    params: list[Any] = []
    if current_user["role"] == "teacher":
        conditions.append(
            """EXISTS (
                   SELECT 1 FROM class_teachers ct
                   WHERE ct.class_id = c.id AND ct.teacher_id = ?
               )"""
        )
        params.append(current_user["id"])
    if query and query.strip():
        conditions.append("(c.name LIKE ? OR c.course_name LIKE ?)")
        pattern = f"%{query.strip()}%"
        params.extend((pattern, pattern))
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    db = get_db()
    total = db.execute(
        f"SELECT COUNT(*) AS count FROM classes c {where}", tuple(params)
    ).fetchone()
    rows = db.execute(
        f"""SELECT c.id FROM classes c {where}
            ORDER BY c.name, c.id LIMIT ? OFFSET ?""",
        (*params, page_size, (page - 1) * page_size),
    ).fetchall()
    return {
        "items": [
            get_teacher_class_overview(current_user, str(row["id"])) for row in rows
        ],
        "total": int(total["count"] or 0),
        "page": page,
        "page_size": page_size,
    }

def list_teacher_class_students(
    current_user: dict[str, Any],
    class_id: str,
    *,
    query: str | None,
    status: Literal["all", "active", "inactive"],
    page: int,
    page_size: int,
) -> dict[str, Any]:
    _class_row(current_user, class_id)
    conditions = [
        "cs.class_id = ?",
        "u.role = 'student'",
        "u.deleted_at IS NULL",
    ]
    params: list[Any] = [class_id]
    if query and query.strip():
        conditions.append("(u.username LIKE ? OR u.display_name LIKE ?)")
        pattern = f"%{query.strip()}%"
        params.extend((pattern, pattern))
    if status == "active":
        conditions.append("u.is_active = 1")
    elif status == "inactive":
        conditions.append("u.is_active = 0")
    where = " AND ".join(conditions)
    db = get_db()
    total = db.execute(
        f"""SELECT COUNT(*) AS count
            FROM class_students cs JOIN users u ON u.id = cs.student_id
            WHERE {where}""",
        tuple(params),
    ).fetchone()
    rows = db.execute(
        f"""SELECT u.id, u.username, u.display_name, u.is_active
            FROM class_students cs JOIN users u ON u.id = cs.student_id
            WHERE {where}
            ORDER BY u.display_name, u.id LIMIT ? OFFSET ?""",
        (*params, page_size, (page - 1) * page_size),
    ).fetchall()
    return {
        "items": [_student_metrics(row) for row in rows],
        "total": int(total["count"] or 0),
        "page": page,
        "page_size": page_size,
    }


def _class_student_row(
    current_user: dict[str, Any],
    class_id: str,
    student_id: str,
) -> Any:
    _class_row(current_user, class_id)
    row = get_db().execute(
        """SELECT u.id, u.username, u.display_name, u.is_active
           FROM class_students cs
           JOIN users u ON u.id = cs.student_id
           WHERE cs.class_id = ? AND cs.student_id = ?
             AND u.role = 'student' AND u.deleted_at IS NULL""",
        (class_id, student_id),
    ).fetchone()
    if row is None:
        raise TeacherStudentNotFoundError("该学生不属于当前班级")
    return row


def get_teacher_student_detail(
    current_user: dict[str, Any],
    class_id: str,
    student_id: str,
) -> dict[str, Any]:
    student_row = _class_student_row(current_user, class_id, student_id)
    return {
        "class_id": class_id,
        "student": _student_metrics(student_row),
        "learning": get_learning_dashboard(student_id, toc=[]),
    }


def _available_objective_question_count(section_key: str, knowledge_point: str) -> int:
    target = knowledge_point.strip().lower()
    rows = get_db().execute(
        """SELECT knowledge_point FROM question_bank
           WHERE section_key = ? AND status = 'active'
             AND type IN ('single_choice', 'true_false')""",
        (section_key,),
    ).fetchall()
    return sum(
        1
        for row in rows
        if not target
        or target in str(row["knowledge_point"]).strip().lower()
        or str(row["knowledge_point"]).strip().lower() in target
    )


def list_class_section_mastery(
    current_user: dict[str, Any],
    class_id: str,
    *,
    page: int,
    page_size: int,
) -> dict[str, Any]:
    _class_row(current_user, class_id)
    rows = get_db().execute(
        """WITH section_questions AS (
               SELECT section_key,
                      MAX(chapter_title) AS chapter_title,
                      MAX(section_number) AS section_number,
                      MAX(section_title) AS section_title,
                      SUM(CASE WHEN type IN ('single_choice', 'true_false') THEN 1 ELSE 0 END)
                        AS available_question_count
               FROM question_bank
               WHERE status = 'active'
               GROUP BY section_key
           ),
           section_attempts AS (
               SELECT ps.section_key,
                      COUNT(*) AS attempts,
                      COALESCE(SUM(ar.is_correct), 0) AS correct_count,
                      COUNT(DISTINCT ar.user_id) AS student_count,
                      COALESCE(SUM(ar.score), 0) AS earned_score,
                      COALESCE(SUM(q.max_score), 0) AS available_score,
                      MAX(ar.submitted_at) AS last_practiced_at
               FROM answer_records ar
               JOIN questions q ON q.id = ar.question_id
               JOIN practice_sessions ps ON ps.id = ar.session_id
               JOIN class_students cs
                 ON cs.student_id = ar.user_id AND cs.class_id = ?
               JOIN users u ON u.id = ar.user_id
               WHERE ps.status = 'submitted'
                 AND u.role = 'student' AND u.deleted_at IS NULL
               GROUP BY ps.section_key
           )
           SELECT sq.section_key, sq.chapter_title, sq.section_number, sq.section_title,
                  sq.available_question_count,
                  COALESCE(sa.attempts, 0) AS attempts,
                  COALESCE(sa.correct_count, 0) AS correct_count,
                  COALESCE(sa.student_count, 0) AS student_count,
                  COALESCE(sa.earned_score, 0) AS earned_score,
                  COALESCE(sa.available_score, 0) AS available_score,
                  sa.last_practiced_at
           FROM section_questions sq
           LEFT JOIN section_attempts sa ON sa.section_key = sq.section_key
           WHERE sq.available_question_count > 0
           ORDER BY
             CASE WHEN COALESCE(sa.attempts, 0) = 0 THEN 1 ELSE 0 END,
             (COALESCE(sa.earned_score, 0) * 1.0 /
              NULLIF(COALESCE(sa.available_score, 0), 0)) ASC,
             COALESCE(sa.attempts, 0) DESC,
             sq.section_number""",
        (class_id,),
    ).fetchall()
    items = [
        {
            "section_key": row["section_key"],
            "chapter_title": row["chapter_title"],
            "section_number": row["section_number"],
            "section_title": row["section_title"],
            "attempts": int(row["attempts"] or 0),
            "correct_count": int(row["correct_count"] or 0),
            "student_count": int(row["student_count"] or 0),
            "score_rate": _rate(
                float(row["earned_score"] or 0),
                float(row["available_score"] or 0),
            ),
            "available_question_count": int(row["available_question_count"] or 0),
            "last_practiced_at": row["last_practiced_at"],
        }
        for row in rows
    ]
    start = (page - 1) * page_size
    return {
        "items": items[start : start + page_size],
        "total": len(items),
        "page": page,
        "page_size": page_size,
    }


def list_weak_knowledge_points(
    current_user: dict[str, Any],
    class_id: str,
    *,
    page: int,
    page_size: int,
) -> dict[str, Any]:
    _class_row(current_user, class_id)
    rows = get_db().execute(
        """SELECT q.knowledge_point, ps.section_key, ps.chapter_title,
                  ps.section_number, ps.section_title,
                  COUNT(*) AS attempts,
                  COALESCE(SUM(ar.is_correct), 0) AS correct_count,
                  COUNT(DISTINCT ar.user_id) AS student_count,
                  COALESCE(SUM(ar.score), 0) AS earned_score,
                  COALESCE(SUM(q.max_score), 0) AS available_score,
                  MAX(ar.submitted_at) AS last_practiced_at
           FROM answer_records ar
           JOIN questions q ON q.id = ar.question_id
           JOIN practice_sessions ps ON ps.id = ar.session_id
           JOIN class_students cs
             ON cs.student_id = ar.user_id AND cs.class_id = ?
           JOIN users u ON u.id = ar.user_id
           WHERE ps.status = 'submitted'
             AND u.role = 'student' AND u.deleted_at IS NULL
             AND TRIM(q.knowledge_point) <> ''
           GROUP BY q.knowledge_point, ps.section_key, ps.chapter_title,
                    ps.section_number, ps.section_title
           ORDER BY
             (COALESCE(SUM(ar.score), 0) * 1.0 /
              NULLIF(COALESCE(SUM(q.max_score), 0), 0)) ASC,
             COUNT(*) DESC,
             q.knowledge_point""",
        (class_id,),
    ).fetchall()
    items = [
        {
            "knowledge_point": row["knowledge_point"],
            "section_key": row["section_key"],
            "chapter_title": row["chapter_title"],
            "section_number": row["section_number"],
            "section_title": row["section_title"],
            "attempts": int(row["attempts"] or 0),
            "correct_count": int(row["correct_count"] or 0),
            "student_count": int(row["student_count"] or 0),
            "score_rate": _rate(
                float(row["earned_score"] or 0),
                float(row["available_score"] or 0),
            ),
            "available_question_count": _available_objective_question_count(
                str(row["section_key"]), str(row["knowledge_point"])
            ),
            "last_practiced_at": row["last_practiced_at"],
        }
        for row in rows
    ]
    start = (page - 1) * page_size
    return {
        "items": items[start : start + page_size],
        "total": len(items),
        "page": page,
        "page_size": page_size,
    }

