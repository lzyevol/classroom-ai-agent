export type QuestionType = 'single_choice' | 'true_false' | 'short_answer';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface PracticeQuestion {
  id: string;
  type: QuestionType;
  stem: string;
  options: string[];
  difficulty: Difficulty;
  knowledge_point: string;
  max_score: number;
}

export interface PracticeSession {
  session_id: string;
  section_key: string;
  chapter_title: string;
  section_number: string;
  section_title: string;
  difficulty: Difficulty;
  status: 'active' | 'submitted';
  created_at: string;
  questions: PracticeQuestion[];
}

export interface PracticeAnswer {
  question_id: string;
  answer: string | boolean;
}

export interface PracticeCitation {
  chunk_id: string;
  book: string;
  chapter_title: string;
  section_number: string;
  section_title: string;
  quote: string;
}

export interface PracticeQuestionResult {
  question_id: string;
  type: QuestionType;
  stem: string;
  options: string[];
  answer: string | boolean;
  correct_answer: string | boolean;
  score: number;
  max_score: number;
  is_correct: boolean;
  analysis: string;
  feedback: string;
  covered_points: string[];
  missing_points: string[];
  errors: string[];
  review_required: boolean;
  knowledge_point: string;
  citation: PracticeCitation;
}

export interface PracticeSubmitResult {
  session_id: string;
  status: 'submitted';
  total_score: number;
  max_score: number;
  correct_count: number;
  question_count: number;
  submitted_at: string;
  results: PracticeQuestionResult[];
}
