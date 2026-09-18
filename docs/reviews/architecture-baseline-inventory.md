# 架构基线清单（ARCH-01 交付物）

- 任务：v0.11.0 / ARCH-01「基线冻结与路径清单」（architecture-baseline.md §C）
- 执行基线：分支 `arch/v0.11.0-arch01-mod01` @ `d9f97ddc5bfb6e4093ede2cfabc7f659d5434e08`
  （= main `690cbc8` + PR #1 head `dab2893` 文档合并；main 未动，PR #1 未合并）
- 产品版本：`packages/shared/src/version.ts` → `PRODUCT_VERSION = "0.10.6"`，兼容块 schema 25 / api 39 / engine 2 / ruleset 16 / content 12 / prompt 8 / economy 4 / worldSeed 1（**未改动**）
- 执行日期：2026-09-18。性质：静态清单 + 门槛实跑记录；**未修改任何游戏源码/规则/迁移**。
- 旧包声明：未执行旧 F11 / v0.12—v1.1 任何历史版本包；本切片仅新增本文档与 MOD-01 交付物。

## 1. 工具链与仓库实况

| 项 | 实况 | 备注 |
|---|---|---|
| Node | v26.8.1 | 高于 review 文档讨论的 22/24 LTS；升级评估属 ARCH-09，此处仅登记 |
| pnpm | 9.0.0 | 与根 `packageManager: pnpm@9.0.0` 一致 |
| PostgreSQL | 服务器不可用（Docker UNAVAILABLE） | 真库门槛全部 NOT_RUN，见 §2 |
| 数据库端口约定 | `DATABASE_URL` 指向 `127.0.0.1:55432`（本机 docker 映射） | 仅核对 host，未读取/打印凭据 |
| 迁移 journal | 25 个迁移，最后为 `0025_item_ledger_system_source.sql` | 后续迁移编号以 journal 实际追加为准，不假定 0026 |
| 仓库卫生 | 根目录存在 `pnpm-lock 2.yaml`（7月1日副本，lockfileVersion 9.0） | 登记；删除属仓库变更，待另行授权 |
| 仓库卫生 | 根 `package.json` 的 version 字段滞后于 shared/version.ts | architecture.md 已自认不可信；以 shared 为准 |
| CI | **未发现任何 CI 配置**（无 .github/workflows 等） | 门禁只能本地执行；分支保护未配置（不在本轮） |
| lint 实质 | 全仓无 eslint；所有包 `lint` ≡ `tsc --noEmit`（与 typecheck 逐字相同） | lint 不构成独立于 typecheck 的证据 |

## 2. 门槛执行记录（实际运行）

运行环境：本机，`CI=true`。`pnpm -r test` 因 shared 失败按 pnpm 递归策略中止，故 server/web/content/game-rules 单独补跑取得计数。

| 命令 | 结果 | 明细 |
|---|---|---|
| `CI=true pnpm -r typecheck` | **PASS**（exit 0） | 6 包全过 |
| `CI=true pnpm -r lint` | **PASS**（exit 0） | ⚠️ 与 typecheck 同一证据（见 §1） |
| `CI=true pnpm -r build` | **PASS**（exit 0） | server tsc + web vite（83 modules）等 |
| `CI=true pnpm -r test` | **FAIL**（exit 1） | shared 1 例失败后递归中止 |
| `pnpm --filter @ai-mud/shared test`（随上） | **FAIL** | 21/22 过，1 失败：`src/game.test.ts:50-53` "exposes v0.10.5 world health compatibility" 断言 `PRODUCT_VERSION === "0.10.5"`、`apiVersion === 38`，实值 `0.10.6` / `39` |
| `pnpm --filter @ai-mud/server test` | **PASS** | 37 文件：352 passed + 6 skipped（跳过=两个真 PG 集成文件，无可用 DATABASE_URL 环境） |
| `pnpm --filter @ai-mud/web test` | **PASS** | 21 文件 103 passed |
| `pnpm --filter @ai-mud/content test` | **PASS** | 2 文件 14 passed |
| `pnpm --filter @ai-mud/game-rules test` | **PASS** | 5 文件 61 passed |
| `pnpm --filter @ai-mud/ai-prompts test`（随 -r） | **PASS** | 6 文件 35 passed |
| `pnpm db:up` / `db:migrate` / `db:verify-migrations` | **NOT_RUN** | Docker 守护进程不可用，无法启动本地 PG |
| `pnpm test:postgres`（postgres-integration + game-concurrency） | **NOT_RUN** | 同上；单测内以 skip 呈现（6 例 skipped） |
| `pnpm verify:npc-simulation` | **NOT_RUN** | 同上（该脚本无 URL 直接失败，不跳过） |
| `pnpm --filter @ai-mud/web e2e`（playwright mock+real） | **NOT_RUN** | 需运行中的 server+PG |

