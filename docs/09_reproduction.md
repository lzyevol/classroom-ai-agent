# C 部分复现记录

## 已完成

1. 固定 Node、pnpm、Next.js 和 React 版本，建立最小页面。
2. 建立 QA 请求适配器、Mock/real 开关、引用与错误展示。
3. 实现可处理任意 UTF-8 分片和 CRLF 的课堂 SSE 解析器。
4. 实现课堂消息状态、等待/结束/error/Abort/断流处理。
5. 实现 Mock 练习的创建、作答、提交和批改展示。
6. 增加成功 JSON 与 SSE 的运行时契约校验。
7. 从参考代码核对并恢复首批白板动作安全执行和 actionId 去重。
8. 增加不包含请求正文和凭据的联调诊断。
9. 建立 Vitest 与 Playwright 两层自动化测试。

## 当前简化

- 所有可演示业务仍为 L1 Mock。
- 课堂没有发送真实 StatelessChatRequest。
- 白板只支持 `wb_open` 和 `wb_draw_text`。
- 练习结果是固定 fixture，不是浏览器判分，也没有数据库记录。
- 教材引用是明确的 Mock 占位符。

## 下一次真正推进所需输入

- A：真实 Chunk、引用和 section 映射。
- B：QA/练习成功与错误 fixture、认证方式、课堂合法请求与完整 SSE fixture。
- B/C：共同确认 Action 名称、参数范围和未知字段兼容策略。
