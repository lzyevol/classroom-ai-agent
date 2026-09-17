from __future__ import annotations

from pydantic import BaseModel, Field


class SlideImage(BaseModel):
    src: str
    caption: str = ""


class SlideQuiz(BaseModel):
    stem: str
    opts: list[str]
    answer: int = Field(ge=0, le=3)
    pass_msg: str = Field(alias="pass", default="回答正确！")
    fail_msg: str = Field(alias="fail", default="再想想。")

    model_config = {"populate_by_name": True}


class Slide(BaseModel):
    slide_id: str
    order: int
    title: str
    subtitle: str = ""
    bullets: list[str] = Field(default_factory=list)
    narration: str = ""
    cite: str = ""
    image: SlideImage | None = None
    quote: str | None = None
    layout: str | None = None
    compare: list[dict] | dict | None = None
    quiz: SlideQuiz | None = None


class LessonResponse(BaseModel):
    section_key: str
    chapter_title: str = ""
    section_title: str = ""
    slides: list[Slide]
    generated_at: str
    cached: bool = False
    status: str = "generated"


class LessonGenerateRequest(BaseModel):
    section_key: str
    force_regenerate: bool = False


class LessonListItem(BaseModel):
    section_key: str
    section_title: str
    chapter_title: str
    slide_count: int
    generated_at: str
    status: str