合计实跑用例：593（592 过 / 1 失败 / 6 跳过）。

### 红旗（基线内已知失败，按纪律不在本切片修）

- **RF-01**：`packages/shared/src/game.test.ts` 的兼容块断言停留在 v0.10.5（版本与 apiVersion 均过期）。0.10.6 发版时漏更新该测试。修复=把断言对齐 0.10.6 实际兼容块，属版本工程决策，须对照 v0.10.6 发布说明逐字段核实后单独提交；**不得删用例变绿**。此红旗阻塞 `pnpm -r test` 作为整体门槛，需在进入 ARCH-02 前由用户裁决修复方式。
- **RF-02**：真 PG 证据整体缺失（同 tick 租约并发、跨模块回滚、迁移链应用均只有内存替身或 NOT_RUN）。这是 ARCH-02/03 验收的硬前置。
- **RF-03**：`apps/server/src/db/client.test.ts` 硬编码 `127.0.0.1:5432` 且无跳过保护（当前仅建连不查询所以通过）；ARCH-09 应纳入隔离要求。

## 3. 七类事实清单（真源 / 写路径 / 锁根 / 事务 / 账本事件 / 测试）

> 完整「表 × 写者」矩阵（33 表，含全部 file:line）已沉淀于 `docs/architecture/legacy-boundary-debt.json` 的 CROSS_OWNER 条目与本节摘要；测试文件级清单见 §4。行号为基线 `d9f97dd` 下的实测值。

### 3.1 余额（铜币）

| 真源 | 当前写者（file:line） | 锁根 | 事务拥有者 | 账本 | 测试 |
|---|---|---|---|---|---|
| characters.copper_balance | game.repository 504/514/521；npc-task.repository 233；dialogue-resource-transfer.repository 41 | 角色行 FOR UPDATE（市场路径）；任务/赠予路径部分无显式角色锁（依赖条件 UPDATE gte） | 各自 service 的 db.transaction | asset_ledger（market_buy/sell、task_reward、dialogue_gift） | game.service.test 锁序/竞态 5 例；game-concurrency.integration 2 例（NOT_RUN） |
| world_actors.copper_balance | npc.repository 298/311；npc-task.repository 187/206；dialogue-resource-transfer.repository 29 | NPC actor 行 FOR UPDATE（任务 commit；NPC 市场四重锁） | 同上 | asset_ledger（task_escrow/refund、npc_wage、market_*） | npc.service.test 市场竞态 4 例 |
| municipal_treasury.copper_balance | game.repository 1067/1080；npc.repository 222/460/470/483 | 金库行 FOR UPDATE（买卖路径） | 同上 | asset_ledger | 同上 |

目标所有者：assets（三处均为 DEBT-016/017/019）。绝对 set 旁路存活：`updateCharacterCopper`（game.repository:504，当前买卖路径未用，有源码断言测试防守）、`updateMunicipalTreasury`/`setMarketInventoryQuantity`（npc/game 侧）。

