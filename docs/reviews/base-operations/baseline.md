# A0-01 基线盘点：《余电》基地经营开工前事实记录

- 日期：2026-09-19。执行者：A0-01。对应任务定义：`docs/implementation/2026-09-19-base-operations/00-scope-and-a0.md` §3 A0-01 行。
- 分支：`docs/base-operations-milestones-20260919`（PR #19 head `7d8f242`）。本轮只新建本文件，未修改任何源码、依赖、配置、数据库，未执行 reset/仿真/db:verify-world-reset 类脚本，未 commit/push。
- 口径：所有数字给出处（路径或本轮实跑输出）；未跑的写 NOT_RUN；不确定的进 §6 开放问题，不下断言。本文件不把规划文档中的未来能力当作已交付能力。

## 1. 基线事实

### 1.1 HEAD 与工作树

| 项 | 值 | 证据 |
|---|---|---|
| 实际 HEAD | `7d8f242d3e45293a1caa2642201122b09e6aa4bd` | `git rev-parse HEAD`（本轮实跑） |
| 与 main 关系 | main 指向 `e2677ea`（"world-runtime integration: explicit 60s test timeouts for temp-DB harness"）；`7d8f242` = `e2677ea` + 规划文档 | `git log --oneline -1 main`；`git diff --stat e2677ea..7d8f242` |
| HEAD−main 差异内容 | 18 个文件、+1087/−28：`AGENTS.md`、`docs/implementation/2026-09-18/README.md` 各 1 处修订，其余 16 个文件全部位于 `docs/implementation/2026-09-19-base-operations/`。无任何源码/依赖/配置/迁移变更 | 同上 diff --stat |
| 工作树 | clean（nothing to commit） | `git status`（本轮实跑） |
| 近期历史 | `1929972` = merge PR #17（v0.11.1 前置：市场饱和上限 + 金库期初加大，见 §4.2） | `git log --oneline -3` |

### 1.2 产品版本（实读 `packages/shared/src/version.ts`）

- `PRODUCT_VERSION = "0.11.0"`。
- `WORLD_COMPATIBILITY`：schemaVersion 28 / apiVersion 41 / engineVersion 2 / rulesetVersion 17 / contentVersion 12 / promptVersion 8 / economyVersion 4 / worldSeedVersion 1。
- 与 `docs/implementation/2026-09-19-base-operations/README.md` §代码基线声明完全一致。
- 根 `package.json` 的 `"version": "0.4.0"` 是工作区包版本，不是产品运行版本（`sources-and-baseline.md` §2 已声明，本轮实读复核）。
- 迁移链尾：`apps/server/drizzle/0026_command_receipts.sql`、`0027_equipment_single_source.sql`、`0028_sync_revision_epoch.sql`（目录实读），与 schemaVersion 28 对齐。

### 1.3 环境（本轮实际使用）

| 项 | 值 | 证据 |
|---|---|---|
| Node | v26.8.1 | 本轮 node 进程报错输出（`Node.js v26.8.1`）；与 `docs/reviews/arch09-10-acceptance.md` §1 记录一致 |
| pnpm | 9.0.0 | 根 `package.json` `packageManager: "pnpm@9.0.0"` |
| PostgreSQL | docker 容器 `ai-mud-dev-postgres-1`，`127.0.0.1:55432->5432` | `docker ps`（本轮实跑）；CI 用 `postgres:16-alpine`（`.github/workflows/architecture.yml:14`），版本一致性以 CI 配置为准 |
| `.env` 关键项 | `DATABASE_URL=postgres://ai_mud:***@127.0.0.1:55432/ai_mud`（dev 业务库）；`AI_PROVIDER=template`；`AI_NPC_DIALOGUE_ENABLED=false`；`WORLD_TICK_ENABLED=true` | `.env` 实读。本轮全部验证无真实模型调用 |

## 2. 实跑验证表（2026-09-19，本机 dev 环境，exact HEAD `7d8f242`）

