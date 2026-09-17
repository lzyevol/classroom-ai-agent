from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.practice import PracticeCitation, QuestionType


MasteryLevel = Literal["needs_review", "developing", "mastered"]
RecommendationType = Literal[
    "start_learning",
    "continue_learning",
    "review_knowledge",
    "retry_mistakes",
    "next_section",
]


class SectionAccessRequest(BaseModel):
    section_key: str = Field(..., min_length=1, max_length=200)
    chapter_title: str = Field(..., min_length=1, max_length=200)
    section_number: str = Field(..., min_length=1, max_length=50)
    section_title: str = Field(..., min_length=1, max_length=200)


class SectionAccessResponse(BaseModel):
    user_id: str
    section_key: str
    access_count: int
    first_accessed_at: str
    last_accessed_at: str


class LearningSummary(BaseModel):
    learned_sections: int
    completed_practices: int
    answered_questions: int
    correct_questions: int
    overall_accuracy: float
    overall_score_rate: float
    mistake_count: int
    last_activity_at: str | None = None


class CourseLearningRecord(BaseModel):
    section_key: str
    chapter_title: str
    section_number: str
    section_title: str
    access_count: int
    first_accessed_at: str
    last_accessed_at: str


class SectionMastery(BaseModel):
    section_key: str
    chapter_title: str
    section_number: str
    section_title: str
    practice_count: int
    answered_questions: int
    correct_questions: int
    accuracy: float
    score_rate: float
    mastery_level: MasteryLevel
    last_practiced_at: str


class KnowledgeMastery(BaseModel):
    knowledge_point: str
    section_key: str
    chapter_title: str
    section_number: str
    section_title: str
    attempts: int
    correct_count: int
    accuracy: float
    score_rate: float
    mastery_level: MasteryLevel
    last_practiced_at: str


class RecentPractice(BaseModel):
    session_id: str
    section_key: str
    section_number: str
    section_title: str
    difficulty: str
    total_score: float
    max_score: float
    score_rate: float
    submitted_at: str


class MistakeRecord(BaseModel):
    question_id: str
    session_id: str
    type: QuestionType
    stem: str
    options: list[str] = Field(default_factory=list)
    answer: str | bool
    correct_answer: str | bool
    analysis: str
    feedback: str
    knowledge_point: str
    section_key: str
    chapter_title: str
    section_number: str
    section_title: str
    citation: PracticeCitation
    submitted_at: str


class LearningRecommendation(BaseModel):
    id: str
    type: RecommendationType
    priority: Literal["high", "medium", "low"]
    title: str
    reason: str
    action_label: str
    href: str
    section_key: str | None = None
    knowledge_point: str | None = None


class KnowledgeReviewResponse(BaseModel):
    section_key: str
    chapter_title: str
    section_number: str
    section_title: str
    knowledge_point: str
    reason: str
    overview: str
    key_points: list[str]
    common_mistakes: list[str]
    sources: list[PracticeCitation]
    related_mistakes: list[MistakeRecord]
    mastery: KnowledgeMastery | None = None
    practice_href: str


class LearningDashboardResponse(BaseModel):
    user_id: str
    generated_at: str
    summary: LearningSummary
    learning_records: list[CourseLearningRecord]
    section_mastery: list[SectionMastery]
    knowledge_mastery: list[KnowledgeMastery]
    recent_practices: list[RecentPractice]
    mistakes: list[MistakeRecord]
    recommendations: list[LearningRecommendation]
