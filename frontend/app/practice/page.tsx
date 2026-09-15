'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  Settings,
  Sparkles,
  Target,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { SettingsDialog } from '@/components/settings';
import { fetchToc } from '../lesson/lesson-client';
import type { TocItem } from '../lesson/types';
import { generatePractice, submitPractice } from './practice-client';
import { fetchStudentAssignments, startStudentAssignment } from '../learning/learning-client';
import type {
  Difficulty,
  PracticeQuestion,
  PracticeSubmitResult,
  QuestionType,
} from './types';

type PracticeMode = 'regular' | 'knowledge_check' | 'assignment';

const QUESTION_TYPE_OPTIONS: Array<{
  value: QuestionType;
  label: string;
  description: string;
}> = [
  { value: 'single_choice', label: '单项选择', description: '检验概念辨析与知识理解' },
  { value: 'true_false', label: '判断题', description: '快速确认关键观点是否掌握' },
  { value: 'short_answer', label: '简答题', description: '由 AI 按教材评分点智能批改' },
];

const DIFFICULTY_OPTIONS: Array<{
  value: Difficulty;
  label: string;
  description: string;
}> = [
  { value: 'easy', label: '基础', description: '核心概念与教材原文' },
  { value: 'medium', label: '进阶', description: '理解、比较与简单应用' },
  { value: 'hard', label: '挑战', description: '综合分析与迁移思考' },
];

const TYPE_LABELS: Record<QuestionType, string> = {
  single_choice: '单项选择',
  true_false: '判断题',
  short_answer: '简答题',
};

function answerText(value: string | boolean): string {
  if (typeof value === 'boolean') return value ? '正确' : '错误';
  return value || '未作答';
}

function answerWithOptionText(value: string | boolean, options: string[]): string {
  if (typeof value === 'boolean') return answerText(value);
  const optionIndex = value.trim().toUpperCase().charCodeAt(0) - 65;
  const option = options[optionIndex];
  return option ? `${value.toUpperCase()}. ${option}` : answerText(value);
}

function isAnswered(question: PracticeQuestion, value: string | boolean | undefined): boolean {
  if (value === undefined) return false;
  if (question.type === 'short_answer') return String(value).trim().length > 0;
  return true;
}

