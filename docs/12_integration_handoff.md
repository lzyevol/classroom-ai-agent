# A/B → C 联调交接清单

## A 需要交付

- 版本化真实 Chunk 小样本及来源说明。
- `chunk_id`、`section_id`、`section_key`、`section_number` 映射。
- 页面可展示的真实 quote、章节和书名。
- 数据版本、记录数、校验值和变更说明。

## B 需要交付

- `/api/qa` 正常、无证据、422、503、500 响应 fixture。
- `/api/practice/generate` 和 submit 的成功、401、403、404、409、422 fixture。
- 可直接请求的 `/api/chat` StatelessChatRequest；明确哪些字段由浏览器发送。
- 教师、助教、ACK、STOP、Action、error、无 done 断流的 SSE fixture。
- 认证令牌取得与刷新方式；不能让浏览器提交任意 `user_id`。
- 真实服务启动命令、端口、模型配置入口和不含密钥的环境变量说明。

## C 收到后执行

1. 将 fixture 送入当前运行时校验器，先报告字段差异。
2. 核对 snake_case QA/练习与 camelCase 课堂边界。
3. 切换 `NEXT_PUBLIC_API_MODE=real`，执行 QA 和练习 L2。
4. 按 B 的请求 fixture 新增真实课堂 client，不修改 B 的服务端语义。
5. 执行 HTTP、SSE、取消、错误、重复提交和认证回归。
6. 与 A 核对每个引用 ID 和 quote，不以 citations 非空代替内容正确。
7. 把结果、代码版本、数据版本和证据写入测试报告。

## 契约差异记录模板

| 字段/事件 | 文档约定 | 实际返回 | 影响 | 负责人 | 处理结论 |
|---|---|---|---|---|---|
| 待填写 | 待填写 | 待填写 | 待填写 | A/B/C | 待评审 |
