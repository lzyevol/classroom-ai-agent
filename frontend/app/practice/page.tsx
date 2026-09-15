"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ApiError } from "@/lib/api/errors";
import { generatePractice, practiceApiMode, submitPractice } from "@/lib/practice/client";
import type {
  MockPracticeScenario,
  PracticeSession,
  PracticeSubmission,
} from "@/lib/practice/types";

type Answers = Record<string, string>;

function displayError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
  if (error instanceof ApiError) return `${error.message}（HTTP ${error.status}）`;
  return "发生了未预期的练习错误";
}

export default function PracticePage() {
  const [scenario, setScenario] = useState<MockPracticeScenario>("partial");
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [submission, setSubmission] = useState<PracticeSubmission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"generate" | "submit" | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  async function beginPractice() {
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading("generate");
    setSession(null);
    setAnswers({});
    setSubmission(null);
    setError(null);

    try {
      const created = await generatePractice(
        {
          section_key: "mock-section-1.1",
          question_types: ["single_choice"],
          difficulty: "easy",
          question_count: 3,
          knowledge_point: null,
        },
        { signal: controller.signal, mockScenario: scenario },
      );
      setSession(created);
    } catch (caught) {
      setError(displayError(caught));
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setLoading(null);
      }
    }
  }

  async function handleSubmit() {
    if (!session || loading) return;
    const unanswered = session.questions.filter((question) => !answers[question.id]);
    if (unanswered.length > 0) {
      setError(`还有 ${unanswered.length} 道题未作答，请完成后再提交。`);
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading("submit");
    setError(null);

    try {
      const result = await submitPractice(
        session.session_id,
        {
          answers: session.questions.map((question) => ({
            question_id: question.id,
            answer: answers[question.id],
          })),
        },
        { signal: controller.signal, mockScenario: scenario },
      );
      setSubmission(result);
    } catch (caught) {
      setError(displayError(caught));
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setLoading(null);
      }
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link className="text-sm text-blue-700 hover:underline" href="/">
            ← 返回首页
          </Link>
          <h1 className="mt-3 text-3xl font-bold">章节练习</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-300">
            验证创建练习、提交答案和展示批改结果的最小链路。
          </p>
        </div>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">
          {practiceApiMode === "mock" ? "Mock 练习" : "真实 API"}
        </span>
      </div>

      <section className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <label className="mb-2 block text-sm font-medium" htmlFor="practice-scenario">
          Mock 验证场景
        </label>
        <div className="flex flex-wrap gap-3">
          <select
            className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
            disabled={Boolean(loading)}
            id="practice-scenario"
            onChange={(event) => setScenario(event.target.value as MockPracticeScenario)}
            value={scenario}
          >
            <option value="partial">部分答错结果</option>
            <option value="all-correct">全部答对结果</option>
            <option value="generate-error">题库不足错误</option>
            <option value="submit-error">重复提交错误</option>
          </select>
          <button
            className="rounded-xl bg-blue-700 px-5 py-2.5 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={Boolean(loading)}
            onClick={beginPractice}
            type="button"
          >
            {loading === "generate" ? "创建中…" : session ? "重新开始" : "开始练习"}
          </button>
          {loading && (
            <button
              className="rounded-xl border border-zinc-300 px-5 py-2.5 dark:border-zinc-700"
              onClick={() => controllerRef.current?.abort()}
              type="button"
            >
              取消
            </button>
          )}
        </div>
        <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
          场景决定固定批改 fixture，仅用于前端联调，不代表浏览器执行了真实判分。
        </p>
      </section>

      {error && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800" role="alert">
          {error}
        </div>
      )}

      {session && (
        <section className="mt-8">
          <div className="mb-5">
            <h2 className="text-2xl font-bold">{session.section_title}</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {session.chapter_title} · {session.section_number} · 会话 {session.session_id}
            </p>
          </div>

          <div className="space-y-5">
            {session.questions.map((question, questionIndex) => {
              const graded = submission?.results.find(
                (item) => item.question_id === question.id,
              );
              return (
                <article
                  className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
                  key={question.id}
                >
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="font-semibold leading-7">
                      {questionIndex + 1}. {question.stem}
                    </h3>
                    <span className="shrink-0 text-sm text-zinc-500">{question.max_score} 分</span>
                  </div>
                  <fieldset className="mt-4 space-y-2" disabled={Boolean(submission) || Boolean(loading)}>
                    <legend className="sr-only">第 {questionIndex + 1} 题选项</legend>
                    {question.options.map((option, optionIndex) => {
                      const letter = String.fromCharCode(65 + optionIndex);
                      return (
                        <label
                          className="flex cursor-pointer gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
                          key={letter}
                        >
                          <input
                            checked={answers[question.id] === letter}
                            name={question.id}
                            onChange={() => {
                              setAnswers((current) => ({ ...current, [question.id]: letter }));
                              setError(null);
                            }}
                            type="radio"
                            value={letter}
                          />
                          <span>{letter}. {option}</span>
                        </label>
                      );
                    })}
                  </fieldset>

                  {graded && (
                    <div
                      className={`mt-5 rounded-xl p-4 ${
                        graded.is_correct
                          ? "bg-emerald-50 text-emerald-900"
                          : "bg-amber-50 text-amber-900"
                      }`}
                    >
                      <p className="font-semibold">
                        {graded.is_correct ? "回答正确" : `回答错误，正确答案：${graded.correct_answer}`}
                      </p>
                      <p className="mt-2">{graded.analysis}</p>
                      <p className="mt-3 text-sm">
                        引用：{graded.citation.book}，{graded.citation.section_number} {graded.citation.section_title}
                      </p>
                      <blockquote className="mt-2 border-l-2 border-current pl-3 text-sm">
                        {graded.citation.quote}
                      </blockquote>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {!submission && (
            <button
              className="mt-6 rounded-xl bg-blue-700 px-6 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={Boolean(loading)}
              onClick={handleSubmit}
              type="button"
            >
              {loading === "submit" ? "提交中…" : "提交答案"}
            </button>
          )}
        </section>
      )}

      {submission && (
        <section className="mt-8 rounded-2xl bg-blue-700 p-6 text-white" aria-live="polite">
          <h2 className="text-xl font-bold">练习完成</h2>
          <p className="mt-3 text-3xl font-bold">
            {submission.total_score.toFixed(2)} / {submission.max_score.toFixed(2)}
          </p>
          <p className="mt-2">
            答对 {submission.correct_count} / {submission.question_count} 题
          </p>
        </section>
      )}
    </main>
  );
}
