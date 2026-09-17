from __future__ import annotations

from unittest.mock import patch, MagicMock, AsyncMock

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    with patch("app.main.init_driver"), patch("app.main.close_driver"):
        from app.main import app
        yield TestClient(app)


SAMPLE_CHUNKS = [
    {
        "entity_id": "e1", "name": "具身智能", "entity_type": "Concept",
        "chunk_id": "book:1.1:chunk-001",
        "content_clean": "具身智能核心含义。",
        "quote_original": "原文。",
        "citation_label": "第1章 1.1",
        "chapter_title": "概述", "section_number": "1.1",
        "section_title": "引言", "image_paths": [],
    }
]


def test_cypher_injection_in_question(client):
    """用户输入含 Cypher 特殊字符，不应报错或注入"""
    malicious = "' OR 1=1 MATCH (n) DETACH DELETE n //"
    deepseek_resp = {"answer": "未找到。", "insufficient_evidence": True}

    with (
        patch("app.services.qa_service.get_driver"),
        patch("app.services.qa_service.KnowledgeRetriever") as MockRetriever,
        patch("app.clients.deepseek.DeepSeekClient.extract_keywords", new_callable=AsyncMock, return_value=[malicious]),
        patch("app.clients.deepseek.DeepSeekClient.generate_answer", new_callable=AsyncMock, return_value=deepseek_resp),
        patch("app.clients.deepseek.DeepSeekClient.close", new_callable=AsyncMock),
    ):
        mock_r = MockRetriever.return_value
        mock_r.search_by_keywords.return_value = []
        resp = client.post("/api/qa", json={"question": malicious})

    assert resp.status_code == 200
    data = resp.json()
    assert data["insufficient_evidence"] is True


def test_no_page_indexes_in_response(client):
    """返回不应包含 source_page_indexes_internal 或 source_blocks_json"""
    deepseek_resp = {"answer": "回答。", "insufficient_evidence": False}

    with (
        patch("app.services.qa_service.get_driver"),
        patch("app.services.qa_service.KnowledgeRetriever") as MockRetriever,
        patch("app.clients.deepseek.DeepSeekClient.extract_keywords", new_callable=AsyncMock, return_value=["具身智能"]),
        patch("app.clients.deepseek.DeepSeekClient.generate_answer", new_callable=AsyncMock, return_value=deepseek_resp),
        patch("app.clients.deepseek.DeepSeekClient.close", new_callable=AsyncMock),
    ):
        mock_r = MockRetriever.return_value
        mock_r.search_by_keywords.return_value = SAMPLE_CHUNKS
        mock_r.get_related.return_value = []
        resp = client.post("/api/qa", json={"question": "什么是具身智能"})

    assert resp.status_code == 200
    text = resp.text
    assert "source_page" not in text
    assert "source_blocks" not in text


def test_neo4j_down_returns_503(client):
    """Neo4j 不可用时，返回 503 不泄露密码"""
    with (
        patch("app.services.qa_service.get_driver", side_effect=RuntimeError("Neo4j driver not initialized")),
    ):
        resp = client.post("/api/qa", json={"question": "测试"})

    assert resp.status_code == 503
    assert "password" not in resp.text.lower()
    assert "neo4j" not in resp.json().get("detail", "").lower() or "driver" in resp.json()["detail"].lower()


def test_deepseek_timeout_returns_graceful(client):
    """DeepSeek 超时不崩溃，返回可读信息"""
    deepseek_resp = {"answer": "AI 服务暂时不可用，请稍后再试。", "insufficient_evidence": True}

    with (
        patch("app.services.qa_service.get_driver"),
        patch("app.services.qa_service.KnowledgeRetriever") as MockRetriever,
        patch("app.clients.deepseek.DeepSeekClient.extract_keywords", new_callable=AsyncMock, return_value=["具身智能"]),
        patch("app.clients.deepseek.DeepSeekClient.generate_answer", new_callable=AsyncMock, return_value=deepseek_resp),
        patch("app.clients.deepseek.DeepSeekClient.close", new_callable=AsyncMock),
    ):
        mock_r = MockRetriever.return_value
        mock_r.search_by_keywords.return_value = SAMPLE_CHUNKS
        mock_r.get_related.return_value = []
        resp = client.post("/api/qa", json={"question": "什么是具身智能"})

    assert resp.status_code == 200
    data = resp.json()
    assert data["insufficient_evidence"] is True


def test_repeated_calls_readonly(client):
    """同一问题重复调用不修改 Neo4j（验证使用的是只读查询）"""
    deepseek_resp = {"answer": "回答。", "insufficient_evidence": False}

    with (
        patch("app.services.qa_service.get_driver"),
        patch("app.services.qa_service.KnowledgeRetriever") as MockRetriever,
        patch("app.clients.deepseek.DeepSeekClient.extract_keywords", new_callable=AsyncMock, return_value=["具身智能"]),
        patch("app.clients.deepseek.DeepSeekClient.generate_answer", new_callable=AsyncMock, return_value=deepseek_resp),
        patch("app.clients.deepseek.DeepSeekClient.close", new_callable=AsyncMock),
    ):
        mock_r = MockRetriever.return_value
        mock_r.search_by_keywords.return_value = SAMPLE_CHUNKS
        mock_r.get_related.return_value = []

        resp1 = client.post("/api/qa", json={"question": "什么是具身智能"})
        resp2 = client.post("/api/qa", json={"question": "什么是具身智能"})

    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert resp1.json()["answer"] == resp2.json()["answer"]


def test_image_paths_converted_to_urls(client):
    """image_paths 应转为可访问的 URL"""
    chunks_with_img = [
        {**SAMPLE_CHUNKS[0], "image_paths": ["data/images/page_0017/p0017_b005_image.jpg"]}
    ]
    deepseek_resp = {"answer": "回答。", "insufficient_evidence": False}

    with (
        patch("app.services.qa_service.get_driver"),
        patch("app.services.qa_service.KnowledgeRetriever") as MockRetriever,
        patch("app.clients.deepseek.DeepSeekClient.extract_keywords", new_callable=AsyncMock, return_value=["具身智能"]),
        patch("app.clients.deepseek.DeepSeekClient.generate_answer", new_callable=AsyncMock, return_value=deepseek_resp),
        patch("app.clients.deepseek.DeepSeekClient.close", new_callable=AsyncMock),
    ):
        mock_r = MockRetriever.return_value
        mock_r.search_by_keywords.return_value = chunks_with_img
        mock_r.get_related.return_value = []
        resp = client.post("/api/qa", json={"question": "什么是具身智能"})

    assert resp.status_code == 200
    urls = resp.json()["citations"][0]["image_urls"]
    assert len(urls) == 1
    assert urls[0] == "/static/images/page_0017/p0017_b005_image.jpg"


def test_question_too_long(client):
    """超长问题应被 schema 拒绝"""
    resp = client.post("/api/qa", json={"question": "A" * 501})
    assert resp.status_code == 422
