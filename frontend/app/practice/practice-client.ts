import type {
  Difficulty,
  PracticeAnswer,
  PracticeSession,
  PracticeSubmitResult,
  QuestionType,
} from './types';
import { authFetch } from '@/lib/auth/auth-client';

const BASE = '/backend';

function detailToMessage(detail: unknown): string | null {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'msg' in item) {
          return String((item as { msg: unknown }).msg);
        }
        return null;
      })
      .filter((item): item is string => Boolean(item));
    return messages.length ? messages.join('；') : null;
  }
  if (detail && typeof detail === 'object' && 'message' in detail) {
    return String((detail as { message: unknown }).message);
  }
  return null;
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  try {
    const body = (await response.json()) as { detail?: unknown; message?: unknown };
    const message = detailToMessage(body.detail) ?? detailToMessage(body.message);
    if (message) return new Error(message);
  } catch {
    // Ignore malformed/non-JSON error bodies and use the friendly fallback below.
  }
  return new Error(`${fallback}（${response.status}）`);
}

export async function generatePractice(input: {
  sectionKey: string;
  questionTypes: QuestionType[];
  difficulty: Difficulty;
  questionCount: number;
  knowledgePoint?: string;
}): Promise<PracticeSession> {
  const response = await authFetch(`${BASE}/api/practice/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      section_key: input.sectionKey,
      question_types: input.questionTypes,
      difficulty: input.difficulty,
      question_count: input.questionCount,
      knowledge_point: input.knowledgePoint?.trim() || null,
    }),
  });

  if (!response.ok) throw await responseError(response, '生成练习失败');
  return response.json() as Promise<PracticeSession>;
}

export async function submitPractice(
  sessionId: string,
  answers: PracticeAnswer[],
): Promise<PracticeSubmitResult> {
  const response = await authFetch(`${BASE}/api/practice/${encodeURIComponent(sessionId)}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers }),
  });

  if (!response.ok) throw await responseError(response, '提交练习失败');
  return response.json() as Promise<PracticeSubmitResult>;
}
