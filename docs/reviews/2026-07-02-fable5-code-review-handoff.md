# Fable5 代码审核交接文档

## 1. 审核目标

这份文档用于把当前 AI MUD 项目交给 Fable5 做代码审核。

请重点审核：

- 当前实现是否符合最初的 MUD 游戏方案和阶段边界。
- 模块边界是否清晰，后续继续扩展地图、NPC、经济、AI 功能时是否容易维护。
- AI 是否被严格限制在表达、总结、对话和提案层，没有绕过规则系统直接改资产、任务、市场或世界状态。
- 账号、激活码、世界重置、经济、NPC、任务、AI 调用日志等核心链路是否存在明显安全、数据一致性或维护风险。
- 测试是否覆盖真实行为，而不是只覆盖 mock 或表面断言。

## 2. 当前仓库状态

- 当前分支：`main`
- 当前提交：`7eb4b5d Let NPC tasks gain AI expression without granting AI authority`
- 产品版本：`0.7.0`
- Schema 版本：`12`
- API 版本：`19`
- Prompt 版本：`7`
- 最新发布说明：`docs/releases/v0.7.0.md`

最近一次主分支验证已通过：

```bash
CI=true pnpm -r test
CI=true pnpm -r typecheck
CI=true pnpm -r lint
CI=true pnpm -r build
git diff --check
```

## 3. 项目定位

这是一个暗黑西幻风格的 AI MUD 网游原型，目标是先做小规模内测版本。

核心玩法方向：

- 文字为主的 Web MUD。
- C/S 架构，服务端权威。
- 玩家有账号、角色、背包、装备、货币、行动状态。
- 新手村和野外矩阵地图。
- 采集和战斗是挂机行为，按时间推进。
- 战斗是自动 ATB，不做玩家手动释放技能。
- 血量归零不是死亡，而是受伤回村并受到属性惩罚。
- 玩家和 NPC 都参与食物、矿石、修理、市场、任务等经济循环。
- AI 是世界体验的一部分：NPC 对话、记忆、传闻、任务表达，而不是离线生成内容后给玩家玩。

当前阶段仍是内部开发原型，不是完整内测候选版本。

## 4. 技术栈与仓库结构

技术栈：

- TypeScript
- pnpm workspace
- React + Vite
- Fastify
- PostgreSQL + Drizzle schema/migrations
- Vitest
- Playwright E2E
- DeepSeek/OpenAI-compatible AI provider boundary

目录职责：

```text
apps/
  server/        Fastify 服务端、数据库访问、模块服务、后台 API、AI 编排
  web/           React 客户端、登录注册、主游戏 UI、管理面板
packages/
  shared/        前后端共享 DTO、版本号、错误类型
  content/       世界、物品、地图等静态内容
  game-rules/    纯规则函数：战斗、采集、经济、饥饿、装备、NPC 行为
  ai-prompts/    AI prompt 构建、结构化输出 parser、安全拒绝规则
docs/
  releases/      中文版本发布说明
  superpowers/   设计规格和执行计划
```

服务端主要模块：

- `activation-code`：一次性激活码。
- `auth`：注册、登录、session。
- `game`：玩家游戏状态、移动、采集、战斗、市场、修理、吃饭等入口。
- `npc`：长期 NPC、NPC 状态和模拟相关数据。
- `world-runtime`：世界自动推进。
- `world-reset`：保留账号、重置世界数据。
- `npc-task`：NPC 基于真实需求发布任务，奖励托管。
- `npc-memory`：NPC 短期记忆和压缩碎片。
- `dialogue`：NPC 对话、AI 调用日志。
- `rumor`：基于真实事件生成传闻。
- `ai`：AI provider、orchestrator、purpose policy、治理统计。
- `admin`：后台页面 API。

## 5. 当前版本进度

### v0.1.x Foundation

已完成：

- monorepo 基础结构。
- 账号注册/登录。
- 激活码注册。
- session/CSRF 基础。
- 后台激活码管理。
- 软重置的基础边界。

### v0.2.x Playable Loop

已完成：

- 创建角色。
- 新手村/野外基础状态。
- 野外矩阵移动。
- 背包基础反馈。
- 鼠标和键盘基础交互。

### v0.3.x Idle Action Loop

已完成：

- 定时采集。
- 自动 ATB 战斗。
- 当前行动状态。
- 战斗受伤回村。
- 采集/战斗取消边界。

### v0.4.x Economy World

已完成：

