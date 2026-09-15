from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from app.config import settings
from app.db.neo4j import get_driver
from app.clients.deepseek import DeepSeekClient
from app.retrieval.knowledge_retriever import KnowledgeRetriever
from app.schemas.qa import (
    QARequest, QAResponse, MatchedEntity, Citation, RelatedKnowledge,
)

PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "qa_system.txt"
_system_prompt: str | None = None

_FOLLOW_UP_CUES = (
    "详细介绍",
    "详细说",
    "展开说",
    "展开讲",
    "继续",
    "再说说",
    "再讲讲",
    "具体一点",
    "它",
    "这个",
    "该概念",
)
_GENERIC_TOPICS = {"它", "这个", "这个概念", "该概念", "这方面", "上述内容"}


def _load_prompt() -> str:
    global _system_prompt
    if _system_prompt is None:
        _system_prompt = PROMPT_PATH.read_text(encoding="utf-8")
    return _system_prompt


def _build_context(
    chunks: list[dict[str, Any]],
    max_chars: int = 3000,
) -> tuple[str, list[dict[str, Any]]]:
    parts: list[str] = []
    used_chunks: list[dict[str, Any]] = []
    total = 0
    for c in chunks:
        text = c.get("content_clean", "")
        if not text:
            continue
        if total + len(text) > max_chars:
            if not used_chunks:
                parts.append(f"[{c.get('citation_label', '')}]\n{text[:max_chars]}")
                used_chunks.append(c)
            break
        parts.append(f"[{c.get('citation_label', '')}]\n{text}")
        used_chunks.append(c)
        total += len(text)
    return "\n\n".join(parts), used_chunks


def _image_paths_to_urls(paths: list[str] | None) -> list[str]:
    if not paths:
        return []
    return [f"/static/images/{p.replace('data/images/', '')}" for p in paths]


def _topic_from_question(question: str) -> str | None:
    """Best-effort extraction for a recent, explicit user question."""
    normalized = re.sub(r"[？?！!。.,，；;：:\s]+$", "", question.strip())
    normalized = re.sub(r"^(?:请问|请|麻烦|帮我|能不能|可以)?", "", normalized)
    patterns = (
        r"^(?:什么是|何为)(.+)$",
        r"^(?:介绍一下|讲讲|解释一下)(.+)$",
        r"^(.+?)(?:是什么|是指什么|指的是什么)$",
        r"^(.+?)(?:的定义|的含义)(?:是什么)?$",
        r"^(.+?)(?:有什么|有哪些|为什么|怎么|如何|是否|能否).*$",
    )
    for pattern in patterns:
        match = re.match(pattern, normalized)
        if not match:
            continue
        topic = match.group(1).strip(" 的")
        if 1 < len(topic) <= 40 and topic not in _GENERIC_TOPICS:
            return topic
    return None


def _fallback_keywords(
    question: str,
    history: list[dict[str, str]],
) -> list[str]:
    normalized = re.sub(r"\s+", "", question)
    is_elliptical_follow_up = len(normalized) <= 30 and any(
        cue in normalized for cue in _FOLLOW_UP_CUES
    )
    if is_elliptical_follow_up:
        for message in reversed(history):
            if message["role"] != "user":
                continue
            topic = _topic_from_question(message["content"])
            if topic:
                return [topic]
    return [question]


async def answer_question(request: QARequest) -> QAResponse:
    driver = get_driver()
    retriever = KnowledgeRetriever(driver)

    client = DeepSeekClient(
        settings.deepseek_api_key,
        settings.deepseek_base_url,
        settings.deepseek_model,
    )
    try:
        history = [message.model_dump() for message in request.history]
        keywords = await client.extract_keywords(request.question, history)
        if not keywords:
            keywords = _fallback_keywords(request.question, history)

        chunks = retriever.search_by_keywords(
            keywords,
            limit=request.max_citations * 3,
            question=request.question,
        )

        if not chunks:
            return QAResponse(
                answer="当前课程资料中未找到与该问题相关的内容。",
                insufficient_evidence=True,
            )

        context, evidence_chunks = _build_context(chunks)
        if not context or not evidence_chunks:
            return QAResponse(
                answer="当前课程资料中未找到足够的教材原文来回答该问题。",
                insufficient_evidence=True,
            )

        entity_map: dict[str, MatchedEntity] = {}
        for c in evidence_chunks:
            eid = c["entity_id"]
            if eid not in entity_map:
                entity_map[eid] = MatchedEntity(
                    entity_id=eid, name=c["name"], entity_type=c["entity_type"]
                )

        prompt_template = _load_prompt()
        system_prompt = prompt_template.replace("{context}", context).replace("{question}", request.question)

        llm_result = await client.generate_answer(
            system_prompt,
            request.question,
            history,
        )

        citations: list[Citation] = []
        seen_cids: set[str] = set()
        for c in evidence_chunks[:request.max_citations]:
            cid = c["chunk_id"]
            if cid in seen_cids:
                continue
            seen_cids.add(cid)
            citations.append(Citation(
                chunk_id=cid,
                quote=c["quote_original"],
                chapter_title=c["chapter_title"],
                section_number=c["section_number"],
                section_title=c["section_title"],
                image_urls=_image_paths_to_urls(c.get("image_paths")),
            ))

        entity_ids = list(entity_map.keys())[:10]
        related_raw = retriever.get_related(entity_ids)
        related = [
            RelatedKnowledge(
                source_name=r["source_name"],
                relation=r["relation"],
                target_name=r["target_name"],
            )
            for r in related_raw
        ]

        return QAResponse(
            answer=llm_result.get("answer", ""),
            matched_entities=list(entity_map.values()),
            citations=citations,
            related_knowledge=related,
            insufficient_evidence=llm_result.get("insufficient_evidence", False),
        )
    finally:
        await client.close()
