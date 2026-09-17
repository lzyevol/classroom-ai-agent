"""Isolated HTTP fixture for frontend-to-FastAPI L2 contract tests.

The real FastAPI app, route and Pydantic schemas are used. Only external
services (Neo4j, Redis, SQLite and the model/retrieval service) are replaced.
"""

from __future__ import annotations

import sys
from pathlib import Path

import uvicorn

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import app.api.qa as qa_api
import app.main as app_main
from app.schemas.qa import Citation, MatchedEntity, QAResponse, RelatedKnowledge


async def fixture_answer(request) -> QAResponse:
    if request.question == "触发服务故障":
        raise RuntimeError("fixture dependency unavailable")

    if request.question == "教材中不存在的问题":
        return QAResponse(
            answer="当前课程资料中未找到与该问题相关的内容。",
            insufficient_evidence=True,
        )

    return QAResponse(
        answer="具身智能强调身体、环境与认知之间的相互作用。",
        matched_entities=[
            MatchedEntity(entity_id="fixture-e1", name="具身智能", entity_type="Concept")
        ],
        citations=[
            Citation(
                chunk_id="book_embodied_ai_intro_2024:1.1:chunk-001",
                quote='具身智能，顾名思义就是“具备了身体的智能”。',
                book="具身智能导论",
                chapter_title="具身智能概述",
                section_number="1.1",
                section_title="引言",
                image_urls=[],
            )
        ],
        related_knowledge=[
            RelatedKnowledge(
                source_name="具身智能",
                relation="INTERACTS_WITH",
                target_name="环境",
            )
        ],
        insufficient_evidence=False,
    )


app_main.init_driver = lambda *_args, **_kwargs: None
app_main.close_driver = lambda: None
app_main.init_client = lambda *_args, **_kwargs: None
app_main.get_db = lambda: None
app_main.close_db = lambda: None


async def _close_client() -> None:
    return None


app_main.close_client = _close_client
qa_api.answer_question = fixture_answer


if __name__ == "__main__":
    uvicorn.run(app_main.app, host="127.0.0.1", port=8101, log_level="warning")
