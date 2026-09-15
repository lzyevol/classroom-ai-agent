import { mockQANoEvidence, mockQASuccess } from "@/fixtures/qa/responses";
import { ApiError, responseToApiError } from "@/lib/api/errors";
import { parseQAResponse } from "@/lib/api/validate";
import type {
  MockQAScenario,
  QAHistoryMessage,
  QARequest,
  QAResponse,
} from "@/lib/api/types";

const QA_URL = "/backend/api/qa";

export const apiMode =
  process.env.NEXT_PUBLIC_API_MODE === "real" ? "real" : "mock";

interface AskQuestionOptions {
  question: string;
  history?: QAHistoryMessage[];
  maxCitations?: number;
  signal?: AbortSignal;
  mockScenario?: MockQAScenario;
}

function waitForMock(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, 450);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("请求已取消", "AbortError"));
      },
      { once: true },
    );
  });
}

async function askMock(
  scenario: MockQAScenario,
  signal?: AbortSignal,
): Promise<QAResponse> {
  await waitForMock(signal);

  if (scenario === "service-error") {
    throw new ApiError("模拟检索服务暂不可用", 503);
  }

  return scenario === "no-evidence" ? mockQANoEvidence : mockQASuccess;
}

export async function askQuestion({
  question,
  history = [],
  maxCitations = 3,
  signal,
  mockScenario = "success",
}: AskQuestionOptions): Promise<QAResponse> {
  const normalizedQuestion = question.trim();
  if (!normalizedQuestion) {
    throw new ApiError("问题不能为空", 422);
  }

  if (apiMode === "mock") {
    return askMock(mockScenario, signal);
  }

  const request: QARequest = {
    question: normalizedQuestion,
    history,
    max_citations: maxCitations,
  };

  const response = await fetch(QA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    throw await responseToApiError(response, `问答请求失败（${response.status}）`);
  }

  return parseQAResponse(await response.json());
}
