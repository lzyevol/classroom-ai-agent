import type {
  PracticeSession,
  PracticeSubmission,
} from "@/lib/practice/types";

const mockCitation = {
  chunk_id: "mock:1.1:chunk-001",
  book: "具身智能导论（Mock）",
  chapter_title: "第 1 章 绪论",
  section_number: "1.1",
  section_title: "具身智能概述",
  quote: "这是前端开发使用的占位引用，等待 A/B 提供可追溯的真实教材 fixture。",
  image_urls: [],
};

export const mockPracticeSession: PracticeSession = {
  session_id: "mock-session-001",
  section_key: "mock-section-1.1",
  chapter_title: "第 1 章 绪论",
  section_number: "1.1",
  section_title: "具身智能概述",
  difficulty: "easy",
  status: "active",
  created_at: "2026-09-15T02:00:00Z",
  questions: [
    {
      id: "mock-question-001",
      type: "single_choice",
      stem: "具身智能系统最强调哪种能力？",
      options: ["只处理文本", "通过身体与环境交互", "只存储知识", "只生成图片"],
      difficulty: "easy",
      knowledge_point: "具身智能定义",
      max_score: 10,
    },
    {
      id: "mock-question-002",
      type: "single_choice",
      stem: "智能体感知环境后，通常还需要完成什么？",
      options: ["行动与反馈", "删除输入", "关闭模型", "忽略状态"],
      difficulty: "easy",
      knowledge_point: "感知—行动闭环",
      max_score: 10,
    },
    {
      id: "mock-question-003",
      type: "single_choice",
      stem: "下列哪项最接近 Agent 的状态作用？",
      options: ["记录执行过程中需要延续的信息", "替代所有工具", "隐藏全部错误", "固定每次输出"],
      difficulty: "easy",
      knowledge_point: "Agent State",
      max_score: 10,
    },
  ],
};

function result(
  index: number,
  answer: string,
  correctAnswer: string,
  isCorrect: boolean,
) {
  const question = mockPracticeSession.questions[index];
  return {
    question_id: question.id,
    type: question.type,
    stem: question.stem,
    options: question.options,
    answer,
    correct_answer: correctAnswer,
    score: isCorrect ? question.max_score : 0,
    max_score: question.max_score,
    is_correct: isCorrect,
    analysis: isCorrect ? "选择与 Mock 标准答案一致。" : "请结合教材重新理解该知识点。",
    feedback: isCorrect ? "回答正确。" : `正确选项为 ${correctAnswer}。`,
    covered_points: [],
    missing_points: [],
    errors: [],
    review_required: false,
    knowledge_point: question.knowledge_point,
    citation: mockCitation,
  };
}

export const mockAllCorrectSubmission: PracticeSubmission = {
  session_id: mockPracticeSession.session_id,
  status: "submitted",
  total_score: 30,
  max_score: 30,
  correct_count: 3,
  question_count: 3,
  submitted_at: "2026-09-15T02:05:00Z",
  results: [result(0, "B", "B", true), result(1, "A", "A", true), result(2, "A", "A", true)],
};

export const mockPartialSubmission: PracticeSubmission = {
  session_id: mockPracticeSession.session_id,
  status: "submitted",
  total_score: 20,
  max_score: 30,
  correct_count: 2,
  question_count: 3,
  submitted_at: "2026-09-15T02:05:00Z",
  results: [result(0, "B", "B", true), result(1, "C", "A", false), result(2, "A", "A", true)],
};
