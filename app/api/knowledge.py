from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.schemas.qa import KnowledgeContextRequest, KnowledgeContextResponse
from app.services.knowledge_context_service import retrieve_knowledge_context

router = APIRouter(prefix="/api")


@router.post("/knowledge/context", response_model=KnowledgeContextResponse)
def post_knowledge_context(request: KnowledgeContextRequest):
    try:
        return retrieve_knowledge_context(request)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logging.getLogger(__name__).exception("Knowledge context endpoint error")
        raise HTTPException(status_code=500, detail="Internal server error") from exc
