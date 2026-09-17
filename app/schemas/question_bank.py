from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.practice import Difficulty, QuestionType


class RubricPoint(BaseModel):
    """One scoring criterion for a short-answer question.

    Any non-negative weight is accepted; the service rescales the set to sum to
    1.0 so teachers can think in raw points (e.g. 3 and 1) instead of fractions.
    """

    point: str = Field(..., min_length=1, max_length=300)
    weight: float = Field(..., ge=0, le=100)


class BankQuestion(BaseModel):
    """A bank question as teachers see it: answers and rubric included."""

    id: str
    section_key: str
    chapter_title: str = ""
    section_number: str = ""
    section_title: str = ""
    type: QuestionType
    stem: str
    options: list[str] = Field(default_factory=list)
    correct_answer: Any | None = None
    analysis: str = ""
    rubric: list[dict[str, Any]] = Field(default_factory=list)
    difficulty: Difficulty
    knowledge_point: str = ""
    source_chunk_id: str = ""
    citation: dict[str, Any] | None = None
    status: str = "active"
    created_at: str
    updated_at: str | None = None
    replaced_from: str | None = None


class BankQuestionPage(BaseModel):
    section_key: str
    questions: list[BankQuestion]
    active_count: int = 0
    archived_count: int = 0


class QuestionBankGenerateRequest(BaseModel):
    """Generation parameters; section_key comes from the path."""

    question_types: list[QuestionType] = Field(
        default_factory=lambda: ["single_choice", "true_false", "short_answer"],
        min_length=1,
        max_length=3,
    )
    difficulty: Difficulty = "medium"
    question_count: int = Field(default=5, ge=1, le=10)
    knowledge_point: str | None = Field(default=None, max_length=100)
    mixed_difficulty: bool = False

    @field_validator("question_types")
    @classmethod
    def unique_question_types(cls, value: list[QuestionType]) -> list[QuestionType]:
        return list(dict.fromkeys(value))


class QuestionBankGenerateResult(BaseModel):
    """Returned as the job result once generation settles."""

    section_key: str
    chapter_title: str = ""
    section_number: str = ""
    section_title: str = ""
    generated_count: int = 0
    inserted_count: int = 0
    skipped_count: int = 0


class QuestionUpdateRequest(BaseModel):
    """Partial edit; omitted fields keep their stored value."""

    stem: str | None = Field(default=None, min_length=1, max_length=1000)
    options: list[str] | None = Field(default=None, max_length=8)
    correct_answer: Any | None = None
    analysis: str | None = Field(default=None, max_length=2000)
    rubric: list[RubricPoint] | None = Field(default=None, max_length=10)
    difficulty: Difficulty | None = None
    knowledge_point: str | None = Field(default=None, max_length=100)
