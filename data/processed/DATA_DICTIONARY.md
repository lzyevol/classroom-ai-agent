# 数据字典（A 交付）

> 供 B 在线检索/RAG 与 C 联调使用。字段以 `data/processed/` 成品文件为准。

## 公共标识

| 标识 | 取值示例 | 说明 |
|---|---|---|
| `SOURCE_ID` | `book_embodied_ai_intro_2024` | 教材唯一标识，所有节点/边按 `source_id` 过滤 |
| `section_number` | `1.1` | 教材显示编号，非全局主键 |
| `section_id` | `book_embodied_ai_intro_2024:1.1` | 离线章节标识（sections.json） |
| `section_key` | `book_embodied_ai_intro_2024:1.1` | 在线课程/练习章节键（Neo4j Section.section_key），映射表见 section_mapping.csv |
| `chunk_id` | `book_embodied_ai_intro_2024:1.1:chunk-001` | 原文片段稳定 ID，问答引用/课堂证据/题目来源共用 |
| `entity_id` | SHA-1 前 16 位 | 知识实体标识 |

## sections.json（数组，170 节）

| 字段 | 类型 | 说明 |
|---|---|---|
| section_id | str | `SOURCE_ID:section_number` |
| book | str | 教材名（具身智能导论） |
| chapter_number | int | 章号 1–13 |
| chapter_title | str | 章标题 |
| section_number | str | 小节显示编号（如 1.1） |
| section_title | str | 小节标题 |
| level | int | 层级 |
| content_type | str | core/introduction/epigraph/summary/exercise/reference/further_reading |
| include_in_rag | bool | 是否进入检索（仅 core/introduction 等 140 节为 true） |
| source_page_indexes | list[int] | 来源页 |
| content_blocks | list | 版面块 |
| image_refs | list | 图片引用 |
| content_raw | str | 原文 |
| content_clean | str | 清洗后文本 |

## chunks.jsonl（426 条）

| 字段 | 类型 | 说明 |
|---|---|---|
| chunk_id | str | 稳定 ID（见公共标识） |
| source_id | str | 教材标识 |
| book / chapter_number / chapter_title / section_number / section_title | - | 定位信息 |
| content_type | str | core 等 |
| citation_label | str | 引用定位文案（如《具身智能导论》第1章“具身智能概述”，1.1 “引言”） |
| source_page_indexes_internal | list[int] | 内部页索引 |
| source_blocks | list | 来源块（页/块 ID/坐标/片段序号） |
| image_refs | list | 绑定图片（local_path/caption） |
| content_clean | str | 清洗文本（RAG 用） |
| quote_original | str | OCR 原文（逐字可追溯） |

## kg_entities.jsonl（788 条）

| 字段 | 类型 | 说明 |
|---|---|---|
| entity_id | str | 稳定 ID |
| name | str | 实体名 |
| type | str | 本体 12 类：Concept/Method/ModelAlgorithm/Component/Task/Agent/Capability/Platform/Metric/Dataset/Environment/Experiment |
| aliases | list[str] | 别名 |
| definitions_json | str | 定义 |
| type_candidates_json | str | 候选类型 |
| source_chunk_ids | list[str] | 证据片段 ID（EVIDENCED_BY 来源） |
| source_id | str | 教材标识 |

## kg_relations.jsonl（338 条）

| 字段 | 类型 | 说明 |
|---|---|---|
| relation_id | str | 关系 ID |
| head / tail | str | 端点实体 ID |
| relation | str | 本体 18 类：USES/PART_OF/DEPENDS_ON/SOLVES/IMPROVES/INSTANCE_OF/ENABLES/APPLIED_TO/IS_A/HAS_INPUT/IMPLEMENTED_ON/HAS_PROPERTY/EVALUATED_BY/COMPARED_WITH/INTERACTS_WITH/PERCEIVES/HAS_OUTPUT/ACTS_ON |
| max_confidence | float | 最大置信度（≥0.75） |
| evidence_json | str | 原文证据（逐字 + 章节定位） |
| source_id | str | 教材标识 |

## kg_section_links.jsonl（1143 条，MENTIONED_IN）

| 字段 | 说明 |
|---|---|
| entity_id | 实体 ID |
| section_number | 小节编号 |
| section_key / source_id | 章节键 / 教材标识 |

## Neo4j 图结构

| 节点/边 | 说明 | 数量 |
|---|---|---|
| `:KnowledgeEntity:<类型>` | 实体节点（entity_id 唯一约束） | 788 |
| `:Section` | 小节节点（section_key 唯一约束） | 140 |
| `:Chunk` | 片段节点（chunk_id 唯一约束） | 426 |
| `(:KnowledgeEntity)-[:EVIDENCED_BY]->(:Chunk)` | 证据链 | 1297 |
| `(:Chunk)-[:BELONGS_TO]->(:Section)` | 归属 | 426 |
| `(:KnowledgeEntity)-[:MENTIONED_IN]->(:Section)` | 快捷关联 | 1143 |
| `(:KnowledgeEntity)-[:<关系类型>]->(:KnowledgeEntity)` | 领域关系 | 338 |

> 关系类型白名单与实体类型白名单见 `config/kg_ontology.json`。
