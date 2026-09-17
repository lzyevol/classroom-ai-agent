# 前端测试执行记录

版本：2026-09-17 本地验证｜层级：L1 + 隔离 L2｜负责人：成员 C

## 1. 当前结论

L1 已证明前端组件、固定 fixture、SSE 消费与 Mock 浏览器流程可用。隔离 L2 已证明 QA 页面能经 Next.js rewrite 调用真实 FastAPI 路由，并保持成功、422 与 503 语义。Compose L2 另已证明 Next.js 代理、FastAPI、真实 Neo4j、A 的 Chunk 和教材图片贯通；真实模型仍未通过。

## 2. 自动化覆盖

| 范围 | 工具 | 已覆盖内容 |
|---|---|---|
| API 错误与安全 | Vitest | 字符串 detail、校验错误数组、非法响应、凭据脱敏 |
| 成功响应契约 | Vitest | QA、练习公开题目、批改字段、重复 ID、汇总一致性 |
| 教材问答 | Vitest + Testing Library | 正常引用、无证据、503、取消、空问题 |
| SSE 协议 | Vitest | 任意字节分片、CRLF、多个事件、error、无终结事件、Abort |
| 课堂状态与页面 | Vitest + Testing Library | 教师/助教、消息追加、动作去重、白板参数、等待/结束、错误、中断、取消 |
| 练习契约与页面 | Vitest + Testing Library | 公开题目不泄露答案、完整提交、部分错误、422、409、取消 |
| 核心浏览器流程 | Playwright | 首页、问答、课堂 SSE/Action、练习、503、断流、取消、422、409 |
| QA 跨服务联调 | Playwright + FastAPI | Next.js 代理、真实请求/响应 schema、成功引用、422、503 |
| 后端模块 | Pytest | QA、knowledge、认证、练习、权限、持久化服务等 57 项测试 |
| A 数据交接 | 数据校验脚本 | v1.0 图谱 dry-run 数量与数据清单一致 |

最近一次本地结果：

| 代码基线 | 命令 | 结果 |
|---|---|---|
| A/B/C 本地集成工作树 | Pytest | 57 个测试通过 |
| A/B/C 本地集成工作树 | Vitest | 10 个文件、52 个测试通过 |
| A/B/C 本地集成工作树 | ESLint | 通过 |
| A/B/C 本地集成工作树 | Next.js production build | 通过，4 个业务路由均生成 |
| A/B/C 本地集成工作树 | Playwright / Edge（L1） | 12 个浏览器测试通过 |
| A/B/C 本地集成工作树 | Playwright / Edge（隔离 L2） | 3 个浏览器测试通过 |
| 数据版本 v1.0 | Neo4j 导入 dry-run | 788 实体、140 章节、426 Chunk、1297 条证据边、338 条知识关系，通过 |
| A/B/C 本地集成工作树 | Docker Compose 配置解析 | 通过 |
| A/B/C 本地集成工作树 | Docker 前后端镜像构建 | 通过 |
| 数据版本 v1.0 | Compose 首次导入 | actual 与 expected 全部一致，耗时 5.11 秒 |
| 数据版本 v1.0 | Compose 重复初始化 | 检测版本已是最新并跳过，通过幂等性冒烟 |
| A/B/C 本地集成工作树 | 真实 knowledge/context（经 3100 代理） | 命中 `book_embodied_ai_intro_2024:1.1:chunk-001`，章节 1.1，图片 HTTP 200 |

## 3. 执行命令

在 `frontend` 目录执行：

```powershell
corepack pnpm@10.28.0 test
corepack pnpm@10.28.0 lint
corepack pnpm@10.28.0 build
corepack pnpm@10.28.0 test:e2e
corepack pnpm@10.28.0 test:e2e:l2
```

`test:e2e:l2` 需要仓库根目录已有 `.venv` 且安装 `requirements.txt`。它会以真实接口模式构建前端，启动隔离 FastAPI fixture（8101）与 Next.js（3100），运行后清理本次服务器进程。fixture 使用真实路由和 schema，仅替换外部依赖。

## 4. 尚未通过的层级

- L2：真实 Neo4j 检索已经通过；完整 `/api/qa` 的模型回答尚未通过。
- L2：练习 generate/submit、浏览器认证与真实 Next.js `/api/chat` 尚未联调。
- L2：重复和并发提交、其他用户会话、服务重启后的持久化属于 B 的后端验收范围。
- L3：真实教材引用、真实模型角色行为和完整浏览器演示尚未执行。
- B 提供课堂 fixture 和固定题库 seed 后，需要继续真实课堂/练习联调并重新执行全部回归。

## 5. 本轮发现的问题

| 问题 | 实际证据 | 责任/下一步 |
|---|---|---|
| 缺模型 Key 时关键词回退不可靠 | `/api/qa` 输入“什么是具身智能？”返回 200 无证据，但相同关键词调用 `/api/knowledge/context` 能命中真实 Chunk | B：缺 Key 应明确失败，或修正关键词回退，不能伪装成无命中 |
| 空 Key 形成非法 Authorization 头 | `/api/qa` 输入“具身智能”命中检索后，`Bearer ` 导致 `httpx.LocalProtocolError`，接口返回 500 | B：客户端创建/调用前校验 Key，返回可理解的配置错误 |
| 模型 HTTP/超时语义与约定不同 | `generate_answer` 最终失败时构造 200 的 `insufficient_evidence=true` 对象 | B：按约定区分模型故障与证据不足 |
| 干净运行库没有固定题库 | 按协作约定未合并 `data/classroom.db`，当前没有可重复 seed | B：交付确定性题库 seed，C 再做真实练习浏览器联调 |
