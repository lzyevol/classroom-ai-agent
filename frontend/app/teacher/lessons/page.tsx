'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BookOpenCheck,
  ListChecks,
  Loader2,
  LogOut,
  Pencil,
  Presentation,
  RefreshCcw,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { fetchCurrentUser, logoutUser } from '@/lib/auth/auth-client';
import { useJob } from '@/lib/jobs/use-job';
import type { LessonData, Slide } from '../../lesson/types';
import { ChapterTree } from './chapter-tree';
import { QuestionsPanel } from './questions-panel';
import { SlideEditorDialog } from './slide-editor-dialog';
import { SlidePreview } from './slide-preview';
import {
  fetchCourseToc,
  fetchGeneratedLessons,
  fetchLesson,
  queueLessonGeneration,
  queueSlideRegeneration,
  saveSlide,
} from './lesson-admin-client';
import type { ChapterNode, LessonListItem, SectionNode } from './types';

function buildChapters(
  toc: Awaited<ReturnType<typeof fetchCourseToc>>,
  lessons: LessonListItem[],
): ChapterNode[] {
  const lessonByKey = new Map(lessons.map((item) => [item.section_key, item]));
  const chapterMap = new Map<number, ChapterNode>();

  for (const item of toc) {
    const existing = lessonByKey.get(item.section_key);
    const section: SectionNode = {
      ...item,
      slideCount: existing?.slide_count ?? 0,
      lessonStatus: existing?.status ?? 'none',
    };

    let chapter = chapterMap.get(item.chapter_number);
    if (!chapter) {
      chapter = {
        chapterNumber: item.chapter_number,
        chapterTitle: item.chapter_title,
        sections: [],
        generatedCount: 0,
      };
      chapterMap.set(item.chapter_number, chapter);
    }
    chapter.sections.push(section);
    if (section.lessonStatus !== 'none') chapter.generatedCount += 1;
  }

  return [...chapterMap.values()].sort((a, b) => a.chapterNumber - b.chapterNumber);
}

