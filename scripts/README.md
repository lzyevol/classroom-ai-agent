# 数据处理脚本

后续脚本按顺序放置：

```text
01_profile_source.py
02_clean_pages.py              # 已实现：页面/版面块清洗、确定性纠错、复核清单
03_build_sections.py           # 已实现：按编号构建章/节/小节，保留图片关联
04_build_chunks.py             # 已实现：生成带原文引用和章节定位的RAG片段
05_extract_images.py             # 已实现：下载图片、绑定图题、回填本地路径
06_validate_output.py           # 已实现：检查章节、片段、引用原文和图片关联
07_extract_kg_deepseek.py        # 已实现：DeepSeek候选实体/关系抽取，可断点续跑
08_build_knowledge_graph.py      # 已实现：本地证据校验、去重并生成知识图谱文件
09_validate_knowledge_graph.py   # 已实现：校验实体端点、关系类型、原文证据和章节链接
10_import_neo4j.py               # 已实现：幂等导入本地Neo4j并核对数量
```

所有脚本应从 `data/raw/` 读取数据，将中间结果写入 `data/interim/`，最终结果写入 `data/processed/`，不得覆盖原始教材文件。

当前原始文件仍位于仓库根目录，可运行：

```powershell
python scripts/02_clean_pages.py --input "具身智能导论_15539220.pdf_by_PaddleOCR-VL-1.6.json"
python scripts/03_build_sections.py
python scripts/04_build_chunks.py
python scripts/05_extract_images.py
python scripts/06_validate_output.py

# 当前PowerShell会话中设置密钥，不要写入仓库文件
$env:DEEPSEEK_API_KEY="<你的密钥>"
python scripts/07_extract_kg_deepseek.py --limit 3
python scripts/08_build_knowledge_graph.py
python scripts/09_validate_knowledge_graph.py

# 本地Neo4j实例启动后执行；未设置密码时会安全地提示输入
.\.venv\Scripts\python.exe scripts\10_import_neo4j.py --dry-run
.\.venv\Scripts\python.exe scripts\10_import_neo4j.py
```
