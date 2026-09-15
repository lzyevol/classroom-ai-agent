import { describe, expect, it } from "vitest";
import { mockQASuccess } from "@/fixtures/qa/responses";
import {
  mockPartialSubmission,
  mockPracticeSession,
} from "@/fixtures/practice/responses";
import { parseQAResponse } from "@/lib/api/validate";
import { ContractValidationError } from "@/lib/contracts/validation";
import {
  parsePracticeSession,
  parsePracticeSubmission,
} from "@/lib/practice/validate";

describe("HTTP 成功响应契约校验", () => {
  it("接受当前 QA 和练习 fixture", () => {
    expect(parseQAResponse(mockQASuccess)).toEqual(mockQASuccess);
    expect(parsePracticeSession(mockPracticeSession)).toEqual(mockPracticeSession);
    expect(parsePracticeSubmission(mockPartialSubmission)).toEqual(mockPartialSubmission);
  });

  it("QA 缺少 citations 时拒绝进入页面状态", () => {
    const invalid = { ...mockQASuccess, citations: undefined };
    expect(() => parseQAResponse(invalid)).toThrowError(ContractValidationError);
    expect(() => parseQAResponse(invalid)).toThrow("qa_response.citations 必须是数组");
  });

  it("开始练习响应泄露的未知字段不会被复制到页面对象", () => {
    const source = {
      ...mockPracticeSession,
      questions: mockPracticeSession.questions.map((question) => ({
        ...question,
        correct_answer: "B",
      })),
    };
    const parsed = parsePracticeSession(source);

    expect(parsed.questions[0]).not.toHaveProperty("correct_answer");
  });

  it("未支持题型和缺失批改字段会被拒绝", () => {
    const unsupported = {
      ...mockPracticeSession,
      questions: [{ ...mockPracticeSession.questions[0], type: "short_answer" }],
    };
    expect(() => parsePracticeSession(unsupported)).toThrow("当前只支持 single_choice");

    const incomplete = {
      ...mockPartialSubmission,
      results: [{ ...mockPartialSubmission.results[0], correct_answer: undefined }],
    };
    expect(() => parsePracticeSubmission(incomplete)).toThrow(
      "practice_submission.results[0].correct_answer 必须是字符串",
    );
  });

  it("拒绝重复题目 ID 和不一致的批改汇总", () => {
    const duplicateQuestions = {
      ...mockPracticeSession,
      questions: [mockPracticeSession.questions[0], mockPracticeSession.questions[0]],
    };
    expect(() => parsePracticeSession(duplicateQuestions)).toThrow("question id 不能重复");

    expect(() =>
      parsePracticeSubmission({ ...mockPartialSubmission, total_score: 999 }),
    ).toThrow("汇总字段与逐题结果不一致");
  });
});
