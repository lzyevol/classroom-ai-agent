import { authFetch } from '@/lib/auth/auth-client';
import type {
  AssignmentCreateInput,
  ClassSectionMasteryPage,
  TeacherAssignmentPage,
  TeacherAssignmentSummary,
  TeacherClassPage,
  TeacherStudentDetail,
  TeacherStudentPage,
  WeakKnowledgePage,
} from './types';

const BASE = '/backend/api/teacher';

async function apiError(response: Response, fallback: string): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { detail?: string } | null;
  return new Error(body?.detail || fallback);
}

export async function fetchTeacherClasses(input: {
  q?: string;
  page: number;
  pageSize: number;
}): Promise<TeacherClassPage> {
  const params = new URLSearchParams({
    page: String(input.page),
    page_size: String(input.pageSize),
  });
  if (input.q) params.set('q', input.q);
  const response = await authFetch(`${BASE}/classes?${params.toString()}`, {
    cache: 'no-store',
  });
  if (!response.ok) throw await apiError(response, '班级列表加载失败');
  return response.json() as Promise<TeacherClassPage>;
}

export async function fetchTeacherStudents(input: {
  classId: string;
  q?: string;
  status: 'all' | 'active' | 'inactive';
  page: number;
  pageSize: number;
}): Promise<TeacherStudentPage> {
  const params = new URLSearchParams({
    page: String(input.page),
    page_size: String(input.pageSize),
    status: input.status,
  });
  if (input.q) params.set('q', input.q);
  const response = await authFetch(
    `${BASE}/classes/${encodeURIComponent(input.classId)}/students?${params.toString()}`,
    { cache: 'no-store' },
  );
  if (!response.ok) throw await apiError(response, '学生列表加载失败');
  return response.json() as Promise<TeacherStudentPage>;
}

export async function fetchClassSectionMastery(input: {
  classId: string;
  page: number;
  pageSize: number;
}): Promise<ClassSectionMasteryPage> {
  const params = new URLSearchParams({
    page: String(input.page),
    page_size: String(input.pageSize),
  });
  const response = await authFetch(
    `${BASE}/classes/${encodeURIComponent(input.classId)}/section-mastery?${params.toString()}`,
    { cache: 'no-store' },
  );
  if (!response.ok) throw await apiError(response, '班级章节掌握情况加载失败');
  return response.json() as Promise<ClassSectionMasteryPage>;
}

export async function fetchWeakKnowledge(input: {
  classId: string;
  page: number;
  pageSize: number;
}): Promise<WeakKnowledgePage> {
  const params = new URLSearchParams({
    page: String(input.page),
    page_size: String(input.pageSize),
  });
  const response = await authFetch(
    `${BASE}/classes/${encodeURIComponent(input.classId)}/weak-knowledge?${params.toString()}`,
    { cache: 'no-store' },
  );
  if (!response.ok) throw await apiError(response, '薄弱知识点加载失败');
  return response.json() as Promise<WeakKnowledgePage>;
}

export async function fetchTeacherStudentDetail(
  classId: string,
  studentId: string,
): Promise<TeacherStudentDetail> {
  const response = await authFetch(
    `${BASE}/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(studentId)}`,
    { cache: 'no-store' },
  );
  if (!response.ok) throw await apiError(response, '学生详情加载失败');
  return response.json() as Promise<TeacherStudentDetail>;
}

export async function fetchTeacherAssignments(input: {
  classId: string;
  page?: number;
  pageSize?: number;
}): Promise<TeacherAssignmentPage> {
  const params = new URLSearchParams({
    page: String(input.page ?? 1),
    page_size: String(input.pageSize ?? 20),
  });
  const response = await authFetch(
    `${BASE}/classes/${encodeURIComponent(input.classId)}/assignments?${params.toString()}`,
    { cache: 'no-store' },
  );
  if (!response.ok) throw await apiError(response, '教学任务加载失败');
  return response.json() as Promise<TeacherAssignmentPage>;
}

export async function createTeacherAssignment(
  classId: string,
  input: AssignmentCreateInput,
): Promise<TeacherAssignmentSummary> {
  const response = await authFetch(`${BASE}/classes/${encodeURIComponent(classId)}/assignments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await apiError(response, '教学任务发布失败');
  return response.json() as Promise<TeacherAssignmentSummary>;
}

export async function closeTeacherAssignment(
  classId: string,
  assignmentId: string,
): Promise<TeacherAssignmentSummary> {
  const response = await authFetch(
    `${BASE}/classes/${encodeURIComponent(classId)}/assignments/${encodeURIComponent(assignmentId)}/close`,
    { method: 'POST' },
  );
  if (!response.ok) throw await apiError(response, '教学任务关闭失败');
  return response.json() as Promise<TeacherAssignmentSummary>;
}

export async function deleteTeacherAssignment(
  classId: string,
  assignmentId: string,
): Promise<void> {
  const response = await authFetch(
    `${BASE}/classes/${encodeURIComponent(classId)}/assignments/${encodeURIComponent(assignmentId)}`,
    { method: 'DELETE' },
  );
  if (!response.ok) throw await apiError(response, '教学任务删除失败');
}
