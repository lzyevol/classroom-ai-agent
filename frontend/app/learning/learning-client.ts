import type { KnowledgeReview, LearningDashboard, SectionAccessInput, StudentAssignmentPage } from './types';
import type { PracticeSession } from '../practice/types';
import { authFetch } from '@/lib/auth/auth-client';

const BASE = '/backend';

let dashboardRequest: Promise<LearningDashboard> | null = null;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function requestLearningDashboard(): Promise<LearningDashboard> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await authFetch(`${BASE}/api/learning/dashboard`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`获取学习数据失败（HTTP ${response.status}）`);
      }
      return (await response.json()) as LearningDashboard;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await wait(250);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('获取学习数据失败');
}

export async function fetchLearningDashboard(): Promise<LearningDashboard> {
  if (!dashboardRequest) {
    dashboardRequest = requestLearningDashboard().finally(() => {
      dashboardRequest = null;
    });
  }
  return dashboardRequest;
}

export async function fetchKnowledgeReview(
  sectionKey: string,
  knowledgePoint: string,
): Promise<KnowledgeReview> {
  const params = new URLSearchParams({
    section_key: sectionKey,
    knowledge_point: knowledgePoint,
  });
  const response = await authFetch(`${BASE}/api/learning/review?${params.toString()}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`获取知识点复习内容失败（HTTP ${response.status}）`);
  }
  return response.json() as Promise<KnowledgeReview>;
}

export async function recordSectionAccess(input: SectionAccessInput): Promise<void> {
  const response = await authFetch(`${BASE}/api/learning/sections/access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error('记录学习进度失败');
}


export async function fetchStudentAssignments(): Promise<StudentAssignmentPage> {
  const response = await authFetch(`${BASE}/api/learning/assignments`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`教学任务加载失败（HTTP ${response.status}）`);
  }
  return response.json() as Promise<StudentAssignmentPage>;
}

export async function startStudentAssignment(
  assignmentId: string,
): Promise<PracticeSession & { assignment_id: string }> {
  const response = await authFetch(
    `${BASE}/api/learning/assignments/${encodeURIComponent(assignmentId)}/start`,
    { method: 'POST' },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail || `教学任务启动失败（HTTP ${response.status}）`);
  }
  return response.json() as Promise<PracticeSession & { assignment_id: string }>;
}
