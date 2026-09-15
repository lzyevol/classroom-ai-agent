from __future__ import annotations

import logging

from redis.asyncio import Redis

logger = logging.getLogger(__name__)

_client: Redis | None = None


def init_client(url: str) -> Redis:
    """Create the shared Redis client. Connectivity is verified lazily."""
    global _client
    _client = Redis.from_url(url, decode_responses=True)
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def get_client() -> Redis:
    if _client is None:
        raise RuntimeError("Redis client not initialized")
    return _client


async def health_check() -> bool:
    """Report whether Redis answers PING, without raising on failure."""
    try:
        return bool(await get_client().ping())
    except Exception as exc:
        logger.warning("Redis health check failed: %s", type(exc).__name__)
        return False
