import type { LessonData, TocItem } from './types';

const BASE = '/backend';

let tocCache: TocItem[] | null = null;
let tocRequest: Promise<TocItem[]> | null = null;

export function getCachedToc(): TocItem[] | null {
  return tocCache;
}

export async function fetchToc(): Promise<TocItem[]> {
  if (tocCache) return tocCache;
  if (tocRequest) return tocRequest;

  tocRequest = fetch(`${BASE}/api/course/toc`)
    .then(async (resp) => {
      if (!resp.ok) throw new Error('获取目录失败');
      const toc = (await resp.json()) as TocItem[];
      tocCache = toc;
      return toc;
    })
    .finally(() => {
      tocRequest = null;
    });

  return tocRequest;
}

export function prefetchToc(): void {
  void fetchToc().catch(() => {
    // The lesson page will show the user-facing error if a later retry also fails.
  });
}

export async function generateLesson(
  sectionKey: string,
  forceRegenerate = false,
): Promise<LessonData> {
  const resp = await fetch(`${BASE}/api/lesson/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section_key: sectionKey, force_regenerate: forceRegenerate }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`生成课件失败 (${resp.status}): ${text}`);
  }
  return resp.json();
}
