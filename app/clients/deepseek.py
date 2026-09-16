from __future__ import annotations

import json
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

KEYWORD_EXTRACT_PROMPT = (
    "结合最近对话，从当前学生问题中提取需要检索的教材知识点名称（中文）。"
    "代词或省略表达必须根据最近对话还原，例如“它有什么优点”要还原出“它”指代的知识点。"
    '只返回 JSON 对象，例如 {{"keywords": ["具身智能", "SLAM"]}}。'
    '如果提取不到有效知识点，返回 {{"keywords": []}}。'
    "\n\n最近对话：\n{history}\n\n当前学生问题：{question}"
)


class DeepSeekClient:
    def __init__(self, api_key: str, base_url: str, model: str):
        self.client = httpx.AsyncClient(
            base_url=base_url,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=httpx.Timeout(connect=5.0, read=30.0, write=5.0, pool=5.0),
        )
        self.model = model

    async def generate_answer(
        self,
        system_prompt: str,
        question: str,
        history: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
        messages.extend((history or [])[-8:])
        messages.append({"role": "user", "content": question})
        payload = {
            "model": self.model,
            "messages": messages,
            "response_format": {"type": "json_object"},
            "temperature": 0.3,
        }
        for attempt in range(3):
            try:
                resp = await self.client.post("/chat/completions", json=payload)
                resp.raise_for_status()
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
                return json.loads(content)
            except (httpx.TimeoutException, httpx.HTTPStatusError) as e:
                if attempt < 2:
                    continue
                logger.warning("DeepSeek failed after retries: %s", type(e).__name__)
                return {"answer": "AI 服务暂时不可用，请稍后再试。", "insufficient_evidence": True}
            except (json.JSONDecodeError, KeyError):
                return {"answer": "AI 返回格式异常，请稍后再试。", "insufficient_evidence": True}

    async def generate_json(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        temperature: float = 0.2,
        read_timeout: float = 60.0,
    ) -> dict[str, Any]:
        """Run a structured JSON request and surface a user-safe failure."""
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "response_format": {"type": "json_object"},
            "temperature": temperature,
        }
        timeout = httpx.Timeout(
            connect=5.0,
            read=read_timeout,
            write=10.0,
            pool=5.0,
        )
        for attempt in range(3):
            try:
                resp = await self.client.post(
                    "/chat/completions",
                    json=payload,
                    timeout=timeout,
                )
                resp.raise_for_status()
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
                result = json.loads(content)
                if not isinstance(result, dict):
                    raise ValueError("structured response is not an object")
                return result
            except (httpx.TimeoutException, httpx.HTTPStatusError) as exc:
                if attempt < 2:
                    continue
                logger.warning(
                    "DeepSeek structured request failed after retries: %s",
                    type(exc).__name__,
                )
                raise RuntimeError("AI 服务暂时不可用，请稍后再试") from exc
            except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
                logger.warning("DeepSeek returned invalid structured JSON")
                raise RuntimeError("AI 返回格式异常，请稍后再试") from exc

    async def extract_keywords(
        self,
        question: str,
        history: list[dict[str, str]] | None = None,
    ) -> list[str]:
        history_text = "\n".join(
            f"{'学生' if item['role'] == 'user' else '助手'}：{item['content']}"
            for item in (history or [])[-6:]
        ) or "无"
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "user",
                    "content": KEYWORD_EXTRACT_PROMPT.format(
                        history=history_text,
                        question=question,
                    ),
                },
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.1,
        }
        try:
            resp = await self.client.post("/chat/completions", json=payload)
            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            result = json.loads(content)
            if isinstance(result, list):
                return result
            if isinstance(result, dict):
                return result.get("keywords", [])
            return []
        except Exception:
            return []

    async def close(self):
        await self.client.aclose()
