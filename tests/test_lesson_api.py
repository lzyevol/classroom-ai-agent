from __future__ import annotations

from unittest.mock import AsyncMock, patch


LESSON = {
    "section_key": "book:1.1",
    "chapter_title": "具身智能概述",
    "section_title": "引言",
    "slides": [
        {
            "slide_id": "slide-001",
            "order": 1,
            "title": "什么是具身智能",
            "bullets": ["身体与环境交互会影响智能形成。"],
        }
    ],
    "generated_at": "2026-07-23T00:00:00+00:00",
    "cached": True,
    "status": "generated",
}


def test_list_lessons(client):
    with patch(
        "app.api.lesson.list_lessons",
        return_value=[
            {
                "section_key": "book:1.1",
                "section_title": "引言",
                "chapter_title": "具身智能概述",
                "slide_count": 1,
                "generated_at": "2026-07-23T00:00:00+00:00",
                "status": "generated",
            }
        ],
    ):
        response = client.get("/api/lesson/list")

    assert response.status_code == 200
    assert response.json()[0]["slide_count"] == 1


def test_get_cached_lesson(client):
    with patch("app.api.lesson.get_cached_lesson", return_value=LESSON):
        response = client.get("/api/lesson/book:1.1")

    assert response.status_code == 200
    assert response.json()["slides"][0]["title"] == "什么是具身智能"


def test_get_missing_lesson(client):
    with patch("app.api.lesson.get_cached_lesson", return_value=None):
        response = client.get("/api/lesson/book:9.9")

    assert response.status_code == 404


def test_generate_lesson(client):
    with patch(
        "app.api.lesson.generate_lesson",
        new_callable=AsyncMock,
        return_value={**LESSON, "cached": False},
    ) as generate:
        response = client.post(
            "/api/lesson/generate",
            json={"section_key": "book:1.1", "force_regenerate": True},
        )

    assert response.status_code == 200
    assert response.json()["cached"] is False
    generate.assert_awaited_once_with("book:1.1", True)


def test_generate_lesson_dependency_failure(client):
    with patch(
        "app.api.lesson.generate_lesson",
        new_callable=AsyncMock,
        side_effect=RuntimeError("课程数据库暂时不可用"),
    ):
        response = client.post(
            "/api/lesson/generate",
            json={"section_key": "book:1.1"},
        )

    assert response.status_code == 503
    assert response.json()["detail"] == "课程数据库暂时不可用"