| 命令 | 实跑数量（本轮输出） | 结果 | 说明 |
|---|---|---|---|
| `pnpm typecheck` | 6/6 包 Done（shared / content / game-rules / ai-prompts / server / web），exit 0 | **PASS** | |
| `pnpm arch:check` | files on disk 220，classified 221，debt-matched 87（of 28 debt entries），UNCOVERED violations 0 | **PASS** | "RESULT: PASS (baseline clean, debts accounted)"。28 与台账 35 条的口径差见 §6 开放问题 Q1 |
| `pnpm arch:test` | 12/12 fixtures（NEG-01—11 全部 expect=fail got=red，NEG-12 绿路） | **PASS** | |
| `pnpm test` | shared 22/2 文件；ai-prompts 35/6；content 14/2；web 109/22；game-rules 61/5；server 365 passed + 6 skipped/40 文件。合计 **606 passed + 6 skipped（77 文件）**，exit 0 | **PASS** | server 输出中含预期内 warning/error 级日志（fake db 注入下 world-runtime preflight 失败重试、`app.test.ts` "database password leaked" 负路径断言），所属测试均绿，非失败 |
| `pnpm test:postgres` | 5 文件 17 测试全过，exit 0 | **PASS** | 隔离性事前确认见 §2.1 |
| `pnpm lint` | NOT_RUN | NOT_RUN | 未执行；且 6 个包的 `lint` 脚本与 `typecheck` 逐字相同（逐包核对 `package.json`），**即使执行也不构成独立证据**，只是 tsc 别名 |
| web `e2e` / `e2e:mock`（Playwright） | NOT_RUN | NOT_RUN | 本轮未执行；`docs/reviews/arch09-10-acceptance.md` §1 亦声明其为环境保留项。脚本存在于 `apps/web/package.json` |
| `pnpm db:verify-migrations` | NOT_RUN | NOT_RUN | 本轮未获执行授权，遵守"不拿未知环境代跑"约束（`sources-and-baseline.md` §4） |
| `db:verify-world-reset` / `verify:npc-simulation` / 七天经济仿真 / 真人试玩 | NOT_RUN | NOT_RUN | reset/仿真按纪律禁跑；真人试玩不存在于本轮。§4.2 引用的历史仿真/试玩结论均为文档记录，非本轮复跑 |

### 2.1 `pnpm test:postgres` 隔离性事前确认（允许实跑的依据）

- 脚本链：根 `package.json` `test:postgres` → `apps/server` `test:integration:postgres` → 依次跑 `src/db/postgres-integration.test.ts`、`game-concurrency.integration.test.ts`、`world-runtime.integration.test.ts`、`asset-mutation.integration.test.ts`、`equipment-migration.integration.test.ts`。
- 每个测试文件自建一次性临时库：连 `DATABASE_URL` 同实例的 `postgres` 管理库 `CREATE DATABASE ai_mud_vitest_*`（时间戳/PID/UUID 后缀，如 `postgres-integration.test.ts` `makeTempDatabaseName()`），迁移后 `DROP DATABASE ... WITH (FORCE)` 清理（`postgres-integration.test.ts:228,239`；`world-runtime.integration.test.ts:56-100`；其余三文件同型）。
- 结论：`.env` 指向的 `ai_mud` 业务库不被触碰；实跑后本轮自建临时库已全部自行清理，`ai_mud` 业务库无写入。
- 遗留观察：实例中存在 **10 个历史残留** `ai_mud_vitest_worldtick_*` 库（两个旧 PID 72403/72680 各 5 个，为更早中断运行遗留，非本轮产生）。本轮未删除（无清理授权）；处理建议见 §6 Q5。

## 3. 已交付能力清单（v0.11.x 实际拥有）

以下每项均为"当前 HEAD 源码/文档可取证"的交付；不包含本目录规划中的未来能力。

