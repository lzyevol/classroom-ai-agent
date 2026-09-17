from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime
import getpass
import json
import os
from pathlib import Path
import time
from typing import Any, Iterable


SOURCE_ID = "book_embodied_ai_intro_2024"


def normalize_section_title(section_number: str, section_title: str) -> str:
    if section_number.endswith(".0") and section_title == "章引言":
        return "引言"
    return section_title


def normalize_citation_label(section_number: str, citation_label: str) -> str:
    if section_number.endswith(".0"):
        return citation_label.replace("“章引言”", "“引言”")
    return citation_label


def iter_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path} 第 {line_number} 行不是有效JSON") from exc


def batches(rows: list[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    for start in range(0, len(rows), size):
        yield rows[start : start + size]


def run_batches(session: Any, query: str, rows: list[dict[str, Any]], size: int) -> None:
    for batch in batches(rows, size):
        session.run(query, rows=batch).consume()


def prepare_data(args: argparse.Namespace) -> dict[str, Any]:
    ontology = json.loads(args.ontology.read_text(encoding="utf-8"))
    allowed_entity_types = set(ontology["entity_types"])
    allowed_relation_types = set(ontology["relation_types"])

    entities = list(iter_jsonl(args.entities))
    relations = list(iter_jsonl(args.relations))
    links = list(iter_jsonl(args.section_links))
    chunks = list(iter_jsonl(args.chunks))
    invalid_entity_types = sorted({row["type"] for row in entities} - allowed_entity_types)
    invalid_relation_types = sorted({row["relation"] for row in relations} - allowed_relation_types)
    if invalid_entity_types:
        raise ValueError(f"存在本体外实体类型：{invalid_entity_types}")
    if invalid_relation_types:
        raise ValueError(f"存在本体外关系类型：{invalid_relation_types}")

    entity_rows: list[dict[str, Any]] = []
    for row in entities:
        entity_rows.append(
            {
                "entity_id": row["entity_id"],
                "name": row["name"],
                "entity_type": row["type"],
                "aliases": row.get("aliases", []),
                "definitions_json": json.dumps(row.get("definitions", []), ensure_ascii=False),
                "type_candidates_json": json.dumps(row.get("type_candidates", []), ensure_ascii=False),
                "source_chunk_ids": row.get("source_chunk_ids", []),
                "source_id": SOURCE_ID,
            }
        )

    section_map: dict[str, dict[str, Any]] = {}
    mention_rows: list[dict[str, Any]] = []
    for row in links:
        section_key = f"{SOURCE_ID}:{row['section_number']}"
        section_map[section_key] = {
            "section_key": section_key,
            "source_id": SOURCE_ID,
            "book": row["book"],
            "chapter_number": int(row["chapter_number"]),
            "chapter_title": row["chapter_title"],
            "section_number": row["section_number"],
            "section_title": normalize_section_title(
                row["section_number"], row["section_title"]
            ),
            "citation_label": normalize_citation_label(
                row["section_number"], row["citation_label"]
            ),
        }
        mention_rows.append(
            {
                "entity_id": row["entity_id"],
                "section_key": section_key,
                "source_id": SOURCE_ID,
            }
        )

    chunk_rows: list[dict[str, Any]] = []
    chunk_ids: set[str] = set()
    for row in chunks:
        chunk_id = row["chunk_id"]
        if chunk_id in chunk_ids:
            raise ValueError(f"原文片段ID重复：{chunk_id}")
        chunk_ids.add(chunk_id)
        section_key = f"{SOURCE_ID}:{row['section_number']}"
        section_map.setdefault(
            section_key,
            {
                "section_key": section_key,
                "source_id": SOURCE_ID,
                "book": row["book"],
                "chapter_number": int(row["chapter_number"]),
                "chapter_title": row["chapter_title"],
                "section_number": row["section_number"],
                "section_title": normalize_section_title(
                    row["section_number"], row["section_title"]
                ),
                "citation_label": normalize_citation_label(
                    row["section_number"], row["citation_label"]
                ),
            },
        )
        image_refs = row.get("image_refs", [])
        chunk_rows.append(
            {
                "chunk_id": chunk_id,
                "source_id": SOURCE_ID,
                "section_key": section_key,
                "book": row["book"],
                "chapter_number": int(row["chapter_number"]),
                "chapter_title": row["chapter_title"],
                "section_number": row["section_number"],
                "section_title": normalize_section_title(
                    row["section_number"], row["section_title"]
                ),
                "content_type": row.get("content_type", "core"),
                "citation_label": normalize_citation_label(
                    row["section_number"], row["citation_label"]
                ),
                "content_clean": row.get("content_clean", ""),
                "quote_original": row.get("quote_original", ""),
                "source_page_indexes_internal": row.get("source_page_indexes_internal", []),
                "source_blocks_json": json.dumps(
                    row.get("source_blocks", []), ensure_ascii=False
                ),
                "image_refs_json": json.dumps(image_refs, ensure_ascii=False),
                "image_ids": [ref["image_id"] for ref in image_refs if ref.get("image_id")],
                "image_paths": [
                    ref["local_path"] for ref in image_refs if ref.get("local_path")
                ],
            }
        )

    evidence_rows = [
        {
            "entity_id": row["entity_id"],
            "chunk_id": chunk_id,
            "source_id": SOURCE_ID,
        }
        for row in entity_rows
        for chunk_id in row["source_chunk_ids"]
    ]
    missing_chunk_ids = sorted(
        {row["chunk_id"] for row in evidence_rows} - chunk_ids
    )
    if missing_chunk_ids:
        preview = missing_chunk_ids[:10]
        raise ValueError(
            f"知识实体引用了不存在的原文片段：{preview}"
            + (f"，另有{len(missing_chunk_ids) - len(preview)}个" if len(missing_chunk_ids) > len(preview) else "")
        )

    relation_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in relations:
        relation_groups[row["relation"]].append(
            {
                "relation_id": row["relation_id"],
                "head_entity_id": row["head_entity_id"],
                "tail_entity_id": row["tail_entity_id"],
                "max_confidence": float(row["max_confidence"]),
                "evidence_json": json.dumps(row.get("evidence", []), ensure_ascii=False),
                "source_id": SOURCE_ID,
            }
        )
    return {
        "allowed_entity_types": allowed_entity_types,
        "allowed_relation_types": allowed_relation_types,
        "entities": entity_rows,
        "sections": list(section_map.values()),
        "chunks": chunk_rows,
        "mentions": mention_rows,
        "evidence_links": evidence_rows,
        "relations": relations,
        "relation_groups": relation_groups,
    }


def import_graph(args: argparse.Namespace, data: dict[str, Any]) -> dict[str, Any]:
    try:
        from neo4j import GraphDatabase
    except ImportError as exc:
        raise SystemExit(
            "缺少neo4j驱动。请先执行：.\\.venv\\Scripts\\python.exe -m pip install -r requirements-neo4j.txt"
        ) from exc

    password = os.environ.get("NEO4J_PASSWORD")
    if not password:
        password = getpass.getpass("Neo4j 密码（输入时不会显示）: ")
    started = time.time()
    driver = GraphDatabase.driver(args.uri, auth=(args.username, password))
    try:
        driver.verify_connectivity()
        with driver.session(database=args.database) as session:
            session.run(
                "CREATE CONSTRAINT entity_id_unique IF NOT EXISTS "
                "FOR (e:KnowledgeEntity) REQUIRE e.entity_id IS UNIQUE"
            ).consume()
            session.run(
                "CREATE CONSTRAINT section_key_unique IF NOT EXISTS "
                "FOR (s:Section) REQUIRE s.section_key IS UNIQUE"
            ).consume()
            session.run(
                "CREATE CONSTRAINT chunk_id_unique IF NOT EXISTS "
                "FOR (c:Chunk) REQUIRE c.chunk_id IS UNIQUE"
            ).consume()

            entities_by_type: dict[str, list[dict[str, Any]]] = defaultdict(list)
            for row in data["entities"]:
                entities_by_type[row["entity_type"]].append(row)
            for entity_type, rows in entities_by_type.items():
                # entity_type 已由本体白名单校验，允许安全地作为Cypher标签使用。
                query = f"""
                UNWIND $rows AS row
                MERGE (e:KnowledgeEntity:{entity_type} {{entity_id: row.entity_id}})
                SET e.name = row.name,
                    e.entity_type = row.entity_type,
                    e.aliases = row.aliases,
                    e.definitions_json = row.definitions_json,
                    e.type_candidates_json = row.type_candidates_json,
                    e.source_chunk_ids = row.source_chunk_ids,
                    e.source_id = row.source_id,
                    e.updated_at = datetime()
                """
                run_batches(session, query, rows, args.batch_size)

            run_batches(
                session,
                """
                UNWIND $rows AS row
                MERGE (s:Section {section_key: row.section_key})
                SET s.source_id = row.source_id,
                    s.book = row.book,
                    s.chapter_number = row.chapter_number,
                    s.chapter_title = row.chapter_title,
                    s.section_number = row.section_number,
                    s.section_title = row.section_title,
                    s.citation_label = row.citation_label,
                    s.updated_at = datetime()
                """,
                data["sections"],
                args.batch_size,
            )
            run_batches(
                session,
                """
                UNWIND $rows AS row
                MERGE (c:Chunk {chunk_id: row.chunk_id})
                SET c.source_id = row.source_id,
                    c.book = row.book,
                    c.chapter_number = row.chapter_number,
                    c.chapter_title = row.chapter_title,
                    c.section_number = row.section_number,
                    c.section_title = row.section_title,
                    c.content_type = row.content_type,
                    c.citation_label = row.citation_label,
                    c.content_clean = row.content_clean,
                    c.quote_original = row.quote_original,
                    c.source_page_indexes_internal = row.source_page_indexes_internal,
                    c.source_blocks_json = row.source_blocks_json,
                    c.image_refs_json = row.image_refs_json,
                    c.image_ids = row.image_ids,
                    c.image_paths = row.image_paths,
                    c.updated_at = datetime()
                """,
                data["chunks"],
                args.batch_size,
            )
            run_batches(
                session,
                """
                UNWIND $rows AS row
                MATCH (c:Chunk {chunk_id: row.chunk_id})
                MATCH (s:Section {section_key: row.section_key})
                MERGE (c)-[r:BELONGS_TO {source_id: row.source_id}]->(s)
                SET r.updated_at = datetime()
                """,
                data["chunks"],
                args.batch_size,
            )
            run_batches(
                session,
                """
                UNWIND $rows AS row
                MATCH (e:KnowledgeEntity {entity_id: row.entity_id})
                MATCH (s:Section {section_key: row.section_key})
                MERGE (e)-[r:MENTIONED_IN {source_id: row.source_id}]->(s)
                SET r.updated_at = datetime()
                """,
                data["mentions"],
                args.batch_size,
            )
            run_batches(
                session,
                """
                UNWIND $rows AS row
                MATCH (e:KnowledgeEntity {entity_id: row.entity_id})
                MATCH (c:Chunk {chunk_id: row.chunk_id})
                MERGE (e)-[r:EVIDENCED_BY {source_id: row.source_id}]->(c)
                SET r.updated_at = datetime()
                """,
                data["evidence_links"],
                args.batch_size,
            )

            for relation_type, rows in data["relation_groups"].items():
                # relation_type 已由本体白名单校验，允许安全地作为关系类型使用。
                query = f"""
                UNWIND $rows AS row
                MATCH (head:KnowledgeEntity {{entity_id: row.head_entity_id}})
                MATCH (tail:KnowledgeEntity {{entity_id: row.tail_entity_id}})
                MERGE (head)-[r:{relation_type} {{relation_id: row.relation_id}}]->(tail)
                SET r.max_confidence = row.max_confidence,
                    r.evidence_json = row.evidence_json,
                    r.source_id = row.source_id,
                    r.updated_at = datetime()
                """
                run_batches(session, query, rows, args.batch_size)

            counts = {
                "entities": session.run(
                    "MATCH (e:KnowledgeEntity {source_id: $source_id}) RETURN count(e) AS count",
                    source_id=SOURCE_ID,
                ).single()["count"],
                "sections": session.run(
                    "MATCH (s:Section {source_id: $source_id}) RETURN count(s) AS count",
                    source_id=SOURCE_ID,
                ).single()["count"],
                "chunks": session.run(
                    "MATCH (c:Chunk {source_id: $source_id}) RETURN count(c) AS count",
                    source_id=SOURCE_ID,
                ).single()["count"],
                "chunk_section_links": session.run(
                    "MATCH (:Chunk)-[r:BELONGS_TO {source_id: $source_id}]->(:Section) "
                    "RETURN count(r) AS count",
                    source_id=SOURCE_ID,
                ).single()["count"],
                "evidence_links": session.run(
                    "MATCH (:KnowledgeEntity)-[r:EVIDENCED_BY {source_id: $source_id}]->(:Chunk) "
                    "RETURN count(r) AS count",
                    source_id=SOURCE_ID,
                ).single()["count"],
                "mentions": session.run(
                    "MATCH (:KnowledgeEntity)-[r:MENTIONED_IN {source_id: $source_id}]->(:Section) "
                    "RETURN count(r) AS count",
                    source_id=SOURCE_ID,
                ).single()["count"],
                "knowledge_relations": session.run(
                    "MATCH (:KnowledgeEntity)-[r]->(:KnowledgeEntity) "
                    "WHERE r.source_id = $source_id RETURN count(r) AS count",
                    source_id=SOURCE_ID,
                ).single()["count"],
            }
    finally:
        driver.close()

    expected = {
        "entities": len(data["entities"]),
        "sections": len(data["sections"]),
        "chunks": len(data["chunks"]),
        "chunk_section_links": len(data["chunks"]),
        "evidence_links": len(data["evidence_links"]),
        "mentions": len(data["mentions"]),
        "knowledge_relations": len(data["relations"]),
    }
    if counts != expected:
        raise RuntimeError(f"导入数量不一致：expected={expected}, actual={counts}")
    return {
        "status": "passed",
        "uri": args.uri,
        "database": args.database,
        "source_id": SOURCE_ID,
        "expected": expected,
        "actual": counts,
        "elapsed_seconds": round(time.time() - started, 2),
        "imported_at": datetime.now().isoformat(timespec="seconds"),
        "password_persisted": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="将教材知识图谱幂等导入Neo4j")
    parser.add_argument("--uri", default=os.environ.get("NEO4J_URI", "neo4j://localhost:7687"))
    parser.add_argument("--username", default=os.environ.get("NEO4J_USERNAME", "neo4j"))
    parser.add_argument("--database", default=os.environ.get("NEO4J_DATABASE", "neo4j"))
    parser.add_argument("--entities", type=Path, default=Path("data/processed/kg_entities.jsonl"))
    parser.add_argument("--relations", type=Path, default=Path("data/processed/kg_relations.jsonl"))
    parser.add_argument("--section-links", type=Path, default=Path("data/processed/kg_section_links.jsonl"))
    parser.add_argument("--chunks", type=Path, default=Path("data/processed/chunks.jsonl"))
    parser.add_argument("--ontology", type=Path, default=Path("config/kg_ontology.json"))
    parser.add_argument("--report", type=Path, default=Path("data/reports/neo4j_import_report.json"))
    parser.add_argument("--batch-size", type=int, default=200)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    data = prepare_data(args)
    expected = {
        "entities": len(data["entities"]),
        "sections": len(data["sections"]),
        "chunks": len(data["chunks"]),
        "chunk_section_links": len(data["chunks"]),
        "evidence_links": len(data["evidence_links"]),
        "mentions": len(data["mentions"]),
        "knowledge_relations": len(data["relations"]),
    }
    if args.dry_run:
        print(json.dumps({"status": "dry_run_passed", "expected": expected}, ensure_ascii=False))
        return
    report = import_graph(args, data)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
