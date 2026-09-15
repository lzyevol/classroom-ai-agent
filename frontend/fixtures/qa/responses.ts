import type { QAResponse } from "@/lib/api/types";

// This remains mock data until A/B provide a verified textbook chunk.
export const mockQASuccess: QAResponse = {
  answer:
    "这是前端联调回答。页面已经能够接收结构化回答并展示教材引用；真实内容将在 A/B 交付教材证据后替换。",
  matched_entities: [
    {
      entity_id: "mock-entity-embodied-ai",
      name: "具身智能",
      entity_type: "Concept",
    },
  ],
  citations: [
    {
      chunk_id: "mock:1.1:chunk-001",
      quote: "【Mock 占位文本】等待 A/B 提供经过核验的真实教材原文。",
      book: "具身智能导论（Mock）",
      chapter_title: "第 1 章（Mock）",
      section_number: "1.1",
      section_title: "引言（Mock）",
      image_urls: [],
    },
  ],
  related_knowledge: [],
  insufficient_evidence: false,
};

export const mockQANoEvidence: QAResponse = {
  answer: "当前证据不足，无法根据教材可靠回答这个问题。",
  matched_entities: [],
  citations: [],
  related_knowledge: [],
  insufficient_evidence: true,
};
