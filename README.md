# 具身智能课程教学智能体

当前仓库已建立《具身智能导论》OCR 教材清洗流水线，用于生成可追溯的章节数据、RAG 引用片段，并为后续知识图谱抽取提供输入。

## Docker 一键启动（推荐交付方式）

只安装 Docker Desktop 即可运行完整服务。复制 Docker 环境模板、填写 Neo4j 密码和可选 API Key 后执行：

```powershell
Copy-Item .env.docker.example .env
docker compose up --build
```

详细的启动、持久化、重置和故障排查说明见 [`docs/Docker一键启动说明.md`](docs/Docker一键启动说明.md)。

## 从零启动完整项目

下面的步骤适用于 Windows PowerShell。仓库已经包含当前演示所需的课程图片、处理后的教材数据、SQLite 数据库、已生成课件、预生成题目以及演示学习记录；克隆代码后不需要重新生成这些内容。Neo4j 图数据仍需在新电脑上导入一次。

### 1. 环境要求

请先安装：

- Git
- Python 3.12（当前开发环境为 3.12.13）
- Node.js 22（前端要求 Node.js 20.9.0 及以上，仓库的 `frontend/.nvmrc` 指定为 22）
- pnpm 10（项目指定版本为 10.28.0，可通过 Node.js 自带的 Corepack 安装）
- Neo4j Desktop 或 Neo4j Server

### 2. 拉取代码

`feature/front` 是当前开发分支：

```powershell
git clone https://gitee.com/ilycn/classroom-ai-agent.git
cd classroom-ai-agent
git checkout feature/front
```

只有已经推送到 Gitee 的提交才能被其他电脑拉取。若代码或运行数据仍只存在于本地提交中，需要先在开发电脑执行：

```powershell
git push -u origin feature/front
```

### 3. 安装后端依赖

在仓库根目录创建 Python 虚拟环境并安装依赖：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

后续命令直接使用虚拟环境中的 `python.exe`，因此不强制要求手动激活虚拟环境。

### 4. 配置后端环境变量

复制配置模板：

```powershell
Copy-Item .env.example .env
```

打开根目录的 `.env`，至少修改 Neo4j 密码：

```env
NEO4J_URI=neo4j://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=你的Neo4j密码
NEO4J_DATABASE=neo4j
```

模型和语音配置说明：

- 使用 DeepSeek 问答、课堂讨论或生成内容时，填写 `DEEPSEEK_API_KEY`。
- 使用通义千问 TTS 时，填写 `QWEN_TTS_API_KEY`。
- 浏览器内置语音和 Edge TTS 不需要在后端配置 API Key。
- 真实 API Key 只能保存在本机 `.env` 或应用设置中，不要提交到 Git。

仓库中的 SQLite 数据库已经包含演示账号。修改 `.env` 里的 `DEMO_*_PASSWORD` 只会影响首次创建账号，不会自动修改现有数据库里的账号密码。

### 5. 启动并导入 Neo4j

在 Neo4j Desktop 中创建并启动一个本地数据库，默认连接信息为：

```text
地址：neo4j://localhost:7687
用户名：neo4j
数据库：neo4j
```

确保密码与根目录 `.env` 中的 `NEO4J_PASSWORD` 一致，然后在仓库根目录执行：

```powershell
.\.venv\Scripts\python.exe scripts\10_import_neo4j.py --dry-run
.\.venv\Scripts\python.exe scripts\10_import_neo4j.py
```

当前完整数据的 dry-run 统计应接近：

```text
entities: 788
sections: 140
chunks: 426
chunk_section_links: 426
evidence_links: 1297
mentions: 1143
knowledge_relations: 338
```

### 6. 启动后端

在仓库根目录执行：

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

启动后可访问：

- 健康检查：`http://127.0.0.1:8000/health`
- FastAPI 接口文档：`http://127.0.0.1:8000/docs`

正常的健康检查响应为：

```json
{"status":"ok","neo4j":"connected"}
```

请保持这个终端运行。

### 7. 安装并启动前端

另开一个 PowerShell 终端，进入前端目录：

