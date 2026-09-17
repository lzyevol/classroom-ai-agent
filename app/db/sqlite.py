from __future__ import annotations

import sqlite3
from functools import lru_cache
from pathlib import Path
from contextlib import contextmanager
from threading import Lock, local

from app.config import settings

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "classroom.db"
DB_PATH = settings.sqlite_db_path or DEFAULT_DB_PATH

_CREATE_AUTH_TABLES = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    deleted_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_role
ON users(role, is_active);

CREATE TABLE IF NOT EXISTS classes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    course_name TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS class_students (
    class_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    PRIMARY KEY (class_id, student_id),
    FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_class_students_student
ON class_students(student_id, class_id);

CREATE TABLE IF NOT EXISTS class_teachers (
    class_id TEXT NOT NULL,
    teacher_id TEXT NOT NULL,
    assigned_at TEXT NOT NULL,
    PRIMARY KEY (class_id, teacher_id),
    FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
    FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_class_teachers_teacher
ON class_teachers(teacher_id, class_id);

CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user
ON auth_sessions(user_id, expires_at);
"""

_CREATE_LESSONS = """
CREATE TABLE IF NOT EXISTS lessons (
    section_key TEXT PRIMARY KEY,
    section_title TEXT,
    chapter_title TEXT,
    slides_json TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    edited_at TEXT,
    status TEXT DEFAULT 'generated'
)
"""

_CREATE_PRACTICE_TABLES = """
CREATE TABLE IF NOT EXISTS question_bank (
    id TEXT PRIMARY KEY,
    section_key TEXT NOT NULL,
    chapter_title TEXT NOT NULL,
    section_number TEXT NOT NULL,
    section_title TEXT NOT NULL,
    type TEXT NOT NULL,
    stem TEXT NOT NULL,
    options_json TEXT NOT NULL,
    correct_answer_json TEXT NOT NULL,
    analysis TEXT NOT NULL,
    rubric_json TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    knowledge_point TEXT NOT NULL,
    source_chunk_id TEXT NOT NULL,
    citation_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    replaced_from TEXT,
    updated_at TEXT,
    UNIQUE(section_key, stem)
);

CREATE INDEX IF NOT EXISTS idx_question_bank_lookup
ON question_bank(section_key, status, difficulty, type);

CREATE TABLE IF NOT EXISTS practice_sessions (
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
    submitted_at TEXT,
    assignment_id TEXT
);

CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    bank_question_id TEXT,
    type TEXT NOT NULL,
    stem TEXT NOT NULL,
    options_json TEXT NOT NULL,
    correct_answer_json TEXT NOT NULL,
    analysis TEXT NOT NULL,
    rubric_json TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    knowledge_point TEXT NOT NULL,
    source_chunk_id TEXT NOT NULL,
    citation_json TEXT NOT NULL,
    max_score REAL NOT NULL,
    sort_order INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES practice_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_questions_session
ON questions(session_id, sort_order);

CREATE TABLE IF NOT EXISTS answer_records (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    question_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    answer_json TEXT NOT NULL,
    score REAL NOT NULL,
    is_correct INTEGER NOT NULL,
    feedback_json TEXT NOT NULL,
    submitted_at TEXT NOT NULL,
    UNIQUE(session_id, question_id, user_id),
    FOREIGN KEY (session_id) REFERENCES practice_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_answer_records_session
ON answer_records(session_id, user_id);

CREATE TABLE IF NOT EXISTS section_learning_progress (
    user_id TEXT NOT NULL,
    section_key TEXT NOT NULL,
    chapter_title TEXT NOT NULL,
    section_number TEXT NOT NULL,
    section_title TEXT NOT NULL,
    access_count INTEGER NOT NULL DEFAULT 1,
    first_accessed_at TEXT NOT NULL,
    last_accessed_at TEXT NOT NULL,
    PRIMARY KEY (user_id, section_key)
);

CREATE INDEX IF NOT EXISTS idx_section_learning_progress_user
ON section_learning_progress(user_id, last_accessed_at DESC);

CREATE TABLE IF NOT EXISTS teaching_assignments (
    id TEXT PRIMARY KEY,
    class_id TEXT NOT NULL,
    teacher_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    section_key TEXT NOT NULL,
    chapter_title TEXT NOT NULL,
    section_number TEXT NOT NULL,
    section_title TEXT NOT NULL,
    knowledge_point TEXT NOT NULL DEFAULT '',
    difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    question_types_json TEXT NOT NULL,
    question_count INTEGER NOT NULL,
    due_at TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
    created_at TEXT NOT NULL,
    closed_at TEXT,
    deleted_at TEXT,
    deleted_by TEXT,
    FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
    FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_teaching_assignments_class
ON teaching_assignments(class_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_teaching_assignments_visible
ON teaching_assignments(class_id, deleted_at, status, created_at DESC);

CREATE TABLE IF NOT EXISTS assignment_students (
    assignment_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'assigned'
        CHECK (status IN ('assigned', 'in_progress', 'completed')),
    baseline_score_rate REAL NOT NULL DEFAULT 0,
    baseline_attempts INTEGER NOT NULL DEFAULT 0,
    practice_session_id TEXT,
    assigned_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    post_score_rate REAL,
    improvement REAL,
    practice_score_rate REAL,
    actual_question_count INTEGER,
    PRIMARY KEY (assignment_id, student_id),
    FOREIGN KEY (assignment_id) REFERENCES teaching_assignments(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (practice_session_id) REFERENCES practice_sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_assignment_students_student
ON assignment_students(student_id, status, assigned_at DESC);
"""


def _get_connection() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


@lru_cache(maxsize=8)
def _cached_password_hash(password: str) -> str:
    from app.security import hash_password

    return hash_password(password)


def _seed_demo_users(conn: sqlite3.Connection) -> None:
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    users = (
        (
            "demo_student",
            "student",
            settings.demo_student_password,
            "演示学生",
            "student",
        ),
        (
            "demo_teacher",
            "teacher",
            settings.demo_teacher_password,
            "演示教师",
            "teacher",
        ),
        (
            "demo_admin",
            "admin",
            settings.demo_admin_password,
            "系统管理员",
            "admin",
        ),
    )
    for user_id, username, password, display_name, role in users:
        exists = conn.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone()
        if exists is None:
            conn.execute(
                """INSERT INTO users (
                       id, username, password_hash, display_name, role,
                       is_active, created_at, updated_at
                   ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)""",
                (
                    user_id,
                    username,
                    _cached_password_hash(password),
                    display_name,
                    role,
                    now,
                    now,
                ),
            )

    conn.execute(
        """INSERT OR IGNORE INTO classes (id, name, course_name, created_at)
           VALUES ('demo_class', '具身智能课程班', '具身智能导论', ?)""",
        (now,),
    )
    conn.execute(
        """INSERT OR IGNORE INTO class_students (class_id, student_id, joined_at)
           VALUES ('demo_class', 'demo_student', ?)""",
        (now,),
    )
    conn.execute(
        """INSERT OR IGNORE INTO class_teachers (class_id, teacher_id, assigned_at)
           VALUES ('demo_class', 'demo_teacher', ?)""",
        (now,),
    )


def initialize_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(_CREATE_AUTH_TABLES)
    conn.execute(_CREATE_LESSONS)
    conn.executescript(_CREATE_PRACTICE_TABLES)
    user_columns = {
        row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()
    }
    if "deleted_at" not in user_columns:
        conn.execute("ALTER TABLE users ADD COLUMN deleted_at TEXT")
    if "deleted_by" not in user_columns:
        conn.execute("ALTER TABLE users ADD COLUMN deleted_by TEXT")
    conn.execute(
        """CREATE INDEX IF NOT EXISTS idx_users_lifecycle
           ON users(deleted_at, is_active, role)"""
    )
    question_columns = {
        row[1] for row in conn.execute("PRAGMA table_info(questions)").fetchall()
    }
    if "bank_question_id" not in question_columns:
        conn.execute("ALTER TABLE questions ADD COLUMN bank_question_id TEXT")
    bank_columns = {
        row[1] for row in conn.execute("PRAGMA table_info(question_bank)").fetchall()
    }
    # Teacher review adds replacement tracking; existing banks are migrated in place.
    if "replaced_from" not in bank_columns:
        conn.execute("ALTER TABLE question_bank ADD COLUMN replaced_from TEXT")
    if "updated_at" not in bank_columns:
        conn.execute("ALTER TABLE question_bank ADD COLUMN updated_at TEXT")
    practice_session_columns = {
        row[1] for row in conn.execute("PRAGMA table_info(practice_sessions)").fetchall()
    }
    if "assignment_id" not in practice_session_columns:
        conn.execute("ALTER TABLE practice_sessions ADD COLUMN assignment_id TEXT")
    conn.execute(
        """CREATE INDEX IF NOT EXISTS idx_practice_sessions_assignment
           ON practice_sessions(assignment_id, user_id)"""
    )
    assignment_student_columns = {
        row[1] for row in conn.execute("PRAGMA table_info(assignment_students)").fetchall()
    }
    if "practice_score_rate" not in assignment_student_columns:
        conn.execute("ALTER TABLE assignment_students ADD COLUMN practice_score_rate REAL")
    if "actual_question_count" not in assignment_student_columns:
        conn.execute("ALTER TABLE assignment_students ADD COLUMN actual_question_count INTEGER")
    teaching_assignment_columns = {
        row[1] for row in conn.execute("PRAGMA table_info(teaching_assignments)").fetchall()
    }
    if "deleted_at" not in teaching_assignment_columns:
        conn.execute("ALTER TABLE teaching_assignments ADD COLUMN deleted_at TEXT")
    if "deleted_by" not in teaching_assignment_columns:
        conn.execute("ALTER TABLE teaching_assignments ADD COLUMN deleted_by TEXT")
    _seed_demo_users(conn)
    conn.commit()


_connection_local = local()
_connections: list[sqlite3.Connection] = []
_connections_lock = Lock()
_connection_generation = 0


def get_db() -> sqlite3.Connection:
    conn = getattr(_connection_local, "connection", None)
    generation = getattr(_connection_local, "generation", None)
    if conn is not None and generation == _connection_generation:
        return conn

    with _connections_lock:
        conn = getattr(_connection_local, "connection", None)
        generation = getattr(_connection_local, "generation", None)
        if conn is not None and generation == _connection_generation:
            return conn

        conn = _get_connection()
        try:
            initialize_schema(conn)
        except Exception:
            conn.close()
            raise

        _connection_local.connection = conn
        _connection_local.generation = _connection_generation
        _connections.append(conn)
        return conn


def close_db() -> None:
    global _connection_generation
    with _connections_lock:
        connections = list(_connections)
        _connections.clear()
        _connection_generation += 1

    for conn in connections:
        try:
            conn.close()
        except sqlite3.Error:
            pass

    for attribute in ("connection", "generation"):
        if hasattr(_connection_local, attribute):
            delattr(_connection_local, attribute)
