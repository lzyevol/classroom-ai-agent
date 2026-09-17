from __future__ import annotations

from unittest.mock import patch


class FakeResponse:
    def __init__(
        self,
        *,
        status_code: int = 200,
        json_data: dict | None = None,
        content: bytes = b"",
        text: str = "",
    ):
        self.status_code = status_code
        self._json_data = json_data or {}
        self.content = content
        self.text = text

    def json(self) -> dict:
        return self._json_data


class FakeAsyncClient:
    responses: list[FakeResponse] = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, *args, **kwargs):
        return self.responses.pop(0)

    async def get(self, *args, **kwargs):
        return self.responses.pop(0)


class FakeEdgeCommunicate:
    def __init__(self, text, *, voice, rate):
        self.text = text
        self.voice = voice
        self.rate = rate

    async def stream(self):
        yield {"type": "audio", "data": b"ID3-edge-audio"}


def test_tts_requires_server_key(client):
    with patch("app.api.tts.settings.qwen_tts_api_key", ""):
        response = client.post("/api/tts", json={"text": "你好"})

    assert response.status_code == 503
    assert "API Key" in response.json()["detail"]


def test_tts_returns_audio(client):
    FakeAsyncClient.responses = [
        FakeResponse(
            json_data={"output": {"audio": {"url": "https://audio.example/test.wav"}}}
        ),
        FakeResponse(content=b"RIFF-test-audio"),
    ]
    with (
        patch("app.api.tts.settings.qwen_tts_api_key", "server-test-key"),
        patch("app.api.tts.httpx.AsyncClient", FakeAsyncClient),
    ):
        response = client.post(
            "/api/tts",
            json={"text": "你好", "voice": "Cherry", "rate": 0},
        )

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.content == b"RIFF-test-audio"


def test_tts_upstream_error_is_bounded(client):
    FakeAsyncClient.responses = [
        FakeResponse(status_code=500, text="upstream failure with private details")
    ]
    with (
        patch("app.api.tts.settings.qwen_tts_api_key", "server-test-key"),
        patch("app.api.tts.httpx.AsyncClient", FakeAsyncClient),
    ):
        response = client.post("/api/tts", json={"text": "你好"})

    assert response.status_code == 502
    assert "server-test-key" not in response.text


def test_edge_tts_returns_audio_without_api_key(client):
    with patch("app.api.tts.edge_tts.Communicate", FakeEdgeCommunicate):
        response = client.post(
            "/api/tts",
            json={
                "provider": "edge",
                "text": "你好",
                "voice": "zh-CN-XiaoxiaoNeural",
                "rate": 100,
            },
        )

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.content == b"ID3-edge-audio"
