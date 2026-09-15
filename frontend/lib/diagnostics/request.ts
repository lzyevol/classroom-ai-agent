import { ApiError } from "@/lib/api/errors";
import { ContractValidationError } from "@/lib/contracts/validation";
import { SSEInterruptedError, SSEProtocolError } from "@/lib/sse/errors";
import { redactSensitiveText } from "@/lib/security/redact";

export type DiagnosticStatus =
  | "running"
  | "completed"
  | "cancelled"
  | "http_error"
  | "contract_error"
  | "protocol_error"
  | "interrupted"
  | "stream_error"
  | "unexpected_error";

export interface RequestDiagnostic {
  operation: "qa.ask" | "classroom.stream" | "practice.generate" | "practice.submit";
  mode: "mock" | "real";
  status: DiagnosticStatus;
  httpStatus?: number;
  detail?: string;
}

export function diagnosticFromError(
  operation: RequestDiagnostic["operation"],
  mode: RequestDiagnostic["mode"],
  error: unknown,
): RequestDiagnostic {
  if (error instanceof DOMException && error.name === "AbortError") {
    return { operation, mode, status: "cancelled", detail: "用户取消了请求" };
  }
  if (error instanceof ApiError) {
    return {
      operation,
      mode,
      status: "http_error",
      httpStatus: error.status,
      detail: redactSensitiveText(error.message),
    };
  }
  if (error instanceof ContractValidationError) {
    return { operation, mode, status: "contract_error", detail: redactSensitiveText(error.message) };
  }
  if (error instanceof SSEProtocolError) {
    return { operation, mode, status: "protocol_error", detail: redactSensitiveText(error.message) };
  }
  if (error instanceof SSEInterruptedError) {
    return { operation, mode, status: "interrupted", detail: redactSensitiveText(error.message) };
  }
  return {
    operation,
    mode,
    status: "unexpected_error",
    detail: "未预期错误；详细堆栈仅应保留在开发日志中",
  };
}
