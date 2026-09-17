"""Seed the fixed, repeatable practice question bank.

The bank is deterministic: every question lives in
``fixtures/practice/seed_questions.json`` and references a real textbook chunk
from A's data package (``data/processed/chunks.jsonl``). No model call, no
Neo4j and no running database are required, so a clean checkout can build the
bank identically on every machine.

Re-running is safe: inserts are keyed by ``UNIQUE(section_key, stem)`` and use
``INSERT OR IGNORE``, so a second run inserts nothing and only reports skipped
rows.

Usage:
    python -m scripts.seed_practice_bank                     # default DB from settings
    python -m scripts.seed_practice_bank --db-path /tmp/classroom.db
    python -m scripts.seed_practice_bank --dry-run           # validate only, no writes
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FIXTURE = PROJECT_ROOT / "fixtures" / "practice" / "seed_questions.json"
DEFAULT_DATA_DIR = PROJECT_ROOT / "data" / "processed"
DEFAULT_CHUNKS = DEFAULT_DATA_DIR / "chunks.jsonl"

# Fixed seed version so every run writes byte-identical rows and tests can
# assert exact counts across clean environments.
SEED_VERSION = "2026-09-17T00:00:00+00:00"

TYPE_LABELS = {
    "single_choice": "单选题",
    "true_false": "判断题",
    "short_answer": "简答题",
}


class SeedValidationError(RuntimeError):
    """The fixture or the referenced data is inconsistent; nothing was written."""


def load_chunk_index(chunks_path: Path) -> dict[str, dict[str, Any]]:
    chunks: dict[str, dict[str, Any]] = {}
    with chunks_path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            chunk_id = record.get("chunk_id")
            if chunk_id:
                chunks[str(chunk_id)] = record
    return chunks


def load_fixture(fixture_path: Path) -> list[dict[str, Any]]:
    payload = json.loads(fixture_path.read_text(encoding="utf-8"))
    questions = payload.get("questions")
    if not isinstance(questions, list) or not questions:
        raise SeedValidationError(f"fixture 缺少非空 questions 列表：{fixture_path}")
    return questions


def validate_fixture(
    questions: list[dict[str, Any]],
    chunks: dict[str, dict[str, Any]],
) -> list[str]:
    """Return a list of human-readable problems; empty means the fixture is sound."""
    errors: list[str] = []
    for index, question in enumerate(questions, 1):
        label = f"第 {index} 题"
        chunk_id = str(question.get("source_chunk_id") or "").strip()
        chunk = chunks.get(chunk_id)
        if not chunk:
            errors.append(f"{label}：source_chunk_id 不存在于 data/processed/chunks.jsonl：{chunk_id}")
            continue

        section_key = str(question.get("section_key") or "").strip()
        section_part = section_key.rsplit(":", 1)[-1]
        if section_part != str(chunk.get("section_number") or ""):
            errors.append(
                f"{label}：section_key {section_key!r} 与 chunk {chunk_id} 的"
                f" section_number {chunk.get('section_number')!r} 不一致"
            )

        quote = str(question.get("quote") or "").strip()
        quote_original = str(chunk.get("quote_original") or "")
        content_clean = str(chunk.get("content_clean") or "")
        if not quote or (quote not in quote_original and quote not in content_clean):
            errors.append(f"{label}：quote 不是 chunk {chunk_id} 原文的逐字子串")

        question_type = str(question.get("type") or "").strip()
        if question_type not in TYPE_LABELS:
            errors.append(f"{label}：不支持的题型 {question_type!r}")
        if question_type == "single_choice":
            options = question.get("options") or []
            if len(options) != 4 or not all(str(item).strip() for item in options):
                errors.append(f"{label}：单选题必须恰好 4 个非空选项")
            if str(question.get("correct_answer") or "").strip().upper() not in "ABCD":
                errors.append(f"{label}：单选题答案必须是 A/B/C/D")
        elif question_type == "true_false":
            if question.get("correct_answer") not in (True, False):
                errors.append(f"{label}：判断题答案必须是布尔值")

        if not str(question.get("stem") or "").strip():
            errors.append(f"{label}：题干不能为空")
        if not str(question.get("analysis") or "").strip():
            errors.append(f"{label}：解析不能为空")
        if str(question.get("difficulty") or "") not in {"easy", "medium", "hard"}:
            errors.append(f"{label}：难度必须是 easy/medium/hard")
        if not str(question.get("knowledge_point") or "").strip():
            errors.append(f"{label}：知识点不能为空")
    return errors


def _citation_from_chunk(chunk: dict[str, Any], quote: str) -> dict[str, str]:
    return {
        "chunk_id": str(chunk["chunk_id"]),
        "book": str(chunk.get("book") or "具身智能导论"),
        "chapter_title": str(chunk.get("chapter_title") or ""),
        "section_number": str(chunk.get("section_number") or ""),
        "section_title": str(chunk.get("section_title") or ""),
        "quote": quote,
    }


def insert_bank(
    connection: sqlite3.Connection,
    questions: list[dict[str, Any]],
    chunks: dict[str, dict[str, Any]],
) -> dict[str, int]:
    inserted = 0
    skipped = 0
    for index, question in enumerate(questions, 1):
        chunk = chunks[str(question["source_chunk_id"])]
        section_key = str(question["section_key"])
        question_type = str(question["type"])
        section_part = section_key.rsplit(":", 1)[-1].replace(".", "_")
        bank_id = f"bank-seed-{section_part}-{index:03d}"

        options = [str(item).strip() for item in question["options"]]
        if question_type == "true_false":
            options = ["正确", "错误"]
        citation = _citation_from_chunk(chunk, str(question["quote"]))

        cursor = connection.execute(
            """INSERT OR IGNORE INTO question_bank (
                   id, section_key, chapter_title, section_number,
                   section_title, type, stem, options_json,
                   correct_answer_json, analysis, rubric_json, difficulty,
                   knowledge_point, source_chunk_id, citation_json,
                   status, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, 'active', ?)""",
            (
                bank_id,
                section_key,
                str(chunk.get("chapter_title") or ""),
                str(chunk.get("section_number") or ""),
                str(chunk.get("section_title") or ""),
                question_type,
                str(question["stem"]).strip(),
                json.dumps(options, ensure_ascii=False),
                json.dumps(question["correct_answer"], ensure_ascii=False),
                str(question["analysis"]).strip(),
                str(question["difficulty"]),
                str(question["knowledge_point"]).strip(),
                str(question["source_chunk_id"]),
                json.dumps(citation, ensure_ascii=False),
                SEED_VERSION,
            ),
        )
        if cursor.rowcount and cursor.rowcount > 0:
            inserted += 1
        else:
            skipped += 1
    return {"total": len(questions), "inserted": inserted, "skipped": skipped}


def seed(
    connection: sqlite3.Connection | None = None,
    *,
    fixture_path: Path | None = None,
    data_dir: Path | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    fixture_path = Path(fixture_path or DEFAULT_FIXTURE)
    chunks_path = Path(data_dir or DEFAULT_DATA_DIR) / "chunks.jsonl"
    if not fixture_path.is_file():
        raise SeedValidationError(f"找不到题库 fixture：{fixture_path}")
    if not chunks_path.is_file():
        raise SeedValidationError(
            f"找不到教材数据 data/processed/chunks.jsonl：{chunks_path}，"
            "请先合并 A 的数据包"
        )

    chunks = load_chunk_index(chunks_path)
    questions = load_fixture(fixture_path)
    errors = validate_fixture(questions, chunks)
    if errors:
        raise SeedValidationError(
            "题库 seed 校验失败（未写入任何数据）：\n- " + "\n- ".join(errors)
        )

    if dry_run:
        return {
            "fixture": str(fixture_path),
            "data": str(chunks_path),
            "dry_run": True,
            **{"total": len(questions), "inserted": 0, "skipped": 0},
        }

    close_after = connection is None
    if connection is None:
        from app.db.sqlite import get_db

        connection = get_db()
    try:
        counts = insert_bank(connection, questions, chunks)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        if close_after:
            connection.close()
    return {
        "fixture": str(fixture_path),
        "data": str(chunks_path),
        "version": SEED_VERSION,
        **counts,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db-path", type=Path, default=None, help="写入的 SQLite 数据库路径（默认 data/classroom.db）")
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--dry-run", action="store_true", help="只校验，不写入")
    args = parser.parse_args()

    if args.db_path is not None:
        import app.db.sqlite as sqlite_module

        sqlite_module.DB_PATH = args.db_path

    result = seed(
        fixture_path=args.fixture,
        data_dir=args.data_dir,
        dry_run=args.dry_run,
    )
    if result.get("dry_run"):
        print(
            f"[dry-run] 校验通过：fixture={result['fixture']} data={result['data']} "
            f"共 {result['total']} 道题，未写入。"
        )
        return
    print(
        f"题库 seed 完成：fixture={result['fixture']} data={result['data']} "
        f"版本={result['version']} 共 {result['total']} 道，"
        f"本次插入 {result['inserted']} 道，跳过（已存在）{result['skipped']} 道。"
    )


if __name__ == "__main__":
    main()
