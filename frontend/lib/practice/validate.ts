import { parseCitation } from "@/lib/api/validate";
import {
  arrayAt,
  booleanAt,
  ContractValidationError,
  nullableStringAt,
  nonEmptyStringAt,
  numberAt,
  objectAt,
  stringArrayAt,
  stringAt,
} from "@/lib/contracts/validation";
import type {
  PracticeDifficulty,
  PracticeQuestion,
  PracticeResult,
  PracticeSession,
  PracticeSubmission,
} from "@/lib/practice/types";

function difficultyAt(value: unknown, path: string): PracticeDifficulty {
  const difficulty = stringAt(value, path);
  if (difficulty !== "easy" && difficulty !== "medium" && difficulty !== "hard") {
    throw new ContractValidationError(path, "不是受支持的难度");
  }
  return difficulty;
}

function parseQuestion(value: unknown, path: string): PracticeQuestion {
  const question = objectAt(value, path);
  if (question.type !== "single_choice") {
    throw new ContractValidationError(`${path}.type`, "当前只支持 single_choice");
  }
  const parsed: PracticeQuestion = {
    id: nonEmptyStringAt(question.id, `${path}.id`),
    type: "single_choice",
    stem: nonEmptyStringAt(question.stem, `${path}.stem`),
    options: stringArrayAt(question.options, `${path}.options`),
    difficulty: difficultyAt(question.difficulty, `${path}.difficulty`),
    knowledge_point: nullableStringAt(question.knowledge_point, `${path}.knowledge_point`),
    max_score: numberAt(question.max_score, `${path}.max_score`),
  };
  if (parsed.options.length < 2) {
    throw new ContractValidationError(`${path}.options`, "至少需要两个选项");
  }
  if (parsed.max_score <= 0) {
    throw new ContractValidationError(`${path}.max_score`, "必须大于 0");
  }
  return parsed;
}

export function parsePracticeSession(value: unknown): PracticeSession {
  const session = objectAt(value, "practice_session");
  if (session.status !== "active") {
    throw new ContractValidationError("practice_session.status", "必须是 active");
  }
  const parsed: PracticeSession = {
    session_id: nonEmptyStringAt(session.session_id, "practice_session.session_id"),
    section_key: nonEmptyStringAt(session.section_key, "practice_session.section_key"),
    chapter_title: stringAt(session.chapter_title, "practice_session.chapter_title"),
    section_number: stringAt(session.section_number, "practice_session.section_number"),
    section_title: stringAt(session.section_title, "practice_session.section_title"),
    difficulty: difficultyAt(session.difficulty, "practice_session.difficulty"),
    status: "active",
    created_at: nonEmptyStringAt(session.created_at, "practice_session.created_at"),
    questions: arrayAt(session.questions, "practice_session.questions").map((item, index) =>
      parseQuestion(item, `practice_session.questions[${index}]`),
    ),
  };
  const ids = parsed.questions.map((question) => question.id);
  if (new Set(ids).size !== ids.length) {
    throw new ContractValidationError("practice_session.questions", "question id 不能重复");
  }
  return parsed;
}

function parseResult(value: unknown, path: string): PracticeResult {
  const result = objectAt(value, path);
  if (result.type !== "single_choice") {
    throw new ContractValidationError(`${path}.type`, "当前只支持 single_choice");
  }
  return {
    question_id: nonEmptyStringAt(result.question_id, `${path}.question_id`),
    type: "single_choice",
    stem: nonEmptyStringAt(result.stem, `${path}.stem`),
    options: stringArrayAt(result.options, `${path}.options`),
    answer: stringAt(result.answer, `${path}.answer`),
    correct_answer: stringAt(result.correct_answer, `${path}.correct_answer`),
    score: numberAt(result.score, `${path}.score`),
    max_score: numberAt(result.max_score, `${path}.max_score`),
    is_correct: booleanAt(result.is_correct, `${path}.is_correct`),
    analysis: stringAt(result.analysis, `${path}.analysis`),
    feedback: stringAt(result.feedback, `${path}.feedback`),
    covered_points: stringArrayAt(result.covered_points, `${path}.covered_points`),
    missing_points: stringArrayAt(result.missing_points, `${path}.missing_points`),
    errors: stringArrayAt(result.errors, `${path}.errors`),
    review_required: booleanAt(result.review_required, `${path}.review_required`),
    knowledge_point: nullableStringAt(result.knowledge_point, `${path}.knowledge_point`),
    citation: parseCitation(result.citation, `${path}.citation`),
  };
}

export function parsePracticeSubmission(value: unknown): PracticeSubmission {
  const submission = objectAt(value, "practice_submission");
  if (submission.status !== "submitted") {
    throw new ContractValidationError("practice_submission.status", "必须是 submitted");
  }
  const parsed: PracticeSubmission = {
    session_id: nonEmptyStringAt(submission.session_id, "practice_submission.session_id"),
    status: "submitted",
    total_score: numberAt(submission.total_score, "practice_submission.total_score"),
    max_score: numberAt(submission.max_score, "practice_submission.max_score"),
    correct_count: numberAt(submission.correct_count, "practice_submission.correct_count"),
    question_count: numberAt(submission.question_count, "practice_submission.question_count"),
    submitted_at: nonEmptyStringAt(submission.submitted_at, "practice_submission.submitted_at"),
    results: arrayAt(submission.results, "practice_submission.results").map((item, index) =>
      parseResult(item, `practice_submission.results[${index}]`),
    ),
  };
  const resultIds = parsed.results.map((result) => result.question_id);
  if (new Set(resultIds).size !== resultIds.length) {
    throw new ContractValidationError("practice_submission.results", "question_id 不能重复");
  }
  const scoreTotal = parsed.results.reduce((total, result) => total + result.score, 0);
  const maxScoreTotal = parsed.results.reduce((total, result) => total + result.max_score, 0);
  const correctTotal = parsed.results.filter((result) => result.is_correct).length;
  if (
    parsed.question_count !== parsed.results.length ||
    parsed.correct_count !== correctTotal ||
    Math.abs(parsed.total_score - scoreTotal) > 0.001 ||
    Math.abs(parsed.max_score - maxScoreTotal) > 0.001
  ) {
    throw new ContractValidationError("practice_submission", "汇总字段与逐题结果不一致");
  }
  return parsed;
}
