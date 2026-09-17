from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
from typing import Any


def block_size(block: dict[str, Any]) -> int:
    return len(block["content_clean"])


def split_large_table(block: dict[str, Any], max_chars: int) -> list[dict[str, Any]]:
    """按HTML表格行拆分超长表格，同时保留原始行文本和来源定位。"""
    clean = block["content_clean"]
    if block["block_label"] != "table" or len(clean) <= max_chars:
        return [block]
    clean_rows = re.findall(r"<tr\b.*?</tr>", clean, flags=re.DOTALL | re.IGNORECASE)
    raw_rows = re.findall(
        r"<tr\b.*?</tr>", block["content_raw"], flags=re.DOTALL | re.IGNORECASE
    )
    if not clean_rows or len(clean_rows) != len(raw_rows):
        return [block]
    prefix_match = re.match(r"(.*?<table\b[^>]*>)", clean, flags=re.DOTALL | re.IGNORECASE)
    clean_prefix = prefix_match.group(1) if prefix_match else "<table>"
    raw_prefix_match = re.match(
        r"(.*?<table\b[^>]*>)", block["content_raw"], flags=re.DOTALL | re.IGNORECASE
    )
    raw_prefix = raw_prefix_match.group(1) if raw_prefix_match else "<table>"
    suffix = "</table>"
    groups: list[tuple[list[str], list[str]]] = []
    clean_group: list[str] = []
    raw_group: list[str] = []
    size = len(clean_prefix) + len(suffix)
    for clean_row, raw_row in zip(clean_rows, raw_rows):
        if clean_group and size + len(clean_row) > max_chars:
            groups.append((clean_group, raw_group))
            clean_group, raw_group = [], []
            size = len(clean_prefix) + len(suffix)
        clean_group.append(clean_row)
        raw_group.append(raw_row)
        size += len(clean_row)
    if clean_group:
        groups.append((clean_group, raw_group))

    fragments: list[dict[str, Any]] = []
    for index, (clean_part, raw_part) in enumerate(groups, 1):
        fragment = dict(block)
        fragment["content_clean"] = clean_prefix + "".join(clean_part) + suffix
        fragment["content_raw"] = raw_prefix + "".join(raw_part) + suffix
        fragment["fragment_index"] = index
        fragment["fragment_count"] = len(groups)
        fragments.append(fragment)
    return fragments


def make_chunk(
    section: dict[str, Any], blocks: list[dict[str, Any]], chunk_index: int
) -> dict[str, Any]:
    source_indexes = [int(block["source_list_index"]) for block in blocks]
    page_indexes = sorted({int(block["source_page_index"]) for block in blocks})
    low, high = min(source_indexes), max(source_indexes)
    images = [
        image
        for image in section.get("image_refs", [])
        if int(image["source_page_index"]) in page_indexes
        and low - 2 <= int(image["source_list_index"]) <= high + 2
    ]
    return {
        "chunk_id": f"{section['section_id']}:chunk-{chunk_index:03d}",
        "source_id": "book_embodied_ai_intro_2024",
        "book": section["book"],
        "chapter_number": section["chapter_number"],
        "chapter_title": section["chapter_title"],
        "section_number": section["section_number"],
        "section_title": section["section_title"],
        "content_type": section["content_type"],
        "citation_label": (
            f"《{section['book']}》第{section['chapter_number']}章"
            f"“{section['chapter_title']}”，{section['section_number']} “{section['section_title']}”"
        ),
        "source_page_indexes_internal": page_indexes,
        "source_blocks": [
            {
                "source_page_index": block["source_page_index"],
                "block_id": block["block_id"],
                "block_label": block["block_label"],
                "block_bbox": block["block_bbox"],
                "source_list_index": block["source_list_index"],
                **(
                    {
                        "fragment_index": block["fragment_index"],
                        "fragment_count": block["fragment_count"],
                    }
                    if "fragment_index" in block
                    else {}
                ),
            }
            for block in blocks
        ],
        "image_refs": images,
        "content_clean": "\n\n".join(block["content_clean"] for block in blocks),
        "quote_original": "\n\n".join(block["content_raw"] for block in blocks),
    }


