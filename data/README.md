# 教材数据目录

- `raw/`：PaddleOCR 原始 JSON、Markdown 和原始图片。只读保存，不在原文件上修改。
- `interim/`：完成页面过滤、版面块筛选和章节归属后的中间数据。
- `processed/`：供 RAG 与知识图谱使用的 `sections.json`、`chunks.jsonl` 等成品数据。
- `images/`：从 OCR 结果下载并本地化的教材图片，按内部页索引分目录保存。
- `reports/`：清洗统计、异常清单、人工复核清单和验收报告。

推荐处理链路：

```text
raw -> interim -> processed
             \-> images
             \-> reports
```

原始内容和清洗内容必须分别保存，所有自动纠错都应写入纠错日志。

图片清单位于 `processed/images.jsonl`。前端从检索片段的
`image_refs[].local_path` 读取图片，从 `image_refs[].caption` 读取图题；
`source_page_index_internal` 只用于内部追溯，不需要展示给学生。
