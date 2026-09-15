from __future__ import annotations

import re

from app.db.neo4j import get_driver
from app.retrieval.knowledge_retriever import KnowledgeRetriever
from app.schemas.qa import (
    Citation,
    KnowledgeChunk,
    KnowledgeContextRequest,
    KnowledgeContextResponse,
    MatchedEntity,
    RelatedKnowledge,
)


_COMPARISON_SUFFIX_RE = re.compile(
    r"(?:\u6709\u4ec0\u4e48\u533a\u522b|\u6709\u4f55\u533a\u522b|\u4e3b\u8981\u533a\u522b|\u533a\u522b\u662f\u4ec0\u4e48|\u7684\u533a\u522b|\u533a\u522b|\u6709\u4ec0\u4e48\u5173\u7cfb|\u5173\u7cfb\u662f\u4ec0\u4e48|\u7684\u5173\u7cfb)$"
)
_COMPARISON_SEPARATOR_RE = re.compile(r"(?:\u4ee5\u53ca|\u548c|\u4e0e|\u8ddf|\u53ca|\u76f8\u6bd4|\u5bf9\u6bd4)")


def _expand_keyword(value: str) -> list[str]:
    cleaned = re.sub(r"[\s\u3000\u3001\u3002\uff0c\uff01\uff1f\uff1b\uff1a,.!?;:~\uff5e]+", "", value)
    if not cleaned:
        return []

    topic = re.sub(r"^(?:\u8bf7\u6bd4\u8f83|\u6bd4\u8f83|\u8bf7\u5bf9\u6bd4|\u5bf9\u6bd4)", "", cleaned)
    topic = _COMPARISON_SUFFIX_RE.sub("", topic)
    parts = [part for part in _COMPARISON_SEPARATOR_RE.split(topic) if len(part) >= 2]

    # Keep the original phrase for exact entity aliases, then add split comparison
    # subjects so queries such as "embodied and disembodied intelligence" can
    # match either entity independently.
    return list(dict.fromkeys([cleaned, topic, *parts]))


def _clean_keywords(request: KnowledgeContextRequest) -> list[str]:
    explicit = [item.strip() for item in request.keywords if item.strip()]
    if not explicit:
        return [request.query.strip()]

    values: list[str] = []
    for item in explicit:
        values.extend(_expand_keyword(item))
    return list(dict.fromkeys(values))[:12]


def retrieve_knowledge_context(request: KnowledgeContextRequest) -> KnowledgeContextResponse:
    retriever = KnowledgeRetriever(get_driver())
    records = retriever.search_by_keywords(
        _clean_keywords(request),
        limit=request.max_citations * 3,
        question=request.query,
    )

    if not records:
        return KnowledgeContextResponse(
            query=request.query,
            insufficient_evidence=True,
        )

    entities: dict[str, MatchedEntity] = {}
    chunks: list[KnowledgeChunk] = []
    citations: list[Citation] = []
    seen_chunks: set[str] = set()

    for record in records:
        entity_id = str(record.get("entity_id") or "")
        if entity_id and entity_id not in entities:
            entities[entity_id] = MatchedEntity(
                entity_id=entity_id,
                name=str(record.get("name") or ""),
                entity_type=str(record.get("entity_type") or ""),
            )

        chunk_id = str(record.get("chunk_id") or "")
        content = str(record.get("content_clean") or "").strip()
        if not chunk_id or not content or chunk_id in seen_chunks:
            continue
        seen_chunks.add(chunk_id)

        quote = str(record.get("quote_original") or content[:500]).strip()
        chapter_title = str(record.get("chapter_title") or "")
        section_number = str(record.get("section_number") or "")
        section_title = str(record.get("section_title") or "")
        image_paths = record.get("image_paths") or []
        image_urls = [
            f"/static/images/{str(path).replace('data/images/', '')}"
            for path in image_paths
        ]

        chunks.append(
            KnowledgeChunk(
                chunk_id=chunk_id,
                content=content[:1600],
                quote=quote[:700],
                citation_label=str(record.get("citation_label") or ""),
                chapter_title=chapter_title,
                section_number=section_number,
                section_title=section_title,
            )
        )
        citations.append(
            Citation(
                chunk_id=chunk_id,
                quote=quote[:700],
                chapter_title=chapter_title,
                section_number=section_number,
                section_title=section_title,
                image_urls=image_urls,
            )
        )
        if len(chunks) >= request.max_citations:
            break

    entity_ids = list(entities)[:10]
    related = [
        RelatedKnowledge(
            source_name=str(item.get("source_name") or ""),
            relation=str(item.get("relation") or ""),
            target_name=str(item.get("target_name") or ""),
        )
        for item in retriever.get_related(entity_ids)
    ]

    return KnowledgeContextResponse(
        query=request.query,
        matched_entities=list(entities.values()),
        chunks=chunks,
        citations=citations,
        related_knowledge=related,
        insufficient_evidence=not chunks,
    )
