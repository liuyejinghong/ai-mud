# ARCH-02 交付记录：世界事务互斥与时间所有权

- 任务：v0.11.0 / ARCH-02（architecture-baseline.md §C）+ MOD-03（ARCH-02 行）
- 分支：`arch/v0.11.0-arch02-world-mutex`；基线 main `1a4009d`
- 日期：2026-09-18。玩法规则数值零改动（60 秒步长、工资/产量节奏不变）；产品版本保持 0.10.6。

## 1. 核心变更：租约 → 事务级行锁

旧模型（AR-01 缺口）：55 秒租约 + `acquireLease/saveProgress/releaseLease`，后两者的 WHERE 只有 key 不含 ownerId——旧持有者可覆盖新持有者进度、释放他人租约；追赶期间租约不续期；ownerId 为 `server-${process.pid}` 跨容器不唯一。

新模型：**每个 tick 一个短事务，事务第一步 `SELECT … FOR UPDATE` 锁定 world_runtime_state 行**，锁后重读最新进度 → 推进一分钟 → 参与方结算 → 保存进度 → 提交。锁随事务结束释放；进度只在锁内重读后推进，结构上不可能倒退或重复结算；并发第二调用者要么排队（随后看到新进度）要么无事可做跳过。旧租约权威路径全部删除（`acquireLease/releaseLease/含 lease 字段的 saveProgress` 不复存在）；lease 两列留在 schema，兼容迁移（含管理面板字段置空）另写迁移，符合任务书"不改旧 SQL"。

## 2. 时间所有权与生命周期（任务书 1/3/4 条）

- **Clock 注入**：新增 `world-clock.ts`（`WorldClock` 接口 + `systemWorldClock`）；服务默认从注入时钟取真实时间，tick 一律以参数 `tickAt` 传递历史时间；测试注入固定时钟。
- **启动建行**：`ensureRow`（幂等）在 buildApp 预检 + 每次 settleDue 防御性补建。
- **统一入口**：timer、`GET /game/state`、管理面板仍共用唯一 `settleDue`；post-tick 仅在真实推进（settledSteps>0）后触发且不在数据库事务内——行为保持。
- **生命周期**：`worldRuntime.idle()` 加入 onClose——顺序为停计时器 → 等待有界在途结算/后处理 → 关闭连接。

## 3. 参与方（MOD-03：npc 结算参与 API + application 协调）

tick 事务内的结算逻辑显式化为 `WorldTickParticipant` 列表，由 composition 装配：

1. **npc 结算参与方**：`NpcService.settleNpcWorld(tickAt)` 绑定事务句柄（与旧行为一致）；
2. **角色侧副本日刷参与方**（**DEBT-022 兑现**）：`GameRepository.refreshDueInstanceResources({now})`——个人副本资源日刷从 npc 模块直写改为角色侧持久层执行，世界 tick 仅触发。删除 `NpcRepository.updateMapResourceCharges` 及 `NpcService.refreshDailyResources` 的 maps 段；世界共享资源节点刷新留在原处（DEBT-025 未动，仍按台账保留）。

## 4. 仿真设施出生产图（DEBT-015 兑现）

`NpcService.runNpcSimulation`（克隆世界入口）移出服务；新增 `runNpcSimulationOnSnapshot(liveRepo, days, startAt)`（仿真仓储文件内）；生产 `NpcService` 不再 import 仿真仓储。调用方（verify 脚本、`POST /admin/npcs/simulate`）改经助手。`runNpcSimulationInPlace` 保留（仅依赖自身仓储端口）。

## 5. 验收证据（G01，全部真实 PostgreSQL 故障注入，无租约睡眠）

新增 `src/db/world-runtime.integration.test.ts`（已纳入 `pnpm test:postgres`），5 例：

1. **同 tick 竞争唯一结算**：两个独立连接并发 `settleDue`，计数表每 tick 恰好 n=1，进度=tick；
2. **故障注入回滚**：参与方在 tick 1 抛错 → 整事务回滚、进度不动；解除注入后下一调用者补结算同一 tick 恰好一次；
3. **进度不倒退/旧 tick 不重复**：重放更早墙钟 → skipped；计数全部为 1；
4. **追赶等价**：3 个欠账 tick 一次批量 vs 三次逐分钟，最终世界状态（铜币合计/饥饿分布/动作数/完成数/交易数）完全一致；
5. **DEBT-022 组合**：副本资源耗尽 + 2 天未刷新 → 一次 tick 后经角色侧参与方恰好恢复一次，`resources_refreshed_at` = tick 时间。

回归：`pnpm -r typecheck` PASS；`CI=true pnpm -r test` 597 例全绿（含重写的 world-runtime 内存套件 6 例与调整后的 npc 仿真用例）；`pnpm db:verify-migrations` PASS；`pnpm test:postgres` 11/11 PASS；`pnpm verify:npc-simulation` PASS（ok:true、账本零偏差、闲置率 0）；`pnpm arch:check` PASS 且两次报告逐字节一致；`pnpm arch:test` 12/12。

## 6. 台账与归属变化

- `legacy-boundary-debt.json`：**DEBT-015、DEBT-022 销账**（removalCondition 达成）；新增 DEBT-040（新真库测试的跨模块夹具登记，与 DEBT-029 同类）。40 → 39 条。
- `module-boundaries.json`：新增 `world-clock.ts`（world/platform）与 `world-runtime.integration.test.ts`（world/test）登记；216 文件。
- DEBT-025（资源节点写入归 world）本切片未动，按台账保留，建议随 ARCH-03 的参与方 API 一并处理；lease 两列的 schema 迁移与共享 DTO 字段清理列入 ARCH-09 前的兼容迁移窗口。

## 7. 未做 / 后续

- 不改 NPC 产量/工资节奏（任务书明确）；
- 无 WebSocket、无新玩法、无多副本生产声明（行锁保证正确性，不等于宣称支持任意副本数的容量）；
- `GET /admin/world-runtime` 的 `leaseOwner/leaseUntil` 恒为 null（DTO 字段兼容保留至迁移）。
