from __future__ import annotations

import json
import sqlite3

import pytest

import app.db.sqlite as sqlite_module
from scripts.seed_practice_bank import (
    DEFAULT_CHUNKS,
    SeedValidationError,
    load_chunk_index,
    seed,
)


def _chunks() -> dict:
    return load_chunk_index(DEFAULT_CHUNKS)


def _bank_rows(conn: sqlite3.Connection) -> list[dict]:
    return [dict(row) for row in conn.execute("SELECT * FROM question_bank").fetchall()]


def test_seed_populates_bank_with_real_chunk_references(sqlite_db):
    conn = sqlite_module.get_db()
    result = seed(connection=conn)
    assert result["total"] == 12
    assert result["inserted"] == 12
    assert result["skipped"] == 0

    chunks = _chunks()
    rows = _bank_rows(conn)
    assert len(rows) == 12
    for row in rows:
        chunk = chunks.get(row["source_chunk_id"])
        assert chunk is not None, f"缺失 chunk: {row['source_chunk_id']}"
        citation = json.loads(row["citation_json"])
        assert (
            citation["quote"] in chunk["quote_original"]
            or citation["quote"] in chunk["content_clean"]
        ), f"quote 不是 chunk {row['source_chunk_id']} 原文子串"
        assert citation["chunk_id"] == row["source_chunk_id"]
        assert row["chapter_title"] == chunk["chapter_title"]
        assert row["section_number"] == chunk["section_number"]
        assert row["section_title"] == chunk["section_title"]
        assert row["section_key"] == f"book_embodied_ai_intro_2024:{chunk['section_number']}"
        if row["type"] == "single_choice":
            assert len(json.loads(row["options_json"])) == 4
        elif row["type"] == "true_false":
            assert json.loads(row["correct_answer_json"]) in (True, False)


def test_seed_is_idempotent(sqlite_db):
    conn = sqlite_module.get_db()
    first = seed(connection=conn)
    second = seed(connection=conn)
    third = seed(connection=conn)

    assert first["inserted"] == 12
    assert second["inserted"] == 0 and second["skipped"] == 12
    assert third["inserted"] == 0 and third["skipped"] == 12
    assert len(_bank_rows(conn)) == 12


def test_seed_dry_run_writes_nothing(sqlite_db):
    conn = sqlite_module.get_db()
    result = seed(connection=conn, dry_run=True)
    assert result["dry_run"] is True
    assert len(_bank_rows(conn)) == 0


def test_seed_rejects_unknown_chunk_id(sqlite_db, tmp_path):
    fixture = json.loads(_read_default_fixture())
    fixture["questions"][0]["source_chunk_id"] = "book:9.9:chunk-999"
    bad_path = tmp_path / "bad_chunk.json"
    bad_path.write_text(json.dumps(fixture, ensure_ascii=False), encoding="utf-8")

    conn = sqlite_module.get_db()
    with pytest.raises(SeedValidationError, match="不存在于"):
        seed(connection=conn, fixture_path=bad_path)
    assert len(_bank_rows(conn)) == 0


def test_seed_rejects_quote_not_in_source_text(sqlite_db, tmp_path):
    fixture = json.loads(_read_default_fixture())
    fixture["questions"][1]["quote"] = "这段文字不是教材原文"
    bad_path = tmp_path / "bad_quote.json"
    bad_path.write_text(json.dumps(fixture, ensure_ascii=False), encoding="utf-8")

    conn = sqlite_module.get_db()
    with pytest.raises(SeedValidationError, match="逐字子串"):
        seed(connection=conn, fixture_path=bad_path)
    assert len(_bank_rows(conn)) == 0


def test_seed_rejects_section_mismatch(sqlite_db, tmp_path):
    fixture = json.loads(_read_default_fixture())
    fixture["questions"][0]["section_key"] = "book_embodied_ai_intro_2024:9.9"
    bad_path = tmp_path / "bad_section.json"
    bad_path.write_text(json.dumps(fixture, ensure_ascii=False), encoding="utf-8")

    conn = sqlite_module.get_db()
    with pytest.raises(SeedValidationError, match="不一致"):
        seed(connection=conn, fixture_path=bad_path)
    assert len(_bank_rows(conn)) == 0


def _read_default_fixture() -> str:
    from scripts.seed_practice_bank import DEFAULT_FIXTURE

    return DEFAULT_FIXTURE.read_text(encoding="utf-8")