export default function TeacherLessonsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [loadingTree, setLoadingTree] = useState(true);
  const [chapters, setChapters] = useState<ChapterNode[]>([]);
  const [selected, setSelected] = useState<SectionNode | null>(null);
  const [lesson, setLesson] = useState<LessonData | null>(null);
  const [loadingLesson, setLoadingLesson] = useState(false);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [savingSlide, setSavingSlide] = useState(false);
  const [activeTab, setActiveTab] = useState<'slides' | 'questions'>('slides');

  const loadTree = useCallback(async () => {
    setLoadingTree(true);
    try {
      const [toc, lessons] = await Promise.all([
        fetchCourseToc(),
        fetchGeneratedLessons(),
      ]);
      setChapters(buildChapters(toc, lessons));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '章节目录加载失败');
    } finally {
      setLoadingTree(false);
    }
  }, []);

  const generation = useJob<LessonData>({
    onDone: (result) => {
      setLesson(result);
      setActiveSlideIndex(0);
      setEditing(false);
      // Reflect the new state immediately; loadTree refreshes the sidebar counts.
      setSelected((prev) =>
        prev && prev.section_key === result.section_key
          ? { ...prev, lessonStatus: result.status, slideCount: result.slides.length }
          : prev,
      );
      toast.success(`已生成 ${result.slides.length} 张幻灯片`);
      void loadTree();
    },
    onFailed: (message) => toast.error(message),
  });

  const slideRegeneration = useJob<Slide>({
    onDone: (slide) => {
      setLesson((prev) =>
        prev
          ? {
              ...prev,
              status: 'edited',
              slides: prev.slides.map((s) => (s.slide_id === slide.slide_id ? slide : s)),
            }
          : prev,
      );
      setSelected((prev) => (prev ? { ...prev, lessonStatus: 'edited' } : prev));
      toast.success('已重新生成该页');
      void loadTree();
    },
    onFailed: (message) => toast.error(message),
  });

  useEffect(() => {
    void fetchCurrentUser()
      .then((user) => {
        if (user.role !== 'teacher' && user.role !== 'admin') {
          toast.error('只有教师可以进入课件生成');
          router.replace('/');
          return;
        }
        setReady(true);
      })
      .catch(() => {
        // authFetch already redirects unauthenticated users to /login.
      });
  }, [router]);

  useEffect(() => {
    if (ready) void loadTree();
  }, [ready, loadTree]);

  const { reset: resetJob, track: trackJob, active: generating } = generation;
  const {
    reset: resetSlideJob,
    track: trackSlideJob,
    active: regeneratingSlide,
  } = slideRegeneration;

  const handleSelect = useCallback(
    async (section: SectionNode) => {
      setSelected(section);
      setLesson(null);
      setActiveSlideIndex(0);
      setEditing(false);
      resetJob();
      resetSlideJob();
      if (section.lessonStatus === 'none') return;

      setLoadingLesson(true);
      try {
        setLesson(await fetchLesson(section.section_key));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '课件加载失败');
      } finally {
        setLoadingLesson(false);
      }
    },
    [resetJob, resetSlideJob],
  );

  const handleGenerate = useCallback(
    async (force: boolean) => {
      if (!selected || generating) return;
      try {
        const accepted = await queueLessonGeneration(selected.section_key, force);
        trackJob(accepted.job_id);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '生成任务创建失败');
      }
    },
    [selected, generating, trackJob],
  );

  const handleSaveSlide = useCallback(
    async (updated: Slide) => {
      if (!selected) return;
      setSavingSlide(true);
      try {
        const saved = await saveSlide(selected.section_key, updated.slide_id, updated);
        setLesson((prev) =>
          prev
            ? {
                ...prev,
                status: 'edited',
                slides: prev.slides.map((s) =>
                  s.slide_id === saved.slide_id ? saved : s,
                ),
              }
            : prev,
        );
        setSelected((prev) => (prev ? { ...prev, lessonStatus: 'edited' } : prev));
        setEditing(false);
        toast.success('已保存');
        void loadTree();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '保存失败');
      } finally {
        setSavingSlide(false);
      }
    },
    [selected, loadTree],
  );

  const handleRegenerateSlide = useCallback(
    async (slideId: string) => {
      if (!selected || regeneratingSlide) return;
      try {
        const accepted = await queueSlideRegeneration(selected.section_key, slideId);
        trackSlideJob(accepted.job_id);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '重新生成任务创建失败');
      }
    },
    [selected, regeneratingSlide, trackSlideJob],
  );

  const totals = useMemo(() => {
    const sections = chapters.reduce((sum, c) => sum + c.sections.length, 0);
    const generated = chapters.reduce((sum, c) => sum + c.generatedCount, 0);
    return { sections, generated };
  }, [chapters]);

  const slides = lesson?.slides ?? [];
  // Clamp so a shorter regenerated deck cannot leave the index out of range.
  const activeSlide = slides[Math.min(activeSlideIndex, Math.max(slides.length - 1, 0))];

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-200">
              <BookOpenCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="font-black">课件生成</div>
              <div className="text-xs text-slate-400">
                已生成 {totals.generated}/{totals.sections} 节
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push('/teacher')}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-500 hover:border-violet-200 hover:text-violet-600"
            >
              返回主页
            </button>
            <button
              type="button"
              onClick={() => void logoutUser()}
              className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-500 hover:border-red-200 hover:text-red-600"
            >
              <LogOut className="h-4 w-4" />
              退出
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-5 py-7 sm:px-8">
        <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
          <aside className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-24 xl:h-[calc(100vh-8rem)]">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-black">课程章节</h2>
                <p className="mt-1 text-xs text-slate-400">选择一节查看或生成课件</p>
              </div>
              <button
                type="button"
                onClick={() => void loadTree()}
                disabled={loadingTree}
                title="刷新章节状态"
                className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-50 hover:text-violet-600 disabled:opacity-40"
              >
                <RefreshCcw className={`h-4 w-4 ${loadingTree ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {loadingTree && chapters.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-400">
                <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                加载章节目录
              </div>
            ) : (
              <div className="h-[calc(100%-4.5rem)]">
                <ChapterTree
                  chapters={chapters}
                  selectedKey={selected?.section_key ?? null}
                  onSelect={(section) => void handleSelect(section)}
                />
              </div>
            )}
          </aside>

          <section className="min-h-[60vh] rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            {!selected ? (
              <div className="flex h-full min-h-[50vh] flex-col items-center justify-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-50 text-violet-500">
                  <Sparkles className="h-7 w-7" />
                </div>
                <h3 className="mt-5 text-lg font-black">从左侧选择一节开始</h3>
                <p className="mt-2 max-w-sm text-sm text-slate-500">
                  绿色对勾表示已生成课件，黄色铅笔表示教师改过，灰色圆点表示尚未生成。
                </p>
              </div>
            ) : (
              <div>
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-5">
                  <div>
                    <div className="text-xs font-bold text-violet-600">
                      第{selected.chapter_number}章 {selected.chapter_title}
                    </div>
                    <h3 className="mt-1 text-2xl font-black">
                      {selected.section_number} {selected.section_title}
                    </h3>
                    <div className="mt-2 text-sm text-slate-500">
                      {selected.lessonStatus === 'none'
                        ? '尚未生成课件'
                        : `已有 ${slides.length || selected.slideCount} 张幻灯片`}
                      {selected.lessonStatus === 'edited' && ' · 教师已编辑'}
                    </div>
                  </div>

                  <div
                    className={`flex items-center gap-2 ${activeTab === 'slides' ? '' : 'hidden'}`}
                  >
                    {selected.lessonStatus === 'none' ? (
                      <button
                        type="button"
                        onClick={() => void handleGenerate(false)}
                        disabled={generation.active}
                        className="flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-violet-200 transition hover:bg-violet-700 disabled:opacity-60"
                      >
                        {generation.active ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Sparkles className="h-4 w-4" />
                        )}
                        生成课件
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleGenerate(true)}
                        disabled={generation.active || regeneratingSlide || editing}
                        title={editing ? '请先保存或取消当前编辑' : undefined}
                        className="flex items-center gap-2 rounded-xl border border-violet-200 px-4 py-2.5 text-sm font-bold text-violet-600 transition hover:bg-violet-50 disabled:opacity-60"
                      >
                        {generation.active ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCcw className="h-4 w-4" />
                        )}
                        重新生成整节
                      </button>
                    )}
                  </div>
                </div>

                <div
                  role="tablist"
                  aria-label="课件与题目"
                  className="mt-5 flex gap-1 rounded-xl bg-slate-100 p-1"
                >
                  {(
                    [
                      { key: 'slides', label: '课件', icon: Presentation },
                      { key: 'questions', label: '题目', icon: ListChecks },
                    ] as const
                  ).map(({ key, label, icon: Icon }) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === key}
                      onClick={() => setActiveTab(key)}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold transition ${
                        activeTab === key
                          ? 'bg-white text-violet-700 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </button>
                  ))}
                </div>

                {activeTab === 'questions' ? (
                  <QuestionsPanel
                    key={selected.section_key}
                    sectionKey={selected.section_key}
                    sectionLabel={`${selected.section_number} ${selected.section_title}`}
                  />
                ) : (
                <>
                {generation.active && (
                  <div
                    role="status"
                    className="mt-5 flex items-center gap-3 rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3 text-sm text-violet-700"
                  >
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    <span>
                      {generation.status === 'pending'
                        ? '任务已排队，正在启动…'
                        : 'AI 正在生成课件，通常需要 30-70 秒，可以先做别的事。'}
                    </span>
                  </div>
                )}

                {generation.status === 'failed' && generation.error && (
                  <div className="mt-5 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                    {generation.error}
                  </div>
                )}

                <div className="mt-6">
                  {loadingLesson ? (
                    <div className="py-16 text-center text-sm text-slate-400">
                      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                      加载课件
                    </div>
                  ) : slides.length > 0 && activeSlide ? (
                    <div className="grid gap-5 lg:grid-cols-[200px_1fr]">
                      <ol className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
                        {slides.map((slide, index) => {
                          const active = slide.slide_id === activeSlide.slide_id;
                          return (
                            <li key={slide.slide_id} className="shrink-0 lg:shrink">
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveSlideIndex(index);
                                  setEditing(false);
                                }}
                                aria-current={active ? 'true' : undefined}
                                className={`flex w-44 gap-2 rounded-xl border p-3 text-left transition lg:w-full ${
                                  active
                                    ? 'border-violet-300 bg-violet-50 shadow-sm'
                                    : 'border-slate-200 hover:border-violet-200'
                                }`}
                              >
                                <span
                                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold ${
                                    active
                                      ? 'bg-violet-600 text-white'
                                      : 'bg-slate-100 text-slate-500'
                                  }`}
                                >
                                  {slide.order}
                                </span>
                                <span className="line-clamp-2 text-xs font-bold text-slate-700">
                                  {slide.title}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ol>

                      <div className="min-w-0">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-bold text-slate-500">
                            第 {activeSlide.order} 张 / 共 {slides.length} 张
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setEditing(true)}
                              disabled={regeneratingSlide}
                              className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 transition hover:border-violet-200 hover:text-violet-600 disabled:opacity-60"
                            >
                              <Pencil className="h-4 w-4" />
                              编辑本页
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleRegenerateSlide(activeSlide.slide_id)}
                              disabled={regeneratingSlide || generating}
                              className="flex items-center gap-1.5 rounded-xl border border-violet-200 px-3 py-2 text-sm font-bold text-violet-600 transition hover:bg-violet-50 disabled:opacity-60"
                            >
                              {regeneratingSlide ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Wand2 className="h-4 w-4" />
                              )}
                              重生成本页
                            </button>
                          </div>
                        </div>

                        {regeneratingSlide && (
                          <div
                            role="status"
                            className="mb-4 flex items-center gap-3 rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3 text-sm text-violet-700"
                          >
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                            AI 正在重新生成这一页，约 15-30 秒。
                          </div>
                        )}

                        {slideRegeneration.status === 'failed' && slideRegeneration.error && (
                          <div className="mb-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                            {slideRegeneration.error}
                          </div>
                        )}

                        <SlidePreview slide={activeSlide} />
                      </div>
                    </div>
                  ) : selected.lessonStatus !== 'none' && !generation.active ? (
                    <div className="py-16 text-center text-sm text-slate-400">
                      该章节暂无幻灯片内容
                    </div>
                  ) : null}
                </div>
                </>
                )}
              </div>
            )}
          </section>
        </div>
      </main>

      {editing && activeSlide && selected && (
        <SlideEditorDialog
          key={activeSlide.slide_id}
          slide={activeSlide}
          sectionLabel={`第${selected.chapter_number}章 ${selected.chapter_title} · ${selected.section_number} ${selected.section_title}`}
          totalSlides={slides.length}
          saving={savingSlide}
          onClose={() => setEditing(false)}
          onSave={(updated) => void handleSaveSlide(updated)}
        />
      )}
    </div>
  );
}