def chunk_section(section: dict[str, Any], target_chars: int, max_chars: int) -> list[dict[str, Any]]:
    blocks = [
        fragment
        for block in section.get("content_blocks", [])
        for fragment in split_large_table(block, max_chars)
    ]
    chunks: list[dict[str, Any]] = []
    current: list[dict[str, Any]] = []
    current_size = 0

    for block in blocks:
        size = block_size(block)
        if current and current_size + size > max_chars:
            chunks.append(make_chunk(section, current, len(chunks) + 1))
            # 以最后一个完整块作为语义重叠；公式、表格和算法不重复。
            last = current[-1]
            if last["block_label"] not in {"display_formula", "table", "algorithm"} and block_size(last) <= 180:
                current = [last]
                current_size = block_size(last)
            else:
                current = []
                current_size = 0
        current.append(block)
        current_size += size
        if current_size >= target_chars and block["block_label"] in {"text", "footnote"}:
            chunks.append(make_chunk(section, current, len(chunks) + 1))
            current = []
            current_size = 0

    if current:
        chunks.append(make_chunk(section, current, len(chunks) + 1))

    # 每张实际图片只绑定到本节距离最近的一个片段，确保不会遗漏或重复展示。
    for chunk in chunks:
        chunk["image_refs"] = [
            ref
            for ref in chunk["image_refs"]
            if ref.get("block_label") not in {"image", "chart"}
        ]
    for image in section.get("image_refs", []):
        if image.get("block_label") not in {"image", "chart"} or not chunks:
            continue
        image_page = int(image["source_page_index"])
        image_index = int(image["source_list_index"])

        def distance(chunk: dict[str, Any]) -> int:
            return min(
                abs(int(block["source_page_index"]) - image_page) * 10_000
                + abs(int(block["source_list_index"]) - image_index)
                for block in chunk["source_blocks"]
            )

        nearest = min(chunks, key=distance)
        nearest["image_refs"].append(image)
    return chunks


def build_chunks(input_path: Path, output_path: Path, report_path: Path, target: int, maximum: int) -> None:
    sections = json.loads(input_path.read_text(encoding="utf-8"))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    chunk_count = 0
    lengths: list[int] = []
    with output_path.open("w", encoding="utf-8", newline="\n") as handle:
        for section in sections:
            if not section.get("include_in_rag") or not section.get("content_blocks"):
                continue
            for chunk in chunk_section(section, target, maximum):
                handle.write(json.dumps(chunk, ensure_ascii=False) + "\n")
                chunk_count += 1
                lengths.append(len(chunk["content_clean"]))
    report = {
        "input": str(input_path),
        "output": str(output_path),
        "target_chars": target,
        "max_chars_soft_limit": maximum,
        "chunk_count": chunk_count,
        "min_chars": min(lengths, default=0),
        "max_chars": max(lengths, default=0),
        "average_chars": round(sum(lengths) / len(lengths), 2) if lengths else 0,
        "chunks_over_soft_limit": sum(length > maximum for length in lengths),
        "note": "软上限仅可能被不可拆分的OCR版面块（如公式、表格或长段落）突破。",
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="将教材章节构建为RAG引用片段")
    parser.add_argument("--input", type=Path, default=Path("data/processed/sections.json"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/chunks.jsonl"))
    parser.add_argument("--report", type=Path, default=Path("data/reports/chunk_build_report.json"))
    parser.add_argument("--target-chars", type=int, default=650)
    parser.add_argument("--max-chars", type=int, default=900)
    args = parser.parse_args()
    if args.target_chars <= 0 or args.max_chars < args.target_chars:
        parser.error("字符阈值必须为正，且max-chars不能小于target-chars")
    build_chunks(args.input, args.output, args.report, args.target_chars, args.max_chars)


if __name__ == "__main__":
    main()
