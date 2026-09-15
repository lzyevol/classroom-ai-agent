import type { PracticeCitation, QuestionType } from '../practice/types';

export type MasteryLevel = 'needs_review' | 'developing' | 'mastered';

export interface LearningSummary {
  learned_sections: number;
  completed_practices: number;
  answered_questions: number;
  correct_questions: number;
  overall_accuracy: number;
  overall_score_rate: number;
  mistake_count: number;
  last_activity_at: string | null;
}

export interface CourseLearningRecord {
  section_key: string;
  chapter_title: string;
  section_number: string;
  section_title: string;
  access_count: number;
  first_accessed_at: string;
  last_accessed_at: string;
}

export interface SectionMastery {
  section_key: string;
  chapter_title: string;
  section_number: string;
  section_title: string;
  practice_count: number;
  answered_questions: number;
  correct_questions: number;
  accuracy: number;
  score_rate: number;
  mastery_level: MasteryLevel;
  last_practiced_at: string;
}

export interface KnowledgeMastery {
  knowledge_point: string;
  section_key: string;
  chapter_title: string;
  section_number: string;
  section_title: string;
  attempts: number;
  correct_count: number;
  accuracy: number;
  score_rate: number;
  mastery_level: MasteryLevel;
  last_practiced_at: string;
}

export interface RecentPractice {
  session_id: string;
  section_key: string;
  section_number: string;
  section_title: string;
  difficulty: string;
  total_score: number;
  max_score: number;
  score_rate: number;
  submitted_at: string;
}

export interface MistakeRecord {
  question_id: string;
  session_id: string;
  type: QuestionType;
  stem: string;
  options: string[];
  answer: string | boolean;
  correct_answer: string | boolean;
  analysis: string;
  feedback: string;
  knowledge_point: string;
  section_key: string;
  chapter_title: string;
  section_number: string;
  section_title: string;
  citation: PracticeCitation;
  submitted_at: string;
}

export interface LearningRecommendation {
  id: string;
  type: 'start_learning' | 'continue_learning' | 'review_knowledge' | 'retry_mistakes' | 'next_section';
  priority: 'high' | 'medium' | 'low';
  title: string;
  reason: string;
  action_label: string;
  href: string;
  section_key: string | null;
  knowledge_point: string | null;
}

export interface KnowledgeReview {
  section_key: string;
  chapter_title: string;
  section_number: string;
  section_title: string;
  knowledge_point: string;
  reason: string;
  overview: string;
  key_points: string[];
  common_mistakes: string[];
  sources: PracticeCitation[];
  related_mistakes: MistakeRecord[];
  mastery: KnowledgeMastery | null;
  practice_href: string;
}

export interface LearningDashboard {
  user_id: string;
  generated_at: string;
  summary: LearningSummary;
  learning_records: CourseLearningRecord[];
  section_mastery: SectionMastery[];
  knowledge_mastery: KnowledgeMastery[];
  recent_practices: RecentPractice[];
  mistakes: MistakeRecord[];
  recommendations: LearningRecommendation[];
}

export interface StudentAssignment {
  id: string;
  title: string;
  description: string;
  class_name: string;
  section_key: string;
  section_number: string;
  section_title: string;
  knowledge_point: string;
  difficulty: 'easy' | 'medium' | 'hard';
  question_types: Array<'single_choice' | 'true_false' | 'short_answer'>;
  question_count: number;
  due_at: string | null;
  assignment_status: 'active' | 'closed';
  progress_status: 'assigned' | 'in_progress' | 'completed';
  baseline_score_rate: number;
  post_score_rate: number | null;
  improvement: number | null;
  practice_session_id: string | null;
  completed_at: string | null;
  practice_score_rate: number | null;
  actual_question_count: number | null;
}

export interface StudentAssignmentPage {
  items: StudentAssignment[];
  total: number;
}

export interface SectionAccessInput {
  section_key: string;
  chapter_title: string;
  section_number: string;
  section_title: string;
}
