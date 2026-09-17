from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Iterable


def iter_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def duplicates(values: list[str]) -> list[str]:
    return sorted({value for value in values if values.count(value) > 1})


def main() -> None:
    parser = argparse.ArgumentParser(description="校验知识图谱实体、关系、证据与章节链接")
    parser.add_argument("--entities", type=Path, default=Path("data/processed/kg_entities.jsonl"))
    parser.add_argument("--relations", type=Path, default=Path("data/processed/kg_relations.jsonl"))
    parser.add_argument("--section-links", type=Path, default=Path("data/processed/kg_section_links.jsonl"))
    parser.add_argument("--chunks", type=Path, default=Path("data/processed/chunks.jsonl"))
    parser.add_argument("--ontology", type=Path, default=Path("config/kg_ontology.json"))
    parser.add_argument("--output", type=Path, default=Path("data/reports/kg_validation_report.json"))
    args = parser.parse_args()
    entities = list(iter_jsonl(args.entities))
    relations = list(iter_jsonl(args.relations))
    links = list(iter_jsonl(args.section_links))
    chunks = {item["chunk_id"]: item for item in iter_jsonl(args.chunks)}
    ontology = json.loads(args.ontology.read_text(encoding="utf-8"))
    entity_types = set(ontology["entity_types"])
    relation_types = set(ontology["relation_types"])
    errors: list[str] = []
    warnings: list[str] = []

    entity_ids = [item["entity_id"] for item in entities]
    relation_ids = [item["relation_id"] for item in relations]
    if values := duplicates(entity_ids): errors.append(f"entity_id重复：{values[:10]}")
    if values := duplicates(relation_ids): errors.append(f"relation_id重复：{values[:10]}")
    known_entities = set(entity_ids)
    invalid_types = [item["entity_id"] for item in entities if item["type"] not in entity_types]
    if invalid_types: errors.append(f"非法实体类型：{invalid_types[:10]}")

    missing_endpoints: list[str] = []
    invalid_relation_types: list[str] = []
    missing_evidence: list[str] = []
    bad_chunk_refs: list[str] = []
    for relation in relations:
        if relation["head_entity_id"] not in known_entities or relation["tail_entity_id"] not in known_entities:
            missing_endpoints.append(relation["relation_id"])
        if relation["relation"] not in relation_types:
            invalid_relation_types.append(relation["relation_id"])
        if not relation.get("evidence") or any(not item.get("quote_original") for item in relation.get("evidence", [])):
            missing_evidence.append(relation["relation_id"])
        if any(item.get("chunk_id") not in chunks for item in relation.get("evidence", [])):
            bad_chunk_refs.append(relation["relation_id"])
        if not relation.get("head_name") or not relation.get("tail_name"):
            missing_endpoints.append(relation["relation_id"])
    if missing_endpoints: errors.append(f"关系端点缺失：{missing_endpoints[:10]}")
    if invalid_relation_types: errors.append(f"非法关系类型：{invalid_relation_types[:10]}")
    if missing_evidence: errors.append(f"关系缺少OCR原文证据：{missing_evidence[:10]}")
    if bad_chunk_refs: errors.append(f"关系引用不存在的片段：{bad_chunk_refs[:10]}")

    broken_links = [item["entity_id"] for item in links if item["entity_id"] not in known_entities]
    if broken_links: errors.append(f"章节链接实体不存在：{broken_links[:10]}")
    isolated = known_entities - {r["head_entity_id"] for r in relations} - {r["tail_entity_id"] for r in relations}
    if isolated:
        warnings.append(f"{len(isolated)} 个实体当前没有通过校验的实体间关系，但仍保留教材章节链接。")
    report = {
        "status": "passed" if not errors else "failed",
        "errors": errors,
        "warnings": warnings,
        "metrics": {
            "entity_count": len(entities),
            "relation_count": len(relations),
            "section_link_count": len(links),
            "relations_with_original_evidence": sum(
                all(item.get("quote_original") for item in relation.get("evidence", []))
                for relation in relations
            ),
            "isolated_entity_count": len(isolated),
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
