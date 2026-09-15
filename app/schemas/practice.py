from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


QuestionType = Literal["single_choice", "true_false", "short_answer"]
Difficulty = Literal["easy", "medium", "hard"]


class PracticeCitation(BaseModel):
    chunk_id: str
    book: str = "具身智能导论"
    chapter_title: str
    section_number: str
    section_title: str
    quote: str


class PracticeGenerateRequest(BaseModel):
    section_key: str = Field(..., min_length=1, max_length=200)
    question_types: list[QuestionType] = Field(
        default_factory=lambda: ["single_choice", "true_false", "short_answer"],
        min_length=1,
        max_length=3,
    )
    difficulty: Difficulty = "medium"
    question_count: int = Field(default=5, ge=1, le=10)
    knowledge_point: str | None = Field(default=None, max_length=100)

    @field_validator("question_types")
    @classmethod
    def unique_question_types(cls, value: list[QuestionType]) -> list[QuestionType]:
        return list(dict.fromkeys(value))


class PracticeQuestion(BaseModel):
    id: str
    type: QuestionType
    stem: str
    options: list[str] = Field(default_factory=list)
    difficulty: Difficulty
    knowledge_point: str
    max_score: float


class PracticeSessionResponse(BaseModel):
    session_id: str
    section_key: str
    chapter_title: str
    section_number: str
    section_title: str
    difficulty: Difficulty
    status: Literal["active", "submitted"]
    created_at: str
    questions: list[PracticeQuestion]


class PracticeAnswer(BaseModel):
    question_id: str = Field(..., min_length=1)
    answer: str | bool


class PracticeSubmitRequest(BaseModel):
    answers: list[PracticeAnswer] = Field(..., min_length=1, max_length=10)

    @field_validator("answers")
    @classmethod
    def unique_question_answers(cls, value: list[PracticeAnswer]) -> list[PracticeAnswer]:
        question_ids = [item.question_id for item in value]
        if len(question_ids) != len(set(question_ids)):
            raise ValueError("同一道题不能重复提交答案")
        return value


class PracticeQuestionResult(BaseModel):
    question_id: str
    type: QuestionType
    stem: str
    options: list[str] = Field(default_factory=list)
    answer: str | bool
    correct_answer: str | bool
    score: float
    max_score: float
    is_correct: bool
    analysis: str
    feedback: str
    covered_points: list[str] = Field(default_factory=list)
    missing_points: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    review_required: bool = False
    knowledge_point: str
    citation: PracticeCitation


class PracticeSubmitResponse(BaseModel):
    session_id: str
    status: Literal["submitted"] = "submitted"
    total_score: float
    max_score: float
    correct_count: int
    question_count: int
    submitted_at: str
    results: list[PracticeQuestionResult]
