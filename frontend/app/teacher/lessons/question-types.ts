export type QuestionType = 'single_choice' | 'true_false' | 'short_answer';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface RubricPoint {
  point: string;
  weight: number;
}

export interface QuestionCitation {
  chunk_id?: string;
  book?: string;
  chapter_title?: string;
  section_number?: string;
  section_title?: string;
  quote?: string;
}

/**
 * A bank question as teachers see it.
 *
 * `correct_answer` is an option letter ("A".."D") for single choice, a boolean
 * for true/false, and reference text for short answer.
 */
export interface BankQuestion {
  id: string;
  section_key: string;
  chapter_title: string;
  section_number: string;
  section_title: string;
  type: QuestionType;
  stem: string;
  options: string[];
  correct_answer: string | boolean | null;
  analysis: string;
  rubric: RubricPoint[];
  difficulty: Difficulty;
  knowledge_point: string;
  source_chunk_id: string;
  citation: QuestionCitation | null;
  status: string;
  created_at: string;
  updated_at: string | null;
  /** Set when this question replaced another one. */
  replaced_from: string | null;
}

export interface BankQuestionPage {
  section_key: string;
  questions: BankQuestion[];
  active_count: number;
  archived_count: number;
}

export interface QuestionGenerateParams {
  question_types: QuestionType[];
  difficulty: Difficulty;
  question_count: number;
  knowledge_point?: string | null;
  mixed_difficulty?: boolean;
}

export interface QuestionGenerateResult {
  section_key: string;
  chapter_title: string;
  section_number: string;
  section_title: string;
  generated_count: number;
  inserted_count: number;
  /** Dropped by UNIQUE(section_key, stem) as duplicates. */
  skipped_count: number;
}

export interface QuestionUpdatePayload {
  stem?: string;
  options?: string[];
  correct_answer?: string | boolean | null;
  analysis?: string;
  rubric?: RubricPoint[];
  difficulty?: Difficulty;
  knowledge_point?: string;
}

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  single_choice: '单选题',
  true_false: '判断题',
  short_answer: '简答题',
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: '简单',
  medium: '中等',
  hard: '困难',
};