| # | 能力 | 证据 |
|---|---|---|
| 1 | **资产统一写入口与幂等回执**：`AssetMutationService` 是铜币/金库/市场库存的唯一可变余额写者；市场链配 `command_receipts`（同 commandId 重放不双扣、异 payload 冲突） | `apps/server/src/modules/ledger/asset-mutation.service.ts`（debitCharacterCopperIfAvailable/creditTreasury/debitMarketStockAboveReserve/findReceiptForUpdate/claimReceipt/saveReceiptResult 等）；`apps/server/src/db/schema.ts:542`（command_receipts + scope_kind_id_epoch_unique）；迁移 0026；真库故障注入 `apps/server/src/db/asset-mutation.integration.test.ts`；DEBT-016—019 销账记录见 `docs/architecture/legacy-boundary-debt.json` amendments |
| 2 | **世界时钟行锁**：租约机制已删，每 tick 一个短事务对 `world_runtime_state` 行 `FOR UPDATE`——并发争抢恰好结算一次、故障回滚不丢 tick、批量补算≡逐分钟 | `apps/server/src/modules/world-runtime/world-runtime.repository.ts:63-74`（`lockAndRead` 内 `.for("update")`）；真库并发证明 `apps/server/src/db/world-runtime.integration.test.ts`；`e2677ea` 为该套件加 60s 显式超时 |
| 3 | **装备单一真源**：`character_equipment` 已迁入 `item_instances` 并删表；新角色/换装/修理/耐久单一来源 | 迁移 `apps/server/drizzle/0027_equipment_single_source.sql`；`apps/server/src/db/schema.ts` 中 `character_equipment` 0 命中（本轮 grep）；`docs/playtests/v0.11.0-playtest.md` §验证通过 2（建角即穿装备，生产路径生效）；一致性真库测试 `equipment-migration.integration.test.ts` |
| 4 | **结构化战斗事实**：timeline 携带 actor/damage 结构化事实，文案降级为展示；事件日志全链路 eventType | `apps/server/src/modules/game/game.repository.ts:165-171`（`CombatTimelineEntry{atMs,message,actor,damage?}`）与 `CombatActionPayload.combatTimeline`；`game.service.ts:283-293`（伤害聚合按结构化字段，非中文正则）；`packages/shared/src/game.ts:147,154`（GameLogEntryDto.eventType） |
| 5 | **纯读观察**：管理面板与 `/game/state` 不再静默推进世界/播种；离线简报立即返回模板、AI 后台生成 | `docs/releases/v0.11.0.md` §架构成果 6；`game.routes.ts` 中 `settleWorldIfDue` 仅存于 dialogue-targets/dialogue 等 GET（`game.routes.ts:562,574`），`/game/state` 不调用；`admin.routes.ts:403` 的 `settleDue` 位于显式 `settleNpcWorld` 维护命令内。保留观察：台账 DEBT-007/008（transport 内嵌组合根）仍 open，见 §4.1 |
| 6 | **同步协议三分离**：cursor / 角色 revision / 世界 epoch 分离下发；客户端拒绝旧 epoch 与回退 revision 覆盖 | `packages/shared/src/game.ts:189-190`（worldEpoch/characterRevision）；`apps/server/src/db/schema.ts:531,548`（world_epoch 列）、`:838`（sync_events.state_dirty）；迁移 0028；客户端 `apps/web/src/features/game/sync/useGameSync.ts`；试玩 §7 整场会话无错乱 |
| 7 | **用途级 AI 准入**：单一共享编排器 + 用途政策表（authorityClass、mutatesWorldState:false、cooldown、fallbackRequired、promptVersion）；`AI_NPC_DIALOGUE_ENABLED` 只治对话 | `apps/server/src/modules/ai/ai-purpose-policy.ts`（AI_PURPOSE_POLICIES，6 用途：npc_dialogue/npc_task_copy/npc_memory_compression/world_rumor/npc_task_proposal/offline_summary，均为 presentation 类、allowedStateEffects:"none"）；`ai-orchestrator.ts`、`template-ai-provider.ts`、`deepseek-ai-provider.ts`、`ai-governance.service.ts` |
| 8 | **CI 真 PG**：CI 内起 postgres service，迁移 + 17 例真库套件 + arch 门禁 + 全量测试同门槛 | `.github/workflows/architecture.yml`（:13-14 postgres:16-alpine service；:42 arch:check；:48 `CI=true pnpm test:postgres`）；`docs/reviews/arch09-10-acceptance.md` §1 |
| 9 | **架构护栏与债务台账**：catalog/boundaries/debt 三份冻结合同 + 程序化检查器 + 12 NEG 探针 | `docs/architecture/module-catalog.json`（21 个目标逻辑模块与允许边）；`docs/architecture/legacy-boundary-debt.json`（35 条登记，见 §4.1）；`scripts/architecture/{arch-check,arch-test,policy}.mjs`；本轮实跑 PASS（§2） |
| 10 | **NPC 记忆证据分级**：记忆条目带 evidenceLevel（dialogue_claim vs system_verified 等） | `apps/server/src/modules/npc-memory/npc-memory.service.ts:70,100,122`（NpcMemoryEvidenceLevel）——对 §5 的 Jev 记忆复用是可用底座 |
| 11 | **静态内容包模式**：模板即纯数据、独立版本化 | `packages/content/src/items.ts`（ItemDefinition/MarketItemFields）、`world.ts`（ResourceDefinition/MonsterDefinition/LootEntry）；contentVersion 12 |
| 12 | **测试与前端底座**：606 单测 + 17 真库 + 临时库 harness；React HUD 骨架 | §2 实跑数；`apps/server/src/db/*.integration.test.ts` 临时库模式（`e2677ea` 60s 超时）；`apps/web/src/features/game/`（GameShell/controller/panels/modals/sync） |

