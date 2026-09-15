import { describe, expect, it } from "vitest";
import {
  mockAllCorrectSubmission,
  mockPartialSubmission,
  mockPracticeSession,
} from "@/fixtures/practice/responses";

describe("练习 fixture 契约", () => {
  it("开始练习响应不泄露答案和解析", () => {
    for (const question of mockPracticeSession.questions) {
      expect(question).not.toHaveProperty("correct_answer");
      expect(question).not.toHaveProperty("analysis");
      expect(question).not.toHaveProperty("rubric");
    }
  });

  it("批改汇总与逐题结果一致", () => {
    for (const submission of [mockAllCorrectSubmission, mockPartialSubmission]) {
      expect(submission.question_count).toBe(submission.results.length);
      expect(submission.correct_count).toBe(
        submission.results.filter((result) => result.is_correct).length,
      );
      expect(submission.total_score).toBe(
        submission.results.reduce((total, result) => total + result.score, 0),
      );
      expect(submission.max_score).toBe(
        submission.results.reduce((total, result) => total + result.max_score, 0),
      );
    }
  });
});
