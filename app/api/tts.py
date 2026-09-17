from __future__ import annotations

import logging
from typing import Literal

import edge_tts
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
import httpx

from app.config import settings
from app.services import tts_cache

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/tts")

DASHSCOPE_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
EDGE_VOICES = {
    "zh-CN-XiaoxiaoNeural",
    "zh-CN-XiaoyiNeural",
    "zh-CN-YunxiNeural",
    "zh-CN-YunjianNeural",
    "zh-CN-YunyangNeural",
}

# Cached files are content-addressed, so their bytes can never change.
IMMUTABLE_CACHE = "public, max-age=31536000, immutable"


class TTSRequest(BaseModel):
    text: str
    voice: str = "Cherry"
    rate: int = 0
    provider: Literal["qwen", "edge"] = "qwen"


class TTSResolveRequest(BaseModel):
    """Ask which of many narrations are already cached, in one round trip."""

    texts: list[str] = Field(..., min_length=1, max_length=64)
    voice: str = "Cherry"
    rate: int = 0
    provider: Literal["qwen", "edge"] = "qwen"


def _edge_rate(rate: int) -> str:
    # The frontend uses -500..500 for a -100%..100% speed range.
    return f"{max(-100, min(100, round(rate / 5))):+d}%"


async def synthesize_edge(text: str, voice: str, rate: int) -> tuple[bytes, str]:
    if voice not in EDGE_VOICES:
        raise HTTPException(status_code=400, detail="不支持的 Edge TTS 音色")

    try:
        communicate = edge_tts.Communicate(text, voice=voice, rate=_edge_rate(rate))
        audio = bytearray()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio.extend(chunk["data"])
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Edge TTS 服务暂时不可用") from exc

    if not audio:
        raise HTTPException(status_code=502, detail="Edge TTS 未返回音频")
    return bytes(audio), "audio/mpeg"


async def synthesize_qwen(text: str, voice: str, rate: int) -> tuple[bytes, str]:
    api_key = settings.qwen_tts_api_key
    if not api_key:
        raise HTTPException(status_code=503, detail="TTS API Key 未配置")

    payload = {
        "model": "qwen3-tts-flash",
        "input": {"text": text, "voice": voice, "language_type": "Chinese"},
        "parameters": {"rate": rate},
    }
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            DASHSCOPE_URL,
            json=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json; charset=utf-8",
            },
        )
        if response.status_code != 200:
            raise HTTPException(
                status_code=502, detail=f"TTS 服务错误: {response.text[:200]}"
            )
        audio_url = response.json().get("output", {}).get("audio", {}).get("url")
        if not audio_url:
            raise HTTPException(status_code=502, detail="TTS 未返回音频")

        audio_response = await client.get(audio_url)

    if audio_response.status_code != 200:
        raise HTTPException(status_code=502, detail="音频下载失败")
    return audio_response.content, "audio/wav"


async def synthesize_cached(request: TTSRequest) -> tuple[str, bytes, str]:
    """Synthesize unless the shared cache already holds this exact audio."""
    key = tts_cache.cache_key(
        request.text,
        provider=request.provider,
        voice=request.voice,
        rate=request.rate,
    )
    hit = tts_cache.find(key)
    if hit:
        path, media_type = hit
        return key, path.read_bytes(), media_type

    if request.provider == "edge":
        audio, media_type = await synthesize_edge(
            request.text, request.voice, request.rate
        )
    else:
        audio, media_type = await synthesize_qwen(
            request.text, request.voice, request.rate
        )
    tts_cache.store(key, audio, media_type)
    return key, audio, media_type


@router.post("/resolve")
def resolve(request: TTSResolveRequest):
    """Report the cache key and hit state for a batch of narrations."""
    items = []
    for text in request.texts:
        key = tts_cache.cache_key(
            text,
            provider=request.provider,
            voice=request.voice,
            rate=request.rate,
        )
        items.append({"key": key, "cached": tts_cache.find(key) is not None})
    return {"items": items}


@router.get("/cached/{key}")
def get_cached(key: str):
    """Serve pre-generated audio straight off disk."""
    if not key.isalnum():
        raise HTTPException(status_code=400, detail="无效的音频标识")
    hit = tts_cache.find(key)
    if not hit:
        raise HTTPException(status_code=404, detail="音频尚未生成")
    path, media_type = hit
    return FileResponse(
        path,
        media_type=media_type,
        headers={"Cache-Control": IMMUTABLE_CACHE},
    )


@router.post("")
async def synthesize(request: TTSRequest):
    key, audio, media_type = await synthesize_cached(request)
    return Response(
        content=audio,
        media_type=media_type,
        headers={
            "Cache-Control": IMMUTABLE_CACHE,
            # Lets the frontend reuse the shared URL on later visits.
            "X-Audio-Key": key,
        },
    )
