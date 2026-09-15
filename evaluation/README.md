# Classroom Evaluation Runner v0

这是比赛用的最小统一实验运行器。它直接调用课堂 `/api/chat`，不经过浏览器或 Zustand，并保存每轮原始回答、路由、教材证据和耗时。

## 三个实验变体

- **A**：旧版本单教师，`discussion + agentIds=["default-1"]`，不传新 guard/evidence/supervisor 字段。
- **B**：新版本单教师，`classroomMode=single`。
- **C**：新版本多智能体，`classroomMode=multi`，普通问题教师回答，困惑追问助教回答。

A/B/C 都读取同一个案例文件和同一个 storeState fixture。Runner 不替 A 拦截“好的”或“结束讨论吧”。

## 当前案例

`cases/core-cases.json` 包含 14 个固定脚本、19 个用户轮次：

- 普通知识；
- 理解错误；
- “还是不懂”；
- 举例和比较；
- ACK；
- STOP。

## 快速命令

在仓库根目录运行：

```powershell
node evaluation/runner.mjs --list
node evaluation/runner.mjs --variant C --case stop-001
node evaluation/runner.mjs --variant C --case confusion-001 --model deepseek/deepseek-chat --api-key YOUR_KEY
node evaluation/runner.mjs --variant all --model deepseek/deepseek-chat --api-key YOUR_KEY
```

也可以在 `frontend` 目录运行：

```powershell
pnpm eval:classroom -- --variant C --case stop-001
pnpm eval:classroom:test
```

## 服务地址

默认地址：

- A：`http://127.0.0.1:3207`
- B/C：`http://127.0.0.1:3107`

可以覆盖：

```powershell
$env:EVAL_BASELINE_URL='http://127.0.0.1:3207'
$env:EVAL_NEW_URL='http://127.0.0.1:3107'
$env:EVAL_MODEL='deepseek/deepseek-chat'
$env:EVAL_API_KEY='...'
$env:EVAL_BASE_URL='...'
node evaluation/runner.mjs --variant all
```

浏览器本地保存的模型设置不会自动进入命令行 Runner。批量实验需要通过参数、环境变量或前端服务端 Provider 配置提供同一个模型。

## 输出

每次运行生成：

- `results/<run>-A.jsonl`
- `results/<run>-B.jsonl`
- `results/<run>-C.jsonl`
- `results/<run>-summary.csv`
- `results/<run>-manifest.json`

JSONL 保存每轮原始结果和 SSE 事件。CSV 自动统计：

- error rate；
- route accuracy；
- STOP success rate；
- ACK no-repeat rate；
- one-agent rate；
- evidence hit rate；
- average latency；
- average model calls。

内容正确性、教材引用正确性和教学适应性使用 `scoring/manual-scoring-template.csv` 人工评分，不在 v0 中使用模型自动评分。

## 公平性约束

1. 三组使用同一个案例文件、storeState、模型和教材数据。
2. A 请求不传 `classroomMode`、`discussionTopic`、`discussionPrompt`、`triggerAgentId` 或 `classroomTurn`。
3. B/C 只通过 `classroomMode` 区分单教师和跨轮教师/助教路由。
4. 多轮实验允许三组历史自然分化，不强行替换模型回答。
5. 原始 JSONL 必须保留，汇总表不能代替原始数据。

## v0 暂不包含

- teacher_then_assistant；
- PreparedTurn 磁盘缓存；
- 自动内容评分；
- Token/P95/Hit@K；
- 实验统计页面。
