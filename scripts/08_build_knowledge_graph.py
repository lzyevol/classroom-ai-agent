from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
from typing import Any, Iterable
import unicodedata


def iter_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def compact(value: str) -> str:
    text = unicodedata.normalize("NFKC", str(value)).lower()
    text = re.sub(r"[‐‑‒–—―−－]", "-", text)
    text = text.translate(str.maketrans({"“": '"', "”": '"', "‘": "'", "’": "'"}))
    return re.sub(r"\s+", "", text)


def stable_id(prefix: str, *parts: str) -> str:
    digest = hashlib.sha1("\x1f".join(parts).encode("utf-8")).hexdigest()[:16]
    return f"{prefix}_{digest}"


def find_original_quote(
    evidence: str, original_text: str, replacements: dict[str, str]
) -> str | None:
    if evidence in original_text:
        return evidence
    candidates = [evidence]
    for original, cleaned in replacements.items():
        candidates.extend(candidate.replace(cleaned, original) for candidate in list(candidates))
    for candidate in candidates:
        if candidate in original_text:
            return candidate
    sentences = re.findall(r"[^。！？；\n]+[。！？；]?", original_text)
    for sentence in sentences:
        if any(compact(candidate) in compact(sentence) for candidate in candidates):
            return sentence.strip()
    return None


def canonicalize(
    entities: dict[tuple[str, str], dict[str, Any]],
    relations: dict[tuple[str, str, str], dict[str, Any]],
    section_links: dict[tuple[str, str], dict[str, Any]],
    review: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], int]:
    priority = {
        name: index
        for index, name in enumerate(
            [
                "Platform", "Dataset", "ModelAlgorithm", "Method", "Metric",
                "Task", "Agent", "Environment", "Experiment", "Component",
                "Capability", "Concept",
            ]
        )
    }
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for entity in entities.values():
        groups[compact(entity["name"])].append(entity)

    old_to_new: dict[str, str] = {}
    canonical_entities: list[dict[str, Any]] = []
    conflict_count = 0
    for normalized_name, group in groups.items():
        type_counts = {
            item["type"]: len(set(item["source_chunk_ids"])) for item in group
        }
        winner = sorted(
            group,
            key=lambda item: (
                -type_counts[item["type"]], priority.get(item["type"], 999), item["name"]
            ),
        )[0]
        entity_id = stable_id("ent", normalized_name)
        for item in group:
            old_to_new[item["entity_id"]] = entity_id
        merged = dict(winner)
        merged["entity_id"] = entity_id
        merged["aliases"] = sorted(
            {
                alias
                for item in group
                for alias in item["aliases"] + ([item["name"]] if item["name"] != winner["name"] else [])
            }
        )
        merged["source_chunk_ids"] = sorted(
            {chunk_id for item in group for chunk_id in item["source_chunk_ids"]}
        )
        definitions = {
            (definition["text"], definition["chunk_id"]): definition
            for item in group
            for definition in item["definitions"]
        }
        merged["definitions"] = list(definitions.values())
        merged["type_candidates"] = [
            {"type": entity_type, "mention_count": count}
            for entity_type, count in sorted(
                type_counts.items(), key=lambda pair: (-pair[1], priority.get(pair[0], 999))
            )
        ]
        if len(type_counts) > 1:
            conflict_count += 1
            review.append(
                {
                    "kind": "entity_type_conflict",
                    "reason": "merged_by_mention_count",
                    "entity_id": entity_id,
                    "name": winner["name"],
                    "selected_type": winner["type"],
                    "type_candidates": merged["type_candidates"],
                }
            )
        canonical_entities.append(merged)

    canonical_relations: dict[tuple[str, str, str], dict[str, Any]] = {}
    for relation in relations.values():
        head_id = old_to_new[relation["head_entity_id"]]
        tail_id = old_to_new[relation["tail_entity_id"]]
        if head_id == tail_id:
            review.append({"kind": "relation", "reason": "self_relation_after_merge", "candidate": relation})
            continue
        key = (head_id, relation["relation"], tail_id)
        if key not in canonical_relations:
            canonical_relations[key] = {
                "relation_id": stable_id("rel", *key),
                "head_entity_id": head_id,
                "relation": relation["relation"],
                "tail_entity_id": tail_id,
                "evidence": [],
                "max_confidence": relation["max_confidence"],
            }
        target = canonical_relations[key]
        target["max_confidence"] = max(target["max_confidence"], relation["max_confidence"])
        target["evidence"].extend(relation["evidence"])
    for relation in canonical_relations.values():
        unique = {(item["chunk_id"], item["quote"]): item for item in relation["evidence"]}
        relation["evidence"] = list(unique.values())

    canonical_links: dict[tuple[str, str], dict[str, Any]] = {}
    for link in section_links.values():
        link = dict(link)
        link["entity_id"] = old_to_new[link["entity_id"]]
        canonical_links[(link["entity_id"], link["section_number"])] = link
    return (
        sorted(canonical_entities, key=lambda x: (x["type"], x["name"])),
        sorted(canonical_relations.values(), key=lambda x: x["relation_id"]),
        sorted(canonical_links.values(), key=lambda x: (x["chapter_number"], x["section_number"], x["entity_id"])),
        conflict_count,
    )


