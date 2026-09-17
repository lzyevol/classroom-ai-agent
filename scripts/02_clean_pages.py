from __future__ import annotations

import argparse
from collections import Counter
import json
from pathlib import Path
import re
import unicodedata
from typing import Any, Iterator


SOURCE_ID = "book_embodied_ai_intro_2024"
BOOK_NAME = "具身智能导论"


def iter_json_array(path: Path, chunk_size: int = 64 * 1024) -> Iterator[Any]:
    """Stream objects from a top-level JSON array without loading the whole file."""
    decoder = json.JSONDecoder()
    with path.open("r", encoding="utf-8") as handle:
        buffer = ""
        position = 0
        started = False
        eof = False

        while True:
            if position >= len(buffer) and not eof:
                buffer = handle.read(chunk_size)
                position = 0
                eof = not buffer

            while position < len(buffer) and buffer[position].isspace():
                position += 1

            if not started:
                if position >= len(buffer):
                    if eof:
                        raise ValueError("输入JSON为空")
                    continue
                if buffer[position] != "[":
                    raise ValueError("输入JSON的顶层必须是数组")
                started = True
                position += 1

            while True:
                while position < len(buffer) and (
                    buffer[position].isspace() or buffer[position] == ","
                ):
                    position += 1

                if position < len(buffer) and buffer[position] == "]":
                    return

                try:
                    item, end = decoder.raw_decode(buffer, position)
                    position = end
                    yield item
                    break
                except json.JSONDecodeError:
                    if eof:
                        raise
                    buffer = buffer[position:] + handle.read(chunk_size)
                    position = 0
                    eof = len(buffer) == 0


