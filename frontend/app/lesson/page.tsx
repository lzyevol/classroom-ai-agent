'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BookOpen, CheckCircle2, ChevronLeft, Circle, Loader2, Play } from 'lucide-react';
import { toast } from 'sonner';
import { fetchToc, generateLesson, getCachedToc } from './lesson-client';
import type { TocItem } from './types';
import { useStageStore } from '@/lib/store';
import { useSettingsStore } from '@/lib/store/settings';
import { buildLessonClassroom, prepareLessonAudio } from '@/lib/classroom/lesson-adapter';
import { useRouter } from 'next/navigation';
import { fetchLearningDashboard, recordSectionAccess } from '../learning/learning-client';

type LoadingState = 'idle' | 'lesson' | 'audio';

export default function LessonPage() {
  const router = useRouter();
  const ttsEnabled = useSettingsStore((state) => state.ttsEnabled);
  const ttsProviderId = useSettingsStore((state) => state.ttsProviderId);
  const ttsVoice = useSettingsStore((state) => state.ttsVoice);
  const ttsSpeed = useSettingsStore((state) => state.ttsSpeed);
  const [toc, setToc] = useState<TocItem[]>(() => getCachedToc() ?? []);
  const [learnedSectionKeys, setLearnedSectionKeys] = useState<Set<string> | null>(null);
  const [loading, setLoading] = useState<LoadingState>('idle');
  const [audioProgress, setAudioProgress] = useState({ completed: 0, total: 0 });

  useEffect(() => {
    fetchToc()
      .then(setToc)
      .catch(() => toast.error('获取章节目录失败'));
    fetchLearningDashboard()
      .then((dashboard) => {
        setLearnedSectionKeys(new Set(dashboard.learning_records.map((item) => item.section_key)));
      })
      .catch(() => toast.error('获取课程学习状态失败'));
  }, []);

  const chapters = useMemo(() => {
    const map: Record<number, { title: string; sections: TocItem[] }> = {};
    for (const item of toc) {
      map[item.chapter_number] ??= { title: item.chapter_title, sections: [] };
      map[item.chapter_number].sections.push(item);
    }
    return Object.entries(map).map(([num, chapter]) => ({
      num: Number(num),
      ...chapter,
    }));
  }, [toc]);

  const startLesson = async (sectionKey: string) => {
    if (loading !== 'idle') return;
    setLoading('lesson');
    try {
      const lesson = await generateLesson(sectionKey);
      if (!lesson.slides.length) {
        toast.error('该章节暂无内容');
        return;
      }

      const selectedSection = toc.find((item) => item.section_key === sectionKey);
      if (selectedSection) {
        void recordSectionAccess({
          section_key: selectedSection.section_key,
          chapter_title: selectedSection.chapter_title,
          section_number: selectedSection.section_number,
          section_title: selectedSection.section_title,
        }).catch(() => {
          // Learning progress must never prevent the classroom from opening.
        });
      }

      const bundle = buildLessonClassroom(lesson);
      const lessonTTS = {
        ttsProvider:
          ttsProviderId === 'edge-tts'
            ? ('edge' as const)
            : ttsProviderId === 'qwen-tts'
              ? ('qwen' as const)
              : ('browser' as const),
        ttsVoice,
        ttsSpeed,
      };
      if (ttsEnabled && lessonTTS.ttsProvider !== 'browser') {
        setLoading('audio');
        await prepareLessonAudio(bundle.scenes, lessonTTS, (completed, total) => {
          setAudioProgress({ completed, total });
        });
      }

      const store = useStageStore.getState();
      store.setStage(bundle.stage);
      store.setOutlines([]);
      store.setScenes(bundle.scenes);
      store.setCurrentSceneId(bundle.scenes[0]?.id || null);
      await store.saveToStorage();
      router.push(`/classroom/${bundle.stage.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '课堂准备失败，请稍后重试');
    } finally {
      setLoading('idle');
    }
  };

  if (loading !== 'idle') {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-950">
        <Loader2 className="w-10 h-10 text-violet-500 animate-spin mb-4" />
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {loading === 'lesson'
            ? '正在生成具身智教课堂内容…'
            : `正在准备课堂语音 ${audioProgress.completed}/${audioProgress.total}`}
        </p>
        <p className="text-xs text-gray-400 mt-2">白板、互动讨论和课堂控制将在下一步课堂页中启用</p>
      </div>
    );
  }

  return (
    <SectionSelector
      chapters={chapters}
      learnedSectionKeys={learnedSectionKeys}
      onSelect={startLesson}
    />
  );
}

function SectionSelector({
  chapters,
  learnedSectionKeys,
  onSelect,
}: {
  chapters: { num: number; title: string; sections: TocItem[] }[];
  learnedSectionKeys: Set<string> | null;
  onSelect: (sectionKey: string) => void;
}) {
  return (
    <div className="h-screen bg-gray-50 dark:bg-gray-950">
      <header className="h-16 border-b border-gray-200/70 bg-white/85 px-6 backdrop-blur-md dark:border-gray-800 dark:bg-gray-900/85 sm:px-10">
        <div className="flex h-full items-center gap-3">
          <Link
            href="/"
            className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-violet-600 dark:hover:bg-gray-800"
            aria-label="返回"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-md shadow-purple-200/50 dark:shadow-none">
            <BookOpen className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-gray-900 dark:text-gray-100 sm:text-base">课堂学习</h1>
            <p className="hidden text-xs text-gray-400 sm:block">选择章节开始上课</p>
          </div>
        </div>
      </header>
      <div className="h-[calc(100vh-4rem)] overflow-y-auto px-6 py-8 sm:px-10">
        <div className="mx-auto max-w-3xl">
          <div className="mb-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900/30 dark:to-purple-900/30 flex items-center justify-center mx-auto mb-4 shadow-inner">
            <BookOpen className="w-8 h-8 text-violet-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">
            选择章节开始上课
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            使用具身智教完整课堂：幻灯片、白板、AI 教师和互动讨论
          </p>
          </div>
          <div className="space-y-4">
          {chapters.map((chapter) => (
            <div
              key={chapter.num}
              className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200/60 dark:border-gray-800 overflow-hidden shadow-sm"
            >
              <div className="px-4 py-3 bg-gray-50/80 dark:bg-gray-800/70 text-sm font-semibold text-gray-700 dark:text-gray-200 border-b border-gray-100 dark:border-gray-800">
                第 {chapter.num} 章 · {chapter.title}
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {chapter.sections.map((section) => (
                  <button
                    key={section.section_key}
                    onClick={() => onSelect(section.section_key)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-violet-50/50 dark:hover:bg-violet-900/10 transition-colors group text-left"
                  >
                    <span className="text-sm text-gray-600 dark:text-gray-300 group-hover:text-violet-600 transition-colors">
                      {section.section_number} {section.section_title}
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      {learnedSectionKeys === null ? (
                        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-400 dark:bg-gray-800 dark:text-gray-500">
                          读取中
                        </span>
                      ) : learnedSectionKeys.has(section.section_key) ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          已学
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700 dark:bg-red-950/40 dark:text-red-300">
                          <Circle className="h-3.5 w-3.5" />
                          未学
                        </span>
                      )}
                      <Play className="w-3.5 h-3.5 text-gray-300 group-hover:text-violet-500 transition-colors" />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {chapters.length === 0 && (
            <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200/60 dark:border-gray-800 p-8 text-center text-sm text-gray-400">
              正在加载教材章节…
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
