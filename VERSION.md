# 技术栈版本约定（团队）

> 依据：2026-09-15 团队确认的前端技术栈版本。三人复现工程统一使用以下版本，避免环境差异。

## 前端 / 工程链

| 技术 | 版本 |
|---|---|
| Node.js | 24.19.0 |
| pnpm | 10.28.0 |
| Next.js | 16.1.2 |
| React / React DOM | 19.2.3 |
| TypeScript | 5.x |
| Tailwind CSS | 4.x |

## 说明

- Node.js 版本以 `nvm use 24.19.0` 或系统安装为准；前端依赖统一用 pnpm 安装（`pnpm install`），保留 lockfile。
- TypeScript 与 Tailwind CSS 使用 5.x / 4.x 大版本，锁定小版本以 `frontend/package.json` 为准。
- 后端 Python 版本与依赖见根目录 `requirements.txt`、`requirements-neo4j.txt`；Docker 镜像版本见 `docker-compose.yml`。
- 分支约定：A `feature/data-kg`，B `feature/backend-agent`，C `feature/frontend-test`，`main` 保持可运行。