- 铜币/银币/金币货币模型。
- 市场买卖。
- 税收/账本/交易流水。
- 饥饿和食物消耗。
- 装备耐久、修理、矿石消耗。
- NPC 工资和基础经济周转。
- 基础铁矿石等经济材料。

### v0.5.x Living NPC

已完成：

- 长期 NPC 数据。
- NPC 移动、工作、库存、钱包等生活状态基础。
- 世界自动推进入口。
- NPC 不是背景板，最低也是可参与经济的长期实体。

### v0.6.x AI Layer

已完成：

- NPC 对话。
- 真实 AI provider 边界和模板 provider fallback。
- AI 调用日志。
- 管理后台 AI 状态。
- NPC 记忆写入和压缩。
- `dialogue_claim` 与 `system_verified` 证据等级区分。
- NPC 真实需求任务闭环。
- AI 对任务文案的只读润色。
- 基于真实世界事件的传闻。
- AI purpose 统一权限表。
- AI 边界回归测试。

### v0.7.0 AI Task Proposal

已完成：

- 新增 `npc_task_proposal` AI purpose。
- AI 可以提出任务标题、描述和 NPC 发任务理由。
- 规则系统先生成合法候选任务，并校验 NPC 钱包能托管奖励。
- AI 输出安全时，只保存展示字段。
- AI 输出失败、越权、关闭或不安全时，回退到模板任务。
- NPC 任务记录新增 `proposalSource` 和 `proposalReason`。
- 前端任务面板显示 NPC 发任务理由。
- 管理端 AI 状态和调用日志能识别 `npc_task_proposal`。

重要边界：

- AI 不能决定任务需求。
- AI 不能改变请求物品、数量、奖励。
- AI 不能给玩家发金币、物品、装备或经验。
- AI 不能改变市场、库存、任务完成、记忆证据等级或世界状态。
- NPC 没有足够铜币押金时，不会触发 AI 提案，也不会创建任务。

## 6. 需要特别审核的架构边界

### 6.1 规则系统与 AI 权限

核心原则：

- 规则系统拥有世界状态。
- AI 只能生成对话、表达、摘要、传闻文本或任务提案文本。
- 所有资产变化必须由服务端规则服务写入。

重点文件：

- `apps/server/src/modules/ai/ai-purpose-policy.ts`
- `apps/server/src/modules/ai/ai-orchestrator.ts`
- `apps/server/src/modules/ai/ai-layer-boundary.test.ts`
- `packages/ai-prompts/src/npc-dialogue.ts`
- `packages/ai-prompts/src/npc-memory-compression.ts`
- `packages/ai-prompts/src/npc-task-proposal.ts`
- `apps/server/src/modules/npc-task/npc-task.service.ts`

请检查：

- 是否有任何 AI 输出可以绕过 parser 或 policy。
- fallback 是否完整。
- AI purpose 的 `mutatesWorldState` 是否始终为 false。
- parser 是否足够严格拒绝奖励承诺、OOC、规则变更、任务需求变更。

### 6.2 NPC 任务与经济闭环

核心原则：

- NPC 任务必须来自真实需求。
- 奖励来自 NPC 自有铜币，并在创建任务时进入托管。
- 完成任务后物品进入 NPC 背包，托管铜币给玩家。
- 过期任务应退还托管铜币。

重点文件：

- `apps/server/src/modules/npc-task/npc-task.service.ts`
- `apps/server/src/modules/npc-task/npc-task.repository.ts`
- `apps/server/drizzle/0010_npc_tasks.sql`
- `apps/server/drizzle/0012_npc_task_proposal.sql`
- `packages/game-rules/src/npc-request-rules.ts`

请检查：

- 任务创建、接取、完成、过期是否存在竞态或重复结算风险。
- NPC 钱包、托管奖励、玩家钱包是否可能不一致。
- AI proposal 失败时是否仍然能创建合法模板任务。

### 6.3 账号、激活码与后台

当前注册需要一次性激活码。

重点文件：

- `apps/server/src/modules/auth/auth.routes.ts`
- `apps/server/src/modules/auth/auth.service.ts`
- `apps/server/src/modules/activation-code/activation-code.service.ts`
- `apps/server/src/modules/admin/admin.routes.ts`
- `apps/web/src/features/auth/AuthPage.tsx`
- `apps/web/src/features/admin/ActivationCodeAdmin.tsx`

请检查：

- 激活码是否只能消费一次。
- 注册/登录是否严格分离。
- CSRF/session 边界是否合理。
- 后台接口是否有权限校验遗漏。

### 6.4 世界重置

项目允许内测阶段保留账号、重置世界。

