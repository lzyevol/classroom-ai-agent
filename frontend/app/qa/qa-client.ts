import type { QAHistoryMessage, QAResponse } from './types';

const BACKEND_QA_URL = '/backend/api/qa';

export async function askQuestion(
  question: string,
  history: QAHistoryMessage[] = [],
  maxCitations = 3,
  signal?: AbortSignal,
): Promise<QAResponse> {
  const resp = await fetch(BACKEND_QA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, history, max_citations: maxCitations }),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`后端错误 (${resp.status}): ${text || resp.statusText}`);
  }

  return (await resp.json()) as QAResponse;
}
