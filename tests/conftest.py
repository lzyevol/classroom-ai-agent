from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import app.db.sqlite as sqlite_module
from app.config import settings
from app.db.sqlite import close_db


@pytest.fixture(autouse=True)
def _fake_deepseek_key(monkeypatch):
    """Give every test a harmless model key so the client can be constructed.

    The model endpoint itself is mocked per test; this only satisfies the
    config guard. Tests that exercise the missing-key path override it.
    """
    monkeypatch.setattr(settings, "deepseek_api_key", "sk-test-not-real")


@pytest.fixture
def sqlite_db(tmp_path):
    """Isolate the SQLite runtime database to a scratch file per test."""
    db_path = tmp_path / "classroom_test.db"
    with (
        patch.object(sqlite_module, "DB_PATH", db_path),
        patch.object(sqlite_module, "DEFAULT_DB_PATH", db_path),
    ):
        yield db_path
        close_db()


@pytest.fixture
def client(sqlite_db):
    """TestClient over the real FastAPI app, with Neo4j startup mocked out."""
    with patch("app.main.init_driver"), patch("app.main.close_driver"):
        from app.main import app

        with TestClient(app) as test_client:
            yield test_client