## 4. 遗留缺口清单

### 4.1 架构债务台账（`docs/architecture/legacy-boundary-debt.json`，冻结 2026-09-18，未销账 35 条）

构成：target_blocking 14 条、transitional 20 条、registered_exception 1 条（REG-001，world-reset 33 表横切 delete）。数量核对：本轮 `node -e` 统计 entries=35，与 arch:check "28 debt entries" 的口径差见 §6 Q1。

对基地经营最相关的 target_blocking 条目摘要（全量见台账原文）：

| ID | 内容 | 与新玩法的关系 |
|---|---|---|
| DEBT-007 / DEBT-008 | `game.routes.ts` / `admin.routes.ts` 内嵌组合根，transport 直接 import 13 个模块内部并编排世界推进 | 基地经营新 API 的落点。新文件不受债务豁免（arch:test NEG-08 证明新文件无登记即红），新路由必须走 application/composition 目标结构，不能照抄现有模式 |
| DEBT-014 | game ⇄ npc-task ⇄ dialogue 模块级环未破 | industry/quests 模式复用时不得重入环；catalog cycles deny |
| DEBT-020 | `npc_items.quantity` 双写（npc + item 两套增减实现），目标唯一写者 assets | 机器人库存/物料若复用 npc_items 模式会放大此债；release 文档明言"保留至 ItemService 统一切片" |
| DEBT-025 | 世界资源池/进度写入口在 npc 持久层（历史命名所致），目标归 world | world 子域恰好是基地作用域（ADR-B01/B02）的落点，需 A0-03 一并裁决 |
| DEBT-005/006/001/004/009—013/027/028 | characters/game/dialogue/rumor/offline-report 各处 peer 内部 import 与类型穿透 | characters 混合服务是旧玩法中心；若旧世界退役（00-scope §5），这些条目的退役路径要与 KEEP/ARCHIVE/MAP/RESET 表一起规划，不得用删测试变绿 |

transitional 20 条多为测试跨模块夹具（DEBT-029—042/044）与过渡写法（DEBT-023 sync_events 分散写、DEBT-024 ai 审计写者错位、DEBT-026 shared barrel、DEBT-039 三处动态 .set 人工审查在案），不阻塞开工，但 test fixture 类条目提示：基地经营的真库测试应从第一切片就用登记 setup helper，避免新增同类登记。

### 4.2 试玩发现的问题（`docs/playtests/v0.11.0-playtest.md`，2026-09-18）及后续状态

| 级别 | 问题 | 当前状态（本轮取证） |
|---|---|---|
| P1 | 新档金库被 NPC 经济抽干，玩家战利品无法变现 | **修复已合入 main，效果无复玩证据**：PR #17（`90dc508` "economy: market saturation cap for NPC sells + larger treasury seed" + `f157333`，merge `1929972`）改动 `npc.service.ts`、`verify-npc-simulation.ts` 及测试。但 PRODUCT_VERSION 仍 0.11.0、无 v0.11.1 发版文档、无真人复玩记录。commit 信息自述"v0.11.1 前置"，即修复定位为前置而非已验收版本 |
| P2 | 登录页版本标签显示 "v0.1 Foundation" | **未修**：`apps/web/src/features/auth/AuthPage.tsx:128` 现仍硬编码 `v0.1 Foundation`（本轮 grep） |
| P3 | 状态栏"铜币 0"折行 | 状态未知（本轮未启动前端核实），列开放问题 Q6 |
| 观察 | 野莓市场库存 0（NPC 吃光浆果，任务"空粮袋"玩家无法购买完成） | 与 P1 同源；#17 饱和上限理论上缓解 NPC 单边吃货，但无针对性验证记录，列开放问题 Q6 |

### 4.3 其他已知未修项

- web E2E（Playwright）从未在门禁中实跑（`arch09-10-acceptance.md` §1 声明的环境保留项）；v0.12 的"鼠标完成核心操作"验收需要它，当前无一条 E2E 证据。
- `AGENTS.md` 旧开头 0.10.6 表述与新交付的错位已由 PR #19 修订（`git diff --stat` 中 AGENTS.md −28/+61）；`sources-and-baseline.md` §2 记录该背景。
- 真实模型（DeepSeek）链路：`.env` 已配 key，但 `AI_PROVIDER=template`、对话开关 false；无任何用途有真实模型运行证据（v0.14 的 LIVE_MODEL_GATE 与本轮无关，勿混淆）。

