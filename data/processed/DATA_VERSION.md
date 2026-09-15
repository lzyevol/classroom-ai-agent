# 数据版本与校验值

- 数据集版本：v1.0（复现自 classroom-ai-agent-feature-zh，数据产物与师兄师姐提交文档 3.2.2 一致）
- 数据来源：教材《具身智能导论》（OCR → 清洗 → 章节 → 片段 → 知识图谱）
- SOURCE_ID：`book_embodied_ai_intro_2024`
- 生成日期：2026-09-15
- 校验值：SHA-256 前 8 位（对文件整体计算）

| 文件 | 类型 | 记录数 | 大小 | SHA-256(前8位) |
|---|---|---|---|---|
| chunks.jsonl | jsonl(行) | 426 | 1991.3 KB | `907b4881` |
| images.jsonl | jsonl(行) | 434 | 443.8 KB | `2c121564` |
| kg_entities.jsonl | jsonl(行) | 788 | 274.5 KB | `81018230` |
| kg_relations.jsonl | jsonl(行) | 338 | 248.5 KB | `306c2a64` |
| kg_section_links.jsonl | jsonl(行) | 1143 | 367.9 KB | `b11615fd` |
| knowledge_graph.json | json(数组) | 5 | 1114.7 KB | `318a421c` |
| sections.json | json(数组) | 170 | 3255.2 KB | `8c31bf3a` |

## 记录数核对

| 指标 | 数量 | 对应文件 |
|---|---|---|
| sections（含题记/练习/参考文献等） | 170 | sections.json |
| sections（进入 RAG，include_in_rag=true） | 140 | sections.json |
| chunks | 426 | chunks.jsonl |
| knowledge entities | 788 | kg_entities.jsonl |
| knowledge relations | 338 | kg_relations.jsonl |
| section links（MENTIONED_IN） | 1143 | kg_section_links.jsonl |
| evidence links（实体引用片段展开） | 1297 | 由 kg_entities.jsonl 的 source_chunk_ids 展开 |
| images 清单 | 434 | images.jsonl |
| images 实际文件 | 159 页目录 | data/images/ |

以上数量与 `scripts/10_import_neo4j.py --dry-run` 的 expected 及 Neo4j 实库查询一致。