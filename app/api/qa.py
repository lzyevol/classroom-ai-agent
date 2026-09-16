from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas.qa import QARequest, QAResponse
from app.services.qa_service import answer_question

router = APIRouter(prefix="/api")


@router.post("/qa", response_model=QAResponse)
async def post_qa(request: QARequest):
    try:
        return await answer_question(request)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        import logging
        logging.getLogger(__name__).exception("QA endpoint error")
        raise HTTPException(status_code=500, detail="Internal server error")
