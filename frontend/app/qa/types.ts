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

export interface QAHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  content: string;
  loading?: boolean;
  error?: string;
  response?: QAResponse;
  createdAt: number;
}

export interface QASession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}
