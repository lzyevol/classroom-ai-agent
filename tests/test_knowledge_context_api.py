from __future__ import annotations

from unittest.mock import patch

SAMPLE_RECORD = {
    "entity_id": "e1",
    "name": "具身智能",
    "entity_type": "Concept",
    "chunk_id": "book_embodied_ai_intro_2024:1.1:chunk-001",
    "content_clean": "具身智能强调身体、环境与认知之间的相互作用。",
    "quote_original": "身体与环境共同参与智能形成。",
    "citation_label": "《具身智能导论》第1章 1.1",
    "chapter_title": "具身智能概述",
    "section_number": "1.1",
    "section_title": "引言",
    "image_paths": [],
}


def test_knowledge_context_returns_evidence_without_answer(client):
    with (
        patch("app.services.knowledge_context_service.get_driver", return_value=object()),
        patch("app.services.knowledge_context_service.KnowledgeRetriever") as MockRetriever,
    ):
        mock_r = MockRetriever.return_value
        mock_r.search_by_keywords.return_value = [SAMPLE_RECORD]
        mock_r.get_related.return_value = []

        response = client.post(
            "/api/knowledge/context",
            json={"query": "为什么身体会影响智能？", "max_citations": 3},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["insufficient_evidence"] is False
    assert data["chunks"][0]["chunk_id"] == SAMPLE_RECORD["chunk_id"]
    assert data["citations"][0]["section_number"] == "1.1"
    assert "answer" not in data


def test_knowledge_context_no_hit_returns_insufficient(client):
    with (
        patch("app.services.knowledge_context_service.get_driver", return_value=object()),
        patch("app.services.knowledge_context_service.KnowledgeRetriever") as MockRetriever,
    ):
        mock_r = MockRetriever.return_value
        mock_r.search_by_keywords.return_value = []

        response = client.post(
            "/api/knowledge/context",
            json={"query": "教材里没有的知识点"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["insufficient_evidence"] is True
    assert data["chunks"] == []
    assert data["citations"] == []
    mock_r.get_related.assert_not_called()


def test_knowledge_context_driver_unavailable_returns_503(client):
    with patch(
        "app.services.knowledge_context_service.get_driver",
        side_effect=RuntimeError("Neo4j driver not initialized"),
    ):
        response = client.post(
            "/api/knowledge/context",
            json={"query": "什么是具身智能？"},
        )

    assert response.status_code == 503
    # A dependency outage must not look like a no-hit evidence shortage.
    assert "insufficient_evidence" not in response.json()


def test_knowledge_context_unexpected_error_returns_500(client):
    with (
        patch("app.services.knowledge_context_service.get_driver", return_value=object()),
        patch(
            "app.services.knowledge_context_service.KnowledgeRetriever",
            side_effect=ValueError("boom"),
        ),
    ):
        response = client.post(
            "/api/knowledge/context",
            json={"query": "什么是具身智能？"},
        )

    assert response.status_code == 500
    assert "insufficient_evidence" not in response.json()


def test_knowledge_context_invalid_query_returns_422(client):
    response = client.post(
        "/api/knowledge/context",
        json={"query": "", "max_citations": 11},
    )
    assert response.status_code == 422
