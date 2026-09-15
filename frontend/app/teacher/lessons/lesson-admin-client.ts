import { authFetch } from '@/lib/auth/auth-client';
import type { JobAccepted } from '@/lib/jobs/types';
import type { LessonData, Slide, TocItem } from '../../lesson/types';
import type { LessonListItem } from './types';

const BASE = '/backend/api/lesson';

async function apiError(response: Response, fallback: string): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { detail?: string } | null;
  return new Error(body?.detail || fallback);
}

/** The full course outline, including sections without courseware. */
export async function fetchCourseToc(): Promise<TocItem[]> {
  const response = await authFetch('/backend/api/course/toc', { cache: 'no-store' });
  if (!response.ok) throw await apiError(response, '课程目录加载失败');
  return response.json() as Promise<TocItem[]>;
}

/** Sections that already have generated courseware. */
export async function fetchGeneratedLessons(): Promise<LessonListItem[]> {
  const response = await authFetch(`${BASE}/list`, { cache: 'no-store' });
  if (!response.ok) throw await apiError(response, '已生成课件列表加载失败');
  return response.json() as Promise<LessonListItem[]>;
}

/** Returns null when the section has no courseware yet. */
export async function fetchLesson(sectionKey: string): Promise<LessonData | null> {
  const response = await authFetch(`${BASE}/${encodeURIComponent(sectionKey)}`, {
    cache: 'no-store',
  });
  if (response.status === 404) return null;
  if (!response.ok) throw await apiError(response, '课件加载失败');
  return response.json() as Promise<LessonData>;
}

export async function queueLessonGeneration(
  sectionKey: string,
  forceRegenerate = false,
): Promise<JobAccepted> {
  const response = await authFetch(`${BASE}/generate-async`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section_key: sectionKey, force_regenerate: forceRegenerate }),
  });
  if (!response.ok) throw await apiError(response, '课件生成任务创建失败');
  return response.json() as Promise<JobAccepted>;
}

export async function queueSlideRegeneration(
  sectionKey: string,
  slideId: string,
): Promise<JobAccepted> {
  const response = await authFetch(
    `${BASE}/${encodeURIComponent(sectionKey)}/slides/${encodeURIComponent(slideId)}/regenerate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    },
  );
  if (!response.ok) throw await apiError(response, '幻灯片重新生成任务创建失败');
  return response.json() as Promise<JobAccepted>;
}

export async function saveSlide(
  sectionKey: string,
  slideId: string,
  slide: Slide,
): Promise<Slide> {
  const response = await authFetch(
    `${BASE}/${encodeURIComponent(sectionKey)}/slides/${encodeURIComponent(slideId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slide),
    },
  );
  if (!response.ok) throw await apiError(response, '幻灯片保存失败');
  return response.json() as Promise<Slide>;
}
