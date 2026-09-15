from __future__ import annotations

from unittest.mock import patch, MagicMock, AsyncMock

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    with patch("app.main.init_driver"), patch("app.main.close_driver"):
        from app.main import app
        yield TestClient(app)


def _mock_retriever(chunks):
    mock_driver = MagicMock()
    mock_session = MagicMock()
    mock_driver.session.return_value.__enter__ = MagicMock(return_value=mock_session)
    mock_driver.session.return_value.__exit__ = MagicMock(return_value=False)
    mock_session.run.return_value.data.return_value = chunks
    return mock_driver


SAMPLE_CHUNKS = [
    {
        "entity_id": "e1", "name": "具身智能", "entity_type": "Concept",
        "chunk_id": "book_embodied_ai_intro_2024:1.1:chunk-001",
        "content_clean": "具身智能的核心含义是身体本身的运动也可以影响脑的发育。",
        "quote_original": '具身智能，顾名思义就是"具备了身体的智能"。',
        "citation_label": '《具身智能导论》第1章 1.1 引言',
        "chapter_title": "具身智能概述", "section_number": "1.1",
        "section_title": "引言", "image_paths": [],
    }
]


def test_qa_basic(client):
    deepseek_resp = {"answer": "具身智能是具备了身体的智能。", "insufficient_evidence": False}
    related = [{"source_name": "具身智能", "relation": "IS_A", "target_name": "智能"}]

    with (
        patch("app.services.qa_service.get_driver"),
        patch("app.services.qa_service.KnowledgeRetriever") as MockRetriever,
        patch("app.clients.deepseek.DeepSeekClient.generate_answer", new_callable=AsyncMock, return_value=deepseek_resp),
        patch("app.clients.deepseek.DeepSeekClient.close", new_callable=AsyncMock),
    ):
        mock_r = MockRetriever.return_value
        mock_r.search_by_keywords.return_value = SAMPLE_CHUNKS
        mock_r.get_related.return_value = related
        resp = client.post("/api/qa", json={"question": "什么是具身智能？"})

    assert resp.status_code == 200
    data = resp.json()
    assert "具身智能" in data["answer"]
    assert data["insufficient_evidence"] is False
    assert len(data["citations"]) >= 1
    assert data["citations"][0]["quote"] == SAMPLE_CHUNKS[0]["quote_original"]
    assert "source_page" not in str(data)


def test_qa_no_results(client):
    with (
        patch("app.services.qa_service.get_driver"),
        patch("app.services.qa_service.KnowledgeRetriever") as MockRetriever,
        patch("app.clients.deepseek.DeepSeekClient.extract_keywords", new_callable=AsyncMock, return_value=[]),
        patch("app.clients.deepseek.DeepSeekClient.close", new_callable=AsyncMock),
    ):
        mock_r = MockRetriever.return_value
        mock_r.search_by_keywords.return_value = []
        resp = client.post("/api/qa", json={"question": "最新的波士顿动力机器人多少钱？"})

    assert resp.status_code == 200
    data = resp.json()
    assert data["insufficient_evidence"] is True


def test_qa_empty_question(client):
    resp = client.post("/api/qa", json={"question": ""})
    assert resp.status_code == 422


def test_qa_passes_history_to_keyword_extraction_and_answer(client):
    history = [
        {"role": "user", "content": "什么是具身智能？"},
        {"role": "assistant", "content": "具身智能强调身体与环境交互。"},
    ]
    deepseek_resp = {"answer": "它的优点包括利用身体与环境交互。", "insufficient_evidence": False}

    with (
        patch("app.services.qa_service.get_driver"),
        patch("app.services.qa_service.KnowledgeRetriever") as MockRetriever,
        patch(
            "app.clients.deepseek.DeepSeekClient.extract_keywords",
            new_callable=AsyncMock,
            return_value=["具身智能"],
        ) as extract_keywords,
        patch(
            "app.clients.deepseek.DeepSeekClient.generate_answer",
            new_callable=AsyncMock,
            return_value=deepseek_resp,
        ) as generate_answer,
        patch("app.clients.deepseek.DeepSeekClient.close", new_callable=AsyncMock),
    ):
        mock_r = MockRetriever.return_value
        mock_r.search_by_keywords.return_value = SAMPLE_CHUNKS
        mock_r.get_related.return_value = []
        resp = client.post(
            "/api/qa",
            json={"question": "它有什么优点？", "history": history},
        )

    assert resp.status_code == 200
    assert extract_keywords.await_args.args[1] == history
    assert generate_answer.await_args.args[2] == history
    mock_r.search_by_keywords.assert_called_once_with(
        ["具身智能"],
        limit=9,
        question="它有什么优点？",
    )


def test_qa_recovers_topic_for_elliptical_follow_up(client):
    history = [
        {"role": "user", "content": "具身智能是什么？"},
        {"role": "assistant", "content": "具身智能强调身体与环境交互。"},
    ]
    deepseek_resp = {
        "answer": "具身智能还包括感知、行动和环境反馈形成的闭环。",
        "insufficient_evidence": False,
    }

    with (
        patch("app.services.qa_service.get_driver"),
        patch("app.services.qa_service.KnowledgeRetriever") as MockRetriever,
        patch(
            "app.clients.deepseek.DeepSeekClient.extract_keywords",
            new_callable=AsyncMock,
            return_value=[],
        ),
        patch(
            "app.clients.deepseek.DeepSeekClient.generate_answer",
            new_callable=AsyncMock,
            return_value=deepseek_resp,
        ),
        patch("app.clients.deepseek.DeepSeekClient.close", new_callable=AsyncMock),
    ):
        mock_r = MockRetriever.return_value
        mock_r.search_by_keywords.return_value = SAMPLE_CHUNKS
        mock_r.get_related.return_value = []
        resp = client.post(
            "/api/qa",
            json={"question": "详细介绍一下", "history": history},
        )

    assert resp.status_code == 200
    assert resp.json()["insufficient_evidence"] is False
    mock_r.search_by_keywords.assert_called_once_with(
        ["具身智能"],
        limit=9,
        question="详细介绍一下",
    )
