export interface QAHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface QARequest {
  question: string;
  max_citations: number;
  history: QAHistoryMessage[];
}

export interface Citation {
  chunk_id: string;
  quote: string;
  book: string;
  chapter_title: string;
  section_number: string;
  section_title: string;
  image_urls: string[];
}

export interface MatchedEntity {
  entity_id: string;
  name: string;
  entity_type: string;
}

export interface RelatedKnowledge {
  source_name: string;
  relation: string;
  target_name: string;
}

export interface QAResponse {
  answer: string;
  matched_entities: MatchedEntity[];
  citations: Citation[];
  related_knowledge: RelatedKnowledge[];
  insufficient_evidence: boolean;
}

export type MockQAScenario = "success" | "no-evidence" | "service-error";