export default function PracticePage() {
  const [toc, setToc] = useState<TocItem[]>([]);
  const [tocLoading, setTocLoading] = useState(true);
  const [tocError, setTocError] = useState('');
  const [sectionKey, setSectionKey] = useState('');
  const [questionTypes, setQuestionTypes] = useState<QuestionType[]>([
    'single_choice',
    'true_false',
    'short_answer',
  ]);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [questionCount, setQuestionCount] = useState(5);
  const [knowledgePoint, setKnowledgePoint] = useState('');
  const [practiceMode, setPracticeMode] = useState<PracticeMode>('regular');
  const [assignmentId, setAssignmentId] = useState('');
  const [session, setSession] = useState<Awaited<ReturnType<typeof generatePractice>> | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [result, setResult] = useState<PracticeSubmitResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    let active = true;
    fetchToc()
      .then((items) => {
        if (!active) return;
        setToc(items);
        const params = new URLSearchParams(window.location.search);
        const requestedSection = params.get('section_key');
        const requestedKnowledgePoint = params.get('knowledge_point');
        const requestedMode = params.get('mode');
        const requestedAssignment = params.get('assignment_id');
        const validRequestedSection = items.some((item) => item.section_key === requestedSection);
        setSectionKey(
          (current) => current || (validRequestedSection ? requestedSection ?? '' : items[0]?.section_key || ''),
        );
        if (requestedKnowledgePoint) setKnowledgePoint(requestedKnowledgePoint);
        if (
          requestedMode === 'knowledge_check' &&
          requestedKnowledgePoint &&
          validRequestedSection
        ) {
          setPracticeMode('knowledge_check');
          setQuestionTypes(['single_choice', 'true_false', 'short_answer']);
          setDifficulty('medium');
          setQuestionCount(3);
        }
        if (requestedAssignment) {
          setAssignmentId(requestedAssignment);
          setPracticeMode('assignment');
          void fetchStudentAssignments()
            .then((result) => {
              const assignment = result.items.find((item) => item.id === requestedAssignment);
              if (!assignment) return;
              setSectionKey(assignment.section_key);
              setKnowledgePoint(assignment.knowledge_point);
              setDifficulty(assignment.difficulty);
              setQuestionTypes(assignment.question_types);
              setQuestionCount(assignment.question_count);
            })
            .catch((error: unknown) => {
              if (active) toast.error(error instanceof Error ? error.message : '获取教师作业详情失败');
            });
        }
        setTocError('');
      })
      .catch((error: unknown) => {
        if (!active) return;
        setTocError(error instanceof Error ? error.message : '获取课程目录失败');
      })
      .finally(() => {
        if (active) setTocLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const groupedToc = useMemo(() => {
    const chapters = new Map<number, { title: string; items: TocItem[] }>();
    toc.forEach((item) => {
      const chapter = chapters.get(item.chapter_number);
      if (chapter) chapter.items.push(item);
      else chapters.set(item.chapter_number, { title: item.chapter_title, items: [item] });
    });
    return Array.from(chapters.entries());
  }, [toc]);

  const selectedSection = toc.find((item) => item.section_key === sectionKey);
  const isKnowledgeCheck = practiceMode === 'knowledge_check';
  const isAssignment = practiceMode === 'assignment';
  const isLocked = isKnowledgeCheck || isAssignment;
  const reviewHref =
    isKnowledgeCheck && sectionKey && knowledgePoint
      ? '/learning/review?section_key=' + encodeURIComponent(sectionKey) +
        '&knowledge_point=' + encodeURIComponent(knowledgePoint)
      : '/';
  const currentQuestion = session?.questions[currentIndex];
  const answeredCount = session
    ? session.questions.filter((question) => isAnswered(question, answers[question.id])).length
    : 0;

  function toggleQuestionType(value: QuestionType) {
    if (isLocked) return;
    setQuestionTypes((current) => {
      if (!current.includes(value)) return [...current, value];
      if (current.length === 1) {
        toast.info('至少保留一种题型');
        return current;
      }
      return current.filter((item) => item !== value);
    });
  }

  async function handleGenerate() {
    if (!sectionKey) {
      toast.error('请先选择一个课程章节');
      return;
    }
    setGenerating(true);
    try {
      if (isAssignment && !assignmentId) {
        toast.error('作业参数无效，请返回首页重新进入。');
        return;
      }
      const generated = isAssignment
        ? await startStudentAssignment(assignmentId)
        : await generatePractice({
            sectionKey,
            questionTypes,
            difficulty,
            questionCount,
            knowledgePoint,
          });
      setSession(generated);
      setAnswers({});
      setCurrentIndex(0);
      setResult(null);
      if (generated.questions.length < questionCount) {
        toast.info(
          '当前筛选条件下题库共有 ' + generated.questions.length + ' 题，已全部抽取。',
        );
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成练习失败，请稍后重试');
    } finally {
      setGenerating(false);
    }
  }

  async function handleSubmit() {
    if (!session) return;
    const missing = session.questions.filter(
      (question) => !isAnswered(question, answers[question.id]),
    );
    if (missing.length) {
      const firstMissing = session.questions.findIndex((question) =>
        missing.some((item) => item.id === question.id),
      );
      setCurrentIndex(firstMissing);
      toast.error('还有 ' + missing.length + ' 道题未完成');
      return;
    }

    setSubmitting(true);
    try {
      const submitted = await submitPractice(
        session.session_id,
        session.questions.map((question) => ({
          question_id: question.id,
          answer: answers[question.id],
        })),
      );
      setResult(submitted);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  function resetPractice() {
    setSession(null);
    setResult(null);
    setAnswers({});
    setCurrentIndex(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="sticky top-0 z-30 h-16 border-b border-gray-200/70 bg-white/85 px-6 backdrop-blur-md dark:border-gray-800 dark:bg-gray-900/85 sm:px-10">
        <div className="flex h-full items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href={reviewHref}
              className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-violet-600 dark:hover:bg-gray-800"
              aria-label="返回"
            >
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-600 shadow-md shadow-violet-200/50 dark:shadow-none">
              <ClipboardCheck className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-gray-900 dark:text-gray-100 sm:text-base">
                {isKnowledgeCheck ? '知识点巩固' : '章节练习'}
              </h1>
              <p className="hidden text-xs text-gray-400 sm:block">
                {isKnowledgeCheck ? '复习后验证 · 专项题目 · 更新掌握度' : '教材出题 · 智能批改 · 原文解析'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 shadow-sm transition hover:border-violet-400 hover:text-violet-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
          >
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">设置</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-12">
        {!session && !result && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
            <div className="mb-8 text-center">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-4 py-1.5 text-sm font-medium text-violet-600 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-300">
                <Sparkles className="h-4 w-4" />
                {isKnowledgeCheck
                  ? '只从当前知识点的预生成题库中抽取，不混入其他知识点'
                  : '章节题库随机组卷，不需要临时等待 AI 出题'}
              </div>
              <h2 className="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white">
                {isKnowledgeCheck ? '开始知识点巩固' : '选择章节开始练习'}
              </h2>
              <p className="mt-3 text-gray-500 dark:text-gray-400">
                {isKnowledgeCheck
                  ? '完成 3 道专项题后，系统会记录结果并重新计算这个知识点的掌握度'
                  : '自定义题型和难度，提交后查看逐题解析与教材原文依据'}
              </p>
            </div>

            <div className="rounded-3xl border border-gray-200/70 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-8">
              <div className="grid gap-8 lg:grid-cols-[1.25fr_1fr]">
                <div className="space-y-7">
                  <section>
                    <label className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-100">
                      <BookOpen className="h-4 w-4 text-violet-500" />
                      练习章节
                    </label>
                    {tocLoading ? (
                      <div className="flex h-12 items-center gap-2 rounded-xl border border-gray-200 px-4 text-sm text-gray-400 dark:border-gray-700">
                        <Loader2 className="h-4 w-4 animate-spin" /> 正在加载课程目录…
                      </div>
                    ) : tocError ? (
                      <div className="flex min-h-12 items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-950/20">
                        <AlertCircle className="h-4 w-4 shrink-0" /> {tocError}
                      </div>
                    ) : (
                      <select
                        value={sectionKey}
                        onChange={(event) => setSectionKey(event.target.value)}
                        disabled={isLocked}
                        className="h-12 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 text-sm text-gray-800 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100 disabled:cursor-not-allowed disabled:opacity-70 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:ring-violet-950"
                      >
                        {groupedToc.map(([chapterNumber, chapter]) => (
                          <optgroup
                            key={chapterNumber}
                            label={'第 ' + chapterNumber + ' 章 · ' + chapter.title}
                          >
                            {chapter.items.map((item) => (
                              <option key={item.section_key} value={item.section_key}>
                                {item.section_number + ' ' + item.section_title}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    )}
                  </section>

                  <section>
                    <div className="mb-3 text-sm font-bold text-gray-800 dark:text-gray-100">题型</div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {QUESTION_TYPE_OPTIONS.map((option) => {
                        const selected = questionTypes.includes(option.value);
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => toggleQuestionType(option.value)}
                            disabled={isLocked}
                            className={
                              'relative rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-70 ' +
                              (selected
                                ? 'border-violet-400 bg-violet-50 ring-2 ring-violet-100 dark:bg-violet-950/30 dark:ring-violet-950'
                                : 'border-gray-200 hover:border-violet-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800')
                            }
                          >
                            <span
                              className={
                                'absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border ' +
                                (selected
                                  ? 'border-violet-500 bg-violet-500 text-white'
                                  : 'border-gray-300 dark:border-gray-600')
                              }
                            >
                              {selected && <Check className="h-3 w-3" />}
                            </span>
                            <div className="pr-5 text-sm font-bold text-gray-800 dark:text-gray-100">
                              {option.label}
                            </div>
                            <div className="mt-1 text-xs leading-5 text-gray-400">{option.description}</div>
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section>
                    <label className="mb-3 block text-sm font-bold text-gray-800 dark:text-gray-100">
                      {isKnowledgeCheck ? '本次巩固知识点' : '重点知识点（可选）'}
                    </label>
                    <input
                      value={knowledgePoint}
                      onChange={(event) => setKnowledgePoint(event.target.value)}
                      readOnly={isLocked}
                      maxLength={100}
                      placeholder="例如：莫拉维克悖论、感知—动作回路"
                      className="h-12 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-violet-400 focus:ring-4 focus:ring-violet-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:ring-violet-950"
                    />
                  </section>
                </div>

                <div className="rounded-2xl bg-gray-50 p-5 dark:bg-gray-800/70 sm:p-6">
                  <section>
                    <div className="mb-3 text-sm font-bold text-gray-800 dark:text-gray-100">难度</div>
                    <div className="space-y-2">
                      {DIFFICULTY_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setDifficulty(option.value)}
                          disabled={isLocked}
                          className={
                            'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-70 ' +
                            (difficulty === option.value
                              ? 'border-violet-400 bg-white shadow-sm dark:bg-gray-900'
                              : 'border-transparent hover:bg-white/70 dark:hover:bg-gray-900/60')
                          }
                        >
                          <span
                            className={
                              'flex h-5 w-5 items-center justify-center rounded-full border ' +
                              (difficulty === option.value
                                ? 'border-violet-500 bg-violet-500'
                                : 'border-gray-300 dark:border-gray-600')
                            }
                          >
                            {difficulty === option.value && <span className="h-2 w-2 rounded-full bg-white" />}
                          </span>
                          <span>
                            <span className="block text-sm font-semibold text-gray-800 dark:text-gray-100">
                              {option.label}
                            </span>
                            <span className="text-xs text-gray-400">{option.description}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="mt-7 border-t border-gray-200 pt-6 dark:border-gray-700">
                    <div className="mb-3 text-sm font-bold text-gray-800 dark:text-gray-100">题目数量</div>
                    <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900">
                      <button
                        type="button"
                        onClick={() => setQuestionCount((value) => Math.max(1, value - 1))}
                        disabled={isLocked || questionCount <= 1}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition hover:bg-violet-50 hover:text-violet-600 disabled:opacity-30 dark:hover:bg-violet-950/40"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <div className="text-center">
                        <div className="text-xl font-extrabold text-gray-900 dark:text-white">{questionCount}</div>
                        <div className="text-[10px] text-gray-400">共 100 分</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setQuestionCount((value) => Math.min(10, value + 1))}
                        disabled={isLocked || questionCount >= 10}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition hover:bg-violet-50 hover:text-violet-600 disabled:opacity-30 dark:hover:bg-violet-950/40"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </section>

                  <div className="mt-7 rounded-xl border border-violet-100 bg-violet-50/70 p-4 text-xs leading-5 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-300">
                    <div className="mb-1 flex items-center gap-1.5 font-bold">
                      <Target className="h-3.5 w-3.5" /> {isAssignment ? '教师布置作业' : isKnowledgeCheck ? '本次专项巩固' : '本次练习'}
                    </div>
                    <div>{selectedSection ? selectedSection.section_number + ' ' + selectedSection.section_title : '请选择章节'}</div>
                    {(isKnowledgeCheck || isAssignment) && <div>知识点：{knowledgePoint}</div>}
                    <div>
                      {isAssignment
                        ? '请按教师要求完成指定题目，提交后可查看批改结果。'
                        : isKnowledgeCheck
                        ? '固定抽取 3 题；若题库不足 3 题，将展示实际可用题量'
                        : questionTypes.map((item) => TYPE_LABELS[item]).join('、')}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={generating || tocLoading || !sectionKey}
                    className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-sm font-bold text-white shadow-lg shadow-violet-200 transition hover:-translate-y-0.5 hover:shadow-xl disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 dark:shadow-none"
                  >
                    {generating ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {isAssignment ? '正在加载教师作业…' : isKnowledgeCheck ? '正在抽取专项题…' : '正在从章节题库组卷…'}
                      </>
                    ) : (
                      <>
                        {isAssignment ? '开始完成作业' : isKnowledgeCheck ? '开始 3 题巩固' : '开始章节练习'} <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {session && !result && currentQuestion && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <div className="mb-1 text-sm font-medium text-violet-600 dark:text-violet-400">
                  {session.section_number + ' ' + session.section_title}
                </div>
                <h2 className="text-2xl font-extrabold text-gray-900 dark:text-white">
                  {isKnowledgeCheck ? '知识点巩固' : '章节练习'}
                </h2>
              </div>
              <div className="min-w-52">
                <div className="mb-2 flex justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span>已完成 {answeredCount}/{session.questions.length}</span>
                  <span>{Math.round((answeredCount / session.questions.length) * 100)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
                    style={{ width: (answeredCount / session.questions.length) * 100 + '%' }}
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
              <aside className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">答题卡</div>
                <div className="grid grid-cols-5 gap-2 lg:grid-cols-4">
                  {session.questions.map((question, index) => {
                    const done = isAnswered(question, answers[question.id]);
                    return (
                      <button
                        key={question.id}
                        type="button"
                        onClick={() => setCurrentIndex(index)}
                        className={
                          'flex aspect-square items-center justify-center rounded-lg border text-xs font-bold transition ' +
                          (index === currentIndex
                            ? 'border-violet-500 bg-violet-500 text-white shadow-sm'
                            : done
                              ? 'border-violet-200 bg-violet-50 text-violet-600 dark:border-violet-900 dark:bg-violet-950/30'
                              : 'border-gray-200 text-gray-400 hover:border-violet-300 dark:border-gray-700')
                        }
                      >
                        {index + 1}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-5 space-y-2 border-t border-gray-100 pt-4 text-xs text-gray-400 dark:border-gray-800">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded bg-violet-500" /> 当前题目
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded border border-violet-200 bg-violet-50 dark:border-violet-900 dark:bg-violet-950/30" /> 已作答
                  </div>
                </div>
              </aside>

              <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-8">
                <div className="mb-6 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-bold text-violet-600 dark:bg-violet-950/40 dark:text-violet-300">
                    {TYPE_LABELS[currentQuestion.type]}
                  </span>
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    {currentQuestion.knowledge_point}
                  </span>
                  <span className="ml-auto text-xs font-medium text-gray-400">
                    第 {currentIndex + 1}/{session.questions.length} 题 · {currentQuestion.max_score} 分
                  </span>
                </div>

                <h3 className="mb-7 text-lg font-bold leading-8 text-gray-900 dark:text-gray-100 sm:text-xl">
                  {currentQuestion.stem}
                </h3>

                {currentQuestion.type === 'single_choice' && (
                  <div className="space-y-3">
                    {currentQuestion.options.map((option, index) => {
                      const optionKey = String.fromCharCode(65 + index);
                      const selected = answers[currentQuestion.id] === optionKey;
                      return (
                        <button
                          key={optionKey + option}
                          type="button"
                          onClick={() =>
                            setAnswers((current) => ({
                              ...current,
                              [currentQuestion.id]: optionKey,
                            }))
                          }
                          className={
                            'flex w-full items-start gap-3 rounded-2xl border p-4 text-left text-sm leading-6 transition ' +
                            (selected
                              ? 'border-violet-400 bg-violet-50 text-violet-900 ring-2 ring-violet-100 dark:bg-violet-950/30 dark:text-violet-100 dark:ring-violet-950'
                              : 'border-gray-200 text-gray-700 hover:border-violet-200 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800')
                          }
                        >
                          <span
                            className={
                              'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold ' +
                              (selected ? 'bg-violet-500 text-white' : 'bg-gray-100 text-gray-500 dark:bg-gray-800')
                            }
                          >
                            {optionKey}
                          </span>
                          <span>{option}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {currentQuestion.type === 'true_false' && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {[
                      { value: true, label: '正确', icon: CheckCircle2 },
                      { value: false, label: '错误', icon: XCircle },
                    ].map((option) => {
                      const selected = answers[currentQuestion.id] === option.value;
                      const Icon = option.icon;
                      return (
                        <button
                          key={option.label}
                          type="button"
                          onClick={() =>
                            setAnswers((current) => ({ ...current, [currentQuestion.id]: option.value }))
                          }
                          className={
                            'flex h-24 items-center justify-center gap-3 rounded-2xl border text-base font-bold transition ' +
                            (selected
                              ? 'border-violet-400 bg-violet-50 text-violet-700 ring-2 ring-violet-100 dark:bg-violet-950/30 dark:text-violet-200 dark:ring-violet-950'
                              : 'border-gray-200 text-gray-600 hover:border-violet-200 dark:border-gray-700 dark:text-gray-300')
                          }
                        >
                          <Icon className="h-6 w-6" /> {option.label}
                        </button>
                      );
                    })}
                  </div>
                )}

                {currentQuestion.type === 'short_answer' && (
                  <div>
                    <textarea
                      value={String(answers[currentQuestion.id] ?? '')}
                      onChange={(event) =>
                        setAnswers((current) => ({
                          ...current,
                          [currentQuestion.id]: event.target.value,
                        }))
                      }
                      rows={7}
                      placeholder="请结合教材内容写出你的理解…"
                      className="w-full resize-y rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm leading-7 text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:bg-gray-900 dark:focus:ring-violet-950"
                    />
                    <div className="mt-2 text-right text-xs text-gray-400">
                      {String(answers[currentQuestion.id] ?? '').trim().length} 字
                    </div>
                  </div>
                )}

                <div className="mt-9 flex items-center justify-between border-t border-gray-100 pt-5 dark:border-gray-800">
                  <button
                    type="button"
                    onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
                    disabled={currentIndex === 0}
                    className="flex items-center gap-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-500 transition hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-800"
                  >
                    <ChevronLeft className="h-4 w-4" /> 上一题
                  </button>
                  {currentIndex < session.questions.length - 1 ? (
                    <button
                      type="button"
                      onClick={() => setCurrentIndex((index) => index + 1)}
                      className="flex items-center gap-1 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-violet-700"
                    >
                      下一题 <ChevronRight className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={submitting}
                      className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:shadow-lg disabled:opacity-60"
                    >
                      {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
                      {submitting ? '正在智能批改…' : '提交并批改'}
                    </button>
                  )}
                </div>
              </section>
            </div>
          </motion.div>
        )}

        {result && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <section className="mb-7 overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 to-fuchsia-600 p-6 text-white shadow-xl shadow-violet-200/60 dark:shadow-none sm:p-8">
              <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
                <div>
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-violet-100">
                    <Sparkles className="h-4 w-4" /> 智能批改已完成
                  </div>
                  <h2 className="text-3xl font-extrabold">本次练习结果</h2>
                  <p className="mt-2 text-sm text-violet-100">
                    {session?.section_number + ' ' + session?.section_title}
                  </p>
                </div>
                <div className="flex items-end gap-2 sm:text-right">
                  <span className="text-6xl font-black leading-none">{result.total_score}</span>
                  <span className="pb-1 text-lg text-violet-100">/ {result.max_score} 分</span>
                </div>
              </div>
              <div className="mt-7 grid grid-cols-2 gap-3 border-t border-white/20 pt-5 sm:grid-cols-4">
                <div><div className="text-2xl font-bold">{result.correct_count}</div><div className="text-xs text-violet-100">答对题数</div></div>
                <div><div className="text-2xl font-bold">{result.question_count}</div><div className="text-xs text-violet-100">题目总数</div></div>
                <div><div className="text-2xl font-bold">{Math.round((result.correct_count / result.question_count) * 100)}%</div><div className="text-xs text-violet-100">正确率</div></div>
                <div><div className="text-2xl font-bold">{result.results.filter((item) => item.review_required).length}</div><div className="text-xs text-violet-100">待复核</div></div>
              </div>
            </section>

            <div className="space-y-5">
              {result.results.map((item, index) => (
                <section
                  key={item.question_id}
                  className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-7"
                >
                  <div className="mb-5 flex flex-wrap items-center gap-2">
                    <span
                      className={
                        'flex h-8 w-8 items-center justify-center rounded-full ' +
                        (item.is_correct
                          ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40'
                          : 'bg-red-100 text-red-600 dark:bg-red-950/40')
                      }
                    >
                      {item.is_correct ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
                    </span>
                    <span className="font-bold text-gray-800 dark:text-gray-100">第 {index + 1} 题</span>
                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500 dark:bg-gray-800">
                      {TYPE_LABELS[item.type]}
                    </span>
                    {item.review_required && (
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                        建议教师复核
                      </span>
                    )}
                    <span className="ml-auto text-sm font-bold text-gray-700 dark:text-gray-200">
                      {item.score} / {item.max_score} 分
                    </span>
                  </div>

                  <h3 className="text-base font-bold leading-7 text-gray-900 dark:text-gray-100">{item.stem}</h3>
                  {item.type === 'single_choice' && item.options.length > 0 && (
                    <div className="mt-4 space-y-2">
                      {item.options.map((option, optionIndex) => {
                        const optionKey = String.fromCharCode(65 + optionIndex);
                        const isSelected = item.answer === optionKey;
                        const isCorrect = item.correct_answer === optionKey;
                        return (
                          <div
                            key={optionKey + option}
                            className={
                              'flex items-start gap-3 rounded-xl border px-4 py-3 text-sm leading-6 ' +
                              (isCorrect
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-100'
                                : isSelected
                                  ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/20 dark:text-red-100'
                                  : 'border-gray-200 bg-gray-50/60 text-gray-600 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300')
                            }
                          >
                            <span className="font-bold">{optionKey}.</span>
                            <span className="min-w-0 flex-1">{option}</span>
                            <span className="flex shrink-0 flex-wrap justify-end gap-1 text-xs font-bold">
                              {isSelected && (
                                <span className={isCorrect ? 'text-emerald-600' : 'text-red-600'}>你的选择</span>
                              )}
                              {isCorrect && <span className="text-emerald-600">正确答案</span>}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-gray-50 p-4 dark:bg-gray-800/70">
                      <div className="mb-1 text-xs font-bold text-gray-400">你的答案</div>
                      <div className="text-sm leading-6 text-gray-700 dark:text-gray-200">
                        {answerWithOptionText(item.answer, item.options)}
                      </div>
                    </div>
                    <div className="rounded-xl bg-emerald-50 p-4 dark:bg-emerald-950/20">
                      <div className="mb-1 text-xs font-bold text-emerald-600">参考答案</div>
                      <div className="text-sm leading-6 text-emerald-900 dark:text-emerald-100">
                        {answerWithOptionText(item.correct_answer, item.options)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 space-y-4 border-t border-gray-100 pt-5 dark:border-gray-800">
                    <div>
                      <div className="mb-1 text-sm font-bold text-gray-800 dark:text-gray-100">答案解析</div>
                      <p className="text-sm leading-7 text-gray-600 dark:text-gray-300">{item.analysis}</p>
                    </div>
                    {item.feedback && (
                      <div>
                        <div className="mb-1 text-sm font-bold text-gray-800 dark:text-gray-100">批改反馈</div>
                        <p className="text-sm leading-7 text-gray-600 dark:text-gray-300">{item.feedback}</p>
                      </div>
                    )}

                    {(item.covered_points.length > 0 || item.missing_points.length > 0 || item.errors.length > 0) && (
                      <div className="grid gap-3 md:grid-cols-3">
                        {item.covered_points.length > 0 && (
                          <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                            <div className="mb-2 text-xs font-bold text-emerald-700 dark:text-emerald-300">已覆盖要点</div>
                            <ul className="space-y-1 text-xs leading-5 text-emerald-800 dark:text-emerald-200">
                              {item.covered_points.map((point) => <li key={point}>• {point}</li>)}
                            </ul>
                          </div>
                        )}
                        {item.missing_points.length > 0 && (
                          <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-3 dark:border-amber-900/40 dark:bg-amber-950/20">
                            <div className="mb-2 text-xs font-bold text-amber-700 dark:text-amber-300">遗漏要点</div>
                            <ul className="space-y-1 text-xs leading-5 text-amber-800 dark:text-amber-200">
                              {item.missing_points.map((point) => <li key={point}>• {point}</li>)}
                            </ul>
                          </div>
                        )}
                        {item.errors.length > 0 && (
                          <div className="rounded-xl border border-red-100 bg-red-50/60 p-3 dark:border-red-900/40 dark:bg-red-950/20">
                            <div className="mb-2 text-xs font-bold text-red-700 dark:text-red-300">需要纠正</div>
                            <ul className="space-y-1 text-xs leading-5 text-red-800 dark:text-red-200">
                              {item.errors.map((error) => <li key={error}>• {error}</li>)}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="rounded-2xl border border-violet-100 bg-violet-50/60 p-4 dark:border-violet-900/50 dark:bg-violet-950/20">
                      <div className="mb-2 flex items-center gap-2 text-xs font-bold text-violet-700 dark:text-violet-300">
                        <BookOpen className="h-4 w-4" /> 教材原文依据
                      </div>
                      <blockquote className="text-sm leading-7 text-gray-700 dark:text-gray-300">
                        “{item.citation.quote}”
                      </blockquote>
                      <div className="mt-2 text-xs text-gray-400">
                        《{item.citation.book}》 · {item.citation.section_number} {item.citation.section_title}
                      </div>
                    </div>
                  </div>
                </section>
              ))}
            </div>

            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <button
                type="button"
                onClick={resetPractice}
                className="flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-6 py-3 text-sm font-bold text-white transition hover:bg-violet-700"
              >
                <RotateCcw className="h-4 w-4" /> 再练一次
              </button>
              <Link
                href={reviewHref}
                className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-6 py-3 text-sm font-bold text-gray-600 transition hover:border-violet-300 hover:text-violet-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
              >
                <ChevronLeft className="h-4 w-4" /> {isKnowledgeCheck ? '返回复习页' : '返回'}
              </Link>
            </div>
          </motion.div>
        )}
      </main>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
