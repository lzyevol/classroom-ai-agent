from __future__ import annotations

from typing import Any

from neo4j import Driver

from app.config import settings

QUERY_ENTITY_CHUNKS = """
MATCH (e:KnowledgeEntity)-[:EVIDENCED_BY]->(c:Chunk)-[:BELONGS_TO]->(s:Section)
WHERE e.name = $keyword
   OR $keyword IN coalesce(e.aliases, [])
   OR e.name CONTAINS $keyword
   OR any(alias IN coalesce(e.aliases, []) WHERE alias CONTAINS $keyword)
RETURN e.entity_id AS entity_id, e.name AS name, e.entity_type AS entity_type,
       e.aliases AS aliases,
       c.chunk_id AS chunk_id, c.content_clean AS content_clean,
       c.quote_original AS quote_original, c.citation_label AS citation_label,
       s.chapter_title AS chapter_title, s.section_number AS section_number,
       s.section_title AS section_title, c.image_paths AS image_paths,
       CASE
         WHEN e.name = $keyword THEN 4
         WHEN $keyword IN coalesce(e.aliases, []) THEN 3
         WHEN e.name CONTAINS $keyword THEN 2
         ELSE 1
       END AS entity_match_score
ORDER BY entity_match_score DESC, c.chunk_id
LIMIT $candidate_limit
"""

QUERY_RELATED = """
MATCH (e:KnowledgeEntity)-[r]-(related:KnowledgeEntity)
WHERE e.entity_id IN $entity_ids
RETURN DISTINCT e.name AS source_name, type(r) AS relation,
       related.name AS target_name
LIMIT $limit
"""


class KnowledgeRetriever:
    def __init__(self, driver: Driver):
        self.driver = driver
        self.database = settings.neo4j_database

    @staticmethod
    def _score_candidate(
        candidate: dict[str, Any],
        keyword: str,
        question: str,
    ) -> int:
        name = str(candidate.get("name") or "")
        aliases = [str(alias) for alias in (candidate.get("aliases") or [])]
        content = str(candidate.get("content_clean") or "")
        quote = str(candidate.get("quote_original") or "")
        section_title = str(candidate.get("section_title") or "")
        score = int(candidate.get("entity_match_score") or 0) * 25

        if name == keyword:
            score += 100
        elif keyword in aliases:
            score += 80
        elif keyword in name:
            score += 50

        score += min(content.count(keyword), 8) * 8
        score += min(quote.count(keyword), 8) * 4
        if keyword in section_title:
            score += 20

        definition_question = any(
            cue in question for cue in ("什么是", "是什么", "定义", "含义", "概念")
        )
        if definition_question:
            strong_definition_cues = (
                f"{keyword}，顾名思义",
                f"{keyword}的核心含义",
                f"所谓{keyword}",
            )
            direct_definition_cues = (f"{keyword}是", f"{keyword}指")
            if any(
                cue in content or cue in quote for cue in strong_definition_cues
            ):
                score += 600
            elif any(
                cue in content or cue in quote for cue in direct_definition_cues
            ):
                score += 100

        comparison_question = any(cue in question for cue in ("区别", "比较", "关系"))
        if comparison_question and any(cue in content for cue in ("区别", "联系", "不同于")):
            score += 50

        return score

    def search_by_keywords(
        self,
        keywords: list[str],
        limit: int = 9,
        question: str = "",
    ) -> list[dict[str, Any]]:
        ranked: dict[str, tuple[int, dict[str, Any]]] = {}
        cleaned_keywords = list(dict.fromkeys(kw.strip() for kw in keywords if kw.strip()))
        candidate_limit = max(limit * 4, 20)

        with self.driver.session(database=self.database) as session:
            for kw in cleaned_keywords:
                records = session.run(
                    QUERY_ENTITY_CHUNKS,
                    keyword=kw,
                    candidate_limit=candidate_limit,
                ).data()
                for record in records:
                    chunk_id = record["chunk_id"]
                    score = self._score_candidate(record, kw, question)
                    current = ranked.get(chunk_id)
                    if current is None or score > current[0]:
                        ranked[chunk_id] = (score, record)

        ordered = sorted(
            ranked.values(),
            key=lambda item: (-item[0], str(item[1].get("chunk_id") or "")),
        )
        if ordered and any(
            cue in question for cue in ("什么是", "是什么", "定义", "含义", "概念")
        ):
            top_score = ordered[0][0]
            ordered = [item for item in ordered if item[0] >= top_score - 150]
        return [record for _, record in ordered[:limit]]

    def get_related(self, entity_ids: list[str], limit: int = 10) -> list[dict[str, Any]]:
        if not entity_ids:
            return []
        with self.driver.session(database=self.database) as session:
            return session.run(
                QUERY_RELATED, entity_ids=entity_ids, limit=limit
            ).data()