### 3.2 堆叠物品

| 真源 | 写者 | 说明 |
|---|---|---|
| character_items | item.repository 112/152（grant/consume，条件 gte+returning）；world-reset 清表 | 目标所有者 assets ✓（item→assets）；调用方 game/npc-task/dialogue |
| npc_items | npc.repository 251/333/355 + item.repository 130/170 | **两套增减实现并存**（DEBT-020） |
| market_inventory.quantity | game.repository 940/981/991/1012/1032 + npc.repository 546/556/576 | 玩家/NPC 各一套；含 reserve 变体 decrementAboveReserve（DEBT-018） |

### 3.3 装备（双真源在用，AR-03）

- legacy：`character_equipment`——createEquipment（game.repository:860，新角色 Starter 仍在写，game.service:564-566）、updateEquipmentDurability legacy-first 双写（:873-898）、deleteLegacyEquipmentBySlot（:905，换装清槽）。
- 新：`item_instances`——item.repository create:191 / move:254（transfer/equip/unequip/destroy 统一入口）；game 侧耐久 fallback :891。
- 读取合并：`listEquippedEquipment`（game.service:1551）双表合并；战斗属性由 service 拼装（:373/:433/:440/:750-759）。
- 测试：postgres-integration 迁移断言（NOT_RUN）；无迁移前后快照对比测试（ARCH-04 交付物）。

### 3.4 任务（npc_tasks）

- 状态机唯一写者：npc-task.repository（createTask:305；updateTask:340 条件更新 expectedStatuses/expectedAcceptedBy）。
- 托管：无独立 escrow 余额列；= npc_tasks.escrow_copper 列 + world_actors.copper_balance 的条件扣减（reserveNpcCopper:181-202，`gte(balance, amount+reserve)`）；过期退款 incrementNpcCopper。
- 每 NPC 唯一活跃任务：部分唯一索引 `npc_tasks_one_active_per_npc_idx`（schema.ts:755-757）+ 应用层三重防（锁 actor/阻塞检查/唯一冲突吞并）。
- 事务：accept/complete/commitCandidate 各自单事务；**履约记忆（npc_memory_entries, evidence_level=system_verified）在事务外独立连接写**（npc-task.service:350-361，经 NpcMemoryPort→app.di.db）——ARCH-03/05 迁移点。
- 过期结算无独立定时器，靠三条写路径 + post-tick 顺带触发。

### 3.5 NPC 行动

- npc_actions：npc.repository create:387 / markCompleted:403（仅 completed，无 cancel 路径，cancelledAt 无写者）。
- world_actors 的 hunger/position/lastHungerSettledAt：npc.repository updateNpcActor:293。
- character_actions：game.repository create:1253 / payload:1293 / completed:1300 / cancelled:1309。
- NPC 资产行为（吃饭/买卖/工资/采集/维护）全部在 npc.service（263-344、682-869、995-1123），ledger 经注入 CopperLedgerWriter（npc→assets 允许边）。

### 3.6 资源池（scope 对照，AR-08）

| 对象 | 真源 | 写者 | scope |
|---|---|---|---|
| 共享世界资源节点 | world_resource_nodes.charges | npc.repository 156/450（采集扣、每日重置 936） | **共享**（全服） |
| 个人副本资源 | map_instances.resourceCharges | game.repository 1227（采集扣）+ **npc.repository 182（世界 tick 每日重置写个人实例）** | **个人** |
| 共享市场/金库 | market_inventory / municipal_treasury | game+npc | **共享** |

⚠️ `map_instances.resourceCharges` 存在跨 scope 写入（共享 tick 重置个人副本），且两模块两套实现——唯一写所有者待裁决（DEBT-022，MOD-02 前需确认）。私人副本产出进入公共市场是可识别的资源来源，不构成"共享野外"。

### 3.7 进度游标与同步

