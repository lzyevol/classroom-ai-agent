from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
from typing import Any, Iterable


def iter_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path} 第 {line_number} 行不是有效JSON") from exc


def duplicates(values: list[str]) -> list[str]:
    counts = Counter(values)
    return sorted(value for value, count in counts.items() if count > 1)


def validate(
    sections_path: Path,
    chunks_path: Path,
    images_path: Path,
    output_path: Path,
) -> bool:
    sections = json.loads(sections_path.read_text(encoding="utf-8"))
    chunks = list(iter_jsonl(chunks_path))
    images = list(iter_jsonl(images_path)) if images_path.exists() else []
    errors: list[str] = []
    warnings: list[str] = []

    chapter_numbers = sorted({int(section["chapter_number"]) for section in sections})
    if chapter_numbers != list(range(1, 14)):
        errors.append(f"章号不连续：{chapter_numbers}")

    section_ids = [str(section["section_id"]) for section in sections]
    chunk_ids = [str(chunk["chunk_id"]) for chunk in chunks]
    if duplicate_section_ids := duplicates(section_ids):
        errors.append(f"section_id重复：{duplicate_section_ids[:10]}")
    if duplicate_chunk_ids := duplicates(chunk_ids):
        errors.append(f"chunk_id重复：{duplicate_chunk_ids[:10]}")
    image_ids = [str(image["image_id"]) for image in images]
    if duplicate_image_ids := duplicates(image_ids):
        errors.append(f"image_id重复：{duplicate_image_ids[:10]}")

    section_by_id = {section["section_id"]: section for section in sections}
    empty_titles = [
        section["section_id"]
        for section in sections
        if not section.get("chapter_title") or not section.get("section_title")
    ]
    if empty_titles:
        errors.append(f"存在空章节标题：{empty_titles[:10]}")

    empty_chunks = [chunk["chunk_id"] for chunk in chunks if not chunk.get("content_clean")]
    if empty_chunks:
        errors.append(f"存在空片段：{empty_chunks[:10]}")

    missing_quotes = [chunk["chunk_id"] for chunk in chunks if not chunk.get("quote_original")]
    if missing_quotes:
        errors.append(f"存在缺少原文的片段：{missing_quotes[:10]}")

    missing_locations = [
        chunk["chunk_id"]
        for chunk in chunks
        if not chunk.get("chapter_title") or not chunk.get("section_title")
    ]
    if missing_locations:
        errors.append(f"存在缺少章节定位的片段：{missing_locations[:10]}")

    invalid_chunk_sections: list[str] = []
    excluded_leaks: list[str] = []
    for chunk in chunks:
        section_id = chunk["chunk_id"].rsplit(":chunk-", 1)[0]
        section = section_by_id.get(section_id)
        if section is None:
            invalid_chunk_sections.append(chunk["chunk_id"])
        elif not section.get("include_in_rag"):
            excluded_leaks.append(chunk["chunk_id"])
    if invalid_chunk_sections:
        errors.append(f"片段找不到所属章节：{invalid_chunk_sections[:10]}")
    if excluded_leaks:
        errors.append(f"被排除章节仍进入RAG：{excluded_leaks[:10]}")

    missing_image_files: list[str] = []
    bad_image_hashes: list[str] = []
    failed_images: list[str] = []
    for image in images:
        if image.get("download_status") == "failed":
            failed_images.append(image["image_id"])
            continue
        local_path = Path(str(image["local_path"]))
        if not local_path.exists():
            missing_image_files.append(image["image_id"])
            continue
        digest = hashlib.sha256(local_path.read_bytes()).hexdigest()
        if digest != image.get("sha256"):
            bad_image_hashes.append(image["image_id"])
    if failed_images:
        errors.append(f"图片下载失败：{failed_images[:10]}")
    if missing_image_files:
        errors.append(f"本地图片缺失：{missing_image_files[:10]}")
    if bad_image_hashes:
        errors.append(f"图片哈希不一致：{bad_image_hashes[:10]}")

    known_image_ids = set(image_ids)
    broken_chunk_image_refs: list[str] = []
    localized_chunk_ref_count = 0
    for chunk in chunks:
        for ref in chunk.get("image_refs", []):
            if ref.get("block_label") not in {"image", "chart"}:
                continue
            localized_chunk_ref_count += 1
            if ref.get("image_id") not in known_image_ids or not ref.get("local_path"):
                broken_chunk_image_refs.append(chunk["chunk_id"])
    if broken_chunk_image_refs:
        errors.append(f"片段图片关联无效：{sorted(set(broken_chunk_image_refs))[:10]}")

    eligible_image_ids = {
        ref["image_id"]
        for section in sections
        if section.get("include_in_rag")
        for ref in section.get("image_refs", [])
        if ref.get("block_label") in {"image", "chart"} and ref.get("image_id")
    }
    chunk_image_ids = {
        ref["image_id"]
        for chunk in chunks
        for ref in chunk.get("image_refs", [])
        if ref.get("block_label") in {"image", "chart"} and ref.get("image_id")
    }
    if missing_chunk_images := sorted(eligible_image_ids - chunk_image_ids):
        errors.append(f"可检索章节中的图片未绑定片段：{missing_chunk_images[:10]}")

    lengths = [len(chunk["content_clean"]) for chunk in chunks]
    over_900 = sum(length > 900 for length in lengths)
    if over_900:
        warnings.append(
            f"{over_900} 个片段超过900字符，均应来自不可安全拆开的长段落、公式组或表格行。"
        )
    very_short = sum(length < 80 for length in lengths)
    if very_short:
        warnings.append(f"{very_short} 个片段少于80字符，建议在检索阶段与相邻片段合并展示。")

    image_count = sum(len(section.get("image_refs", [])) for section in sections)
    chunk_image_count = sum(len(chunk.get("image_refs", [])) for chunk in chunks)
    report = {
        "status": "passed" if not errors else "failed",
        "errors": errors,
        "warnings": warnings,
        "metrics": {
            "chapter_count": len(chapter_numbers),
            "section_count": len(sections),
            "chunk_count": len(chunks),
            "section_image_refs": image_count,
            "chunk_image_refs": chunk_image_count,
            "localized_images": len(images),
            "localized_chunk_image_refs": localized_chunk_ref_count,
            "unique_images_in_rag_sections": len(eligible_image_ids),
            "unique_images_bound_to_chunks": len(chunk_image_ids),
            "chunks_with_original_quote": sum(bool(chunk.get("quote_original")) for chunk in chunks),
            "chunks_with_chapter_location": sum(bool(chunk.get("citation_label")) for chunk in chunks),
            "min_chunk_chars": min(lengths, default=0),
            "max_chunk_chars": max(lengths, default=0),
        },
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return not errors


def main() -> None:
    parser = argparse.ArgumentParser(description="校验教材清洗与分块结果")
    parser.add_argument("--sections", type=Path, default=Path("data/processed/sections.json"))
    parser.add_argument("--chunks", type=Path, default=Path("data/processed/chunks.jsonl"))
    parser.add_argument("--images", type=Path, default=Path("data/processed/images.jsonl"))
    parser.add_argument("--output", type=Path, default=Path("data/reports/validation_report.json"))
    args = parser.parse_args()
    if not validate(args.sections, args.chunks, args.images, args.output):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
