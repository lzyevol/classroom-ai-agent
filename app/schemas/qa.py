from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class QAHistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=2000)


class QARequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=500)
    max_citations: int = Field(default=3, ge=1, le=10)
    history: list[QAHistoryMessage] = Field(default_factory=list, max_length=12)


class MatchedEntity(BaseModel):
    entity_id: str
    name: str
    entity_type: str


class Citation(BaseModel):
    chunk_id: str
    quote: str
    book: str = "具身智能导论"
    chapter_title: str
    section_number: str
    section_title: str
    image_urls: list[str] = Field(default_factory=list)


class RelatedKnowledge(BaseModel):
    source_name: str
    relation: str
    target_name: str


class KnowledgeContextRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=800)
    keywords: list[str] = Field(default_factory=list, max_length=12)
    max_citations: int = Field(default=3, ge=1, le=10)


class KnowledgeChunk(BaseModel):
    chunk_id: str
    content: str
    quote: str
    citation_label: str = ""
    chapter_title: str
    section_number: str
    section_title: str


class KnowledgeContextResponse(BaseModel):
    query: str
    matched_entities: list[MatchedEntity] = Field(default_factory=list)
    chunks: list[KnowledgeChunk] = Field(default_factory=list)
    citations: list[Citation] = Field(default_factory=list)
    related_knowledge: list[RelatedKnowledge] = Field(default_factory=list)
    insufficient_evidence: bool = False


class QAResponse(BaseModel):
    answer: str
    matched_entities: list[MatchedEntity] = Field(default_factory=list)
    citations: list[Citation] = Field(default_factory=list)
    related_knowledge: list[RelatedKnowledge] = Field(default_factory=list)
    insufficient_evidence: bool = False