def normalize_text(text: str, protected: bool) -> str:
    text = unicodedata.normalize("NFC", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\u200b", "").replace("\ufeff", "")
    if not protected:
        text = text.replace("\u00a0", " ")
        text = re.sub(r"[ \t]+\n", "\n", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def apply_replacements(text: str, replacements: dict[str, str]) -> tuple[str, list[dict[str, Any]]]:
    changes: list[dict[str, Any]] = []
    cleaned = text
    for original, replacement in replacements.items():
        count = cleaned.count(original)
        if count:
            cleaned = cleaned.replace(original, replacement)
            changes.append(
                {
                    "original": original,
                    "replacement": replacement,
                    "count": count,
                    "rule": "deterministic_replacement",
                    "confidence": 1.0,
                }
            )
    return cleaned, changes


def detect_page_scope(page_index: int, text: str, current_scope: str) -> tuple[str, str]:
    compact = " ".join(text.split())
    starts_core = bool(
        re.search(r"(?m)^#\s*具身智能概述\s*$", text)
    )
    if starts_core:
        return "core_content", "core_content"

    if current_scope == "core_content" and (
        "##### 新一代人工智能系列教材" in text
        and "权威一流的编委会" in compact
    ):
        return "back_matter", "back_matter"

    if current_scope == "core_content":
        return "core_content", "core_content"
    if current_scope == "back_matter":
        return "back_matter", "back_matter"

    if "# 目录" in text or re.search(r"(^|\n)#{1,6}\s*目录\s*($|\n)", text):
        return "toc", "toc"
    if current_scope == "toc":
        return "toc", "toc"
    return "front_matter", "front_matter"


def resolve_image_url(page: dict[str, Any], block_content: str) -> tuple[str | None, str | None]:
    match = re.search(r'(?:src=["\'])([^"\']+)', block_content)
    relative_path = match.group(1) if match else None
    image_map = (page.get("markdown") or {}).get("images") or {}
    remote_url = image_map.get(relative_path) if relative_path else None
    return relative_path, remote_url


def clean_source(
    source: Path,
    config_path: Path,
    output_path: Path,
    corrections_path: Path,
    review_path: Path,
    report_path: Path,
) -> None:
    config = json.loads(config_path.read_text(encoding="utf-8"))
    keep_labels = set(config["keep_block_labels"])
    drop_labels = set(config["drop_block_labels"])
    image_labels = set(config["image_block_labels"])
    protected_labels = set(config["protected_block_labels"])
    replacements = config["deterministic_replacements"]
    manual_terms = config["manual_review_terms"]
    drop_exact_contents = set(config.get("drop_exact_block_contents", []))

    for path in (output_path, corrections_path, review_path, report_path):
        path.parent.mkdir(parents=True, exist_ok=True)

    stats = Counter()
    input_labels = Counter()
    kept_labels = Counter()
    dropped_labels = Counter()
    scopes = Counter()
    correction_terms = Counter()
    manual_terms_found = Counter()
    current_scope = "front_matter"

    with (
        output_path.open("w", encoding="utf-8", newline="\n") as output_file,
        corrections_path.open("w", encoding="utf-8", newline="\n") as corrections_file,
        review_path.open("w", encoding="utf-8", newline="\n") as review_file,
    ):
        for page_index, page in enumerate(iter_json_array(source)):
            stats["pages_total"] += 1
            markdown_text = str((page.get("markdown") or {}).get("text") or "")
            scope, current_scope = detect_page_scope(page_index, markdown_text, current_scope)
            scopes[scope] += 1

            raw_blocks = (page.get("prunedResult") or {}).get("parsing_res_list") or []
            clean_blocks: list[dict[str, Any]] = []
            image_refs: list[dict[str, Any]] = []
            page_text_parts: list[str] = []

            for source_list_index, block in enumerate(raw_blocks):
                label = str(block.get("block_label") or "unknown")
                input_labels[label] += 1
                raw_content = str(block.get("block_content") or "")

                if label in drop_labels:
                    dropped_labels[label] += 1
                    continue

                if label in image_labels:
                    relative_path, remote_url = resolve_image_url(page, raw_content)
                    image_refs.append(
                        {
                            "block_label": label,
                            "block_id": block.get("block_id"),
                            "block_order": block.get("block_order"),
                            "source_list_index": source_list_index,
                            "block_bbox": block.get("block_bbox"),
                            "block_content": raw_content.strip(),
                            "relative_path": relative_path,
                            "remote_url": remote_url,
                        }
                    )
                    kept_labels[label] += 1
                    continue

                if label not in keep_labels:
                    dropped_labels[label] += 1
                    continue

                protected = label in protected_labels
                normalized = normalize_text(raw_content, protected=protected)
                if normalized in drop_exact_contents:
                    dropped_labels[f"{label}:confirmed_ocr_false_positive"] += 1
                    correction_record = {
                        "source_id": SOURCE_ID,
                        "source_page_index": page_index,
                        "block_id": block.get("block_id"),
                        "block_label": label,
                        "original": normalized,
                        "replacement": "",
                        "count": 1,
                        "rule": "confirmed_ocr_false_positive_removal",
                        "confidence": 1.0,
                        "reviewed": True,
                    }
                    corrections_file.write(
                        json.dumps(correction_record, ensure_ascii=False) + "\n"
                    )
                    stats["correction_records"] += 1
                    stats["correction_occurrences"] += 1
                    correction_terms[normalized] += 1
                    continue
                cleaned = normalized
                changes: list[dict[str, Any]] = []
                if not protected:
                    cleaned, changes = apply_replacements(normalized, replacements)

                if not cleaned:
                    dropped_labels[f"{label}:empty"] += 1
                    continue

                clean_block = {
                    "block_label": label,
                    "block_id": block.get("block_id"),
                    "block_order": block.get("block_order"),
                    "source_list_index": source_list_index,
                    "block_bbox": block.get("block_bbox"),
                    "content_raw": normalized,
                    "content_clean": cleaned,
                }
                clean_blocks.append(clean_block)
                page_text_parts.append(cleaned)
                kept_labels[label] += 1

                for change in changes:
                    correction_terms[change["original"]] += change["count"]
                    correction_record = {
                        "source_id": SOURCE_ID,
                        "source_page_index": page_index,
                        "block_id": block.get("block_id"),
                        "block_label": label,
                        **change,
                        "reviewed": True,
                    }
                    corrections_file.write(json.dumps(correction_record, ensure_ascii=False) + "\n")
                    stats["correction_records"] += 1
                    stats["correction_occurrences"] += change["count"]

                for term in manual_terms:
                    if term in normalized:
                        count = normalized.count(term)
                        manual_terms_found[term] += count
                        review_record = {
                            "source_id": SOURCE_ID,
                            "source_page_index": page_index,
                            "block_id": block.get("block_id"),
                            "block_label": label,
                            "term": term,
                            "count": count,
                            "context": normalized[:500],
                            "status": "pending",
                            "suggested_by": None,
                        }
                        review_file.write(json.dumps(review_record, ensure_ascii=False) + "\n")
                        stats["manual_review_records"] += 1

            page_record = {
                "source_id": SOURCE_ID,
                "source_file": source.name,
                "book": BOOK_NAME,
                "source_page_index": page_index,
                "page_scope": scope,
                "include_in_rag": scope == "core_content",
                "blocks": clean_blocks,
                "image_refs": image_refs,
                "content_clean": "\n\n".join(page_text_parts),
            }
            output_file.write(json.dumps(page_record, ensure_ascii=False) + "\n")
            stats["blocks_kept"] += len(clean_blocks)
            stats["image_refs_kept"] += len(image_refs)
            if scope == "core_content":
                stats["pages_included_in_rag"] += 1

    report = {
        "source_id": SOURCE_ID,
        "source_file": str(source),
        "config_file": str(config_path),
        "output_file": str(output_path),
        "stats": dict(stats),
        "page_scopes": dict(scopes),
        "input_block_labels": dict(input_labels),
        "kept_block_labels": dict(kept_labels),
        "dropped_block_labels": dict(dropped_labels),
        "correction_terms": dict(correction_terms),
        "manual_review_terms": dict(manual_terms_found),
        "deepseek_used": False,
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="流式清洗PaddleOCR教材JSON")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--config", type=Path, default=Path("config/cleaning_rules.json"))
    parser.add_argument("--output", type=Path, default=Path("data/interim/clean_pages.jsonl"))
    parser.add_argument("--corrections", type=Path, default=Path("data/reports/correction_log.jsonl"))
    parser.add_argument("--manual-review", type=Path, default=Path("data/reports/manual_review.jsonl"))
    parser.add_argument("--report", type=Path, default=Path("data/reports/cleaning_report.json"))
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    clean_source(
        source=args.input,
        config_path=args.config,
        output_path=args.output,
        corrections_path=args.corrections,
        review_path=args.manual_review,
        report_path=args.report,
    )
