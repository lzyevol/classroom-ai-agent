'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  ArrowRight,
  BookOpenCheck,
  Brain,
  CheckCircle2,
  ChevronLeft,
  FileText,
  Loader2,
  Settings,
  Target,
} from 'lucide-react';
import { SettingsDialog } from '@/components/settings';
import { fetchKnowledgeReview } from '../learning-client';
import type { KnowledgeReview, MistakeRecord } from '../types';

function answerText(value: string | boolean, options: string[]): string {
  if (typeof value === 'boolean') return value ? '正确' : '错误';
  const normalized = value.trim().toUpperCase();
  const optionIndex = normalized.charCodeAt(0) - 65;
  return options[optionIndex] ? `${normalized}. ${options[optionIndex]}` : value || '未作答';
}

function MistakeReviewCard({ item }: { item: MistakeRecord }) {
  return (
    <article className="rounded-2xl border border-red-100 bg-red-50/40 p-5 dark:border-red-950/60 dark:bg-red-950/10">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-red-100 px-2.5 py-1 font-bold text-red-700 dark:bg-red-950/50 dark:text-red-300">
          相关错题
        </span>
        <span className="text-gray-400">{item.section_number} {item.section_title}</span>
      </div>
      <h3 className="font-bold leading-7 text-gray-900 dark:text-gray-100">{item.stem}</h3>

      {item.type === 'single_choice' && item.options.length > 0 && (
        <div className="mt-4 space-y-2">
          {item.options.map((option, index) => {
            const key = String.fromCharCode(65 + index);
            const selected = item.answer === key;
            const correct = item.correct_answer === key;
            return (
              <div
                key={key + option}
                className={
                  'rounded-xl border px-4 py-3 text-sm leading-6 ' +
                  (correct
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-100'
                    : selected
                      ? 'border-red-200 bg-red-100/70 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100'
                      : 'border-transparent bg-white/70 text-gray-600 dark:bg-gray-900/40 dark:text-gray-300')
                }
              >
                <span className="mr-2 font-bold">{key}.</span>{option}
                {selected && <span className="ml-2 text-xs font-bold">你的选择</span>}
                {correct && <span className="ml-2 text-xs font-bold">正确答案</span>}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-white/80 p-4 dark:bg-gray-900/50">
          <div className="text-xs font-bold text-gray-400">你的答案</div>
          <div className="mt-1 text-sm font-medium text-red-700 dark:text-red-300">
            {answerText(item.answer, item.options)}
          </div>
        </div>
        <div className="rounded-xl bg-emerald-50 p-4 dark:bg-emerald-950/20">
          <div className="text-xs font-bold text-emerald-600">正确答案</div>
          <div className="mt-1 text-sm font-medium text-emerald-800 dark:text-emerald-200">
            {answerText(item.correct_answer, item.options)}
          </div>
        </div>
      </div>

      <div className="mt-4 border-t border-red-100 pt-4 dark:border-red-950/50">
        <div className="text-sm font-bold text-gray-800 dark:text-gray-100">答案解析</div>
        <p className="mt-1 text-sm leading-7 text-gray-600 dark:text-gray-300">{item.analysis}</p>
        {item.feedback && (
          <div className="mt-3 rounded-xl bg-amber-50 p-4 dark:bg-amber-950/20">
            <div className="text-xs font-bold text-amber-700 dark:text-amber-300">上次批改反馈</div>
            <p className="mt-1 text-sm leading-6 text-amber-900 dark:text-amber-100">{item.feedback}</p>
          </div>
        )}
      </div>
    </article>
  );
}

function KnowledgeReviewContent() {
  const searchParams = useSearchParams();
  const sectionKey = searchParams.get('section_key')?.trim() || '';
  const knowledgePoint = searchParams.get('knowledge_point')?.trim() || '';
  const missingParams = !sectionKey || !knowledgePoint;
  const [review, setReview] = useState<KnowledgeReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    let active = true;
    if (missingParams) return () => { active = false; };

    fetchKnowledgeReview(sectionKey, knowledgePoint)
      .then((data) => {
        if (active) setReview(data);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : '获取知识点复习内容失败');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [knowledgePoint, missingParams, sectionKey]);

  const pageError = missingParams
    ? '缺少章节或知识点信息，无法打开复习内容。'
    : error;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="sticky top-0 z-30 border-b border-gray-200/70 bg-white/85 px-6 py-4 backdrop-blur-md dark:border-gray-800 dark:bg-gray-900/85 sm:px-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/learning"
              aria-label="返回学习中心"
              className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-violet-600 dark:hover:bg-gray-800"
            >
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600">
              <Brain className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-gray-900 dark:text-gray-100">知识点复习</h1>
              <p className="text-xs text-gray-400">先理解教材，再进行专项巩固</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 transition hover:border-violet-300 hover:text-violet-600 dark:border-gray-700 dark:text-gray-300"
          >
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">设置</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
        {loading && !missingParams ? (
          <div className="flex min-h-[420px] items-center justify-center text-gray-400">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />正在整理知识点复习内容…
          </div>
        ) : pageError || !review ? (
          <div className="mx-auto mt-16 max-w-xl rounded-3xl border border-red-100 bg-white p-8 text-center shadow-sm dark:border-red-950/50 dark:bg-gray-900">
            <AlertCircle className="mx-auto h-10 w-10 text-red-500" />
            <h2 className="mt-4 text-xl font-bold text-gray-900 dark:text-gray-100">暂时无法打开复习内容</h2>
            <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">{pageError}</p>
            <Link href="/learning" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-3 text-sm font-bold text-white">
              返回学习中心
            </Link>
          </div>
        ) : (
          <div className="space-y-7">
            <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 p-7 text-white shadow-xl shadow-violet-200/40 dark:shadow-none sm:p-9">
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div className="max-w-3xl">
                  <div className="mb-3 inline-flex rounded-full bg-white/15 px-3 py-1 text-xs font-bold text-violet-50">
                    {review.section_number} {review.section_title}
                  </div>
                  <h2 className="text-3xl font-black tracking-tight sm:text-4xl">{review.knowledge_point}</h2>
                  <p className="mt-4 text-sm leading-7 text-violet-100">{review.reason}</p>
                </div>
                {review.mastery && (
                  <div className="min-w-32 rounded-2xl bg-white/15 p-4 text-center backdrop-blur">
                    <div className="text-3xl font-black">{review.mastery.score_rate}%</div>
                    <div className="mt-1 text-xs text-violet-100">当前得分率</div>
                    <div className="mt-2 text-xs text-violet-100">{review.mastery.attempts} 次作答</div>
                  </div>
                )}
              </div>
            </section>

            <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-7">
                <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-8">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300">
                      <BookOpenCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">先理解这个知识点</h2>
                      <p className="text-sm text-gray-400">内容来自现有题库解析和教材依据</p>
                    </div>
                  </div>
                  <p className="mt-6 rounded-2xl bg-violet-50 p-5 text-sm leading-8 text-violet-950 dark:bg-violet-950/20 dark:text-violet-100">
                    {review.overview}
                  </p>
                  {review.key_points.length > 0 && (
                    <div className="mt-6">
                      <h3 className="font-bold text-gray-900 dark:text-gray-100">理解要点</h3>
                      <div className="mt-3 space-y-3">
                        {review.key_points.map((point, index) => (
                          <div key={point} className="flex gap-3 rounded-2xl border border-gray-100 p-4 dark:border-gray-800">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-xs font-black text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                              {index + 1}
                            </span>
                            <p className="text-sm leading-7 text-gray-600 dark:text-gray-300">{point}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </section>

                {review.common_mistakes.length > 0 && (
                  <section className="rounded-3xl border border-amber-200 bg-amber-50/60 p-6 dark:border-amber-900/50 dark:bg-amber-950/10 sm:p-8">
                    <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
                      <Target className="h-5 w-5" />
                      <h2 className="text-lg font-bold">你需要特别注意</h2>
                    </div>
                    <ul className="mt-4 space-y-3">
                      {review.common_mistakes.map((item) => (
                        <li key={item} className="flex gap-3 text-sm leading-7 text-amber-950 dark:text-amber-100">
                          <AlertCircle className="mt-1 h-4 w-4 shrink-0 text-amber-600" />{item}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-8">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-indigo-500" />
                    <div>
                      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">教材原文依据</h2>
                      <p className="text-sm text-gray-400">复习内容对应的教材片段</p>
                    </div>
                  </div>
                  {review.sources.length ? (
                    <div className="mt-5 space-y-4">
                      {review.sources.map((source, index) => (
                        <blockquote key={source.chunk_id || source.quote} className="rounded-2xl border-l-4 border-indigo-400 bg-indigo-50/60 p-5 dark:bg-indigo-950/15">
                          <p className="text-sm leading-8 text-gray-700 dark:text-gray-200">{source.quote}</p>
                          <footer className="mt-3 text-xs font-medium text-indigo-600 dark:text-indigo-300">
                            {source.book} · {source.section_number} {source.section_title}
                            {review.sources.length > 1 ? ` · 依据 ${index + 1}` : ''}
                          </footer>
                        </blockquote>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-5 rounded-2xl bg-gray-50 p-4 text-sm text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                      当前题库还没有保存可展示的教材原文片段。
                    </p>
                  )}
                </section>

                <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-8">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">这个知识点的相关错题</h2>
                      <p className="mt-1 text-sm text-gray-400">这里只展示你在当前知识点上真正答错过的题</p>
                    </div>
                    <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-700 dark:bg-red-950/40 dark:text-red-300">
                      {review.related_mistakes.length} 道
                    </span>
                  </div>
                  <div className="mt-5 space-y-4">
                    {review.related_mistakes.length ? (
                      review.related_mistakes.map((item) => <MistakeReviewCard key={item.question_id} item={item} />)
                    ) : (
                      <div className="rounded-2xl bg-emerald-50 p-5 text-sm leading-7 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-200">
                        当前没有这个知识点的错题。你可以阅读上面的教材内容，然后完成 3 道专项题确认掌握情况。
                      </div>
                    )}
                  </div>
                </section>
              </div>

              <aside className="space-y-4 lg:sticky lg:top-24">
                <div className="rounded-3xl border border-violet-200 bg-white p-6 shadow-lg shadow-violet-100/60 dark:border-violet-900/60 dark:bg-gray-900 dark:shadow-none">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <h2 className="mt-4 text-xl font-bold text-gray-900 dark:text-gray-100">复习后再验证</h2>
                  <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
                    巩固练习固定抽取当前知识点的 3 道题，不会混入同章节的其他题目。
                  </p>
                  <Link
                    href={review.practice_href}
                    className="mt-6 flex h-12 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-sm font-bold text-white shadow-lg shadow-violet-200 dark:shadow-none"
                  >
                    开始 3 题巩固 <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link href="/learning" className="mt-3 flex h-11 items-center justify-center rounded-xl border border-gray-200 text-sm font-bold text-gray-600 dark:border-gray-700 dark:text-gray-300">
                    稍后再复习
                  </Link>
                </div>
                <div className="rounded-2xl bg-gray-100 p-4 text-xs leading-6 text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                  本页不会临时调用模型生成内容，展示的是已经保存的题目解析、教材引用和你的错题记录。
                </div>
              </aside>
            </div>
          </div>
        )}
      </main>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

export default function KnowledgeReviewPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-400 dark:bg-gray-950">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />正在打开知识点复习…
        </div>
      }
    >
      <KnowledgeReviewContent />
    </Suspense>
  );
}
