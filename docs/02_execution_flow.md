# 浏览器端执行流程

## QA

```text
用户问题 → askQuestion → Mock 或 /backend/api/qa
→ 运行时校验 → 页面回答/引用 → 脱敏诊断
```

## 课堂

```text
用户输入 → Mock SSE（真实 /api/chat 待 B fixture）
→ TextDecoder 缓存任意网络分片
→ 事件字段校验
├─ 文本事件 → ClassroomState 追加消息
├─ Action → 允许列表/参数/ID 去重 → Mock 白板
├─ cue_user/done → 等待或结束状态
└─ error/断流/Abort → 明确失败状态和诊断
```

一次网络 `read()` 不等于一条 SSE。解析器先把字节增量解码并缓存，只有遇到空行分隔符才解析完整 JSON。

## 练习

```text
创建请求 → 公开题目响应校验 → 用户完成全部题目
→ 提交 question_id/answer → 批改响应校验 → 分数、错题和引用
```

浏览器只验证是否全部作答；标准答案、判分、会话所有权、重复/并发提交和数据库事务必须由 B 的服务端完成。
