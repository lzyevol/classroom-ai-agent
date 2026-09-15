import type { Citation } from "@/lib/api/types";

export type PracticeDifficulty = "easy" | "medium" | "hard";
export type PracticeQuestionType = "single_choice";

export interface PracticeQuestion {
  id: string;
  type: PracticeQuestionType;
  stem: string;
  options: string[];
  difficulty: PracticeDifficulty;
  knowledge_point: string | null;
  max_score: number;
}

export interface GeneratePracticeRequest {
  section_key: string;
  question_types: PracticeQuestionType[];
  difficulty: PracticeDifficulty;
  question_count: number;
  knowledge_point: string | null;
}

export interface PracticeSession {
  session_id: string;
  section_key: string;
  chapter_title: string;
  section_number: string;
  section_title: string;
  difficulty: PracticeDifficulty;
  status: "active";
  created_at: string;
  questions: PracticeQuestion[];
}

export interface PracticeAnswer {
  question_id: string;
  answer: string;
}

export interface SubmitPracticeRequest {
  answers: PracticeAnswer[];
}

export interface PracticeResult {
  question_id: string;
  type: PracticeQuestionType;
  stem: string;
  options: string[];
  answer: string;
  correct_answer: string;
  score: number;
  max_score: number;
  is_correct: boolean;
  analysis: string;
  feedback: string;
  covered_points: string[];
  missing_points: string[];
  errors: string[];
  review_required: boolean;
  knowledge_point: string | null;
  citation: Citation;
}

export interface PracticeSubmission {
  session_id: string;
  status: "submitted";
  total_score: number;
  max_score: number;
  correct_count: number;
  question_count: number;
  submitted_at: string;
  results: PracticeResult[];
}

export type MockPracticeScenario =
  | "all-correct"
  | "partial"
  | "generate-error"
  | "submit-error";
