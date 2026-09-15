"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import { RequestDiagnostic } from "@/components/request-diagnostic";
import {
  createMockClassroomResponse,
  type MockClassroomScenario,
} from "@/lib/classroom/mock-client";
import {
  ClassroomActionExecutor,
  type ActionExecutionResult,
  type WhiteboardSnapshot,
} from "@/lib/classroom/action-executor";
import {
  createInitialClassroomState,
  markClassroomFailed,
  markClassroomInterrupted,
  reduceClassroomEvent,
} from "@/lib/classroom/state";
import { SSEInterruptedError, SSEProtocolError } from "@/lib/sse/errors";
import { parseSSEStream } from "@/lib/sse/parser";
import {
  diagnosticFromError,
  type RequestDiagnostic as Diagnostic,
} from "@/lib/diagnostics/request";
import { redactSensitiveText } from "@/lib/security/redact";

const statusText = {
  idle: "等待开始",
  streaming: "正在生成",
  waiting_for_user: "等待用户",
  ended: "课堂已结束",
  completed: "本轮已完成",
  error: "生成失败",
  interrupted: "连接中断",
} as const;

export default function ClassroomPage() {
  const [input, setInput] = useState("什么是具身智能？");
  const [lastInput, setLastInput] = useState<string | null>(null);
  const [scenario, setScenario] = useState<MockClassroomScenario>("teacher");
  const [state, setState] = useState(createInitialClassroomState);
  const [loading, setLoading] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const actionExecutorRef = useRef(new ClassroomActionExecutor());
  const [actionResults, setActionResults] = useState<ActionExecutionResult[]>([]);
  const [whiteboard, setWhiteboard] = useState<WhiteboardSnapshot>({
    open: false,
    elements: [],
  });
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedInput = input.trim();
    if (!normalizedInput || loading) return;

    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setLastInput(normalizedInput);
    setState({ ...createInitialClassroomState(), status: "streaming" });
    actionExecutorRef.current.reset();
    setActionResults([]);
    setWhiteboard(actionExecutorRef.current.getSnapshot());
    setDiagnostic({ operation: "classroom.stream", mode: "mock", status: "running" });

    try {
      const response = createMockClassroomResponse(scenario);
      let streamFailed = false;
      for await (const streamEvent of parseSSEStream(response, controller.signal)) {
        if (streamEvent.type === "action") {
          const execution = actionExecutorRef.current.execute(streamEvent.data);
          setActionResults((current) => [...current, execution]);
          setWhiteboard(actionExecutorRef.current.getSnapshot());
        }
        if (streamEvent.type === "error") {
          streamFailed = true;
          setDiagnostic({
            operation: "classroom.stream",
            mode: "mock",
            status: "stream_error",
            detail: redactSensitiveText(streamEvent.data.message),
          });
        }
        setState((current) => reduceClassroomEvent(current, streamEvent));
      }
      if (!streamFailed) {
        setDiagnostic({ operation: "classroom.stream", mode: "mock", status: "completed" });
      }
    } catch (error) {
      setDiagnostic(diagnosticFromError("classroom.stream", "mock", error));
      if (error instanceof DOMException && error.name === "AbortError") {
        setState((current) => markClassroomInterrupted(current, "请求已取消"));
      } else if (error instanceof SSEInterruptedError) {
        setState((current) => markClassroomInterrupted(current, error.message));
      } else if (error instanceof SSEProtocolError) {
        setState((current) => markClassroomFailed(current, error.message));
      } else {
        setState((current) => markClassroomFailed(current, "发生了未预期的课堂错误"));
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link className="text-sm text-blue-700 hover:underline" href="/">
            ← 返回首页
          </Link>
          <h1 className="mt-3 text-3xl font-bold">智能课堂</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-300">
            当前使用 Mock SSE，验证浏览器端的流式消费和状态变化。
          </p>
        </div>
        <div className="flex gap-2">
          <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">
            Mock SSE
          </span>
          <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-900">
            {statusText[state.status]}
          </span>
        </div>
      </div>

      <form
        className="mt-8 space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
        onSubmit={handleSubmit}
      >
        <label className="block font-medium" htmlFor="classroom-input">
          课堂输入
        </label>
        <textarea
          className="min-h-24 w-full rounded-xl border border-zinc-300 bg-transparent p-3 outline-none focus:border-blue-600 dark:border-zinc-700"
          disabled={loading}
          id="classroom-input"
          maxLength={800}
          onChange={(event) => setInput(event.target.value)}
          value={input}
        />

        <div>
          <label className="mb-2 block text-sm font-medium" htmlFor="classroom-scenario">
            Mock 场景
          </label>
          <select
            className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
            disabled={loading}
            id="classroom-scenario"
            onChange={(event) => setScenario(event.target.value as MockClassroomScenario)}
            value={scenario}
          >
            <option value="teacher">普通问题：教师回答</option>
            <option value="assistant">还是不懂：助教回答</option>
            <option value="ack">好的：等待用户</option>
            <option value="stop">结束讨论：结束课堂</option>
            <option value="whiteboard">白板动作与重复去重</option>
            <option value="service-error">服务错误</option>
            <option value="interrupted">无终结事件断线</option>
          </select>
        </div>

        <div className="flex gap-3">
          <button
            className="rounded-xl bg-blue-700 px-5 py-2.5 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!input.trim() || loading}
            type="submit"
          >
            {loading ? "课堂生成中…" : "发送"}
          </button>
          {loading && (
            <button
              className="rounded-xl border border-zinc-300 px-5 py-2.5 dark:border-zinc-700"
              onClick={cancelRequest}
              type="button"
            >
              停止
            </button>
          )}
        </div>
      </form>

      <section aria-live="polite" className="mt-8 space-y-4">
        {lastInput && (
          <article className="ml-auto max-w-2xl rounded-2xl bg-blue-700 p-4 text-white">
            <p className="text-xs font-semibold opacity-75">你</p>
            <p className="mt-1 leading-7">{lastInput}</p>
          </article>
        )}

        {state.messages.map((message) => (
          <article
            className="max-w-2xl rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
            key={message.id}
          >
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-semibold">{message.agentName}</h2>
              <span className="text-xs text-zinc-500">
                {message.status === "streaming"
                  ? "生成中"
                  : message.status === "interrupted"
                    ? "已中断"
                    : "已完成"}
              </span>
            </div>
            <p className="mt-3 whitespace-pre-wrap leading-7">
              {message.content || "正在组织回答…"}
            </p>
          </article>
        ))}

        {state.cue?.prompt && (
          <div className="rounded-xl bg-blue-50 p-4 text-blue-900">
            {state.cue.prompt}
          </div>
        )}

        {state.error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800" role="alert">
            {state.error}
          </div>
        )}

        {state.done && (
          <p className="text-sm text-zinc-500">
            本轮角色数：{state.done.totalAgents}；动作数：{state.done.totalActions}
          </p>
        )}

        {whiteboard.open && (
          <section className="rounded-2xl border-2 border-slate-300 bg-slate-50 p-5 text-slate-900">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">Mock 白板</h2>
              <span className="text-xs text-slate-500">1000 × 562 坐标系</span>
            </div>
            <div className="relative mt-4 aspect-[1000/562] overflow-hidden rounded-xl bg-white shadow-inner">
              {whiteboard.elements.map((element) => (
                <div
                  className="absolute overflow-hidden rounded border border-blue-200 bg-blue-50 p-2"
                  key={element.id}
                  style={{
                    color: element.color,
                    fontSize: `${element.fontSize}px`,
                    height: `${(element.height / 562) * 100}%`,
                    left: `${(element.x / 1000) * 100}%`,
                    top: `${(element.y / 562) * 100}%`,
                    width: `${(element.width / 1000) * 100}%`,
                  }}
                >
                  {element.content}
                </div>
              ))}
            </div>
          </section>
        )}

        {actionResults.length > 0 && (
          <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="font-semibold">动作执行记录</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {actionResults.map((result, index) => (
                <li key={`${result.actionId}-${index}`}>
                  {result.actionName} · {result.actionId} · {result.status}
                  {result.reason ? ` · ${result.reason}` : ""}
                </li>
              ))}
            </ul>
          </section>
        )}
      </section>
      <RequestDiagnostic diagnostic={diagnostic} />
    </main>
  );
}
