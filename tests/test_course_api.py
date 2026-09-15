from __future__ import annotations

from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    with patch("app.main.init_driver"), patch("app.main.close_driver"):
        from app.main import app
        yield TestClient(app)


MOCK_TOC = [
    {"section_key": "book:1.1", "chapter_number": 1, "chapter_title": "具身智能概述",
     "section_number": "1.1", "section_title": "引言"},
    {"section_key": "book:1.2", "chapter_number": 1, "chapter_title": "具身智能概述",
     "section_number": "1.2", "section_title": "具身智能简史"},
]

MOCK_SECTION_CHUNKS = [
    {"chunk_id": "book:1.1:chunk-001", "quote_original": "原文第一段",
     "content_type": "core", "image_paths": ["data/images/page_0017/p0017.jpg"],
     "chapter_title": "具身智能概述", "section_number": "1.1", "section_title": "引言",
     "entities": [{"id": "e1", "name": "具身智能"}]},
    {"chunk_id": "book:1.1:chunk-002", "quote_original": "原文第二段",
     "content_type": "core", "image_paths": [],
     "chapter_title": "具身智能概述", "section_number": "1.1", "section_title": "引言",
     "entities": [{"id": None, "name": None}]},
]


def test_toc(client):
    mock_driver = MagicMock()
    mock_session = MagicMock()
    mock_driver.session.return_value.__enter__ = MagicMock(return_value=mock_session)
    mock_driver.session.return_value.__exit__ = MagicMock(return_value=False)
    mock_session.run.return_value.data.return_value = MOCK_TOC

    with patch("app.api.course.get_driver", return_value=mock_driver):
        resp = client.get("/api/course/toc")

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert data[0]["section_key"] == "book:1.1"
    assert data[0]["chapter_title"] == "具身智能概述"


def test_section_detail(client):
    mock_driver = MagicMock()
    mock_session = MagicMock()
    mock_driver.session.return_value.__enter__ = MagicMock(return_value=mock_session)
    mock_driver.session.return_value.__exit__ = MagicMock(return_value=False)
    mock_session.run.return_value.data.return_value = MOCK_SECTION_CHUNKS

    with patch("app.api.course.get_driver", return_value=mock_driver):
        resp = client.get("/api/course/section/book:1.1")

    assert resp.status_code == 200
    data = resp.json()
    assert data["section_key"] == "book:1.1"
    assert data["chapter_title"] == "具身智能概述"
    assert data["section_number"] == "1.1"
    assert data["section_title"] == "引言"
    assert len(data["chunks"]) == 2
    assert data["chunks"][0]["quote_original"] == "原文第一段"
    assert data["chunks"][0]["image_urls"] == ["/static/images/page_0017/p0017.jpg"]
    assert data["chunks"][0]["entities"][0]["name"] == "具身智能"
    # null entities filtered out
    assert len(data["chunks"][1]["entities"]) == 0


def test_section_not_found(client):
    mock_driver = MagicMock()
    mock_session = MagicMock()
    mock_driver.session.return_value.__enter__ = MagicMock(return_value=mock_session)
    mock_driver.session.return_value.__exit__ = MagicMock(return_value=False)
    mock_session.run.return_value.data.return_value = []

    with patch("app.api.course.get_driver", return_value=mock_driver):
        resp = client.get("/api/course/section/book:99.99")

    assert resp.status_code == 404
