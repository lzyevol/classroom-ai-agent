from __future__ import annotations

import asyncio
import json
import re
from html import unescape
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from app.config import settings
from app.db.neo4j import get_driver
from app.db.sqlite import get_db
from app.clients.deepseek import DeepSeekClient

PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "lesson_generate.txt"
_prompt_template: str | None = None
_HTML_TAG_RE = re.compile(r"<[^>]+>")

QUERY_SECTION_CHUNKS = """
MATCH (c:Chunk)-[:BELONGS_TO]->(s:Section {section_key: $key})
OPTIONAL MATCH (e:KnowledgeEntity)-[:EVIDENCED_BY]->(c)
RETURN c.chunk_id AS chunk_id, c.content_clean AS content_clean,
       c.quote_original AS quote_original, c.content_type AS content_type,
       c.image_paths AS image_paths, c.citation_label AS citation_label,
       s.chapter_number AS chapter_number, s.chapter_title AS chapter_title,
       s.section_number AS section_number, s.section_title AS section_title,
       collect(DISTINCT {id: e.entity_id, name: e.name, type: e.entity_type}) AS entities
ORDER BY c.chunk_id
"""


def _load_prompt() -> str:
    global _prompt_template
    if _prompt_template is None:
        _prompt_template = PROMPT_PATH.read_text(encoding="utf-8")
    return _prompt_template


def _image_path_to_url(path: str) -> str:
    return f"/static/images/{path.replace('data/images/', '')}"


def _new_slide_id(order: int) -> str:
    return f"slide-{order:03d}-{datetime.now(timezone.utc).strftime('%H%M%S')}"


def _plain_text(value: Any) -> str:
    """Keep narration safe for captions and TTS even if the model emits HTML."""
    if not isinstance(value, str):
        return ""
    return unescape(_HTML_TAG_RE.sub("", value)).strip()


def _normalize_compare(value: Any) -> list[dict[str, str]] | None:
    """Accept both list form and legacy {left, right} object form."""
    if value is None:
        return None
    if isinstance(value, list):
        items: list[dict[str, str]] = []
        for entry in value:
            if not isinstance(entry, dict):
                continue
            name = entry.get("name") or entry.get("title") or ""
            desc = entry.get("desc") or entry.get("text") or entry.get("content") or ""
            items.append({"name": str(name), "desc": str(desc)})
        return items or None
    if isinstance(value, dict):
        left = value.get("left")
        right = value.get("right")
        if left is None and right is None:
            return None
        return [
            {"name": "左", "desc": str(left) if left is not None else ""},
            {"name": "右", "desc": str(right) if right is not None else ""},
        ]
    return None


def _normalize_image(value: Any) -> dict[str, str] | None:
    """Accept one image even if the model accidentally returns an image list."""
    candidates = value if isinstance(value, list) else [value]
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        src = candidate.get("src")
        if not isinstance(src, str) or not src.strip():
            continue
        caption = candidate.get("caption", "")
        return {
            "src": src.strip(),
            "caption": caption if isinstance(caption, str) else str(caption),
        }
    return None


def get_cached_lesson(section_key: str) -> dict[str, Any] | None:
    db = get_db()
    row = db.execute(
        "SELECT * FROM lessons WHERE section_key = ?", (section_key,)
    ).fetchone()
    if row is None:
        return None
    slides = json.loads(row["slides_json"])
    for slide in slides:
        if isinstance(slide, dict):
            slide["narration"] = _plain_text(slide.get("narration", ""))
            slide["image"] = _normalize_image(slide.get("image"))
            slide["compare"] = _normalize_compare(slide.get("compare"))
    return {
        "section_key": row["section_key"],
        "chapter_title": row["chapter_title"] or "",
        "section_title": row["section_title"] or "",
        "slides": slides,
        "generated_at": row["generated_at"],
        "cached": True,
        "status": row["status"],
    }


def list_lessons() -> list[dict[str, Any]]:
    db = get_db()
    rows = db.execute(
        "SELECT section_key, section_title, chapter_title, slides_json, generated_at, status FROM lessons ORDER BY section_key"
    ).fetchall()
    results = []
    for row in rows:
        slides = json.loads(row["slides_json"])
        results.append({
            "section_key": row["section_key"],
            "section_title": row["section_title"] or "",
            "chapter_title": row["chapter_title"] or "",
            "slide_count": len(slides),
            "generated_at": row["generated_at"],
            "status": row["status"],
        })
    return results


