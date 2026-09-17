from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.db.neo4j import get_driver
from app.schemas.course import TocItem, SectionDetail
from app.services.course_service import CourseService

router = APIRouter(prefix="/api/course")


@router.get("/toc", response_model=list[TocItem])
def get_toc():
    driver = get_driver()
    service = CourseService(driver)
    return service.get_toc()


@router.get("/section/{key:path}", response_model=SectionDetail)
def get_section(key: str):
    driver = get_driver()
    service = CourseService(driver)
    result = service.get_section(key)
    if result is None:
        raise HTTPException(status_code=404, detail="Section not found")
    return result
