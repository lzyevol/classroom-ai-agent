from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.practice import Difficulty, PracticeSessionResponse, QuestionType


class AssignmentCreateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    section_key: str = Field(..., min_length=1, max_length=200)
    chapter_title: str = Field(default="", max_length=200)
    section_number: str = Field(default="", max_length=50)
    section_title: str = Field(..., min_length=1, max_length=200)
    knowledge_point: str = Field(default="", max_length=100)
    difficulty: Difficulty = "medium"
    question_types: list[QuestionType] = Field(
        default_factory=lambda: ["single_choice", "true_false"],
        min_length=1,
        max_length=3,
    )
    question_count: int = Field(default=5, ge=1, le=10)
    due_at: datetime | None = None

    @field_validator("question_types")
    @classmethod
    def unique_question_types(cls, value: list[QuestionType]) -> list[QuestionType]:
        return list(dict.fromkeys(value))


class AssignmentProgress(BaseModel):
    student_id: str
    username: str
    display_name: str
    status: Literal["assigned", "in_progress", "completed"]
    baseline_score_rate: float
    baseline_attempts: int
    practice_session_id: str | None = None
    assigned_at: str
    started_at: str | None = None
    completed_at: str | None = None
    post_score_rate: float | None = None
    improvement: float | None = None
    practice_score_rate: float | None = None
    actual_question_count: int | None = None


class AssignmentSummary(BaseModel):
    id: str
    class_id: str
    teacher_id: str
    title: str
    description: str
    section_key: str
    chapter_title: str
    section_number: str
    section_title: str
    knowledge_point: str
    difficulty: Difficulty
    question_types: list[QuestionType]
    question_count: int
    due_at: str | None = None
    status: Literal["active", "closed"]
    created_at: str
    closed_at: str | None = None
    total_students: int
    assigned_students: int
    in_progress_students: int
    completed_students: int
    completion_rate: float
    baseline_average: float
    post_average: float | None = None
    average_improvement: float | None = None
    average_practice_score: float | None = None
    actual_question_count: int | None = None


class AssignmentDetail(AssignmentSummary):
    students: list[AssignmentProgress]


class AssignmentPage(BaseModel):
    items: list[AssignmentSummary]
    total: int
    page: int
    page_size: int


class StudentAssignment(BaseModel):
    id: str
    title: str
    description: str
    class_name: str
    section_key: str
    section_number: str
    section_title: str
    knowledge_point: str
    difficulty: Difficulty
    question_types: list[QuestionType]
    question_count: int
    due_at: str | None = None
    assignment_status: Literal["active", "closed"]
    progress_status: Literal["assigned", "in_progress", "completed"]
    baseline_score_rate: float
    post_score_rate: float | None = None
    improvement: float | None = None
    practice_session_id: str | None = None
    completed_at: str | None = None
    practice_score_rate: float | None = None
    actual_question_count: int | None = None


class StudentAssignmentPage(BaseModel):
    items: list[StudentAssignment]
    total: int


class AssignmentStartResponse(PracticeSessionResponse):
    assignment_id: str