def write_jsonl(path: Path, records: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def build(args: argparse.Namespace) -> None:
    ontology = json.loads(args.ontology.read_text(encoding="utf-8"))
    entity_types = set(ontology["entity_types"])
    relation_types = set(ontology["relation_types"])
    threshold = float(ontology["minimum_confidence"])
    cleaning_rules = json.loads(args.cleaning_rules.read_text(encoding="utf-8"))
    replacements = cleaning_rules.get("deterministic_replacements", {})
    chunks = {chunk["chunk_id"]: chunk for chunk in iter_jsonl(args.chunks)}
    candidates = list(iter_jsonl(args.extractions))

    entities: dict[tuple[str, str], dict[str, Any]] = {}
    relations: dict[tuple[str, str, str], dict[str, Any]] = {}
    section_links: dict[tuple[str, str], dict[str, Any]] = {}
    review: list[dict[str, Any]] = []
    rejected = Counter()

    for record in candidates:
        chunk_id = str(record.get("chunk_id"))
        chunk = chunks.get(chunk_id)
        extraction = record.get("extraction") or {}
        if chunk is None:
            rejected["unknown_chunk"] += 1
            continue
        text_compact = compact(chunk["content_clean"])
        local_entities: dict[str, tuple[str, str]] = {}
        for entity in extraction.get("entities", []):
            name = str(entity.get("name") or "").strip()
            entity_type = str(entity.get("type") or "")
            aliases = sorted({str(x).strip() for x in entity.get("aliases", []) if str(x).strip()})
            mentioned = compact(name) in text_compact or any(compact(alias) in text_compact for alias in aliases)
            if not name or entity_type not in entity_types or not mentioned:
                rejected["invalid_entity"] += 1
                review.append({"chunk_id": chunk_id, "kind": "entity", "reason": "invalid_type_or_not_mentioned", "candidate": entity})
                continue
            if re.search(r"\bet\s+al\.?,?\s*\d{4}\b", name, flags=re.IGNORECASE):
                rejected["citation_as_entity"] += 1
                review.append({"chunk_id": chunk_id, "kind": "entity", "reason": "citation_as_entity", "candidate": entity})
                continue
            key = (compact(name), entity_type)
            entity_id = stable_id("ent", key[0], entity_type)
            if key not in entities:
                entities[key] = {
                    "entity_id": entity_id,
                    "name": name,
                    "type": entity_type,
                    "aliases": aliases,
                    "definitions": [],
                    "source_chunk_ids": [],
                }
            stored = entities[key]
            stored["aliases"] = sorted(set(stored["aliases"]) | set(aliases))
            stored["source_chunk_ids"].append(chunk_id)
            definition = entity.get("definition")
            if definition and compact(str(definition)) in text_compact:
                stored["definitions"].append(
                    {"text": str(definition), "chunk_id": chunk_id, "citation_label": chunk["citation_label"]}
                )
            local_entities[compact(name)] = key
            section_key = (entity_id, chunk["section_number"])
            section_links[section_key] = {
                "entity_id": entity_id,
                "relation": "MENTIONED_IN",
                "book": chunk["book"],
                "chapter_number": chunk["chapter_number"],
                "chapter_title": chunk["chapter_title"],
                "section_number": chunk["section_number"],
                "section_title": chunk["section_title"],
                "citation_label": chunk["citation_label"],
            }

        for relation in extraction.get("relations", []):
            head = str(relation.get("head") or "").strip()
            tail = str(relation.get("tail") or "").strip()
            relation_type = str(relation.get("relation") or "")
            evidence = str(relation.get("evidence") or "").strip()
            try:
                confidence = float(relation.get("confidence"))
            except (TypeError, ValueError):
                confidence = -1
            reason = None
            if relation_type not in relation_types:
                reason = "invalid_relation_type"
            elif compact(head) not in local_entities or compact(tail) not in local_entities:
                reason = "missing_endpoint_entity"
            elif not evidence or compact(evidence) not in text_compact or len(evidence) > 220:
                reason = "evidence_not_verbatim"
            elif not 0 <= confidence <= 1:
                reason = "invalid_confidence"
            elif confidence < threshold:
                reason = "low_confidence"
            if reason:
                rejected[reason] += 1
                review.append({"chunk_id": chunk_id, "kind": "relation", "reason": reason, "candidate": relation})
                continue

            head_entity = entities[local_entities[compact(head)]]
            tail_entity = entities[local_entities[compact(tail)]]
            original_quote = find_original_quote(evidence, chunk["quote_original"], replacements)
            if original_quote is None:
                rejected["missing_original_evidence"] += 1
                review.append({"chunk_id": chunk_id, "kind": "relation", "reason": "missing_original_evidence", "candidate": relation})
                continue
            key = (head_entity["entity_id"], relation_type, tail_entity["entity_id"])
            if key not in relations:
                relations[key] = {
                    "relation_id": stable_id("rel", *key),
                    "head_entity_id": key[0],
                    "relation": relation_type,
                    "tail_entity_id": key[2],
                    "evidence": [],
                    "max_confidence": confidence,
                }
            stored_relation = relations[key]
            stored_relation["max_confidence"] = max(stored_relation["max_confidence"], confidence)
            stored_relation["evidence"].append(
                {
                    "chunk_id": chunk_id,
                    "quote": evidence,
                    "quote_original": original_quote,
                    "citation_label": chunk["citation_label"],
                    "confidence": confidence,
                }
            )

    for entity in entities.values():
        entity["source_chunk_ids"] = sorted(set(entity["source_chunk_ids"]))
        unique_defs = {(item["text"], item["chunk_id"]): item for item in entity["definitions"]}
        entity["definitions"] = list(unique_defs.values())
    for relation in relations.values():
        unique_evidence = {(item["chunk_id"], item["quote"]): item for item in relation["evidence"]}
        relation["evidence"] = list(unique_evidence.values())

    entity_rows, relation_rows, link_rows, type_conflicts = canonicalize(
        entities, relations, section_links, review
    )
    entity_by_id = {entity["entity_id"]: entity for entity in entity_rows}
    for relation in relation_rows:
        head = entity_by_id[relation["head_entity_id"]]
        tail = entity_by_id[relation["tail_entity_id"]]
        relation["head_name"] = head["name"]
        relation["head_type"] = head["type"]
        relation["tail_name"] = tail["name"]
        relation["tail_type"] = tail["type"]
    write_jsonl(args.entities, entity_rows)
    write_jsonl(args.relations, relation_rows)
    write_jsonl(args.section_links, link_rows)
    write_jsonl(args.review, review)
    graph = {
        "schema_version": "0.1.0",
        "book": "具身智能导论",
        "nodes": entity_rows,
        "edges": relation_rows,
        "section_links": link_rows,
    }
    args.graph.parent.mkdir(parents=True, exist_ok=True)
    args.graph.write_text(
        json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    report = {
        "extraction_record_count": len(candidates),
        "entity_count": len(entity_rows),
        "relation_count": len(relation_rows),
        "section_link_count": len(link_rows),
        "review_count": len(review),
        "merged_entity_type_conflicts": type_conflicts,
        "rejected_by_reason": dict(sorted(rejected.items())),
        "minimum_confidence": threshold,
        "model_outputs_are_candidates_only": True,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="校验DeepSeek候选并构建知识图谱文件")
    parser.add_argument("--chunks", type=Path, default=Path("data/processed/chunks.jsonl"))
    parser.add_argument("--ontology", type=Path, default=Path("config/kg_ontology.json"))
    parser.add_argument("--cleaning-rules", type=Path, default=Path("config/cleaning_rules.json"))
    parser.add_argument("--extractions", type=Path, default=Path("data/interim/kg_extractions.jsonl"))
    parser.add_argument("--entities", type=Path, default=Path("data/processed/kg_entities.jsonl"))
    parser.add_argument("--relations", type=Path, default=Path("data/processed/kg_relations.jsonl"))
    parser.add_argument("--section-links", type=Path, default=Path("data/processed/kg_section_links.jsonl"))
    parser.add_argument("--graph", type=Path, default=Path("data/processed/knowledge_graph.json"))
    parser.add_argument("--review", type=Path, default=Path("data/reports/kg_manual_review.jsonl"))
    parser.add_argument("--report", type=Path, default=Path("data/reports/kg_build_report.json"))
    build(parser.parse_args())


if __name__ == "__main__":
    main()
