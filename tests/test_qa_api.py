from __future__ import annotations

from unittest.mock import AsyncMock, patch

from app.config import settings

SAMPLE_CHUNKS = [
    {
        "entity_id": "e1",
        "name": "具身智能",
        "entity_type": "Concept",
        "chunk_id": "book_embodied_ai_intro_2024:1.1:chunk-001",
        "content_clean": "具身智能的核心含义是身体本身的运动也可以影响脑的发育与认知。",
        "quote_original": "具身智能，顾名思义就是“具备了身体的智能”。",
        "citation_label": "《具身智能导论》第1章 1.1 引言",
        "chapter_title": "具身智能概述",
        "section_number": "1.1",
        "section_title": "引言",
        "image_paths": [],
    }
]


def test_qa_basic_success(client):
    with (
        patch("app.services.qa_service.get_driver"),
        patch("app.services.qa_service.KnowledgeRetriever") as MockRetriever,
        patch(
            "app.services.qa_service.DeepSeekClient.generate_answer",
            new_callable=AsyncMock,
            return_value={
                "answer": "具身智能是具备了身体的智能。",
                "insufficient_evidence": False,
            },
        ),
        patch("app.services.qa_service.DeepSeekClient.close", new_callable=AsyncMock),
    ):
        mock_r = MockRetriever.return_value
        mock_r.search_by_keywords.return_value = SAMPLE_CHUNKS
        mock_r.get_related.return_value = []
        response = client.post("/api/qa", json={"question": "什么是具身智能？"})

    assert response.status_code == 200
    data = response.json()
    assert data["insufficient_evidence"] is False
    assert len(data["citations"]) == 1
    assert data["citations"][0]["quote"] == SAMPLE_CHUNKS[0]["quote_original"]
    assert data["citations"][0]["chunk_id"] == SAMPLE_CHUNKS[0]["chunk_id"]


def test_qa_no_evidence_returns_200_without_calling_model(client):
    with (
        patch("app.services.qa_service.get_driver"),
        patch("app.services.qa_service.KnowledgeRetriever") as MockRetriever,
        patch(
            "app.services.qa_service.DeepSeekClient.extract_keywords",
            new_callable=AsyncMock,
            return_value=[],
        ) as mock_extract,
        patch(
            "app.services.qa_service.DeepSeekClient.generate_answer",
            new_callable=AsyncMock,
        ) as mock_answer,
        patch("app.services.qa_service.DeepSeekClient.close", new_callable=AsyncMock),
    ):
        mock_r = MockRetriever.return_value
        mock_r.search_by_keywords.return_value = []
        response = client.post("/api/qa", json={"question": "教材里不存在的问题"})

    assert response.status_code == 200
    data = response.json()
    assert data["insufficient_evidence"] is True
    assert data["citations"] == []
    mock_answer.assert_not_awaited()


def test_qa_missing_key_returns_503_config_error(client, monkeypatch):
    monkeypatch.setattr(settings, "deepseek_api_key", "")
    with (
        patch("app.services.qa_service.get_driver"),
        patch("app.services.qa_service.KnowledgeRetriever"),
        patch("app.services.qa_service.DeepSeekClient.close", new_callable=AsyncMock),
    ):
        response = client.post("/api/qa", json={"question": "什么是具身智能？"})

    assert response.status_code == 503
    detail = response.json()["detail"]
    assert "DEEPSEEK_API_KEY" in detail
    # A config error must never be disguised as insufficient evidence.
    assert "insufficient_evidence" not in response.json()


def test_qa_timeout_returns_503_not_evidence_shortage(client):
    with (
        patch("app.services.qa_service.get_driver"),
        patch("app.services.qa_service.KnowledgeRetriever") as MockRetriever,
        patch(
            "app.services.qa_service.DeepSeekClient.generate_answer",
            new_callable=AsyncMock,
            side_effect=RuntimeError("AI 服务暂时不可用，请稍后再试"),
        ),
        patch("app.services.qa_service.DeepSeekClient.close", new_callable=AsyncMock),
    ):
        mock_r = MockRetriever.return_value
        mock_r.search_by_keywords.return_value = SAMPLE_CHUNKS
        mock_r.get_related.return_value = []
        response = client.post("/api/qa", json={"question": "什么是具身智能？"})

    assert response.status_code == 503
    assert "暂时不可用" in response.json()["detail"]
    assert "insufficient_evidence" not in response.json()


def test_qa_invalid_json_returns_503_not_evidence_shortage(client):
    with (
        patch("app.services.qa_service.get_driver"),
        patch("app.services.qa_service.KnowledgeRetriever") as MockRetriever,
        patch(
            "app.services.qa_service.DeepSeekClient.generate_answer",
            new_callable=AsyncMock,
            side_effect=RuntimeError("AI 返回格式异常，请稍后再试"),
        ),
        patch("app.services.qa_service.DeepSeekClient.close", new_callable=AsyncMock),
    ):
        mock_r = MockRetriever.return_value
        mock_r.search_by_keywords.return_value = SAMPLE_CHUNKS
        mock_r.get_related.return_value = []
        response = client.post("/api/qa", json={"question": "什么是具身智能？"})

    assert response.status_code == 503
    assert "格式异常" in response.json()["detail"]
    assert "insufficient_evidence" not in response.json()


def test_qa_empty_question_returns_422(client):
    response = client.post("/api/qa", json={"question": ""})
    assert response.status_code == 422