## 5. 新玩法需求 vs 可复用基础

对照 `00-scope-and-a0.md` §1/§4（ADR-B01—05）与 `01-domain-contracts.md`。判定口径："已有可复用"=当前 HEAD 存在可直接平移的能力（给证据）；"部分可复用"=有同型底座但目标形态缺关键件；"全新"=当前无对应代码/表/模块。**下表"全新"不构成对规划的否定，只陈述当前事实。**

| 需求 | 判定 | 现状与可复用点 |
|---|---|---|
| BaseId / 基地作用域（ADR-B01：一账号一基地，不复用 CharacterId） | **部分可复用** | 可复用：identity 的账号/会话/CSRF/权限底座（`modules/auth`、`activation-code`、`rate-limit`）；catalog 目标图中 `world` 模块已定义 owns "Topology, instance identity, scoped resources, runtime progress and epoch"（module-catalog.json），是天然落点。全新：基地表、BaseId 授权路径（现请求授权链是 account→character，schema 无 bases/base 成员概念）；ADR-B01 明确禁止拿全库放宽权限实现多基地 |
| 基地模拟时钟 simTime / 暂停 / 受控加速（ADR-B02） | **部分可复用** | 可复用：world-runtime 的 runtime 行 + 行锁 + 批量补算模式（§3.2 三条真库性质可直接平移为"每基地一行 runtime"）。全新：当前 `world_runtime_state` 是单键全局 NPC 世界 tick（`NPC_WORLD_RUNTIME_KEY`，`WORLD_TICK_INTERVAL_MS=60000` 墙钟驱动）；simTime 与 UTC 分离、暂停/倍速命令、心跳租期、每基地锁序参与根均为新逻辑。01-contract §5 明言"不由此承诺未测多副本容量" |
| industry：设施/项目/步骤/工单/站内供能（ADR-B03） | **全新** | 无任何设施/工单/能源表、服务或规则。可借用模式：quests 的托管/义务生命周期与 assets 同事务参与（`npc-task` 链 + `asset-mutation` 端口）、`command_receipts` 幂等、纯规则包（`packages/game-rules`，确定性计算 + 显式时间）。catalog 尚无 industry 模块——新增目录/依赖边须走 A0-03 的 Architecture Policy Change，不由实现代理自行放宽 |
| content-catalog：草稿/修订/发布快照/激活（ADR-B04） | **部分可复用** | 可复用：`packages/content` 静态纯数据包 + contentVersion 12 证明"模板为数据、不含可执行代码"模式；v0.12 内置快照可先经同一 port 语义加载静态包。全新：草稿/发布/激活的存储与后台（v0.13）、运行时 `ContentCatalogPort`、DefinitionRef(kind+stableId+revision) 校验 |
| 机器人作业者（约 12 台、三组分工） | **部分可复用** | 可复用：npc 模块的身份/需求/行动/记忆底座与 world-runtime tick 参与方模式；npc-memory 的 evidenceLevel 证据分级（§3.10）正是 01-contract §7 "必要记忆保留 source/证据等级"的同型。全新：机器人运行状态（电量/载体/当前分配/位置）、与 assets 设备资产 ID 一对一关联（01-contract §1 明确 assets 写所有权、npc 写运行状态）、RobotFactoryPort/setup receipt |
| Jev DecisionProvider（ADR/00-scope：规则兜底、有限决策） | **部分可复用** | 可复用：ai 模块的用途级准入政策表、单一编排器、cooldown/fallback/promptVersion/审计治理（§3.7）；provider 抽象已隔离供应商（template/deepseek）。全新：decision 类用途（现 6 个用途全部 `authorityClass=presentation`、`allowedStateEffects:"none"`，无决策类先例）；DecisionId/PlanRevision 合同、candidateId/abstain 输出、预算双层限额、baseId/epoch/revision 绑定（00-scope §5 迟到响应要求）。Jev SDK 端点/价格按 `sources-and-baseline.md` §3 留待实施时核实，本轮未查证 |
| 内容发布后台 | **全新**（v0.13 范围） | 本轮无对应物；不因路线批准视为已开工 |
| 开发试玩入口（简单注册/自动登录/直建基地） | **部分可复用** | 可复用：注册/激活码/会话/哈希/CSRF 全链路已在产（试玩 §验证通过 1）。全新：部署模式显式识别（01-contract §8：正式模式不得因 NODE_ENV 误配无声开放）、注册直建基地的 provisioning 流程 |
| 同步/观察前端 | **已有可复用** | sync 三分离 + `useGameSync`、GameShell/panels/modals HUD 骨架（§3.6/§3.12）；BaseSnapshot 的 epoch/revision/cursor 三元组与现有 SyncResponse 同构可平移 |
| 事务/幂等/真库测试纪律 | **已有可复用** | UoW 同事务参与方模式（world-runtime transaction 绑定参与仓储）、command_receipts、临时库 harness + 60s 超时、CI 真 PG（§2/§3）。01-contract §6 的五类失败注入点可沿用 `asset-mutation.integration.test.ts` 的故障注入手法 |
| DuckDB 隔离分析 | **全新** | 00-scope 定为候选；无依赖、无代码（本轮 package.json/源码无 duckdb 引用） |
| 旧世界退出（KEEP/ARCHIVE/MAP/RESET 表） | **全新** | 仅有 `world-reset` 的 33 表横切 delete（REG-001 登记例外）可作 reset 语义参考；归档/映射方案零实现。00-scope §5：读页面不触发 seed 或升级，原 reset 入口不是创建基地的实现 |

