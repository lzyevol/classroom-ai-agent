import { authFetch } from '@/lib/auth/auth-client';
import type { JobRecord } from './types';

const BASE = '/backend/api/jobs';

export async function fetchJob<TResult = unknown>(
  jobId: string,
): Promise<JobRecord<TResult>> {
  const response = await authFetch(`${BASE}/${encodeURIComponent(jobId)}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail || '任务状态查询失败');
  }
  return response.json() as Promise<JobRecord<TResult>>;
}
