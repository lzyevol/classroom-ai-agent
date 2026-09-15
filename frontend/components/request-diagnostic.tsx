import type { RequestDiagnostic as Diagnostic } from "@/lib/diagnostics/request";

const statusText: Record<Diagnostic["status"], string> = {
  running: "请求进行中",
  completed: "请求完成",
  cancelled: "用户已取消",
  http_error: "HTTP 错误",
  contract_error: "响应契约错误",
  protocol_error: "流协议错误",
  interrupted: "连接中断",
  stream_error: "服务端流错误",
  unexpected_error: "未预期错误",
};

export function RequestDiagnostic({ diagnostic }: { diagnostic: Diagnostic | null }) {
  if (!diagnostic) return null;

  return (
    <aside
      aria-label="请求诊断"
      className="mt-6 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <h2 className="font-semibold">请求诊断（不含请求正文与凭据）</h2>
      <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[8rem_1fr]">
        <dt className="text-zinc-500">阶段</dt>
        <dd>{diagnostic.operation}</dd>
        <dt className="text-zinc-500">模式</dt>
        <dd>{diagnostic.mode}</dd>
        <dt className="text-zinc-500">状态</dt>
        <dd>{statusText[diagnostic.status]}</dd>
        {diagnostic.httpStatus !== undefined && (
          <>
            <dt className="text-zinc-500">HTTP</dt>
            <dd>{diagnostic.httpStatus}</dd>
          </>
        )}
        {diagnostic.detail && (
          <>
            <dt className="text-zinc-500">说明</dt>
            <dd>{diagnostic.detail}</dd>
          </>
        )}
      </dl>
    </aside>
  );
}
