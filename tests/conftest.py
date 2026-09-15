from __future__ import annotations

from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def isolated_audio_cache(tmp_path):
    """Point the TTS cache at a scratch directory for every test.

    The cache is content-addressed and really writes to disk, so without this
    tests both pollute the shared `data/audio` directory and leak into each
    other: two tests synthesizing the same text hash to the same key, and the
    second one silently gets a cache hit instead of exercising its own path.
    """
    from app.services import tts_cache

    with patch.object(tts_cache, "AUDIO_DIR", tmp_path / "audio"):
        yield


@pytest.fixture
def mock_neo4j_driver():
    with patch("app.db.neo4j._driver") as mock_driver:
        mock_driver.session.return_value.__enter__ = MagicMock()
        mock_driver.session.return_value.__exit__ = MagicMock()
        yield mock_driver


@pytest.fixture
def test_app():
    with patch("app.main.init_driver"), patch("app.main.close_driver"):
        from app.main import app
        from app.dependencies import get_current_user

        app.dependency_overrides[get_current_user] = lambda: {
            "id": "demo_student",
            "username": "student",
            "display_name": "演示学生",
            "role": "student",
            "is_active": True,
        }
        try:
            yield app
        finally:
            app.dependency_overrides.clear()


@pytest.fixture
def client(test_app):
    return TestClient(test_app)
