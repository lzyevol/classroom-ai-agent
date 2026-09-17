from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.clients.deepseek import DeepSeekClient, DeepSeekConfigError

BASE_URL = "https://api.deepseek.com"
MODEL = "deepseek-v4-flash"


class _FakeResponse:
    """Minimal httpx.Response stand-in with controllable json() behavior."""

    def __init__(self, *, content: str | None = None, json_error: Exception | None = None):
        self._content = content
        self._json_error = json_error

    def raise_for_status(self) -> None:
        return None

    def json(self):
        if self._json_error is not None:
            raise self._json_error
        if self._content is None:
            raise json.JSONDecodeError("missing content", "", 0)
        return {"choices": [{"message": {"content": self._content}}]}


def test_empty_api_key_raises_config_error():
    with pytest.raises(DeepSeekConfigError, match="DEEPSEEK_API_KEY"):
        DeepSeekClient("", BASE_URL, MODEL)


def test_blank_api_key_raises_config_error():
    with pytest.raises(DeepSeekConfigError, match="DEEPSEEK_API_KEY"):
        DeepSeekClient("   \t", BASE_URL, MODEL)


def test_config_error_message_is_locatable():
    with pytest.raises(DeepSeekConfigError) as exc_info:
        DeepSeekClient("", BASE_URL, MODEL)
    message = str(exc_info.value)
    assert "DEEPSEEK_API_KEY" in message
    assert ".env" in message or "环境变量" in message


def test_valid_key_sets_bearer_header():
    client = DeepSeekClient("sk-test-123", BASE_URL, MODEL)
    assert client.client.headers["Authorization"] == "Bearer sk-test-123"


@pytest.mark.asyncio
async def test_generate_answer_timeout_raises_after_retries():
    client = DeepSeekClient("sk-test-123", BASE_URL, MODEL)
    try:
        with patch.object(
            client.client,
            "post",
            new_callable=AsyncMock,
            side_effect=httpx.TimeoutException("read timeout"),
        ) as mock_post:
            with pytest.raises(RuntimeError, match="AI 服务暂时不可用"):
                await client.generate_answer("system", "问题")
        assert mock_post.await_count == 3
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_generate_answer_http_error_raises():
    client = DeepSeekClient("sk-test-123", BASE_URL, MODEL)
    try:
        request = httpx.Request("POST", f"{BASE_URL}/chat/completions")
        response = httpx.Response(500, request=request)
        error = httpx.HTTPStatusError(
            "500 Server Error", request=request, response=response
        )
        with patch.object(
            client.client, "post", new_callable=AsyncMock, side_effect=error
        ):
            with pytest.raises(RuntimeError, match="AI 服务暂时不可用"):
                await client.generate_answer("system", "问题")
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_generate_answer_invalid_json_raises_format_error():
    client = DeepSeekClient("sk-test-123", BASE_URL, MODEL)
    try:
        with patch.object(
            client.client,
            "post",
            new_callable=AsyncMock,
            return_value=_FakeResponse(
                json_error=json.JSONDecodeError("bad payload", "", 0)
            ),
        ):
            with pytest.raises(RuntimeError, match="AI 返回格式异常"):
                await client.generate_answer("system", "问题")
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_generate_answer_non_object_json_raises_format_error():
    client = DeepSeekClient("sk-test-123", BASE_URL, MODEL)
    try:
        with patch.object(
            client.client,
            "post",
            new_callable=AsyncMock,
            return_value=_FakeResponse(content="[1, 2, 3]"),
        ):
            with pytest.raises(RuntimeError, match="AI 返回格式异常"):
                await client.generate_answer("system", "问题")
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_generate_answer_success_returns_dict():
    client = DeepSeekClient("sk-test-123", BASE_URL, MODEL)
    try:
        payload = json.dumps(
            {"answer": "具身智能是具备了身体的智能。", "insufficient_evidence": False},
            ensure_ascii=False,
        )
        with patch.object(
            client.client,
            "post",
            new_callable=AsyncMock,
            return_value=_FakeResponse(content=payload),
        ):
            result = await client.generate_answer("system", "什么是具身智能？")
        assert result["answer"] == "具身智能是具备了身体的智能。"
        assert result["insufficient_evidence"] is False
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_extract_keywords_failure_is_best_effort():
    client = DeepSeekClient("sk-test-123", BASE_URL, MODEL)
    try:
        with patch.object(
            client.client,
            "post",
            new_callable=AsyncMock,
            side_effect=httpx.TimeoutException("timeout"),
        ):
            assert await client.extract_keywords("问题") == []
    finally:
        await client.close()
