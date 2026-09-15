from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
from html import unescape
import json
from pathlib import Path
import re
import time
from typing import Any, Iterable
from urllib.parse import urlparse
from urllib.request import Request, urlopen


ACTUAL_IMAGE_LABELS = {"image", "chart"}
CAPTION_LABELS = {"figure_title", "vision_footnote"}


def iter_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path} 第 {line_number} 行不是有效JSON") from exc


def html_to_text(value: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", value, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"[ \t\n]+", " ", unescape(text)).strip()


def image_key(item: dict[str, Any]) -> tuple[int, int, str]:
    return (
        int(item["source_page_index"]),
        int(item["source_list_index"]),
        str(item["block_label"]),
    )


def suffix_for(item: dict[str, Any]) -> str:
    relative = str(item.get("relative_path") or "")
    suffix = Path(urlparse(relative).path).suffix.lower()
    return suffix if suffix in {".jpg", ".jpeg", ".png", ".webp", ".gif"} else ".bin"


def collect_images(pages_path: Path, images_dir: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for page in iter_jsonl(pages_path):
        if not page.get("include_in_rag"):
            continue
        page_index = int(page["source_page_index"])
        refs = sorted(page.get("image_refs", []), key=lambda x: int(x["source_list_index"]))
        captions = [ref for ref in refs if ref["block_label"] in CAPTION_LABELS]
        used_caption_indexes: set[int] = set()
        for ref in refs:
            if ref["block_label"] not in ACTUAL_IMAGE_LABELS or not ref.get("remote_url"):
                continue
            source_index = int(ref["source_list_index"])
            caption = None
            caption_ref = None
            candidates = [
                candidate
                for candidate in captions
                if int(candidate["source_list_index"]) not in used_caption_indexes
                and 0 < int(candidate["source_list_index"]) - source_index <= 3
            ]
            if candidates:
                caption_ref = min(
                    candidates, key=lambda x: int(x["source_list_index"]) - source_index
                )
                used_caption_indexes.add(int(caption_ref["source_list_index"]))
                caption = html_to_text(str(caption_ref.get("block_content") or "")) or None

            image_id = f"book_embodied_ai_intro_2024:p{page_index:04d}:b{source_index:03d}"
            filename = f"p{page_index:04d}_b{source_index:03d}_{ref['block_label']}{suffix_for(ref)}"
            relative_local = Path("data") / "images" / f"page_{page_index:04d}" / filename
            record = {
                "image_id": image_id,
                "source_id": "book_embodied_ai_intro_2024",
                "book": "具身智能导论",
                "source_page_index_internal": page_index,
                "source_list_index": source_index,
                "block_id": ref.get("block_id"),
                "block_label": ref["block_label"],
                "block_bbox": ref.get("block_bbox"),
                "caption": caption,
                "caption_source_list_index": (
                    int(caption_ref["source_list_index"]) if caption_ref else None
                ),
                "source_relative_path": ref.get("relative_path"),
                "source_url": ref["remote_url"],
                "local_path": relative_local.as_posix(),
                "absolute_path": str((Path.cwd() / relative_local).resolve()),
                "download_status": "pending",
                "byte_size": None,
                "sha256": None,
            }
            records.append(record)
    return records


def valid_image_bytes(data: bytes) -> bool:
    return (
        data.startswith(b"\xff\xd8\xff")
        or data.startswith(b"\x89PNG\r\n\x1a\n")
        or data.startswith((b"GIF87a", b"GIF89a"))
        or (len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP")
    )


def download_one(record: dict[str, Any], repo_root: Path, timeout: int, retries: int) -> dict[str, Any]:
    output = repo_root / record["local_path"]
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        existing = output.read_bytes()
        if valid_image_bytes(existing):
            record["download_status"] = "existing"
            record["byte_size"] = len(existing)
            record["sha256"] = hashlib.sha256(existing).hexdigest()
            return record

    url = str(record["source_url"])
    if urlparse(url).scheme != "https":
        record["download_status"] = "failed"
        record["error"] = "仅允许下载HTTPS图片"
        return record

    error = ""
    for attempt in range(retries + 1):
        try:
            request = Request(url, headers={"User-Agent": "classroom-ai-agent/0.1"})
            with urlopen(request, timeout=timeout) as response:
                data = response.read()
            if not valid_image_bytes(data):
                raise ValueError("响应内容不是受支持的图片格式")
            temporary = output.with_suffix(output.suffix + ".part")
            temporary.write_bytes(data)
            temporary.replace(output)
            record["download_status"] = "downloaded"
            record["byte_size"] = len(data)
            record["sha256"] = hashlib.sha256(data).hexdigest()
            return record
        except Exception as exc:  # 单张失败不能中断整批下载，错误会进入报告。
            error = f"{type(exc).__name__}: {exc}"
            if attempt < retries:
                time.sleep(0.5 * (attempt + 1))
    record["download_status"] = "failed"
    record["error"] = error
    return record


def enrich_image_ref(ref: dict[str, Any], mapping: dict[tuple[int, int, str], dict[str, Any]]) -> dict[str, Any]:
    key = image_key(ref)
    record = mapping.get(key)
    if not record:
        return ref
    enriched = dict(ref)
    enriched.update(
        {
            "image_id": record["image_id"],
            "caption": record["caption"],
            "local_path": record["local_path"],
            "download_status": record["download_status"],
            "sha256": record["sha256"],
        }
    )
    return enriched


def backfill_outputs(
    sections_path: Path,
    chunks_path: Path,
    mapping: dict[tuple[int, int, str], dict[str, Any]],
) -> None:
    sections = json.loads(sections_path.read_text(encoding="utf-8"))
    for section in sections:
        refs = []
        for ref in section.get("image_refs", []):
            item = dict(ref)
            item["source_page_index"] = int(item["source_page_index"])
            refs.append(enrich_image_ref(item, mapping))
        section["image_refs"] = refs
    sections_path.write_text(
        json.dumps(sections, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    temporary = chunks_path.with_suffix(chunks_path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as output:
        for chunk in iter_jsonl(chunks_path):
            chunk["image_refs"] = [
                enrich_image_ref(ref, mapping) for ref in chunk.get("image_refs", [])
            ]
            output.write(json.dumps(chunk, ensure_ascii=False) + "\n")
    temporary.replace(chunks_path)


def run(args: argparse.Namespace) -> None:
    repo_root = Path.cwd().resolve()
    records = collect_images(args.pages, args.images_dir)
    if args.no_download:
        for record in records:
            record["download_status"] = "not_downloaded"
    else:
        completed: list[dict[str, Any]] = []
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = [
                executor.submit(
                    download_one, record, repo_root, args.timeout, args.retries
                )
                for record in records
            ]
            for future in as_completed(futures):
                completed.append(future.result())
        records = sorted(completed, key=lambda x: image_key({
            "source_page_index": x["source_page_index_internal"],
            "source_list_index": x["source_list_index"],
            "block_label": x["block_label"],
        }))

    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    with args.manifest.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    mapping = {
        (
            int(record["source_page_index_internal"]),
            int(record["source_list_index"]),
            str(record["block_label"]),
        ): record
        for record in records
    }
    backfill_outputs(args.sections, args.chunks, mapping)

    statuses: dict[str, int] = {}
    for record in records:
        status = record["download_status"]
        statuses[status] = statuses.get(status, 0) + 1
    report = {
        "image_count": len(records),
        "status_counts": statuses,
        "images_with_caption": sum(bool(record["caption"]) for record in records),
        "total_bytes": sum(int(record["byte_size"] or 0) for record in records),
        "manifest": str(args.manifest),
        "images_directory": str(args.images_dir),
        "sections_backfilled": str(args.sections),
        "chunks_backfilled": str(args.chunks),
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    if statuses.get("failed"):
        raise SystemExit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="下载教材图片并回填章节与RAG片段")
    parser.add_argument("--pages", type=Path, default=Path("data/interim/clean_pages.jsonl"))
    parser.add_argument("--sections", type=Path, default=Path("data/processed/sections.json"))
    parser.add_argument("--chunks", type=Path, default=Path("data/processed/chunks.jsonl"))
    parser.add_argument("--images-dir", type=Path, default=Path("data/images"))
    parser.add_argument("--manifest", type=Path, default=Path("data/processed/images.jsonl"))
    parser.add_argument("--report", type=Path, default=Path("data/reports/image_extract_report.json"))
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--no-download", action="store_true")
    args = parser.parse_args()
    if args.workers < 1 or args.workers > 32:
        parser.error("workers必须在1到32之间")
    run(args)


if __name__ == "__main__":
    main()
