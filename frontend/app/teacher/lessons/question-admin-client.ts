import { authFetch } from '@/lib/auth/auth-client';
import type { JobAccepted } from '@/lib/jobs/types';
import type {
  BankQuestion,
  BankQuestionPage,
  QuestionGenerateParams,
  QuestionUpdatePayload,
} from './question-types';

const BASE = '/backend/api/questions';

async function apiError(response: Response, fallback: string): Promise<Error> {
  const body = (await response.json().catch(() => null)) as
    | { detail?: string | { msg?: string }[] }
    | null;
  const detail = body?.detail;
  if (typeof detail === 'string') return new Error(detail);
  // FastAPI returns an array of issues for request-model validation failures.
  if (Array.isArray(detail) && detail[0]?.msg) return new Error(detail[0].msg);
  return new Error(fallback);
}

export async function fetchSectionQuestions(
  sectionKey: string,
  options: { includeArchived?: boolean } = {},
): Promise<BankQuestionPage> {
  const params = new URLSearchParams();
  if (options.includeArchived) params.set('include_archived', 'true');
  const query = params.toString();
  const response = await authFetch(
    `${BASE}/section/${encodeURIComponent(sectionKey)}${query ? `?${query}` : ''}`,
    { cache: 'no-store' },
  );
  if (!response.ok) throw await apiError(response, '题库加载失败');
  return response.json() as Promise<BankQuestionPage>;
}

export async function queueQuestionGeneration(
  sectionKey: string,
  params: QuestionGenerateParams,
): Promise<JobAccepted> {
  const response = await authFetch(
    `${BASE}/section/${encodeURIComponent(sectionKey)}/generate-async`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    },
  );
  if (!response.ok) throw await apiError(response, '题目生成任务创建失败');
  return response.json() as Promise<JobAccepted>;
}

export async function queueQuestionRegeneration(
  questionId: string,
): Promise<JobAccepted> {
  const response = await authFetch(
    `${BASE}/${encodeURIComponent(questionId)}/regenerate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    },
  );
  if (!response.ok) throw await apiError(response, '重新出题任务创建失败');
  return response.json() as Promise<JobAccepted>;
}

export async function updateQuestion(
  questionId: string,
  payload: QuestionUpdatePayload,
): Promise<BankQuestion> {
  const response = await authFetch(`${BASE}/${encodeURIComponent(questionId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw await apiError(response, '题目保存失败');
  return response.json() as Promise<BankQuestion>;
}

/** Archives the question; student answer records keep referencing it. */
export async function archiveQuestion(questionId: string): Promise<BankQuestion> {
  const response = await authFetch(`${BASE}/${encodeURIComponent(questionId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw await apiError(response, '题目废弃失败');
  return response.json() as Promise<BankQuestion>;
}