## 6. 风险与开放问题

- **Q1 口径差**：`arch:check` 报 "28 debt entries"，台账 JSON 实有 35 条。推测检查器只统计机器可匹配（有 targetGlobs/边）的条目，无机器边的登记项（如 REG-001、DEBT-039 人工清单）不计入；UNCOVERED=0 说明不影响 PASS 判定。建议 A0-03 或 MOD 侧给出一句口径说明，避免后人误读。
- **Q2 transport 债务与新 API 落地顺序**：DEBT-007/008 未破除前，基地新路由若"照抄 game.routes 现状"会立刻产生无豁免新违规（NEG-08 会红）。v0.12 的 P 包必须先冻结新路由走 application/composition 的装配方式，否则实现代理面临"守规则就装不上"的两难。
- **Q3 模块环**：DEBT-014（game⇄npc-task⇄dialogue）仍在。industry 复用 quests 义务模式时，若新模块再挂进现有环上会加固债务；A0-03 的依赖图变更需单列审查（00-scope §4 已要求）。
- **Q4 时钟双轨语义**：现有 NPC 世界 tick 是墙钟驱动单键；ADR-B02 要求基地 simTime 独立。若旧西幻世界保留运行（00-scope §5 默认方案是备份/归档），将出现"共享野外墙钟 tick + 独立基地 simTime"两套时钟并存；若旧世界整体退役，world_runtime_state 语义可让渡给基地。这是 A0-02/A0-03 交叉裁决点，本轮不下结论。
- **Q5 残留临时库**：10 个 `ai_mud_vitest_worldtick_*` 残留库占 dev 实例（§2.1）。harness 清理依赖 vitest afterAll，进程被杀即漏清（`e2677ea` 加超时正是针对此类挂死）。需要一次显式授权的清理（手工 DROP 或登记维护脚本）；本轮未动。
- **Q6 试玩小项状态**：P3 折行与野莓观察项未核实（本轮未启动 dev 前端）；#17 修复对 P1 的实际效果无真人复玩。建议升 0.11.1 前补一次复玩，避免基地版本叠在未验收的经济补丁上。
- **Q7 未跑项的边界**：E2E、db:verify-migrations、七天仿真、真实模型均 NOT_RUN（§2）；本文件不得被引用为这些面的通过证据。v0.12 的鼠标验收（E2E/Playwright）与 v0.14 的 LIVE_MODEL_GATE 是各自版本的独立门槛。
- **Q8 版本字段纪律**：#17 改了经济行为但 economyVersion 仍 4、PRODUCT_VERSION 仍 0.11.0。README §5 规定"实际发布才更新 PRODUCT_VERSION"；当前状态符合字面纪律，但"v0.11.1 前置"长期滞留 main 会模糊 0.11.0 的验收边界，建议在 v0.12 P 包开工前明确 0.11.1 是否单独发版。

## 7. A0-G01 对照

| 退出条件 | 状态 |
|---|---|
| 实际 HEAD/版本已列清 | §1：HEAD `7d8f242`（=main `e2677ea`+规划文档）、0.11.0 全字段 |
| 可复用接口已列清 | §3 十二项 + §5 逐项判定；未验证能力（E2E/真实模型/复玩）均标 NOT_RUN 或开放问题，未标已完成 |
| 未验证能力不标已完成 | §2 NOT_RUN 列 + §4.2/§4.3 + Q7 明示边界 |
