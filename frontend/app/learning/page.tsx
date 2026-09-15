'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  ChevronLeft,
  ClipboardCheck,
  Loader2,
  RefreshCcw,
  Settings,
  Target,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { SettingsDialog } from '@/components/settings';
import { fetchLearningDashboard, fetchStudentAssignments } from './learning-client';
import { Pagination, clampPage, pageSlice } from './pagination';
import type { LearningDashboard, MasteryLevel, MistakeRecord, StudentAssignment } from './types';

type PageKey = 'recommendations' | 'sections' | 'knowledge' | 'mistakes' | 'practices';
type ChapterScopedItem = { chapter_title: string; section_number: string };
type MistakeGroup = {
  section_key: string;
  section_number: string;
  section_title: string;
  items: MistakeRecord[];
};

const PAGE_SIZES: Record<PageKey, number> = {
  recommendations: 1,
  sections: 4,
  knowledge: 6,
  mistakes: 4,
  practices: 4,
};

const INITIAL_PAGES: Record<PageKey, number> = {
  recommendations: 1,
  sections: 1,
  knowledge: 1,
  mistakes: 1,
  practices: 1,
};

function chapterKey(item: ChapterScopedItem): string {
  return item.section_number.split('.')[0] || item.section_number;
}

function chapterOptions(items: ChapterScopedItem[]): { value: string; label: string }[] {
  const chapters = new Map<string, string>();
  for (const item of items) {
    const value = chapterKey(item);
    if (!chapters.has(value)) chapters.set(value, item.chapter_title);
  }
  return Array.from(chapters, ([value, title]) => ({
    value,
    label: '第 ' + value + ' 章 · ' + title,
  })).sort((left, right) => Number(left.value) - Number(right.value));
}

function levelLabel(level: MasteryLevel): string {
  if (level === 'mastered') return '已掌握';
  if (level === 'developing') return '巩固中';
  return '需要复习';
}

function levelClass(level: MasteryLevel): string {
  if (level === 'mastered')
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300';
  if (level === 'developing')
    return 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300';
  return 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-300';
}

function answerText(value: string | boolean, options: string[]): string {
  if (typeof value === 'boolean') return value ? '正确' : '错误';
  const index = value.trim().toUpperCase().charCodeAt(0) - 65;
  return options[index] ? value.toUpperCase() + '. ' + options[index] : value || '未作答';
}

function formatDate(value: string | null): string {
  if (!value) return '暂无记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
      <div
        className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500"
        style={{ width: String(Math.min(100, Math.max(0, value))) + '%' }}
      />
    </div>
  );
}

