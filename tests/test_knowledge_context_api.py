from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from app.main import app

    yield TestClient(app)


SAMPLE_RECORD = {
    "entity_id": "e1",
    "name": "\u5177\u8eab\u667a\u80fd",
    "entity_type": "Concept",
    "chunk_id": "book:1.1:chunk-001",
    "content_clean": "\u5177\u8eab\u667a\u80fd\u5f3a\u8c03\u8eab\u4f53\u3001\u73af\u5883\u4e0e\u8ba4\u77e5\u4e4b\u95f4\u7684\u76f8\u4e92\u4f5c\u7528\u3002",
    "quote_original": "\u8eab\u4f53\u4e0e\u73af\u5883\u5171\u540c\u53c2\u4e0e\u667a\u80fd\u5f62\u6210\u3002",
    "citation_label": "\u300a\u5177\u8eab\u667a\u80fd\u5bfc\u8bba\u300b\u7b2c1\u7ae0 1.1",
    "chapter_title": "\u5177\u8eab\u667a\u80fd\u5bfc\u8bba",
    "section_number": "1.1",
    "section_title": "\u6982\u5ff5",
    "image_paths": [],
}


def _patched_retriever():
    return (
        patch("app.services.knowledge_context_service.get_driver", return_value=object()),
        patch("app.services.knowledge_context_service.KnowledgeRetriever"),
    )


def test_knowledge_context_returns_evidence_without_answer(client):
    driver_patch, retriever_patch = _patched_retriever()
    with driver_patch, retriever_patch as mock_retriever:
        instance = mock_retriever.return_value
        instance.search_by_keywords.return_value = [SAMPLE_RECORD]
        instance.get_related.return_value = []

        response = client.post(
            "/api/knowledge/context",
            json={"query": "\u4e3a\u4ec0\u4e48\u8eab\u4f53\u4f1a\u5f71\u54cd\u667a\u80fd\uff1f", "max_citations": 3},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["insufficient_evidence"] is False
    assert data["chunks"][0]["chunk_id"] == SAMPLE_RECORD["chunk_id"]
    assert data["citations"][0]["section_number"] == "1.1"
    assert "answer" not in data
    instance.search_by_keywords.assert_called_once_with(
        ["\u4e3a\u4ec0\u4e48\u8eab\u4f53\u4f1a\u5f71\u54cd\u667a\u80fd\uff1f"],
        limit=9,
        question="\u4e3a\u4ec0\u4e48\u8eab\u4f53\u4f1a\u5f71\u54cd\u667a\u80fd\uff1f",
    )


def test_knowledge_context_uses_explicit_keywords_and_deduplicates(client):
    driver_patch, retriever_patch = _patched_retriever()
    with driver_patch, retriever_patch as mock_retriever:
        instance = mock_retriever.return_value
        instance.search_by_keywords.return_value = [SAMPLE_RECORD, SAMPLE_RECORD]
        instance.get_related.return_value = []

        response = client.post(
            "/api/knowledge/context",
            json={
                "query": "\u4ec0\u4e48\u662f\u5177\u8eab\u667a\u80fd\uff1f",
                "keywords": ["\u5177\u8eab\u667a\u80fd", "\u5177\u8eab\u667a\u80fd", ""],
                "max_citations": 3,
            },
        )

    assert response.status_code == 200
    assert len(response.json()["chunks"]) == 1
    instance.search_by_keywords.assert_called_once_with(
        ["\u5177\u8eab\u667a\u80fd"],
        limit=9,
        question="\u4ec0\u4e48\u662f\u5177\u8eab\u667a\u80fd\uff1f",
    )


def test_knowledge_context_reports_insufficient_evidence(client):
    driver_patch, retriever_patch = _patched_retriever()
    with driver_patch, retriever_patch as mock_retriever:
        instance = mock_retriever.return_value
        instance.search_by_keywords.return_value = []

        response = client.post(
            "/api/knowledge/context",
            json={"query": "\u6559\u6750\u91cc\u6ca1\u6709\u7684\u95ee\u9898"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["insufficient_evidence"] is True
    assert data["chunks"] == []
    assert data["citations"] == []
    instance.get_related.assert_not_called()


def test_knowledge_context_expands_comparison_keywords(client):
    driver_patch, retriever_patch = _patched_retriever()
    with driver_patch, retriever_patch as mock_retriever:
        instance = mock_retriever.return_value
        instance.search_by_keywords.return_value = [SAMPLE_RECORD]
        instance.get_related.return_value = []

        response = client.post(
            "/api/knowledge/context",
            json={
                "query": "\u5177\u8eab\u667a\u80fd\u548c\u79bb\u8eab\u667a\u80fd\u6709\u4ec0\u4e48\u533a\u522b\uff1f",
                "keywords": ["\u5177\u8eab\u667a\u80fd\u548c\u79bb\u8eab\u667a\u80fd"],
                "max_citations": 3,
            },
        )

    assert response.status_code == 200
    instance.search_by_keywords.assert_called_once_with(
        [
            "\u5177\u8eab\u667a\u80fd\u548c\u79bb\u8eab\u667a\u80fd",
            "\u5177\u8eab\u667a\u80fd",
            "\u79bb\u8eab\u667a\u80fd",
        ],
        limit=9,
        question="\u5177\u8eab\u667a\u80fd\u548c\u79bb\u8eab\u667a\u80fd\u6709\u4ec0\u4e48\u533a\u522b\uff1f",
    )
