import {
  mockAllCorrectSubmission,
  mockPartialSubmission,
  mockPracticeSession,
} from "@/fixtures/practice/responses";
import { ApiError, responseToApiError } from "@/lib/api/errors";
import type {
  GeneratePracticeRequest,
  MockPracticeScenario,
  PracticeSession,
  PracticeSubmission,
  SubmitPracticeRequest,
} from "@/lib/practice/types";
import { parsePracticeSession, parsePracticeSubmission } from "@/lib/practice/validate";

const PRACTICE_URL = "/backend/api/practice";

export const practiceApiMode =
  process.env.NEXT_PUBLIC_API_MODE === "real" ? "real" : "mock";

interface RequestOptions {
  signal?: AbortSignal;
  token?: string;
  mockScenario?: MockPracticeScenario;
}

function headers(token?: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function waitForMock(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, 350);
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

export async function generatePractice(
  request: GeneratePracticeRequest,
  options: RequestOptions = {},
): Promise<PracticeSession> {
  if (practiceApiMode === "mock") {
    await waitForMock(options.signal);
    if (options.mockScenario === "generate-error") {
      throw new ApiError("模拟题库暂时不足，无法创建练习", 422);
    }
    return mockPracticeSession;
  }

  const response = await fetch(`${PRACTICE_URL}/generate`, {
    method: "POST",
    headers: headers(options.token),
    body: JSON.stringify(request),
    signal: options.signal,
  });
  if (!response.ok) {
    throw await responseToApiError(response, `创建练习失败（${response.status}）`);
  }
  return parsePracticeSession(await response.json());
}

export async function submitPractice(
  sessionId: string,
  request: SubmitPracticeRequest,
  options: RequestOptions = {},
): Promise<PracticeSubmission> {
  if (practiceApiMode === "mock") {
    await waitForMock(options.signal);
    if (options.mockScenario === "submit-error") {
      throw new ApiError("模拟会话已经提交，请重新开始练习", 409);
    }
    return options.mockScenario === "partial"
      ? mockPartialSubmission
      : mockAllCorrectSubmission;
  }

  const response = await fetch(`${PRACTICE_URL}/${encodeURIComponent(sessionId)}/submit`, {
    method: "POST",
    headers: headers(options.token),
    body: JSON.stringify(request),
    signal: options.signal,
  });
  if (!response.ok) {
    throw await responseToApiError(response, `提交练习失败（${response.status}）`);
  }
  return parsePracticeSubmission(await response.json());
}
