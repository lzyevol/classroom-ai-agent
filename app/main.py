from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.db.neo4j import init_driver, close_driver
from app.db.redis import init_client, close_client
from app.db.sqlite import get_db, close_db
from app.api.health import router as health_router
from app.api.qa import router as qa_router
from app.api.knowledge import router as knowledge_router
from app.api.course import router as course_router
from app.api.lesson import router as lesson_router
from app.api.tts import router as tts_router
from app.api.practice import router as practice_router
from app.api.learning import router as learning_router
from app.api.auth import router as auth_router
from app.api.admin import router as admin_router
from app.api.teacher import router as teacher_router
from app.api.jobs import router as jobs_router
from app.api.questions import router as questions_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_driver(
        settings.neo4j_uri,
        settings.neo4j_username,
        settings.neo4j_password,
    )
    init_client(settings.redis_url)
    get_db()
    yield
    close_driver()
    await close_client()
    close_db()


app = FastAPI(title="具身智能课程教学智能体", lifespan=lifespan)

app.include_router(health_router)
app.include_router(qa_router)
app.include_router(knowledge_router)
app.include_router(course_router)
app.include_router(lesson_router)
app.include_router(tts_router)
app.include_router(practice_router)
app.include_router(learning_router)
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(teacher_router)
app.include_router(jobs_router)
app.include_router(questions_router)

images_dir = Path(__file__).resolve().parent.parent / "data" / "images"
if images_dir.exists():
    app.mount("/static/images", StaticFiles(directory=str(images_dir)), name="images")
