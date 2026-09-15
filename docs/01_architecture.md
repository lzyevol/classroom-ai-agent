# 前端与联调架构

```mermaid
flowchart LR
    User[用户] --> Pages[Next.js 页面]
    Pages --> Adapters[请求适配器]
    Adapters --> Mock[固定 Mock fixture]
    Adapters -. real .-> Rewrite[/backend rewrite]
    Rewrite -. 待联调 .-> FastAPI[FastAPI /api]
    Pages --> SSE[SSE 字节流解析]
    SSE --> EventValidation[事件运行时校验]
    EventValidation --> State[课堂状态归并]
    EventValidation --> ActionGuard[Action 允许列表与参数校验]
    ActionGuard --> Whiteboard[浏览器 Mock 白板]
    Pages --> Diagnostics[脱敏请求诊断]
    Pages --> Tests[Vitest / Playwright]
```

## 为什么分层

- 请求适配器隔离 Mock 和真实 HTTP，使换后端时页面不用重写。
- TypeScript 类型只在编译时有效，因此真实 JSON/SSE 进入系统时仍需运行时校验。
- SSE 解析与课堂状态分离，网络分片规则不会污染 UI 组件。
- Action 在执行前再次校验，因为来自模型或服务端的动作不能直接信任。
- 诊断只记录阶段、模式、状态和必要错误，不记录用户正文与凭据。

## 当前与原项目的关系

白板第一阶段只恢复参考项目明确存在且联合约定首轮需要的 `wb_open`、`wb_draw_text`。其他原项目 Action 尚未恢复，不会被静默执行。