```powershell
cd frontend
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

浏览器访问：

```text
http://127.0.0.1:3000
```

前端会把 `/backend/*` 请求代理到 `http://127.0.0.1:8000`。如果后端使用了其他地址，可在启动前端前设置 `BACKEND_URL`。

### 8. 演示账号

| 身份 | 用户名 | 默认密码 |
| --- | --- | --- |
| 学生 | `student` | `student123` |
| 教师 | `teacher` | `teacher123` |
| 管理员 | `admin` | `admin123` |

这些账号仅用于本地演示。对外部署前必须修改默认密码。

### 9. 首次使用说明

- SQLite 数据库 `data/classroom.db` 已包含当前课件、题库、练习记录、错题和学习记录，不需要重新生成。
- Neo4j 数据不存放在 SQLite 中，因此每台新电脑仍需执行一次知识图谱导入。
- 浏览器本地保存的模型选择、API Key、语音类型和具体音色不会随 Git 仓库迁移。登录后请在系统设置中重新选择语言模型与语音。
- Edge TTS 和浏览器内置语音可以直接选择；浏览器语音的可用音色取决于对方电脑的操作系统和浏览器。
- 如果以后要把最新的 SQLite 运行数据提交到 Git，请先停止后端，使 WAL 数据合并到 `data/classroom.db`。不要提交 `data/classroom.db-wal` 和 `data/classroom.db-shm`。

### 10. 常见问题

#### 健康检查失败或返回 503

确认 Neo4j 已启动，并检查 `.env` 中的地址、用户名、密码和数据库名。

#### 页面能打开，但章节目录或知识内容为空

通常是 Neo4j 尚未导入。重新执行 `scripts\10_import_neo4j.py`，并观察导入命令是否报错。

#### 前端提示接口请求失败

确认后端终端仍在运行，且 `http://127.0.0.1:8000/health` 可以正常访问。还应确认 8000 端口没有被其他程序占用。

#### DeepSeek 问答或课堂讨论不可用

检查根目录 `.env` 或前端模型设置中的 API Key、模型名称和接口地址。保存后重新发起一次请求。

#### 语音没有声音

在系统设置中确认已经勾选语音引擎和音色，同时检查浏览器标签页是否静音、Windows 音量、浏览器自动播放权限以及当前电脑是否安装了所选的系统语音。

## 当前数据原则

- 不覆盖 PaddleOCR 原始 JSON / Markdown。
- 面向学生展示“教材原文片段 + 所在章/节”，不展示页码。
- 页号、版面坐标仍作为内部字段保留，用于追溯原文和定位教材图片。
- 确定性错字由规则修正并记录日志；不确定内容进入人工复核清单。
- DeepSeek 默认关闭，后续只用于疑似 OCR 错误复核，不允许直接改写原文。
- 知识图谱阶段使用 `deepseek-v4-flash` 生成候选，只有通过本地本体、原文证据和置信度校验的结果才进入成品。

## 运行清洗流水线

在仓库根目录执行：

```powershell
python scripts/02_clean_pages.py --input "具身智能导论_15539220.pdf_by_PaddleOCR-VL-1.6.json"
python scripts/03_build_sections.py
python scripts/04_build_chunks.py
python scripts/05_extract_images.py
python scripts/06_validate_output.py
```

主要输出：

- `data/interim/clean_pages.jsonl`：清洗后的页面与版面块。
- `data/processed/sections.json`：章、节、小节结构以及图片关联。
- `data/processed/chunks.jsonl`：可检索片段，包含清洗文本、引用原文和章节定位。
- `data/processed/images.jsonl`：图片清单、本地路径、图题和完整性哈希。
- `data/reports/correction_log.jsonl`：自动纠错记录。
- `data/reports/manual_review.jsonl`：待人工或 DeepSeek 复核的疑似错误。
- `data/reports/validation_report.json`：最终完整性检查。
- `data/processed/kg_entities.jsonl`：知识图谱实体。
- `data/processed/kg_relations.jsonl`：带教材原文证据和章节定位的关系。
- `data/processed/kg_section_links.jsonl`：实体与教材小节的确定性关联。
- `data/processed/knowledge_graph.json`：前端可直接加载的完整 nodes / edges / section_links 图谱。

## 导入本地 Neo4j Desktop

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-neo4j.txt
.\.venv\Scripts\python.exe scripts\10_import_neo4j.py --dry-run
.\.venv\Scripts\python.exe scripts\10_import_neo4j.py
```

导入脚本默认连接 `neo4j://localhost:7687`，用户名和数据库均为 `neo4j`。
密码未通过环境变量提供时会在终端中安全提示输入，不会写入项目文件。

脚本会同时导入知识实体、教材小节和原文 `Chunk` 节点，并建立：

- `(KnowledgeEntity)-[:EVIDENCED_BY]->(Chunk)`：知识点对应的教材原文证据。
- `(Chunk)-[:BELONGS_TO]->(Section)`：原文片段所属的小节。
- `(KnowledgeEntity)-[:MENTIONED_IN]->(Section)`：知识点所在小节的快捷关联。

原文保存在 `Chunk.quote_original`，清洗后的检索文本保存在
`Chunk.content_clean`；图片引用、内部页索引和版面块信息作为内部追溯字段保留。

数据目录的详细约定见 `data/README.md`，脚本说明见 `scripts/README.md`。
