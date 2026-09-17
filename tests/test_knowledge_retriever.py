from __future__ import annotations

from unittest.mock import MagicMock

from app.retrieval.knowledge_retriever import KnowledgeRetriever


def test_search_by_keywords_dedup():
    mock_driver = MagicMock()
    mock_session = MagicMock()
    mock_driver.session.return_value.__enter__ = MagicMock(return_value=mock_session)
    mock_driver.session.return_value.__exit__ = MagicMock(return_value=False)

    mock_session.run.return_value.data.return_value = [
        {"chunk_id": "c1", "entity_id": "e1", "name": "具身智能", "entity_type": "Concept",
         "content_clean": "text", "quote_original": "quote", "citation_label": "label",
         "chapter_title": "ch1", "section_number": "1.1", "section_title": "引言", "image_paths": []},
        {"chunk_id": "c1", "entity_id": "e1", "name": "具身智能", "entity_type": "Concept",
         "content_clean": "text", "quote_original": "quote", "citation_label": "label",
         "chapter_title": "ch1", "section_number": "1.1", "section_title": "引言", "image_paths": []},
    ]

    retriever = KnowledgeRetriever(mock_driver)
    results = retriever.search_by_keywords(["具身智能"])
    assert len(results) == 1


def test_search_multiple_keywords():
    mock_driver = MagicMock()
    mock_session = MagicMock()
    mock_driver.session.return_value.__enter__ = MagicMock(return_value=mock_session)
    mock_driver.session.return_value.__exit__ = MagicMock(return_value=False)

    mock_session.run.return_value.data.return_value = [
        {"chunk_id": "c1", "entity_id": "e1", "name": "A", "entity_type": "Concept",
         "content_clean": "t", "quote_original": "q", "citation_label": "l",
         "chapter_title": "ch", "section_number": "1.1", "section_title": "s", "image_paths": []},
    ]

    retriever = KnowledgeRetriever(mock_driver)
    results = retriever.search_by_keywords(["具身智能", "莫拉维克"], limit=5)
    assert len(results) >= 1
    assert mock_session.run.call_count >= 1


def test_definition_question_prioritizes_definition_chunk():
    mock_driver = MagicMock()
    mock_session = MagicMock()
    mock_driver.session.return_value.__enter__ = MagicMock(return_value=mock_session)
    mock_driver.session.return_value.__exit__ = MagicMock(return_value=False)
    mock_session.run.return_value.data.return_value = [
        {
            "chunk_id": "book:6.1:chunk-001",
            "entity_id": "e1",
            "name": "具身智能",
            "aliases": [],
            "entity_type": "Concept",
            "content_clean": "具身智能体需要进行结构化形态控制。",
            "quote_original": "具身智能体都是具有特定形态的智能体。",
            "citation_label": "第6章 6.1",
            "chapter_title": "结构化形态控制",
            "section_number": "6.1",
            "section_title": "引言",
            "image_paths": [],
            "entity_match_score": 4,
        },
        {
            "chunk_id": "book:1.1:chunk-001",
            "entity_id": "e1",
            "name": "具身智能",
            "aliases": [],
            "entity_type": "Concept",
            "content_clean": "具身智能，顾名思义就是具备了身体的智能，其核心含义是身体会影响认知。",
            "quote_original": "具身智能，顾名思义就是具备了身体的智能。",
            "citation_label": "第1章 1.1",
            "chapter_title": "具身智能概述",
            "section_number": "1.1",
            "section_title": "引言",
            "image_paths": [],
            "entity_match_score": 4,
        },
    ]

    retriever = KnowledgeRetriever(mock_driver)
    results = retriever.search_by_keywords(
        ["具身智能"],
        limit=2,
        question="什么是具身智能？",
    )

    assert results[0]["chunk_id"] == "book:1.1:chunk-001"


def test_get_related_empty():
    mock_driver = MagicMock()
    retriever = KnowledgeRetriever(mock_driver)
    assert retriever.get_related([]) == []
