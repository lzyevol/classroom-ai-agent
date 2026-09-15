"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import { RequestDiagnostic } from "@/components/request-diagnostic";
import { ApiError } from "@/lib/api/errors";
import { apiMode, askQuestion } from "@/lib/api/qa-client";
import type { MockQAScenario, QAResponse } from "@/lib/api/types";
import {
  diagnosticFromError,
  type RequestDiagnostic as Diagnostic,
} from "@/lib/diagnostics/request";

export default function QAPage() {
  const [question, setQuestion] = useState("什么是具身智能？");
  const [scenario, setScenario] = useState<MockQAScenario>("success");
  const [response, setResponse] = useState<QAResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim() || loading) return;

    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    setResponse(null);
    setDiagnostic({ operation: "qa.ask", mode: apiMode, status: "running" });

    try {
      const result = await askQuestion({
        question,
        signal: controller.signal,
        mockScenario: scenario,
      });
      setResponse(result);
      setDiagnostic({ operation: "qa.ask", mode: apiMode, status: "completed" });
    } catch (requestError) {
      setDiagnostic(diagnosticFromError("qa.ask", apiMode, requestError));
      if (requestError instanceof DOMException && requestError.name === "AbortError") {
        setError("请求已取消");
      } else if (requestError instanceof ApiError) {
        setError(`${requestError.message}（HTTP ${requestError.status}）`);
      } else {
        setError("发生了未预期的错误，请稍后重试");
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setLoading(false);
      }
    }
  }

  function cancelRequest() {
    controllerRef.current?.abort();
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link className="text-sm text-blue-700 hover:underline" href="/">
            ← 返回首页
          </Link>
          <h1 className="mt-3 text-3xl font-bold">教材问答</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-300">
            输入问题后，系统将展示回答及其教材证据。
          </p>
        </div>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">
          {apiMode === "mock" ? "Mock 联调模式" : "真实接口模式"}
        </span>
      </div>

      <form
        className="mt-8 space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
        onSubmit={handleSubmit}
      >
        <label className="block font-medium" htmlFor="question">
          你的问题
        </label>
        <textarea
          className="min-h-28 w-full rounded-xl border border-zinc-300 bg-transparent p-3 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 dark:border-zinc-700"
          disabled={loading}
          id="question"
          maxLength={500}
          onChange={(event) => setQuestion(event.target.value)}
          value={question}
        />

        {apiMode === "mock" && (
          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor="scenario">
              Mock 验证场景
            </label>
            <select
              className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
              disabled={loading}
              id="scenario"
              onChange={(event) => setScenario(event.target.value as MockQAScenario)}
              value={scenario}
            >
              <option value="success">正常回答</option>
              <option value="no-evidence">无教材证据</option>
              <option value="service-error">检索服务故障</option>
            </select>
          </div>
        )}

        <div className="flex gap-3">
          <button
            className="rounded-xl bg-blue-700 px-5 py-2.5 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!question.trim() || loading}
            type="submit"
          >
            {loading ? "正在查询…" : "提交问题"}
          </button>
          {loading && (
            <button
              className="rounded-xl border border-zinc-300 px-5 py-2.5 dark:border-zinc-700"
              onClick={cancelRequest}
              type="button"
            >
              取消
            </button>
          )}
        </div>
      </form>

      <section aria-live="polite" className="mt-8 space-y-5">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800" role="alert">
            {error}
          </div>
        )}

        {response && (
          <>
            <article className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
              <h2 className="text-lg font-semibold">回答</h2>
              <p className="mt-3 leading-7">{response.answer}</p>
              {response.insufficient_evidence && (
                <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                  当前没有找到足够的教材证据。本结果不能作为教材依据。
                </p>
              )}
            </article>

            {response.citations.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold">教材引用</h2>
                <div className="mt-3 space-y-3">
                  {response.citations.map((citation) => (
                    <article
                      className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"
                      key={citation.chunk_id}
                    >
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-zinc-500">
                        <span>{citation.book}</span>
                        <span>{citation.chapter_title}</span>
                        <span>
                          {citation.section_number} {citation.section_title}
                        </span>
                      </div>
                      <blockquote className="mt-3 border-l-4 border-blue-600 pl-4 leading-7">
                        {citation.quote}
                      </blockquote>
                      <p className="mt-3 break-all font-mono text-xs text-zinc-500">
                        chunk_id: {citation.chunk_id}
                      </p>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>
      <RequestDiagnostic diagnostic={diagnostic} />
    </main>
  );
}
