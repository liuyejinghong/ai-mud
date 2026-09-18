# 模块边界清单（MOD-01 交付物）

- 任务：v0.11.0 / MOD-01「冻结逻辑模块、文件归属与能力合同」（modularity-baseline.md §2）
- 基线：分支 `arch/v0.11.0-arch01-mod01` @ `d9f97dd`（main 690cbc8 + PR#1 head dab2893）
- 配套机读文件（本切片同时新增）：
  - `docs/architecture/module-boundaries.json` —— 214 个 TS/TSX 文件的唯一归属分类（0 未分类、0 重复、模块 ID ⊆ catalog），MOD-02 检查器的实际输入
  - `docs/architecture/legacy-boundary-debt.json` —— 26 条精确债务 + 1 条登记例外（REG-001）
- 状态：DRAFT_PENDING_INDEPENDENT_REVIEW（M01 验收要求"经独立审查后冻结"，冻结动作在审查后）

## 1. 归类规则摘要（module-boundaries.json 的生成口径）

| 现有目录/文件 | 逻辑模块 | 层 | 备注 |
|---|---|---|---|
| modules/account-ops、activation-code、auth | identity | transport/domain/persistence | |
| modules/admin | transport | transport | **legacy_mixed**：读路径触发推进/种子（DEBT-008） |
| modules/ai、packages/ai-prompts | ai | capability | |
| modules/announcement、lobby、rumor | social | domain | |
| modules/audit、rate-limit、config、db | platform | platform/persistence | schema 共置=登记例外 |
| modules/dialogue（repository/service） | npc | domain | **legacy_mixed**；AI 直调/ai 日志写者错位（DEBT-009/010/024） |
| modules/dialogue/dialogue-resource-transfer.repository | application | application | **legacy_misplaced**：跨域转账用例住在 repository（ARCH-03） |
| modules/game/game.{routes,service,repository} | transport / characters / characters | — | 三者均 **legacy_mixed**（R1；方法级目标见 §3） |
| modules/game/game.composition、src/app.ts、src/main.ts | composition | composition | 事实组合根（当前分散于三处，ARCH-07 收敛） |
| modules/item、ledger | assets | domain/persistence | 方向正确的目标所有者 |
| modules/npc、npc-memory、dialogue 域部分 | npc | domain | npc.service 含仿真设施 import（DEBT-015） |
| modules/npc-task | quests | domain | **legacy_mixed**：托管/物品/台账编排内嵌（DEBT-002/003） |
| modules/offline-report | observation | read_model | |
| modules/world-reset | application | application | REG-001 登记例外 |
| modules/world-runtime/{service,repository} | world | domain/persistence | |
| modules/world-runtime/world-post-tick | application | application | 提交后协调（方向符合 ADR-04） |
| packages/shared：version.ts、errors.ts | kernel | kernel | |
| packages/shared：game.ts | protocol | protocol | **legacy_mixed**：混领域值（ARCH-05 分区） |
| packages/shared：admin.ts、auth.ts、index.ts | protocol | protocol | |
| packages/content、game-rules | content / rules | content / rules | |
| apps/web：controller/sync/*Api | client_session | client_state | |
| apps/web：其余 src | client_text | client_view | |

全仓**不存在任何 public.ts / bootstrap.ts**（find 实证），故 boundaries.json 中 `currentPublicEntry` 全为 null——公开入口规则在提取完成前不可执行，不得伪称已生效。

## 2. 裁决记录（需独立审查确认）

- **R1（routes 归类）**：game.routes.ts / admin.routes.ts 的 `createDefaultDependencies` 是事实组合根（import 13 模块 repo/service 并直接 new、路由层触发世界推进）。裁决：归类为 transport 层 `legacy_mixed`，整体登记 DEBT-007/008；目标形态 transport→application；**不**为过检强行归类为 composition。
- **R2（debt 粒度）**：登记粒度=文件×符号（导入边/写函数），逐条绑定 ARCH 切片与删除条件；不用行号做唯一身份；不设 glob 豁免；新增违规（含 legacy 文件内新增符号）不豁免（NEG-08/09）。
- **未决（需 ARCH-02 前裁决）**：`map_instances.resourceCharges` 的唯一写所有者——现状是 game（采集扣减）+ npc（世界 tick 每日重置写个人实例）双写且跨 scope（DEBT-022）。

## 3. 混合文件方法级迁移目标

### game.service.ts（2197 行，primary=characters）

| 方法组（示例） | 迁移目标 | 任务 |
|---|---|---|
| createCharacter / move / startCombat / settleCombatAction / settleGatheringAction / settleReadableState / settleHunger* / requireSettledCharacter* | characters | ARCH-06（单一结算入口） |
| buyMarketItem / sellMarketItem / getMarket / buildMarketDto | economy（报价/成交）+ assets（库存/款项） | ARCH-03（首迁链） |
| repair* / equipEquipment / 吃饭消耗 | characters + assets | ARCH-03/04 |
| getSync / getState / settleWorldIfDue 编排 / enricher 数据拼装 | application（用例）+ observation（投影） | ARCH-06/07 |
| acceptNpcTask / completeNpcTask / 任务路由委托 | quests（经 application 用例） | ARCH-03 |

### game.repository.ts（1342 行，primary=characters/persistence）

| 写函数组 | 迁移目标 | 任务 |
|---|---|---|
| copper/treasury/market_inventory 族（504-536、940-1093） | assets persistence | ARCH-03 |
| character/items/location/needs/vitals/actions（454-846、1208-1322） | characters / world persistence | ARCH-05/06 |
| equipment 双表示族（727-905） | assets（item_instances 唯一真源） | ARCH-04 |
| writeEvent / writeSyncEvent（1153-1322） | world/observation 事件面 | ARCH-05 |

### 其它混合体

- npc-task.repository：编排内嵌（item/ledger/game 实例化）→ quests 持久层瘦身 + application/assets 参与API（ARCH-03）。
- dialogue.service / dialogue.repository：对话域留 npc；AI 调用迁 application+AiGateway；资源转移用例迁 application（ARCH-03/08）。
- game.routes / admin.routes 依赖闭包 → application 用例 + observation 聚合（ARCH-03/06/07）。

## 4. 首批公开能力最小集（仅为有真实调用者的路径定义，PC-15）

> 以下是**目标合同条目草案**（MOD-01 §5 要求定义输入/返回/错误/scope/query-or-tx-only/幂等/消费者）。当前无一存在；命名在实施时冻结，不预建空接口。

| 能力 | 所有者 | 类型 | 消费者（用例） | 关键语义 |
|---|---|---|---|---|
| economy.quote(itemId, quantity, side) | economy | query | market-trade 用例 | 输入库存快照来自 assets 锁定读；返回报价值对象 |
| assets.transferMarketStock / settleAccounts(...) | assets | tx-only | market-trade | 唯一 quantity/铜币/金库写入口；含幂等 commandId |
| quests.validateCompletion(taskId, characterId) | quests | tx-only | complete-task | 锁任务行，返回资产计划（应付物品/托管金额） |
| assets.settleObligation(plan) / quests.markCompleted(id) | assets/quests | tx-only | complete-task | modularity §6 伪代码顺序 |
| npc.recordVerifiedFulfillment(fact) | npc | tx-only | complete-task | 写 npc_memory_entries（system_verified）**必须同事务**（现状在事务外，ARCH-03/05 迁移点） |
| world.advanceTick(tickAt) + npc.settleTick(tickAt) | world/npc | tx-only | advance-world-tick | 同一 UoW；替换 lease 旁路（ARCH-02） |

## 5. 覆盖验证（M01 验收对应）

- 全部生产源文件唯一分类：**214/214**（生成脚本 + 双向对账：磁盘 find ↔ JSON 集合差=0；unmatched=0；dupes=0；unknownModules=0）。
- catalog 目标图无环：module-catalog.json 业务边复核无环 ✓（当前代码模块聚合环已登记 DEBT-014，属债务非目标图问题）。
- debt 每条含 ruleId/source/target/symbol/evidence/fixTask/removalCondition：26+1 条 ✓。
- 不能解析的文件明确失败：生成器 unmatched 非空即失败（本轮为 0）；MOD-02 的 NEG-08 将门禁化。

## 6. 冻结前待办

1. 独立审查确认 R1/R2 裁决与 DEBT-022 未决项。
2. RF-01（shared 陈旧断言）裁决（见 architecture-baseline-inventory.md §2）。
3. 审查确认后，将两份 JSON 的 `status` 置为 `FROZEN_<date>`，此后改动须走 Architecture Policy Change。