def update_slide(section_key: str, slide_id: str, slide_data: dict) -> dict[str, Any] | None:
    db = get_db()
    row = db.execute(
        "SELECT slides_json FROM lessons WHERE section_key = ?", (section_key,)
    ).fetchone()
    if row is None:
        return None
    slides = json.loads(row["slides_json"])
    found = False
    for i, s in enumerate(slides):
        if s.get("slide_id") == slide_id:
            slide_data["slide_id"] = slide_id
            slide_data["order"] = s.get("order", i + 1)
            slides[i] = slide_data
            found = True
            break
    if not found:
        return None
    now = datetime.now(timezone.utc).isoformat()
    db.execute(
        "UPDATE lessons SET slides_json = ?, edited_at = ?, status = 'edited' WHERE section_key = ?",
        (json.dumps(slides, ensure_ascii=False), now, section_key),
    )
    db.commit()
    return slide_data


def _fetch_section_material(section_key: str) -> dict[str, Any] | None:
    """Collect the teaching material a section needs for prompt assembly."""
    driver = get_driver()
    with driver.session(database=settings.neo4j_database) as session:
        records = session.run(QUERY_SECTION_CHUNKS, key=section_key).data()

    if not records:
        return None

    context_parts: list[str] = []
    all_entities: dict[str, str] = {}
    all_images: list[dict[str, str]] = []

    for r in records:
        text = r.get("content_clean") or r.get("quote_original") or ""
        if text:
            context_parts.append(text)
        for e in (r.get("entities") or []):
            if e.get("id") and e.get("name"):
                all_entities[e["name"]] = e.get("type", "")
        for p in (r.get("image_paths") or []):
            all_images.append({"src": _image_path_to_url(p), "path": p})

    context = "\n\n".join(context_parts)
    if len(context) > 4000:
        context = context[:4000]

    return {
        "chapter_title": records[0].get("chapter_title") or "",
        "section_title": records[0].get("section_title") or "",
        "chapter_number": records[0].get("chapter_number") or "",
        "section_number": records[0].get("section_number") or "",
        "context": context,
        "entities_str": ", ".join(
            f"{name}({typ})" for name, typ in list(all_entities.items())[:30]
        ),
        "images_str": "\n".join(f"- {img['src']}" for img in all_images[:8]) or "无",
    }


def _render_lesson_prompt(material: dict[str, Any]) -> str:
    prompt = _load_prompt()
    prompt = prompt.replace("{entities}", material["entities_str"])
    prompt = prompt.replace("{images}", material["images_str"])
    prompt = prompt.replace("{context}", material["context"])
    prompt = prompt.replace("{chapter_number}", str(material["chapter_number"]))
    prompt = prompt.replace("{chapter_title}", material["chapter_title"])
    prompt = prompt.replace("{section_number}", str(material["section_number"]))
    prompt = prompt.replace("{section_title}", material["section_title"])
    return prompt


async def _request_lesson_json(system_prompt: str, user_prompt: str) -> dict[str, Any]:
    """Call DeepSeek for slide JSON, retrying once on timeout."""
    client = DeepSeekClient(
        settings.deepseek_api_key,
        settings.deepseek_base_url,
        settings.deepseek_model,
    )
    try:
        payload = {
            "model": client.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.5,
        }
        lesson_timeout = httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=10.0)
        for attempt in range(2):
            try:
                resp = await client.client.post(
                    "/chat/completions",
                    json=payload,
                    timeout=lesson_timeout,
                )
                resp.raise_for_status()
                break
            except httpx.TimeoutException:
                if attempt == 1:
                    raise
                await asyncio.sleep(2)
        data = resp.json()
        return json.loads(data["choices"][0]["message"]["content"])
    finally:
        await client.close()


def _build_slide(
    raw: dict[str, Any],
    *,
    slide_id: str,
    order: int,
    section_number: Any,
    section_title: str,
    chapter_number: Any,
) -> dict[str, Any]:
    """Normalize one raw LLM slide into the stored shape."""
    return {
        "slide_id": slide_id,
        "order": order,
        "title": raw.get("title", ""),
        "subtitle": raw.get("subtitle", f"CHAPTER {section_number} · {section_title}"),
        "bullets": raw.get("bullets", []),
        "narration": _plain_text(raw.get("narration", "")),
        "cite": raw.get(
            "cite", f"第{chapter_number}章 · {section_number} {section_title}"
        ),
        "image": _normalize_image(raw.get("image")),
        "quote": raw.get("quote"),
        "layout": raw.get("layout"),
        "compare": _normalize_compare(raw.get("compare")),
        "quiz": raw.get("quiz"),
    }


