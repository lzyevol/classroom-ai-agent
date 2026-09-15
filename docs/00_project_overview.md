# 项目概览（当前复现状态）

## 一句话说明

这是一个让学生基于教材证据进行问答、参与多角色课堂并完成章节练习的 AI 教学系统复现工程。

## 当前已确认的模块边界

```text
教材数据/图谱（A）
        ↓
在线检索、RAG、Agent、练习后端（B）
        ↓ HTTP JSON / SSE
页面、流消费、动作执行、测试与演示（C）
```

当前 C 分支只实现浏览器端和固定 Mock。Agent、模型、RAG、持久化与认证尚不能从本分支确认完成。

## C 分支技术栈

| 技术 | 用途 | 位置 |
|---|---|---|
| Next.js 16 | 页面和构建 | `frontend/app` |
| React 19 | 浏览器交互和状态 | 三个页面 |
| TypeScript 5 | 编译期类型 | `frontend/lib` |
| Tailwind CSS 4 | 最小页面样式 | 页面和 `globals.css` |
| Vitest | 单元、协议、组件测试 | `frontend/tests` |
| Playwright | 真实浏览器流程 | `frontend/e2e` |

## 当前能力等级

- L1：QA、课堂、练习、错误分支、SSE 与 Action 的 Mock 自动化验证。
- L2：等待 A/B 数据和服务后执行真实接口、认证、数据库与持久化联调。
- L3：等待真实教材与模型后执行内容正确性和完整演示。
