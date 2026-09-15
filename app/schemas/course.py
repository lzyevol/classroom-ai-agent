from __future__ import annotations

from pydantic import BaseModel, Field


class TocItem(BaseModel):
    section_key: str
    chapter_number: int
    chapter_title: str
    section_number: str
    section_title: str


class ChunkEntity(BaseModel):
    entity_id: str
    name: str


class ChunkItem(BaseModel):
    chunk_id: str
    quote_original: str
    content_type: str
    image_urls: list[str] = Field(default_factory=list)
    entities: list[ChunkEntity] = Field(default_factory=list)


class SectionDetail(BaseModel):
    section_key: str
    chapter_title: str
    section_number: str
    section_title: str
    chunks: list[ChunkItem] = Field(default_factory=list)
