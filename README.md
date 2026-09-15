# Classroom AI Agent 复现工程

三人协作复现项目。当前仓库按以下分支分工：

- `feature/data-kg`：成员 A，教材数据、Chunk、知识图谱与 Neo4j。
- `feature/backend-agent`：成员 B，FastAPI、RAG、LLM、Agent、课堂服务与练习后端。
- `feature/frontend-test`：成员 C，前端页面、SSE 消费、浏览器 Action、联调测试和演示。

成员 C 的运行说明见 [frontend/README.md](frontend/README.md)，当前测试事实与 Mock/真实差异见 `docs/`。

当前页面能力默认处于 **L1 Mock**，不能视为真实教材、真实模型、认证、数据库或跨服务联调已经完成。
