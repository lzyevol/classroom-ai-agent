# Classroom Reproduction Frontend

成员 C 负责的 Next.js 浏览器端工程。当前实现教材问答、课堂 SSE 消费、白板动作安全执行、章节练习，以及 Vitest/Playwright 自动化测试。

## 环境版本

- Node.js 24.19.0（仓库根目录 `.nvmrc`）
- pnpm 10.28.0（`package.json#packageManager`）
- Next.js 16.1.2
- React 19.2.3

## 本地运行

在本目录执行：

```powershell
corepack pnpm@10.28.0 install
corepack pnpm@10.28.0 dev -- --port 3100
```

访问 `http://127.0.0.1:3100`。

如果 `corepack enable` 因为 `C:\Program Files\nodejs` 权限失败，不需要修改系统目录；直接使用上面的带版本命令即可。

## Mock 与真实接口

复制 `.env.example` 为本地 `.env.local`，不要提交密钥：

```env
NEXT_PUBLIC_API_MODE=mock
BACKEND_URL=http://127.0.0.1:8100
```

- `mock`：完全使用浏览器端固定 fixture，适合 C 独立开发和 L1 测试。
- `real`：教材问答和练习经 `/backend` rewrite 访问 FastAPI。
- 课堂当前只有 Mock SSE；真实 `/api/chat` 必须等 B 提供合法请求 fixture 后接入，不能猜测 `classroomTurn`。

当前 Mock 引用带有 `mock:` ID 和明确占位说明，不是教材原文。

## 页面

| 路由 | 当前能力 |
|---|---|
| `/qa` | 问答、引用、无证据、HTTP 错误、取消、请求诊断 |
| `/classroom` | SSE 分片、教师/助教、等待/结束、中断、白板动作与诊断 |
| `/practice` | 创建练习、完整作答、批改结果、422/409、取消与诊断 |

## 验证命令

```powershell
corepack pnpm@10.28.0 lint
corepack pnpm@10.28.0 test
corepack pnpm@10.28.0 build
corepack pnpm@10.28.0 test:e2e
```

Playwright 会构建生产版本、启动 3100 端口，并在结束时清理本次启动的服务器。Windows 默认复用系统 Edge；其他环境需要安装 Playwright Chromium 或设置 `PLAYWRIGHT_CHANNEL`。

## 关键目录

```text
app/                  页面与交互入口
components/           可复用浏览器组件
fixtures/             明确标注的 L1 Mock 数据
lib/api/              QA 请求、错误适配与响应校验
lib/classroom/        课堂状态、Mock 流、Action 执行层
lib/contracts/        通用运行时契约校验
lib/diagnostics/      不记录正文和凭据的请求诊断
lib/practice/         练习请求、类型与响应校验
lib/sse/              SSE 字节流解析与事件校验
tests/                Vitest 单元和组件测试
e2e/                  Playwright 真实浏览器测试
scripts/run-e2e.mjs   浏览器测试服务器生命周期管理
```

## 安全和职责边界

- 浏览器不构造 `classroomTurn`，不决定 Agent 角色或教材证据。
- 浏览器不实现真实评分、认证、所有权、事务或并发控制。
- 请求诊断不显示问题正文、答案、Authorization、Token、API Key 或响应堆栈。
- Action 必须先通过允许列表和参数校验，并按 `actionId` 去重。
- 真实响应先经过运行时契约校验，再进入页面状态。
