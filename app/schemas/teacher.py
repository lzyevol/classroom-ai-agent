from __future__ import annotations

from pydantic import BaseModel

from app.schemas.learning import LearningDashboardResponse


class TeacherClassOverview(BaseModel):
    id: str
    name: str
    course_name: str
    student_count: int
    active_student_count: int
    engaged_student_count: int
    completed_practices: int
    average_score_rate: float
    mistake_count: int
    last_activity_at: str | None = None


class TeacherClassPage(BaseModel):
    items: list[TeacherClassOverview]
    total: int
    page: int
    page_size: int


class TeacherStudentSummary(BaseModel):
    id: str
    username: str
    display_name: str
    is_active: bool
    learned_sections: int
    completed_practices: int
    overall_score_rate: float
    mistake_count: int
    last_activity_at: str | None = None


class TeacherStudentPage(BaseModel):
    items: list[TeacherStudentSummary]
    total: int
    page: int
    page_size: int


class WeakKnowledgePoint(BaseModel):
    knowledge_point: str
    section_key: str
    chapter_title: str
    section_number: str
    section_title: str
    attempts: int
    correct_count: int
    student_count: int
    score_rate: float
    available_question_count: int
    last_practiced_at: str


class WeakKnowledgePage(BaseModel):
    items: list[WeakKnowledgePoint]
    total: int
    page: int
    page_size: int


class ClassSectionMastery(BaseModel):
    section_key: str
    chapter_title: str
    section_number: str
    section_title: str
    attempts: int
    correct_count: int
    student_count: int
    score_rate: float
    available_question_count: int
    last_practiced_at: str | None = None


class ClassSectionMasteryPage(BaseModel):
    items: list[ClassSectionMastery]
    total: int
    page: int
    page_size: int


class TeacherStudentDetail(BaseModel):
    class_id: str
    student: TeacherStudentSummary
    learning: LearningDashboardResponse

