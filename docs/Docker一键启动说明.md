# Docker 一键启动说明

更新时间：2026-08-05

## 目标

本方案通过 Docker Compose 一次启动 Next.js 前端、FastAPI 后端、Neo4j 和 Redis，并在首次运行时自动导入知识图谱。使用者无需在本机安装 Python、Node.js、pnpm、Neo4j Desktop 或 Redis。

## 前置条件

- 已安装并启动 Docker Desktop。
- 首次构建时可访问网络，以拉取镜像和安装容器内依赖。
- DeepSeek 和通义千问 TTS 是可选能力；未配置对应 API Key 时，依赖这些云服务的功能会降级或不可用。

## 首次启动

在仓库根目录执行：

```powershell
Copy-Item .env.docker.example .env
```

编辑根目录 `.env`，至少修改：

```env
NEO4J_PASSWORD=请设置一个至少8位的密码
```

如需大模型问答/内容生成或通义千问 TTS，再填写 `DEEPSEEK_API_KEY` 和 `QWEN_TTS_API_KEY`。镜像内置的 SQLite 种子库已包含演示账号。`DEMO_*_PASSWORD` 只用于补建缺失的演示账号，不会覆盖种子库或已有 Volume 中的密码。请勿将真实 Key 或密码提交到 Git。

然后执行：

```powershell
docker compose up --build
```

首次启动会依次完成：

1. 构建 FastAPI 后端和 Next.js 前端镜像；
2. 启动 Neo4j 与 Redis，并等待其健康检查通过；
3. `neo4j-init` 为 `data/processed` 和 `config/kg_ontology.json` 计算指纹；
4. 若图谱尚未导入、图谱为空，或图谱源文件已变更，自动运行 `scripts/10_import_neo4j.py`；
5. 将镜像内的 `data/classroom.db` 复制到持久化 SQLite Volume（仅首次）；
6. 启动后端和前端。

启动完成后访问：

- 前端：`http://localhost:3000`
- FastAPI：`http://localhost:8000`
- Neo4j Browser：`http://localhost:7474`
- Neo4j Bolt：`neo4j://localhost:7687`

端口可通过 `.env` 中的 `FRONTEND_PORT`、`BACKEND_PORT`、`NEO4J_HTTP_PORT` 和 `NEO4J_BOLT_PORT` 修改。

> 如果你正在进行本地 Python/Node 开发并希望保留现有 `.env`，可改用独立文件：`Copy-Item .env.docker.example .env.docker`，并在下方每条命令的 `docker compose` 后补上 `--env-file .env.docker`。

## 日常使用

后台启动：

```powershell
docker compose up -d
```

查看服务状态：

```powershell
docker compose ps
```

查看所有日志：

```powershell
docker compose logs -f
```

查看知识图谱初始化日志：

```powershell
docker compose logs neo4j-init
```

停止服务但保留用户数据、SQLite 数据和图谱：

```powershell
docker compose down
```

## 数据持久化与重置

| Docker Volume | 持久化内容 |
| --- | --- |
| `neo4j_data` | Neo4j 知识图谱数据库 |
| `neo4j_logs` | Neo4j 服务日志 |
| `redis_data` | Redis 持久化任务状态 |
| `app_runtime` | 运行时 SQLite 数据库 |
| `audio_cache` | Edge TTS / Qwen TTS 音频缓存 |

镜像内的 `data/classroom.db` 只作为首次启动的种子数据库。后续学生作答、教师布置作业和管理员操作均写入 `app_runtime` Volume，因此重启或重建容器不会丢失用户数据。

要彻底删除演示数据、SQLite 数据、Neo4j 图谱、Redis 状态和音频缓存，请执行：

```powershell
docker compose down -v
docker compose up --build
```

## 常见问题

### 端口被占用

在 `.env` 中更换对应端口，例如：

```env
FRONTEND_PORT=3001
BACKEND_PORT=8001
NEO4J_HTTP_PORT=7475
NEO4J_BOLT_PORT=7688
```

### 前端提示端口 `3000` 已被占用

这通常是本机仍有 `pnpm dev` / `next dev` 在运行。先关闭旧的本地前端进程，或在 `.env` 中设置 `FRONTEND_PORT=3001`，再重新执行 `docker compose up -d frontend`。

### `neo4j-init` 失败

先查看错误：

```powershell
docker compose logs neo4j-init
```

常见原因是 Neo4j 密码少于 8 位、首次拉取镜像的网络问题，或可用内存不足。修正后执行 `docker compose up -d --build` 重试。若需要从零重新导入图谱，使用 `docker compose down -v` 后再启动。

### 修改 Neo4j 密码后无法启动

`NEO4J_PASSWORD` 只在空的 Neo4j Volume 首次初始化时生效。若图谱 Volume 已存在，请恢复原密码；若确定要使用新密码并接受清空图谱与运行数据，则执行 `docker compose down -v` 后重新启动。

### 图谱数据更新后没有重新导入

`neo4j-init` 会记录知识图谱源文件指纹。更新 `data/processed` 或 `config/kg_ontology.json` 后，请重新构建并启动，以便重新创建初始化容器：

```powershell
docker compose up -d --build --force-recreate neo4j-init backend frontend
```

已有 Volume 会被保留；初始化容器会替换本项目管理的教材图谱子图，但不会清空 SQLite 中的用户、班级、作业和学习记录。
