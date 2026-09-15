import type { LearningDashboard } from '../learning/types';

export interface TeacherClassOverview {
  id: string;
  name: string;
  course_name: string;
  student_count: number;
  active_student_count: number;
  engaged_student_count: number;
  completed_practices: number;
  average_score_rate: number;
  mistake_count: number;
  last_activity_at: string | null;
}

export interface TeacherClassPage {
  items: TeacherClassOverview[];
  total: number;
  page: number;
  page_size: number;
}

export interface TeacherStudentSummary {
  id: string;
  username: string;
  display_name: string;
  is_active: boolean;
  learned_sections: number;
  completed_practices: number;
  overall_score_rate: number;
  mistake_count: number;
  last_activity_at: string | null;
}

export interface TeacherStudentPage {
  items: TeacherStudentSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface WeakKnowledgePoint {
  knowledge_point: string;
  section_key: string;
  chapter_title: string;
  section_number: string;
  section_title: string;
  attempts: number;
  correct_count: number;
  student_count: number;
  score_rate: number;
  available_question_count: number;
  last_practiced_at: string;
}

export interface WeakKnowledgePage {
  items: WeakKnowledgePoint[];
  total: number;
  page: number;
  page_size: number;
}

export interface ClassSectionMastery {
  section_key: string;
  chapter_title: string;
  section_number: string;
  section_title: string;
  attempts: number;
  correct_count: number;
  student_count: number;
  score_rate: number;
  available_question_count: number;
  last_practiced_at: string | null;
}

export interface ClassSectionMasteryPage {
  items: ClassSectionMastery[];
  total: number;
  page: number;
  page_size: number;
}

export interface TeacherStudentDetail {
  class_id: string;
  student: TeacherStudentSummary;
  learning: LearningDashboard;
}

export interface AssignmentCreateInput {
  title: string;
  description: string;
  section_key: string;
  chapter_title: string;
  section_number: string;
  section_title: string;
  knowledge_point?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  question_types: Array<'single_choice' | 'true_false' | 'short_answer'>;
  question_count: number;
  due_at: string | null;
}

export interface TeacherAssignmentProgress {
  student_id: string;
  username: string;
  display_name: string;
  status: 'assigned' | 'in_progress' | 'completed';
  baseline_score_rate: number;
  baseline_attempts: number;
  practice_session_id: string | null;
  assigned_at: string;
  started_at: string | null;
  completed_at: string | null;
  post_score_rate: number | null;
  improvement: number | null;
  practice_score_rate: number | null;
  actual_question_count: number | null;
}

export interface TeacherAssignmentSummary {
  id: string;
  class_id: string;
  teacher_id: string;
  title: string;
  description: string;
  section_key: string;
  chapter_title: string;
  section_number: string;
  section_title: string;
  knowledge_point: string;
  difficulty: 'easy' | 'medium' | 'hard';
  question_types: Array<'single_choice' | 'true_false' | 'short_answer'>;
  question_count: number;
  due_at: string | null;
  status: 'active' | 'closed';
  created_at: string;
  closed_at: string | null;
  total_students: number;
  assigned_students: number;
  in_progress_students: number;
  completed_students: number;
  completion_rate: number;
  baseline_average: number;
  post_average: number | null;
  average_improvement: number | null;
  average_practice_score: number | null;
  actual_question_count: number | null;
}

export interface TeacherAssignmentDetail extends TeacherAssignmentSummary {
  students: TeacherAssignmentProgress[];
}

export interface TeacherAssignmentPage {
  items: TeacherAssignmentSummary[];
  total: number;
  page: number;
  page_size: number;
}
