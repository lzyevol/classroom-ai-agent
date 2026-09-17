from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.db.sqlite import get_db
from app.schemas.admin import (
    AdminUserCreate,
    AdminUserUpdate,
    UserStatusFilter,
)
from app.schemas.auth import UserRole
from app.security import hash_password


class AdminUserNotFoundError(Exception):
    pass


class AdminUserConflictError(Exception):
    pass


class InvalidAdminOperationError(Exception):
    pass


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _user_dict(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "role": row["role"],
        "is_active": bool(row["is_active"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "deleted_at": row["deleted_at"],
    }


def _get_user_row(user_id: str, *, include_deleted: bool = True) -> Any:
    where = "id = ?" if include_deleted else "id = ? AND deleted_at IS NULL"
    row = get_db().execute(
        f"""SELECT id, username, display_name, role, is_active,
                   created_at, updated_at, deleted_at
            FROM users WHERE {where}""",
        (user_id,),
    ).fetchone()
    if row is None:
        raise AdminUserNotFoundError("用户不存在")
    return row


def _ensure_admin_remains(target: Any) -> None:
    if target["role"] != "admin" or not bool(target["is_active"]):
        return
    row = get_db().execute(
        """SELECT COUNT(*) AS count
           FROM users
           WHERE role = 'admin' AND is_active = 1
             AND deleted_at IS NULL AND id <> ?""",
        (target["id"],),
    ).fetchone()
    if int(row["count"] or 0) == 0:
        raise InvalidAdminOperationError("系统至少需要保留一个启用的管理员")


def _invalidate_sessions(user_id: str) -> None:
    get_db().execute("DELETE FROM auth_sessions WHERE user_id = ?", (user_id,))


def list_admin_users(
    *,
    query: str | None,
    role: UserRole | None,
    status: UserStatusFilter,
    page: int,
    page_size: int,
) -> dict[str, Any]:
    conditions: list[str] = []
    params: list[Any] = []
    if query and query.strip():
        conditions.append("(username LIKE ? OR display_name LIKE ?)")
        pattern = f"%{query.strip()}%"
        params.extend((pattern, pattern))
    if role:
        conditions.append("role = ?")
        params.append(role)
    if status == "active":
        conditions.append("deleted_at IS NULL AND is_active = 1")
    elif status == "inactive":
        conditions.append("deleted_at IS NULL AND is_active = 0")
    elif status == "deleted":
        conditions.append("deleted_at IS NOT NULL")

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    db = get_db()
    total_row = db.execute(
        f"SELECT COUNT(*) AS count FROM users {where}", tuple(params)
    ).fetchone()
    rows = db.execute(
        f"""SELECT id, username, display_name, role, is_active,
                   created_at, updated_at, deleted_at
            FROM users {where}
            ORDER BY deleted_at IS NOT NULL, role, display_name, id
            LIMIT ? OFFSET ?""",
        (*params, page_size, (page - 1) * page_size),
    ).fetchall()
    return {
        "items": [_user_dict(row) for row in rows],
        "total": int(total_row["count"] or 0),
        "page": page,
        "page_size": page_size,
    }


def get_admin_user(user_id: str) -> dict[str, Any]:
    return _user_dict(_get_user_row(user_id))


def create_admin_user(request: AdminUserCreate) -> dict[str, Any]:
    db = get_db()
    now = _utc_now()
    user_id = f"user_{uuid4().hex}"
    try:
        db.execute(
            """INSERT INTO users (
                   id, username, password_hash, display_name, role,
                   is_active, created_at, updated_at, deleted_at, deleted_by
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)""",
            (
                user_id,
                request.username.strip(),
                hash_password(request.password),
                request.display_name.strip(),
                request.role,
                int(request.is_active),
                now,
                now,
            ),
        )
        db.commit()
    except sqlite3.IntegrityError as exc:
        db.rollback()
        raise AdminUserConflictError("用户名已存在") from exc
    return get_admin_user(user_id)


def update_admin_user(
    current_admin: dict[str, Any],
    user_id: str,
    request: AdminUserUpdate,
) -> dict[str, Any]:
    target = _get_user_row(user_id, include_deleted=False)
    updates = request.model_dump(exclude_unset=True, exclude_none=True)
    if not updates:
        return _user_dict(target)
    if current_admin["id"] == user_id and updates.get("role", target["role"]) != "admin":
        raise InvalidAdminOperationError("不能取消自己的管理员角色")
    if updates.get("role") != target["role"] and target["role"] == "admin":
        _ensure_admin_remains(target)

    fields: list[str] = []
    params: list[Any] = []
    for name in ("username", "display_name", "role"):
        if name in updates:
            value = updates[name]
            if isinstance(value, str):
                value = value.strip()
            fields.append(f"{name} = ?")
            params.append(value)
    fields.append("updated_at = ?")
    params.append(_utc_now())
    params.append(user_id)
    db = get_db()
    try:
        db.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = ?", tuple(params))
        if "role" in updates:
            _invalidate_sessions(user_id)
        db.commit()
    except sqlite3.IntegrityError as exc:
        db.rollback()
        raise AdminUserConflictError("用户名已存在") from exc
    return get_admin_user(user_id)


def reset_admin_user_password(user_id: str, password: str) -> None:
    _get_user_row(user_id, include_deleted=False)
    db = get_db()
    db.execute(
        "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
        (hash_password(password), _utc_now(), user_id),
    )
    _invalidate_sessions(user_id)
    db.commit()


def set_admin_user_status(
    current_admin: dict[str, Any],
    user_id: str,
    is_active: bool,
) -> dict[str, Any]:
    target = _get_user_row(user_id, include_deleted=False)
    if current_admin["id"] == user_id and not is_active:
        raise InvalidAdminOperationError("不能停用当前登录的管理员账号")
    if not is_active:
        _ensure_admin_remains(target)
    db = get_db()
    db.execute(
        "UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?",
        (int(is_active), _utc_now(), user_id),
    )
    if not is_active:
        _invalidate_sessions(user_id)
    db.commit()
    return get_admin_user(user_id)


def soft_delete_admin_user(current_admin: dict[str, Any], user_id: str) -> None:
    target = _get_user_row(user_id, include_deleted=False)
    if current_admin["id"] == user_id:
        raise InvalidAdminOperationError("不能删除当前登录的管理员账号")
    _ensure_admin_remains(target)
    now = _utc_now()
    db = get_db()
    db.execute(
        """UPDATE users
           SET is_active = 0, deleted_at = ?, deleted_by = ?, updated_at = ?
           WHERE id = ?""",
        (now, current_admin["id"], now, user_id),
    )
    _invalidate_sessions(user_id)
    db.commit()

