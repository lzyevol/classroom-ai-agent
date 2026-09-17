from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from app.config import settings
from app.db.sqlite import get_db
from app.security import generate_access_token, hash_access_token, verify_password


class InvalidCredentialsError(Exception):
    pass


class UserNotFoundError(Exception):
    pass


class PermissionDeniedError(Exception):
    pass


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _user_dict(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "role": row["role"],
        "is_active": bool(row["is_active"]),
    }


def login(username: str, password: str) -> dict[str, Any]:
    db = get_db()
    row = db.execute(
        """SELECT id, username, display_name, role, is_active, password_hash, deleted_at
           FROM users WHERE username = ? COLLATE NOCASE""",
        (username.strip(),),
    ).fetchone()
    if (
        row is None
        or row["deleted_at"] is not None
        or not bool(row["is_active"])
        or not verify_password(password, row["password_hash"])
    ):
        raise InvalidCredentialsError("用户名或密码错误")

    token = generate_access_token()
    created_at = _utc_now()
    expires_at = created_at + timedelta(days=settings.auth_session_days)
    db.execute(
        """INSERT INTO auth_sessions (
               token_hash, user_id, created_at, expires_at, last_used_at
           ) VALUES (?, ?, ?, ?, ?)""",
        (
            hash_access_token(token),
            row["id"],
            created_at.isoformat(),
            expires_at.isoformat(),
            created_at.isoformat(),
        ),
    )
    db.commit()
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_at": expires_at.isoformat(),
        "user": _user_dict(row),
    }


def get_user_by_token(token: str) -> dict[str, Any] | None:
    db = get_db()
    token_hash = hash_access_token(token)
    row = db.execute(
        """SELECT u.id, u.username, u.display_name, u.role, u.is_active,
                  s.expires_at
           FROM auth_sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND u.deleted_at IS NULL""",
        (token_hash,),
    ).fetchone()
    if row is None:
        return None

    try:
        expires_at = datetime.fromisoformat(row["expires_at"])
    except (TypeError, ValueError):
        expires_at = _utc_now() - timedelta(seconds=1)
    if expires_at <= _utc_now() or not bool(row["is_active"]):
        db.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (token_hash,))
        db.commit()
        return None

    db.execute(
        "UPDATE auth_sessions SET last_used_at = ? WHERE token_hash = ?",
        (_utc_now().isoformat(), token_hash),
    )
    db.commit()
    return _user_dict(row)


def logout(token: str) -> None:
    db = get_db()
    db.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (hash_access_token(token),))
    db.commit()


def list_users() -> list[dict[str, Any]]:
    rows = get_db().execute(
        """SELECT id, username, display_name, role, is_active
           FROM users WHERE deleted_at IS NULL ORDER BY role, display_name"""
    ).fetchall()
    return [_user_dict(row) for row in rows]


def get_user(user_id: str) -> dict[str, Any]:
    row = get_db().execute(
        """SELECT id, username, display_name, role, is_active
           FROM users WHERE id = ? AND deleted_at IS NULL""",
        (user_id,),
    ).fetchone()
    if row is None:
        raise UserNotFoundError("用户不存在")
    return _user_dict(row)


def can_access_user(current_user: dict[str, Any], target_user_id: str) -> bool:
    if current_user["id"] == target_user_id or current_user["role"] == "admin":
        return True
    if current_user["role"] != "teacher":
        return False
    row = get_db().execute(
        """SELECT 1
           FROM class_teachers ct
           JOIN class_students cs ON cs.class_id = ct.class_id
           WHERE ct.teacher_id = ? AND cs.student_id = ?
           LIMIT 1""",
        (current_user["id"], target_user_id),
    ).fetchone()
    return row is not None


def resolve_accessible_user_id(
    current_user: dict[str, Any],
    requested_user_id: str | None,
) -> str:
    target_user_id = requested_user_id or current_user["id"]
    target = get_user(target_user_id)
    if target["role"] != "student":
        if target_user_id == current_user["id"] and current_user["role"] != "student":
            raise PermissionDeniedError("教师和管理员没有学生学习记录")
        raise PermissionDeniedError("只能查看学生的学习数据")
    if not can_access_user(current_user, target_user_id):
        raise PermissionDeniedError("无权查看该学生的学习数据")
    return target_user_id


def list_accessible_classes(current_user: dict[str, Any]) -> list[dict[str, Any]]:
    db = get_db()
    if current_user["role"] == "admin":
        where_sql = ""
        params: tuple[Any, ...] = ()
    elif current_user["role"] == "teacher":
        where_sql = "WHERE EXISTS (SELECT 1 FROM class_teachers ct WHERE ct.class_id = c.id AND ct.teacher_id = ?)"
        params = (current_user["id"],)
    else:
        where_sql = "WHERE EXISTS (SELECT 1 FROM class_students cs WHERE cs.class_id = c.id AND cs.student_id = ?)"
        params = (current_user["id"],)
    rows = db.execute(
        f"""SELECT c.id, c.name, c.course_name, COUNT(cs.student_id) AS student_count
            FROM classes c
            LEFT JOIN class_students cs ON cs.class_id = c.id
            {where_sql}
            GROUP BY c.id, c.name, c.course_name
            ORDER BY c.name""",
        params,
    ).fetchall()
    return [dict(row) for row in rows]


def ensure_can_access_class(current_user: dict[str, Any], class_id: str) -> None:
    if current_user["role"] == "admin":
        exists = get_db().execute("SELECT 1 FROM classes WHERE id = ?", (class_id,)).fetchone()
    elif current_user["role"] == "teacher":
        exists = get_db().execute(
            "SELECT 1 FROM class_teachers WHERE class_id = ? AND teacher_id = ?",
            (class_id, current_user["id"]),
        ).fetchone()
    else:
        exists = None
    if exists is None:
        raise PermissionDeniedError("无权查看该班级")


def list_class_students(current_user: dict[str, Any], class_id: str) -> list[dict[str, Any]]:
    ensure_can_access_class(current_user, class_id)
    rows = get_db().execute(
        """SELECT u.id, u.username, u.display_name, u.is_active
           FROM class_students cs
           JOIN users u ON u.id = cs.student_id
           WHERE cs.class_id = ? AND u.deleted_at IS NULL
           ORDER BY u.display_name""",
        (class_id,),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "username": row["username"],
            "display_name": row["display_name"],
            "is_active": bool(row["is_active"]),
        }
        for row in rows
    ]