async def generate_lesson(section_key: str, force: bool = False) -> dict[str, Any]:
    if not force:
        cached = get_cached_lesson(section_key)
        if cached:
            return cached

    material = _fetch_section_material(section_key)
    if material is None:
        return {
            "section_key": section_key,
            "chapter_title": "",
            "section_title": "",
            "slides": [],
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "cached": False,
            "status": "empty",
        }

    chapter_title = material["chapter_title"]
    section_title = material["section_title"]
    chapter_number = material["chapter_number"]
    section_number = material["section_number"]

    result = await _request_lesson_json(
        _render_lesson_prompt(material),
        f"请为 {section_number} {section_title} 生成教学幻灯片。",
    )

    raw_slides = result.get("slides", result if isinstance(result, list) else [])

    slides: list[dict[str, Any]] = [
        _build_slide(
            s,
            slide_id=_new_slide_id(i + 1),
            order=i + 1,
            section_number=section_number,
            section_title=section_title,
            chapter_number=chapter_number,
        )
        for i, s in enumerate(raw_slides)
    ]

    now = datetime.now(timezone.utc).isoformat()
    db = get_db()
    db.execute(
        """INSERT OR REPLACE INTO lessons (section_key, section_title, chapter_title, slides_json, generated_at, status)
           VALUES (?, ?, ?, ?, ?, 'generated')""",
        (section_key, section_title, chapter_title, json.dumps(slides, ensure_ascii=False), now),
    )
    db.commit()

    return {
        "section_key": section_key,
        "chapter_title": chapter_title,
        "section_title": section_title,
        "slides": slides,
        "generated_at": now,
        "cached": False,
        "status": "generated",
    }


SLIDE_REGENERATE_INSTRUCTION = (
    "现在只需要重新生成第 {order} 张幻灯片，不要生成其他幻灯片。\n\n"
    "这张幻灯片当前的内容是：\n{current}\n\n"
    "本节其他幻灯片的标题依次是：\n{siblings}\n\n"
    "请给出一张全新的、与上述其他幻灯片内容不重复的幻灯片，"
    "讲解角度或表述方式要与当前版本明显不同。\n"
    '输出格式为 {{"slides": [一张幻灯片对象]}}。'
)


def _slide_summary_for_prompt(slide: dict[str, Any]) -> str:
    bullets = slide.get("bullets") or []
    lines = [f"标题：{slide.get('title', '')}"]
    if bullets:
        lines.append("要点：" + "；".join(_plain_text(b) for b in bullets))
    narration = _plain_text(slide.get("narration", ""))
    if narration:
        lines.append(f"讲稿：{narration}")
    return "\n".join(lines)


async def regenerate_slide(section_key: str, slide_id: str) -> dict[str, Any] | None:
    """Regenerate a single slide in place, leaving its siblings untouched.

    Returns the new slide, None when the section or slide is unknown.
    """
    db = get_db()
    row = db.execute(
        "SELECT slides_json FROM lessons WHERE section_key = ?", (section_key,)
    ).fetchone()
    if row is None:
        return None

    slides = json.loads(row["slides_json"])
    index = next(
        (i for i, s in enumerate(slides) if s.get("slide_id") == slide_id), None
    )
    if index is None:
        return None

    material = _fetch_section_material(section_key)
    if material is None:
        raise RuntimeError("该章节缺少教材内容，无法重新生成")

    current = slides[index]
    order = current.get("order", index + 1)
    siblings = "\n".join(
        f"- 第{s.get('order', i + 1)}张：{s.get('title', '')}"
        for i, s in enumerate(slides)
        if i != index
    ) or "无"

    result = await _request_lesson_json(
        _render_lesson_prompt(material),
        SLIDE_REGENERATE_INSTRUCTION.format(
            order=order,
            current=_slide_summary_for_prompt(current),
            siblings=siblings,
        ),
    )

    raw_slides = result.get("slides", result if isinstance(result, list) else [])
    raw = next((s for s in raw_slides if isinstance(s, dict)), None)
    if raw is None:
        raise RuntimeError("AI 未返回有效的幻灯片内容")

    # Keep the original slide_id and order so the caller's slide list stays stable.
    slides[index] = _build_slide(
        raw,
        slide_id=slide_id,
        order=order,
        section_number=material["section_number"],
        section_title=material["section_title"],
        chapter_number=material["chapter_number"],
    )

    db.execute(
        "UPDATE lessons SET slides_json = ?, edited_at = ?, status = 'edited' WHERE section_key = ?",
        (
            json.dumps(slides, ensure_ascii=False),
            datetime.now(timezone.utc).isoformat(),
            section_key,
        ),
    )
    db.commit()
    return slides[index]
