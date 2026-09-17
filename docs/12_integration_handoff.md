# A/B → C 联调交接清单

## A 已收到

- v1.0 完整成品：426 Chunk、170 sections（140 个进入 RAG）、788 实体、338 条知识关系。
- `section_mapping.csv`、数据字典、版本、记录数和校验值。
- Neo4j 幂等导入与 dry-run；当前 dry-run 统计通过。
- 434 条图片清单及 159 个页面目录中的教材图片。

## B 已收到

- `/api/qa`、`/api/knowledge/context`、schema、检索、DeepSeek client、服务与 Prompt。
- B 分支提交已合并；其 10 个文件与 A 复现基底中的对应文件一致。
- A 复现基底补齐后，后端 57 项模块测试通过。

## B 仍需交付或确认

- 可直接请求的 `/api/chat` StatelessChatRequest；明确哪些字段由浏览器发送。
- 教师、助教、ACK、STOP、Action、error、无 done 断流的 SSE fixture。
- 可重建的固定练习题库 seed，以及练习成功/401/403/404/409/422 HTTP fixture。
- 确认 `DeepSeekClient.generate_answer` 最终超时/HTTP 错误的契约。目前代码返回 HTTP 200 且 `insufficient_evidence=true`，与约定的“依赖故障不伪装成证据不足”不一致。
- 修复空 `DEEPSEEK_API_KEY`：当前会形成非法 `Authorization: Bearer `；视问题写法不同，会误报无证据或返回 500。
- 评审 Docker 后端、模型配置与最终运行说明。

## C 收到后执行

1. 已完成 QA 隔离 L2：真实 Next.js 代理、FastAPI 路由/schema、成功、422、503。
2. 已在独立 Neo4j 数据卷完成真实检索，稳定 ID、章节、quote 和图片路径贯通；重复初始化会跳过。
3. 收到 B 的课堂 fixture 后新增真实课堂 client，不修改 B 的服务端语义。
4. 收到固定题库 seed 后完成登录、练习、重复提交与持久化浏览器联调。
5. B 修复缺 Key 语义后配置真实模型执行 L3，单独记录内容正确性和故障行为。

## 契约差异记录模板

| 字段/事件 | 文档约定 | 实际返回 | 影响 | 负责人 | 处理结论 |
|---|---|---|---|---|---|
| 模型依赖失败 | 503 或明确失败 | `generate_answer` 返回 200 的不足对象 | 无法区分模型故障与证据不足 | B | 待 B 评审修复 |
| 缺模型 Key | 明确且可定位的配置错误 | 普通问法误报无证据；关键词问法因 `Bearer ` 返回 500 | QA 真实模式不可可靠使用 | B | 已复现，待修复 |
| 课堂接口 | `/api/chat` SSE | B 分支未交付 | C 只能保留 Mock 消费 | B/C | 阻塞真实课堂 L2 |
| 练习初始化 | 固定题库可重建 | 无 seed，且运行 DB 不合并 | 干净环境无题可组卷 | B | 待交付 seed |
