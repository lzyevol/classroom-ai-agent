from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.db.neo4j import health_check
from app.db.redis import health_check as redis_health_check

router = APIRouter()


@router.get("/health")
async def get_health():
    try:
        health_check()
    except Exception:
        raise HTTPException(status_code=503, detail="Neo4j unavailable")
    # Redis only backs async job state, so a miss degrades rather than fails.
    redis_ok = await redis_health_check()
    return {
        "status": "ok",
        "neo4j": "connected",
        "redis": "connected" if redis_ok else "unavailable",
    }
