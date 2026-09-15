import type {
  Citation,
  MatchedEntity,
  QAResponse,
  RelatedKnowledge,
} from "@/lib/api/types";
import {
  arrayAt,
  booleanAt,
  nonEmptyStringAt,
  objectAt,
  stringArrayAt,
  stringAt,
} from "@/lib/contracts/validation";

export function parseCitation(value: unknown, path: string): Citation {
  const item = objectAt(value, path);
  return {
    chunk_id: nonEmptyStringAt(item.chunk_id, `${path}.chunk_id`),
    quote: stringAt(item.quote, `${path}.quote`),
    book: stringAt(item.book, `${path}.book`),
    chapter_title: stringAt(item.chapter_title, `${path}.chapter_title`),
    section_number: stringAt(item.section_number, `${path}.section_number`),
    section_title: stringAt(item.section_title, `${path}.section_title`),
    image_urls: stringArrayAt(item.image_urls, `${path}.image_urls`),
  };
}

function parseMatchedEntity(value: unknown, path: string): MatchedEntity {
  const item = objectAt(value, path);
  return {
    entity_id: nonEmptyStringAt(item.entity_id, `${path}.entity_id`),
    name: stringAt(item.name, `${path}.name`),
    entity_type: stringAt(item.entity_type, `${path}.entity_type`),
  };
}

function parseRelatedKnowledge(value: unknown, path: string): RelatedKnowledge {
  const item = objectAt(value, path);
  return {
    source_name: stringAt(item.source_name, `${path}.source_name`),
    relation: stringAt(item.relation, `${path}.relation`),
    target_name: stringAt(item.target_name, `${path}.target_name`),
  };
}

export function parseQAResponse(value: unknown): QAResponse {
  const response = objectAt(value, "qa_response");
  return {
    answer: stringAt(response.answer, "qa_response.answer"),
    matched_entities: arrayAt(response.matched_entities, "qa_response.matched_entities").map(
      (item, index) => parseMatchedEntity(item, `qa_response.matched_entities[${index}]`),
    ),
    citations: arrayAt(response.citations, "qa_response.citations").map((item, index) =>
      parseCitation(item, `qa_response.citations[${index}]`),
    ),
    related_knowledge: arrayAt(response.related_knowledge, "qa_response.related_knowledge").map(
      (item, index) => parseRelatedKnowledge(item, `qa_response.related_knowledge[${index}]`),
    ),
    insufficient_evidence: booleanAt(
      response.insufficient_evidence,
      "qa_response.insufficient_evidence",
    ),
  };
}
