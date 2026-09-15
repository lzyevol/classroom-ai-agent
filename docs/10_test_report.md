# 前端测试执行记录

版本：2026-09-15 本地验证｜层级：L1 Mock｜负责人：成员 C

## 1. 当前结论

当前结果只证明前端组件、固定 fixture、SSE 消费和 Mock 浏览器流程可用，不代表真实后端、真实教材、真实模型、认证或持久化已经通过。

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

最近一次本地结果：

| 代码基线 | 命令 | 结果 |
|---|---|---|
| `15321d7` + 当前未提交改动 | Vitest | 10 个文件、52 个测试通过 |
| `15321d7` + 当前未提交改动 | ESLint | 通过 |
| `15321d7` + 当前未提交改动 | Next.js production build | 通过，4 个业务路由均生成 |
| `15321d7` + 当前未提交改动 | Playwright / Edge | 12 个浏览器测试通过 |

## 3. 执行命令

在 `frontend` 目录执行：

```powershell
corepack pnpm@10.28.0 test
corepack pnpm@10.28.0 lint
corepack pnpm@10.28.0 build
corepack pnpm@10.28.0 test:e2e
```

`test:e2e` 会先构建生产版本，再由 `scripts/run-e2e.mjs` 启动 3100 端口；结束时只清理本次启动的服务器进程树。Windows 默认使用系统 Edge。若要指定其他 Playwright 浏览器通道，可以设置 `PLAYWRIGHT_CHANNEL`。在没有系统浏览器的环境中，需要先执行 Playwright 的浏览器安装命令。

## 4. 尚未通过的层级

- L2：真实 FastAPI `/api/qa`、练习 generate/submit、认证、SQLite 与真实 Next.js `/api/chat` 尚未联调。
- L2：重复和并发提交、其他用户会话、服务重启后的持久化属于 B 的后端验收范围。
- L3：真实教材引用、真实模型角色行为和完整浏览器演示尚未执行。
- A/B 提供真实 fixture 后，需要替换当前带 `mock:` 的 ID 和占位引用并重新执行全部回归。