- world_runtime_state：world-runtime.repository 独占（upsert:34 / acquireLease:57-91 / saveProgress:93-108 / releaseLease:110-124）。**AR-01 缺口实测确认：saveProgress/releaseLease 的 WHERE 仅 key 无 ownerId；追赶期间租约不续期；ownerId=`server-${process.pid}`**。每 tick「NPC 结算+进度」单事务（app.ts:106-117）；post-tick 仅在真实推进后触发且在事务外（app.ts:74、world-post-tick.service）。
- sync_events：四模块各自 insert（game:1157 / item:299 / lobby:101 / announcement:44）；getSync 以 `sync_events.id` 为 stateVersion=nextCursor（game.service:480,495），客户端无版本比较。
- game_events：game.repository.writeEvent:1322 独写（18 处调用）；其中战斗结算消费仍走 `playerDamageFromCombatLog` 正则（game.service:275,1809）；教程进度正则在 web TutorialGuide.tsx:66-67。事实→文案反向依赖实测确认（AR-05）。

## 4. 测试与证据盘点（全部 NOT_RUN 之外的本轮实跑结果见 §2）

- 静态盘点：73 个测试文件 / 严格 grep 口径 555 用例；实跑口径 593（差异=each/参数化与计数口径）。分包：server 358（含 6 PG-skip）、web 103、game-rules 61、ai-prompts 35、shared 22、content 14。
- 真 PG 依赖：postgres-integration（1 例）、game-concurrency（5 例）、verify:npc-simulation（建临时库跑 7 天模拟+7 断言）——本轮 NOT_RUN。**无真 PG 并发同 tick 租约用例**（grep 确认）。
- e2e：playwright 3 spec（auth-smoke / playable-loop / real-player-loop）存在，NOT_RUN。
- 源码断言型测试（架构防守）：item-architecture.test.ts、ai-layer-boundary.test.ts、game.service.test 的"禁绝对写"切片——存在且随本轮 server 运行通过。

## 5. AR-01—08 → 任务映射（验收要求）

| AR | 结论（本轮实测） | 对应任务 |
|---|---|---|
| AR-01 tick 互斥不完整 | 确认（saveProgress/releaseLease 无 owner 条件；pid ownerId；追赶不续租） | ARCH-02 |
| AR-02 资产写边界分散 | 确认（§3.1/3.2 三+四处入口；绝对 set 旁路存活） | ARCH-03 |
| AR-03 装备双真源 | 确认（§3.3，新角色仍写 legacy） | ARCH-04 |
| AR-04 读取/推进/叙事混合 | 确认（getSync 内结算+路由层离线简报串行等待；admin 读路径触发世界推进+种子） | ARCH-06 |
| AR-05 事实依赖中文文案 | 确认（战斗正则+教程正则） | ARCH-05 |
| AR-06 游标≠修订号 | 确认（stateVersion=事件id；客户端后写赢） | ARCH-07 |
| AR-07 模型接口/治理绑定对话 | 确认（createAiOrchestrator×5 实例化；AI_NPC_DIALOGUE_ENABLED 统辖全部用途；无统一预算准入） | ARCH-08 |
| AR-08 实例 scope | 确认（§3.6，且发现 map_instances 跨 scope 写入待裁决） | ARCH-02/06 |

## 6. 进入 ARCH-02 的前置状态

1. RF-01（shared 陈旧断言）需裁决修复方式；否则 `-r test` 无法作为整链绿灯证据。
2. RF-02：真 PG 环境必须可用（Docker），否则 ARCH-02 的 G01 验收天然 BLOCKED。
3. DEBT-022（map_instances.resourceCharges 所有者）与 R1/R2 裁决记录需独立审查确认（见 module-boundary-inventory.md §decisionLog）。
4. 本清单与 MOD-01 三交付物共同构成冻结基线；后续切片以 actual HEAD 重新核对，本文件不自动顺延。