function MistakeCard({ item }: { item: MistakeRecord }) {
  return (
    <article className="rounded-2xl border border-red-100 bg-red-50/50 p-5 dark:border-red-950/50 dark:bg-red-950/10">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-red-100 px-2.5 py-1 font-bold text-red-700 dark:bg-red-950/40 dark:text-red-300">
          错题
        </span>
        <span className="text-gray-500 dark:text-gray-400">
          {item.section_number} {item.section_title}
        </span>
        <span className="ml-auto text-gray-400">{formatDate(item.submitted_at)}</span>
      </div>
      <h3 className="font-bold leading-7 text-gray-900 dark:text-gray-100">{item.stem}</h3>
      {item.type === 'single_choice' && item.options.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {item.options.map((option, index) => {
            const key = String.fromCharCode(65 + index);
            const selected = item.answer === key;
            const correct = item.correct_answer === key;
            return (
              <div
                key={key + option}
                className={
                  'rounded-lg px-3 py-2 text-sm ' +
                  (correct
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200'
                    : selected
                      ? 'bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-200'
                      : 'text-gray-600 dark:text-gray-300')
                }
              >
                <span className="mr-2 font-bold">{key}.</span>
                {option}
                {selected && <span className="ml-2 text-xs font-bold">你的选择</span>}
                {correct && <span className="ml-2 text-xs font-bold">正确答案</span>}
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-xl bg-white/70 p-3 dark:bg-gray-900/40">
          <span className="text-xs text-gray-400">你的答案</span>
          <div className="mt-1 font-medium text-red-800 dark:text-red-200">
            {answerText(item.answer, item.options)}
          </div>
        </div>
        <div className="rounded-xl bg-white/70 p-3 dark:bg-gray-900/40">
          <span className="text-xs text-gray-400">正确答案</span>
          <div className="mt-1 font-medium text-emerald-800 dark:text-emerald-200">
            {answerText(item.correct_answer, item.options)}
          </div>
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-gray-300">{item.analysis}</p>
      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-gray-400">
        <span>知识点：{item.knowledge_point}</span>
        <Link
          href={
            '/learning/review?section_key=' +
            encodeURIComponent(item.section_key) +
            '&knowledge_point=' +
            encodeURIComponent(item.knowledge_point)
          }
          className="font-bold text-violet-600 hover:text-violet-700"
        >
          复习这个知识点 <ArrowRight className="inline h-3.5 w-3.5" />
        </Link>
      </div>
    </article>
  );
}

export default function LearningPage() {
  const [dashboard, setDashboard] = useState<LearningDashboard | null>(null);
  const [studentAssignments, setStudentAssignments] = useState<StudentAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pages, setPages] = useState<Record<PageKey, number>>(INITIAL_PAGES);
  const [knowledgeChapter, setKnowledgeChapter] = useState('all');
  const [mistakeChapter, setMistakeChapter] = useState('all');

  function changePage(key: PageKey, page: number, totalItems: number) {
    setPages((current) => ({
      ...current,
      [key]: clampPage(page, totalItems, PAGE_SIZES[key]),
    }));
  }

  async function loadDashboard() {
    setLoading(true);
    try {
      const [nextDashboard, assignments] = await Promise.all([
        fetchLearningDashboard(),
        fetchStudentAssignments()
          .then((result) => result.items)
          .catch(() => []),
      ]);
      setDashboard(nextDashboard);
      setStudentAssignments(assignments);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '学习数据加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, []);

  const knowledgeItems = dashboard?.knowledge_mastery ?? [];
  const mistakeItems = dashboard?.mistakes ?? [];
  const filteredKnowledge =
    knowledgeChapter === 'all'
      ? knowledgeItems
      : knowledgeItems.filter((item) => chapterKey(item) === knowledgeChapter);
  const filteredMistakes =
    mistakeChapter === 'all'
      ? mistakeItems
      : mistakeItems.filter((item) => chapterKey(item) === mistakeChapter);
  const pendingAssignments = studentAssignments
    .filter(
      (assignment) =>
        assignment.assignment_status === 'active' && assignment.progress_status !== 'completed',
    )
    .sort((left, right) => {
      const statusRank = (assignment: StudentAssignment) =>
        assignment.progress_status === 'in_progress' ? 0 : 1;
      const statusDifference = statusRank(left) - statusRank(right);
      if (statusDifference !== 0) return statusDifference;
      const dueTime = (assignment: StudentAssignment) => {
        if (!assignment.due_at) return Number.MAX_SAFE_INTEGER;
        const value = new Date(assignment.due_at).getTime();
        return Number.isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
      };
      return dueTime(left) - dueTime(right);
    });
  const nextAssignment = pendingAssignments[0] ?? null;
  const nextRecommendation = dashboard?.recommendations[0] ?? null;
  const nextActionHref = nextAssignment
    ? '/practice?assignment_id=' +
      encodeURIComponent(nextAssignment.id) +
      '&section_key=' +
      encodeURIComponent(nextAssignment.section_key)
    : (nextRecommendation?.href ?? '/practice');
  const nextActionTitle = nextAssignment
    ? (nextAssignment.progress_status === 'in_progress' ? '继续完成教师作业：' : '开始教师作业：') +
      nextAssignment.section_number +
      ' ' +
      nextAssignment.section_title
    : (nextRecommendation?.title ?? '开始下一节学习');
  const nextActionReason = nextAssignment
    ? nextAssignment.due_at
      ? '截止：' + formatDate(nextAssignment.due_at)
      : '这是当前优先处理的教师任务。'
    : (nextRecommendation?.reason ?? '完成一次章节练习后，这里会生成更具体的学习建议。');
  const nextActionLabel = nextAssignment
    ? nextAssignment.progress_status === 'in_progress'
      ? '继续完成'
      : '开始完成'
    : (nextRecommendation?.action_label ?? '开始练习');
  const sectionMastery = dashboard?.section_mastery ?? [];
  const prioritySections = [...sectionMastery]
    .filter((item) => item.mastery_level === 'needs_review' || item.score_rate < 70)
    .sort((left, right) => left.score_rate - right.score_rate)
    .slice(0, 3);
  const developingSections = [...sectionMastery]
    .filter(
      (item) =>
        item.mastery_level === 'developing' &&
        !prioritySections.some((section) => section.section_key === item.section_key),
    )
    .sort((left, right) => left.score_rate - right.score_rate)
    .slice(0, 3);
  const masteredSectionCount = sectionMastery.filter(
    (item) => item.mastery_level === 'mastered',
  ).length;
  const mistakeGroups = useMemo<MistakeGroup[]>(() => {
    const groups = new Map<string, MistakeGroup>();
    for (const item of filteredMistakes) {
      const group = groups.get(item.section_key) ?? {
        section_key: item.section_key,
        section_number: item.section_number,
        section_title: item.section_title,
        items: [],
      };
      group.items.push(item);
      groups.set(item.section_key, group);
    }
    return Array.from(groups.values()).sort(
      (left, right) => right.items.length - left.items.length,
    );
  }, [filteredMistakes]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="flex items-center justify-between border-b border-gray-200/70 bg-white/80 px-6 py-4 backdrop-blur dark:border-gray-800 dark:bg-gray-900/80 sm:px-10">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-violet-600 dark:hover:bg-gray-800"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600">
            <BarChart3 className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-gray-900 dark:text-gray-100">学习中心</h1>
            <p className="text-xs text-gray-400">掌握度、错题与下一步建议</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadDashboard()}
            className="rounded-xl border border-gray-200 p-2 text-gray-500 hover:border-violet-300 hover:text-violet-600 dark:border-gray-700"
          >
            <RefreshCcw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:border-violet-300 hover:text-violet-600 dark:border-gray-700 dark:text-gray-300"
          >
            <Settings className="h-4 w-4" />
            设置
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8 sm:px-10">
        {loading && !dashboard ? (
          <div className="flex min-h-[420px] items-center justify-center text-gray-400">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            正在整理你的学习数据…
          </div>
        ) : dashboard ? (
          <div className="space-y-8">
            <section className="rounded-3xl bg-gradient-to-br from-violet-600 to-indigo-700 p-6 text-white shadow-xl shadow-violet-200/40 sm:p-8">
              <div className="flex flex-wrap items-end justify-between gap-5">
                <div className="min-w-0">
                  <p className="text-sm text-violet-100">你下一步该做什么</p>
                  <h2 className="mt-1 max-w-3xl text-2xl font-black sm:text-3xl">
                    {nextActionTitle}
                  </h2>
                  <p className="mt-2 text-sm text-violet-100">{nextActionReason}</p>
                </div>
                <Link
                  href={nextActionHref}
                  className="shrink-0 rounded-xl bg-white/15 px-4 py-2 text-sm font-bold hover:bg-white/25"
                >
                  {nextActionLabel} <ArrowRight className="inline h-4 w-4" />
                </Link>
              </div>
              <div className="mt-7 grid grid-cols-2 gap-4 border-t border-white/20 pt-5 sm:grid-cols-3">
                <div>
                  <div className="text-3xl font-black">{dashboard.summary.overall_score_rate}%</div>
                  <div className="text-xs text-violet-100">总体掌握度</div>
                </div>
                <div>
                  <div className="text-3xl font-black">{dashboard.summary.mistake_count}</div>
                  <div className="text-xs text-violet-100">待复习错题</div>
                </div>
                <div>
                  <div className="text-3xl font-black">{dashboard.summary.learned_sections}</div>
                  <div className="text-xs text-violet-100">已学习小节</div>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">小节掌握度</h2>
                  <p className="mt-1 text-sm text-gray-400">
                    先处理掌握度较低的小节，再下钻查看知识点原因
                  </p>
                </div>
                <BookOpen className="h-5 w-5 text-indigo-500" />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-red-100 bg-red-50/50 p-4 dark:border-red-950/40 dark:bg-red-950/10">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="font-bold text-red-800 dark:text-red-200">需要优先复习</h3>
                    <span className="text-xs text-red-500">{prioritySections.length} 个小节</span>
                  </div>
                  <div className="space-y-3">
                    {prioritySections.length ? (
                      prioritySections.map((item) => (
                        <Link
                          key={item.section_key}
                          href={'/practice?section_key=' + encodeURIComponent(item.section_key)}
                          className="block rounded-xl bg-white p-3 transition hover:ring-2 hover:ring-red-200 dark:bg-gray-900"
                        >
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="truncate font-bold text-gray-800 dark:text-gray-100">
                              {item.section_number} {item.section_title}
                            </span>
                            <span className="shrink-0 font-black text-red-600">
                              {item.score_rate}%
                            </span>
                          </div>
                          <div className="mt-2">
                            <ProgressBar value={item.score_rate} />
                          </div>
                          <div className="mt-2 text-xs font-bold text-red-500">
                            去复习 <ArrowRight className="inline h-3.5 w-3.5" />
                          </div>
                        </Link>
                      ))
                    ) : (
                      <p className="rounded-xl bg-white/70 p-3 text-sm text-red-700 dark:bg-gray-900/60 dark:text-red-200">
                        目前没有需要优先复习的小节。
                      </p>
                    )}
                  </div>
                </div>
                <div className="rounded-2xl border border-amber-100 bg-amber-50/50 p-4 dark:border-amber-950/40 dark:bg-amber-950/10">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="font-bold text-amber-800 dark:text-amber-200">正在巩固</h3>
                    <span className="text-xs text-amber-500">
                      {masteredSectionCount} 个小节已掌握
                    </span>
                  </div>
                  <div className="space-y-3">
                    {developingSections.length ? (
                      developingSections.map((item) => (
                        <Link
                          key={item.section_key}
                          href={'/practice?section_key=' + encodeURIComponent(item.section_key)}
                          className="block rounded-xl bg-white p-3 transition hover:ring-2 hover:ring-amber-200 dark:bg-gray-900"
                        >
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="truncate font-bold text-gray-800 dark:text-gray-100">
                              {item.section_number} {item.section_title}
                            </span>
                            <span className="shrink-0 font-black text-amber-600">
                              {item.score_rate}%
                            </span>
                          </div>
                          <div className="mt-2">
                            <ProgressBar value={item.score_rate} />
                          </div>
                        </Link>
                      ))
                    ) : (
                      <p className="rounded-xl bg-white/70 p-3 text-sm text-amber-700 dark:bg-gray-900/60 dark:text-amber-200">
                        完成更多练习后，这里会显示正在巩固的小节。
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <details className="mt-5 rounded-2xl border border-gray-100 p-4 dark:border-gray-800">
                <summary className="cursor-pointer list-none text-sm font-bold text-violet-600">
                  查看全部小节掌握情况
                </summary>
                <div className="mt-4 space-y-4">
                  {sectionMastery.length ? (
                    pageSlice(sectionMastery, pages.sections, PAGE_SIZES.sections).map((item) => (
                      <div key={item.section_key}>
                        <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                          <span className="truncate font-medium text-gray-700 dark:text-gray-200">
                            {item.section_number} {item.section_title}
                          </span>
                          <span className="shrink-0 font-bold text-violet-600">
                            {item.score_rate}%
                          </span>
                        </div>
                        <ProgressBar value={item.score_rate} />
                        <div className="mt-1 flex items-center justify-between text-xs text-gray-400">
                          <span>
                            {item.answered_questions} 题 · {item.practice_count} 次练习
                          </span>
                          <span
                            className={
                              'rounded-full px-2 py-0.5 font-bold ' + levelClass(item.mastery_level)
                            }
                          >
                            {levelLabel(item.mastery_level)}
                          </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                      还没有小节练习记录，先完成一次练习吧。
                    </p>
                  )}
                </div>
                <Pagination
                  page={pages.sections}
                  pageSize={PAGE_SIZES.sections}
                  totalItems={sectionMastery.length}
                  onPageChange={(page) => changePage('sections', page, sectionMastery.length)}
                />
              </details>
            </section>

            <details className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <summary className="flex cursor-pointer list-none items-center justify-between text-xl font-bold text-gray-900 dark:text-gray-100">
                <span>
                  知识点诊断{' '}
                  <span className="ml-2 text-sm font-normal text-gray-400">展开查看薄弱原因</span>
                </span>
                <Target className="h-5 w-5 text-violet-500" />
              </summary>
              <div className="mt-5">
                <div className="mb-5 flex flex-wrap items-center justify-end gap-3">
                  <select
                    value={knowledgeChapter}
                    onChange={(event) => {
                      setKnowledgeChapter(event.target.value);
                      changePage('knowledge', 1, knowledgeItems.length);
                    }}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 outline-none transition focus:border-violet-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  >
                    <option value="all">全部章节</option>
                    {chapterOptions(knowledgeItems).map((chapter) => (
                      <option key={chapter.value} value={chapter.value}>
                        {chapter.label}
                      </option>
                    ))}
                  </select>
                  <Link href="/practice" className="text-sm font-bold text-violet-600">
                    去练习 <ArrowRight className="inline h-4 w-4" />
                  </Link>
                </div>
                {filteredKnowledge.length ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    {pageSlice(filteredKnowledge, pages.knowledge, PAGE_SIZES.knowledge).map(
                      (item) => (
                        <div
                          key={item.section_key + '-' + item.knowledge_point}
                          className="rounded-2xl border border-gray-100 p-4 dark:border-gray-800"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate font-bold text-gray-800 dark:text-gray-100">
                                {item.knowledge_point}
                              </div>
                              <div className="mt-1 text-xs text-gray-400">
                                {item.section_number} {item.section_title} · {item.attempts} 次作答
                              </div>
                            </div>
                            <span
                              className={
                                'shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ' +
                                levelClass(item.mastery_level)
                              }
                            >
                              {levelLabel(item.mastery_level)}
                            </span>
                          </div>
                          <div className="mt-3 flex items-center gap-3">
                            <div className="flex-1">
                              <ProgressBar value={item.score_rate} />
                            </div>
                            <span className="w-12 text-right text-sm font-bold text-gray-600 dark:text-gray-300">
                              {item.score_rate}%
                            </span>
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                ) : (
                  <p className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    当前没有知识点诊断数据。
                  </p>
                )}
                <Pagination
                  page={pages.knowledge}
                  pageSize={PAGE_SIZES.knowledge}
                  totalItems={filteredKnowledge.length}
                  onPageChange={(page) => changePage('knowledge', page, filteredKnowledge.length)}
                />
              </div>
            </details>

            <section id="mistakes" className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="flex h-[650px] flex-col rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">错题复习</h2>
                    <p className="mt-1 text-sm text-gray-400">
                      先按小节集中处理，再展开查看具体题目
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <select
                      value={mistakeChapter}
                      onChange={(event) => {
                        setMistakeChapter(event.target.value);
                        changePage('mistakes', 1, mistakeItems.length);
                      }}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 outline-none transition focus:border-violet-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                    >
                      <option value="all">全部章节</option>
                      {chapterOptions(mistakeItems).map((chapter) => (
                        <option key={chapter.value} value={chapter.value}>
                          {chapter.label}
                        </option>
                      ))}
                    </select>
                    <XCircle className="h-5 w-5 text-red-500" />
                  </div>
                </div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                  {mistakeGroups.length ? (
                    pageSlice(mistakeGroups, pages.mistakes, PAGE_SIZES.mistakes).map((group) => (
                      <article
                        key={group.section_key}
                        className="rounded-2xl border border-red-100 bg-red-50/40 p-4 dark:border-red-950/40 dark:bg-red-950/10"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-bold text-gray-800 dark:text-gray-100">
                              {group.section_number} {group.section_title}
                            </div>
                            <div className="mt-1 text-xs text-red-600">
                              {group.items.length} 道待复习错题
                            </div>
                          </div>
                          <Link
                            href={'/practice?section_key=' + encodeURIComponent(group.section_key)}
                            className="shrink-0 text-xs font-bold text-red-600"
                          >
                            集中复习 <ArrowRight className="inline h-3.5 w-3.5" />
                          </Link>
                        </div>
                        <details className="mt-3 rounded-xl bg-white/70 p-3 dark:bg-gray-900/50">
                          <summary className="cursor-pointer text-xs font-bold text-gray-600 dark:text-gray-300">
                            查看题目
                          </summary>
                          <div className="mt-3 space-y-3">
                            {group.items.map((item) => (
                              <MistakeCard
                                key={item.session_id + '-' + item.question_id}
                                item={item}
                              />
                            ))}
                          </div>
                        </details>
                      </article>
                    ))
                  ) : (
                    <p className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300">
                      {mistakeChapter === 'all'
                        ? '目前没有错题，继续保持。'
                        : '第 ' + mistakeChapter + ' 章目前没有错题。'}
                    </p>
                  )}
                </div>
                <Pagination
                  page={pages.mistakes}
                  pageSize={PAGE_SIZES.mistakes}
                  totalItems={mistakeGroups.length}
                  onPageChange={(page) => changePage('mistakes', page, mistakeGroups.length)}
                />
              </div>
              <div className="flex h-[650px] flex-col rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">最近练习</h2>
                    <p className="mt-1 text-sm text-gray-400">每次提交都会更新掌握度</p>
                  </div>
                  <ClipboardCheck className="h-5 w-5 text-fuchsia-500" />
                </div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                  {dashboard.recent_practices.length ? (
                    pageSlice(
                      dashboard.recent_practices,
                      pages.practices,
                      PAGE_SIZES.practices,
                    ).map((item) => (
                      <div
                        key={item.session_id}
                        className="rounded-2xl border border-gray-100 p-4 dark:border-gray-800"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="truncate font-bold text-gray-800 dark:text-gray-100">
                            {item.section_number} {item.section_title}
                          </div>
                          <div className="shrink-0 text-lg font-black text-violet-600">
                            {item.total_score}/{item.max_score}
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
                          <span>
                            {item.difficulty} · {formatDate(item.submitted_at)}
                          </span>
                          <span>{item.score_rate}%</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                      还没有提交过练习。
                    </p>
                  )}
                </div>
                <Pagination
                  page={pages.practices}
                  pageSize={PAGE_SIZES.practices}
                  totalItems={dashboard.recent_practices.length}
                  onPageChange={(page) =>
                    changePage('practices', page, dashboard.recent_practices.length)
                  }
                />
              </div>
            </section>
          </div>
        ) : null}
      </main>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
