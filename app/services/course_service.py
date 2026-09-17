from __future__ import annotations

from threading import Lock
from time import monotonic
from typing import Any

from neo4j import Driver

from app.config import settings

TOC_CACHE_TTL_SECONDS = 300.0
_toc_cache: list[dict[str, Any]] | None = None
_toc_cache_expires_at = 0.0
_toc_cache_lock = Lock()

QUERY_TOC = """
MATCH (s:Section)
RETURN s.section_key AS section_key, s.chapter_number AS chapter_number,
       s.chapter_title AS chapter_title, s.section_number AS section_number,
       s.section_title AS section_title
ORDER BY s.chapter_number, s.section_number
"""

QUERY_SECTION_DETAIL = """
MATCH (c:Chunk)-[:BELONGS_TO]->(s:Section {section_key: $key})
OPTIONAL MATCH (e:KnowledgeEntity)-[:EVIDENCED_BY]->(c)
RETURN c.chunk_id AS chunk_id, c.quote_original AS quote_original,
       c.content_type AS content_type, c.image_paths AS image_paths,
       s.chapter_title AS chapter_title, s.section_number AS section_number,
       s.section_title AS section_title,
       collect(DISTINCT {id: e.entity_id, name: e.name}) AS entities
ORDER BY c.chunk_id
"""


def _image_paths_to_urls(paths: list[str] | None) -> list[str]:
    if not paths:
        return []
    return [f"/static/images/{p.replace('data/images/', '')}" for p in paths]


def _normalize_section_title(section_number: str, section_title: str) -> str:
    if section_number.endswith(".0") and section_title == "章引言":
        return "引言"
    return section_title


class CourseService:
    def __init__(self, driver: Driver):
        self.driver = driver
        self.database = settings.neo4j_database

    def get_toc(self) -> list[dict[str, Any]]:
        global _toc_cache, _toc_cache_expires_at

        now = monotonic()
        if _toc_cache is not None and now < _toc_cache_expires_at:
            return [dict(item) for item in _toc_cache]

        with _toc_cache_lock:
            now = monotonic()
            if _toc_cache is None or now >= _toc_cache_expires_at:
                with self.driver.session(database=self.database) as session:
                    rows = session.run(QUERY_TOC).data()
                for row in rows:
                    row["section_title"] = _normalize_section_title(
                        row.get("section_number") or "",
                        row.get("section_title") or "",
                    )
                _toc_cache = rows
                _toc_cache_expires_at = now + TOC_CACHE_TTL_SECONDS

        return [dict(item) for item in _toc_cache]

    def get_section(self, section_key: str) -> dict[str, Any] | None:
        with self.driver.session(database=self.database) as session:
            records = session.run(QUERY_SECTION_DETAIL, key=section_key).data()
        if not records:
            return None

        first = records[0]
        chunks = []
        for r in records:
            entities = [
                {"entity_id": e["id"], "name": e["name"]}
                for e in (r.get("entities") or [])
                if e.get("id")
            ]
            chunks.append({
                "chunk_id": r["chunk_id"],
                "quote_original": r["quote_original"] or "",
                "content_type": r["content_type"] or "core",
                "image_urls": _image_paths_to_urls(r.get("image_paths")),
                "entities": entities,
            })

        return {
            "section_key": section_key,
            "chapter_title": first.get("chapter_title") or "",
            "section_number": first.get("section_number") or "",
            "section_title": _normalize_section_title(
                first.get("section_number") or "",
                first.get("section_title") or "",
            ),
            "chunks": chunks,
        }
