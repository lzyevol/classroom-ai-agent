from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
from typing import Any, Iterable


CHAPTER_RE = re.compile(r"^第\s*(\d+)\s*章$")
SECTION_RE = re.compile(r"^(\d+)\.(\d+)(?:\.(\d+))?\s*(.*)$")
SUMMARY_SECTION_RE = re.compile(r"^(\d+)\.\s+(.+)$")
TITLE_LABELS = {"doc_title", "paragraph_title"}
SPECIAL_TITLES = {"小结", "思考", "参考文献", "前沿阅读"}


def plain_heading(text: str) -> str:
    return re.sub(r"^\s*#{1,6}\s*", "", text).strip()


def iter_pages(path: Path) -> Iterable[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if line.strip():
                try:
                    yield json.loads(line)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"第 {line_number} 行不是有效JSON") from exc


def new_section(
    chapter_number: int,
    chapter_title: str,
    section_number: str,
    section_title: str,
    level: int,
    content_type: str = "core",
) -> dict[str, Any]:
    return {
        "section_id": f"book_embodied_ai_intro_2024:{section_number}",
        "book": "具身智能导论",
        "chapter_number": chapter_number,
        "chapter_title": chapter_title,
        "section_number": section_number,
        "section_title": section_title,
        "level": level,
        "content_type": content_type,
        "include_in_rag": content_type not in {"reference", "exercise"},
        "source_page_indexes": [],
        "content_blocks": [],
        "image_refs": [],
        "content_raw": "",
        "content_clean": "",
    }


def finish_section(section: dict[str, Any] | None, sections: list[dict[str, Any]]) -> None:
    if section is None:
        return
    section["source_page_indexes"] = sorted(set(section["source_page_indexes"]))
    section["content_raw"] = "\n\n".join(
        block["content_raw"] for block in section["content_blocks"]
    )
    section["content_clean"] = "\n\n".join(
        block["content_clean"] for block in section["content_blocks"]
    )
    if (
        section["section_number"].endswith(".0")
        and len(section["content_blocks"]) == 1
        and len(section["content_clean"]) < 100
    ):
        # 各章开头的题记诗句不承载课程知识，保留在结构数据中但不进入问答检索。
        section["content_type"] = "epigraph"
        section["include_in_rag"] = False
    sections.append(section)


def content_type_for(title: str) -> str:
    if title == "参考文献":
        return "reference"
    if title == "思考":
        return "exercise"
    if title == "小结":
        return "summary"
    if title == "前沿阅读":
        return "further_reading"
    return "core"


def build_sections(input_path: Path, output_path: Path, report_path: Path) -> None:
    sections: list[dict[str, Any]] = []
    current_chapter: int | None = None
    chapter_title = ""
    current_section: dict[str, Any] | None = None
    pending_chapter: int | None = None
    special_counts: dict[tuple[int, str], int] = {}

    for page in iter_pages(input_path):
        if not page.get("include_in_rag"):
            continue
        page_index = int(page["source_page_index"])
        events: list[tuple[int, str, dict[str, Any]]] = []
        for block in page.get("blocks", []):
            events.append((int(block["source_list_index"]), "block", block))
        for image in page.get("image_refs", []):
            events.append((int(image["source_list_index"]), "image", image))
        events.sort(key=lambda item: item[0])

        for _, event_type, item in events:
            if event_type == "image":
                if current_section is not None:
                    image = dict(item)
                    image["source_page_index"] = page_index
                    current_section["image_refs"].append(image)
                    current_section["source_page_indexes"].append(page_index)
                continue

            clean_text = item["content_clean"]
            raw_text = item["content_raw"]
            heading = plain_heading(clean_text)
            chapter_match = CHAPTER_RE.fullmatch(heading)
            if chapter_match and item["block_label"] in TITLE_LABELS:
                finish_section(current_section, sections)
                current_section = None
                pending_chapter = int(chapter_match.group(1))
                current_chapter = pending_chapter
                chapter_title = ""
                continue

            if pending_chapter is not None:
                # OCR把第12章章名误标成普通text，因此这里允许章标记后的首个文本块作为章名。
                chapter_title = heading
                current_chapter = pending_chapter
                pending_chapter = None
                continue

            if current_chapter is None:
                continue

            section_match = SECTION_RE.fullmatch(heading)
            summary_match = (
                SUMMARY_SECTION_RE.fullmatch(heading) if current_chapter == 13 else None
            )
            is_title = item["block_label"] in TITLE_LABELS
            if is_title and section_match and int(section_match.group(1)) == current_chapter:
                finish_section(current_section, sections)
                third = section_match.group(3)
                section_number = (
                    f"{section_match.group(1)}.{section_match.group(2)}"
                    + (f".{third}" if third else "")
                )
                current_section = new_section(
                    current_chapter,
                    chapter_title,
                    section_number,
                    section_match.group(4).strip(),
                    3 if third else 2,
                )
                continue

            if is_title and summary_match:
                finish_section(current_section, sections)
                section_number = f"13.{summary_match.group(1)}"
                current_section = new_section(
                    current_chapter,
                    chapter_title,
                    section_number,
                    summary_match.group(2).strip(),
                    2,
                )
                continue

            if is_title and heading in SPECIAL_TITLES:
                finish_section(current_section, sections)
                key = (current_chapter, heading)
                special_counts[key] = special_counts.get(key, 0) + 1
                suffix = special_counts[key]
                section_number = f"{current_chapter}.{heading}.{suffix}"
                current_section = new_section(
                    current_chapter,
                    chapter_title,
                    section_number,
                    heading,
                    2,
                    content_type_for(heading),
                )
                continue

            if current_section is None:
                current_section = new_section(
                    current_chapter,
                    chapter_title,
                    f"{current_chapter}.0",
                    "引言",
                    2,
                    "introduction",
                )

            block = dict(item)
            block["source_page_index"] = page_index
            current_section["content_blocks"].append(block)
            current_section["source_page_indexes"].append(page_index)

    finish_section(current_section, sections)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(sections, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    chapters: dict[int, str] = {}
    for section in sections:
        chapters[section["chapter_number"]] = section["chapter_title"]
    report = {
        "input": str(input_path),
        "output": str(output_path),
        "chapter_count": len(chapters),
        "section_count": len(sections),
        "rag_section_count": sum(bool(x["include_in_rag"]) for x in sections),
        "excluded_reference_sections": sum(x["content_type"] == "reference" for x in sections),
        "excluded_exercise_sections": sum(x["content_type"] == "exercise" for x in sections),
        "chapters": [
            {"chapter_number": number, "chapter_title": chapters[number]}
            for number in sorted(chapters)
        ],
    }
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="从清洗页构建教材章节结构")
    parser.add_argument("--input", type=Path, default=Path("data/interim/clean_pages.jsonl"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/sections.json"))
    parser.add_argument(
        "--report", type=Path, default=Path("data/reports/section_build_report.json")
    )
    args = parser.parse_args()
    build_sections(args.input, args.output, args.report)


if __name__ == "__main__":
    main()