重点文件：

- `apps/server/src/modules/world-reset/world-reset.service.ts`
- `apps/server/src/modules/admin/admin.routes.ts`
- `apps/server/drizzle/*.sql`

请检查：

- reset 是否会误删账号、激活码或审计数据。
- reset 后世界初始化是否完整。
- reset 是否有足够权限限制和审计。

### 6.5 前端交互与 UI

当前 UI 借鉴 MUD 面板风格，支持键盘和鼠标。

重点文件：

- `apps/web/src/features/game/GameShell.tsx`
- `apps/web/src/features/game/GameShell.css`
- `apps/web/src/features/auth/AuthPage.tsx`
- `apps/web/src/features/admin/*.tsx`

请检查：

- 键盘移动是否会在输入框中误触发。
- 道具弹窗、市场弹窗、NPC 对话弹窗是否存在状态污染。
- 长文本是否会撑破面板。
- 登录/注册流程是否符合普通网页习惯。

## 7. 数据库迁移

当前迁移列表：

```text
0000_sweet_quasar.sql
0001_colossal_susan_delgado.sql
0002_wise_weapon_omega.sql
0003_economy_foundation.sql
0004_equipment_durability.sql
0005_character_needs.sql
0006_living_npc.sql
0007_world_runtime_state.sql
0008_ai_dialogue.sql
0009_npc_memory.sql
0010_npc_tasks.sql
0011_world_rumors.sql
0012_npc_task_proposal.sql
```

请重点检查：

- schema 与 migration 是否一致。
- 新字段是否有合理默认值。
- 已有测试数据库初始化是否覆盖最新 migration。
- 后续 reset 是否同步处理新增表/字段。

## 8. 审核范围建议

### 8.1 全项目审核

用于看架构、模块边界、测试策略和长期可维护性。

```bash
git checkout main
git status --short
pnpm install
CI=true pnpm -r test
CI=true pnpm -r typecheck
CI=true pnpm -r lint
CI=true pnpm -r build
```

### 8.2 最近 v0.7.0 差异审核

用于聚焦最新 AI 任务提案闭环。

```bash
git diff --stat b8434b6..7eb4b5d
git diff b8434b6..7eb4b5d
```

如果想把 `v0.7.0` 的设计文档和实现一起看：

```bash
git diff --stat d8333e0..7eb4b5d
git diff d8333e0..7eb4b5d
```

## 9. 已知风险与待确认点

- 根目录 `package.json` 的 `version` 仍是 `0.4.0`，真实产品版本在 `packages/shared/src/version.ts`。需要确认是否要统一。
- 当前 E2E 覆盖有限，主要依赖 Vitest 单元/集成测试。
- DeepSeek 真实 provider 行为只通过结构化 provider 边界和 mock 覆盖，真实模型输出仍需要联调观察。
- 当前世界规模很小，性能判断还停留在小规模 NPC 和小地图。
- `v0.7.x` 总路线图原本写的是 Admin and Simulation，但实际 `v0.7.0` 被用于 AI Task Proposal 收口。后续需要重新校准版本线，避免阶段命名混乱。
- 经济系统目前仍是内测原型，工资、物资产出、价格公式需要通过模拟和玩家行为继续调参。
- NPC 自主生活已经有基础，但还不是完整“NPC 等同 AI 玩家”的最终形态。
- 副本和 AI 随机地图尚未进入实现阶段。

## 10. 建议 Fable5 输出格式

请按以下格式返回审核结果：

```text
### 总体判断

是否建议进入下一阶段：

### 优点

- ...

### Critical 必须修

- 文件:行号
- 问题
- 影响
- 建议修法

### Important 建议先修

- 文件:行号
- 问题
- 影响
- 建议修法

### Minor 可后续优化

- 文件:行号
- 问题
- 建议

### 架构风险

- ...

### 测试缺口

- ...

### 版本路线建议

- ...
```

## 11. 推荐审核问题清单

请 Fable5 特别回答这些问题：

1. 当前模块边界是否足够支撑后续新增地图、NPC、任务类型和副本？
2. AI 权限边界是否真的关住了？有没有隐藏的越权路径？
3. NPC 任务和经济闭环是否有重复结算、虚空造物或账本不一致风险？
4. 目前的测试是否足够防止后续 AI 功能扩展时破坏经济权威？
5. 数据库 schema、migration、reset 之间是否存在漂移？
6. 前端 UI 状态是否有明显复杂度或维护隐患？
7. 下一阶段应该优先做 Admin/Simulation，还是先修当前架构债？
