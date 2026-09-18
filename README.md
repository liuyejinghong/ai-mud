# AI MUD

一个暗黑西幻题材的全栈 Web MUD。玩家通过快捷键探索、采集、战斗、交易并与 NPC 互动；世界规则、数值结算和持久化状态由服务端裁决，AI 只负责受约束的叙事、对话、记忆整理与任务文案。

当前为 `v0.10.6` 的开发中版本，适合本地体验、贡献和架构讨论，尚不作为生产部署方案。

## 已有内容

- 服务端权威的探索、挂机结算、自动战斗、采集与装备循环。
- 新手村供需经济、NPC 库存/需求、任务托管与世界时钟。
- React + Vite 客户端、Fastify + Drizzle 服务端、PostgreSQL 持久化。
- 受治理的 AI 层：AI 不得修改金币、物品、经验、掉落、角色或世界状态；所有调用都有确定性降级路径。
- 管理后台、审计记录与迁移校验。

产品与架构说明见 [游戏设计文档](docs/superpowers/specs/2026-07-01-ai-mud-game-design.md)，版本说明见 [发布记录](docs/releases/)。

## 本地运行

前置条件：Node.js 22+、pnpm 9、Docker（用于 PostgreSQL）。

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm dev
```

默认地址：客户端 `http://127.0.0.1:5173`，服务端 `http://127.0.0.1:3000`。

`.env.example` 仅包含本地开发的占位配置。请勿提交 `.env`、数据库文件、密钥或任何运行时数据。

## 验证

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

涉及真实 PostgreSQL 的迁移验证可使用 `pnpm db:verify-migrations`。更多开发约定见 [CLAUDE.md](CLAUDE.md)。

## 贡献

欢迎提交 issue 和 pull request。请保持规则层对数值与状态的唯一裁决权；任何新增 AI 能力都必须保留确定性降级、治理策略和边界测试。

## 许可证

本项目采用 [MIT License](LICENSE)。
