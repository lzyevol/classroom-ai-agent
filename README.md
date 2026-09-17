# Classroom AI Agent 复现工程

三人协作复现项目。当前仓库按以下分支分工：

- `feature/data-kg`：成员 A，教材数据、Chunk、知识图谱与 Neo4j。
- `feature/backend-agent`：成员 B，FastAPI、RAG、LLM、Agent、课堂服务与练习后端。
- `feature/frontend-test`：成员 C，前端页面、SSE 消费、浏览器 Action、联调测试和演示。

成员 C 的运行说明见 [frontend/README.md](frontend/README.md)，当前测试事实与 Mock/真实差异见 `docs/`。

## 当前集成状态

- A 的 v1.0 数据成品、Neo4j 导入脚本和教材图片已接入；运行数据库 `data/classroom.db` 未作为代码合并。
- B 的 QA/knowledge 实现已按其分支提交合并，FastAPI 工程底座来自 A 分支中提供的复现基底。
- C 的页面默认仍使用 L1 Mock；QA 已完成“浏览器/HTTP → Next.js 代理 → FastAPI → Neo4j”的 L2 验证。
- 真实 DeepSeek 的 L3 尚未执行，课堂真实 SSE 与真实练习题库仍缺 B 的交接输入。

## 一键启动配置

复制示例配置后再填写本机密码与可选模型 Key：

```powershell
Copy-Item .env.docker.example .env
docker compose up --build
```

默认访问地址：前端 `http://127.0.0.1:3100`，后端文档 `http://127.0.0.1:8100/docs`，Neo4j 浏览器 `http://127.0.0.1:7475`。Compose 项目名、宿主机端口和数据卷均与原项目隔离。

## 本地验证

后端：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe scripts\10_import_neo4j.py --dry-run
```

前端命令见 [frontend/README.md](frontend/README.md)。
