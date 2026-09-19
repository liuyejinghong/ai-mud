# M12-P：v0.12.0 接口包冻结

状态：CONTRACT_READY（本文件由主代理在 v0.12.0-base-operations 分支冻结；A0-04 §4 九项修正已落实，落实对照见 §8）。
基线：main `46d91b9` + A0 修正 `2993385` + P 提交。

## 1. 已冻结的公共面

| 产物 | 文件 | 内容 |
|---|---|---|
| 公共协议 | `packages/shared/src/base.ts` | 全部基地 DTO/枚举/常量；W/Wh 整数定点；sol=24h，昼间 06:00—18:00（Q-06 冻结）；Q-01 纯储能过夜 |
| 错误分类 | `packages/shared/src/errors.ts` | 新增 8 码：BASE_SCOPE_INVALID、REVISION_EXPIRED、CONTENT_INCOMPATIBLE、RESOURCE_INSUFFICIENT、SITE_OCCUPIED、REQUIREMENTS_NOT_MET、BUDGET_EXCEEDED、IDEMPOTENCY_CONFLICT |
| 数据契约 | `apps/server/src/db/schema.ts` + `drizzle/0029_base_operations.sql` | 9 张新表（bases/base_sites/base_control_leases=world；base_inventory/base_devices=assets；robot_operators=npc；base_power_state/base_projects/base_project_steps=industry） |
| 用例端口 | `apps/server/src/application/base/ports.ts` | ContentCatalogPort、BaseAssetPort、RobotFactoryPort（事务绑定）+ 五个路由用例接口 + 路由依赖 |
| 装配开关 | `apps/server/src/config/env.ts` | `PLAYTEST_REGISTRATION_ENABLED`（默认 false；正式部署必须显式 true 才开放试玩注册） |
| 台账 | module-catalog.json / module-boundaries.json | industry、content-catalog 两模块 + 全部新文件登记（arch:check/arch:test 已绿） |

## 2. 各线接口与文件边界（严格按 boundaries 台账；测试文件名不得自改）

- **M12-A（world 基地子域 + 注册/快照/时钟）**：`world-runtime/base.service.ts`、`base.repository.ts`、`base-session.routes.ts`（路由无默认依赖，deps 必填，见 ports.ts `BaseSessionRouteDeps`）+ `application/base/provision-base.ts`、`base-snapshot.ts`、`base-clock.ts`。测试：`base.service.test.ts`、`base.repository.test.ts`。Provision 通过 `BaseAssetPort`/`RobotFactoryPort`/`ContentCatalogPort` 端口完成种子（设备/物料/电力行不直写他模块表）。
- **M12-B（industry + 作业者）**：`industry/construction.service.ts`、`industry.repository.ts`、`base-settlement.service.ts`、`industry.pure.ts`、`base-projects.routes.ts`（`BaseProjectsRouteDeps`）+ `application/base/create-project.ts`、`cancel-project.ts` + `npc/robot-factory.ts`、`robot-runtime.ts`。测试：construction/settlement/pure/robot-factory/robot-runtime 五个 `.test.ts`。物料预留/消耗只经 `BaseAssetPort`；作业者状态只经 robot-runtime（npc 写）。
- **M12-C（客户端）**：`apps/web/src/features/base/` 六个组件 + `baseApi.ts`。数据只来自 `BaseSnapshotDto` 与端口返回；CSRF/credentials 模式照抄 `features/game/gameApi.ts`。不做任何业务计算，展示即事实。
- **M12-D（内容）**：`packages/content/src/base/`（schemas/default-release/index barrel + `content/src/index.ts` 加一行导出）+ `content-catalog/catalog.service.ts`、`bootstrap-release.ts`。release 数据按 §4 fixture；catalog.service 实现 `ContentCatalogPort`。
- **M12-Q**：`apps/server/src/tests/base-operations/m12/` 三个测试文件；runner 已由 server vitest 默认 include 收编。
- **M12-I（主代理）**：`app.ts` 装配（di.baseUseCases 绑定、base tick participant、两路由注册）、`AuthPage` 试玩模式入口切换、`version.ts` 0.12.0、composition 绑定真实端口。

## 3. 冻结的运行语义（各线不得自行放宽）

1. **基地时钟**：复用 `world_runtime_state` 每分钟 tick（`settleDue` 参与者数组追加基地结算）；每基地一行 `bases`，`SELECT … FOR UPDATE` 后：`timeMode='running'` 且 `base_control_leases.leaseUntil > now` 才推进，`Δsim = Δwall × speed`（Δwall = `now - lastAdvancedAt`，上限 `BASE_MAX_CATCHUP_MS`）；暂停/未租约推进 0（天然无补算）。推进后 `lastAdvancedAt=now`、`simTime+=Δsim`。resume 命令同时把 `lastAdvancedAt=now`。
2. **供能规则**（industry.pure，纯函数）：昼间（simTime 小时 ∈ [6,18)）发电 = `Σ 设施 generationWPeak × 0.9`（积尘系数，fixture），夜间 0；负载优先级 基础 1000W < 施工 2000W（存在 running 的 site_clearing/installation 步骤时）< 充电；盈余入储能（效率 1.0），不足放储能，储能尽 → 施工步骤 `blocked_reason='insufficient_power'`（工作量不推进，绝不 clamp 完成），机器人转 charging 等待。每 tick Δh = Δsim/3600。
3. **工作量**：running 步骤由其 `group_id` 组内 `working` 状态机器人各出 `workRatePerTick`；机器人 working 时每 tick 耗电 `ROBOT_WORK_DRAIN_WH=500`（fixture，纯规则常量），电池尽转 idle。步骤完成 → 下一步 ready；`commissioning` 完成 → 项目 completed、site → built、`base_power_state.generationWPeak += outputFacility.generationWPeak`（同事务）。
4. **物料**：createProject 同事务对全部 inputs `reserveBaseInventoryIfAvailable`，任一不足整体回滚（RESOURCE_INSUFFICIENT）；步骤开工消耗该步预留份额（v0.12 简化：创建即全额预留，取消按未消耗全退——释放数额 = `reservedInputs` 剩余）；`base_projects.reserved_inputs` 记账。
5. **幂等**：复用 `command_receipts`。provision：`actorScope=account:{id}`，`commandKind='base.provision'`（账号作用域收据，A0-04 附注 i——不套用含 baseId 的 CommandId 格式）；createProject/cancel：`actorScope=base:{id}`。命中收据：requestHash 一致 → 原样重放，不一致 → IDEMPOTENCY_CONFLICT。
6. **设备↔作业者 1:1**：`base_devices.source_operation + device_def_id` 唯一索引兜底；`robot_operators.device_id` 唯一。provision 幂等重放时不再补建设备/作业者。
7. **租约**：heartbeat 刷新 `leaseUntil = now + BASE_LEASE_TTL_MS`；`resume` 必须携带合法会话且把租约一并续上；pause 不清除租约只改 timeMode。控制租期事实写者 = world.base（A0-04 附注 ii）。

## 4. fixture 数值（Q-09 冻结；全部"游戏初值"，写进 D 的 default-release 与 pure 常量）

- 初始阵列 15000W（×0.9 积尘 = 13500W 昼间）；储能容量 200000Wh，期初 100000Wh；基础负荷 1000W。
- 模板：YD-H1 驮运（transport，20000Wh，充电 4000W，work 1/tick）×4；YD-E1 筑垒（engineering，30000Wh，6000W，1）×5；YD-S1 望山（survey，10000Wh，2000W，1）×3。期初电量 60%。
- 首项目 `install-solar-array`（install_solar_array v1）：步骤 清场 engineering 40 → 运输 transport 60 → 安装 engineering 80 → 验收 survey 20；inputs：solar_panel_set×6、support_frame×6、cable×2、power_box×1、anchor×8；产出设施 solar_array_unit 5000W。
- 站点：array（built）、storage（built）、warehouse（built）、maintenance（built）、charging（built）、site_a（free，首工程位）。
- 物资种子：上列 inputs 各一份 + spare_parts×30。

## 5. 样例

- S1 注册后 provision 中断重试 → 同 account 收据重放，同 baseId，物资不重复。
- S2 账号 A 请求账号 B 的 baseId → BASE_SCOPE_INVALID（403），不泄漏存在性。
- S3 anchor 不足时 createProject → RESOURCE_INSUFFICIENT，事务回滚无悬挂预留。
- S4 旧 revision 的 createProject → CONTENT_INCOMPATIBLE，不 fallback latest。
- S5 暂停期间快照 simTime 不变；resume 后 lastAdvancedAt=now，不补暂停期。

## 6. mock 规则

A 在 B/D 交付前可用接口替身开发（PARTIAL_MOCK 标注于交接），最终集成以真实实现为准；Q 只认真实链。禁止为对齐 mock 改 shared 类型——类型变更必须回 P 握手。

跨线接缝一律走 ports.ts（P.1 扩展）：B 结算消费 `BaseClockStorePort`/`BaseSiteStorePort`（world 提供，A 实现）；A 快照消费 `BaseIndustryReadPort`/`BaseRobotReadPort`（B 实现）与 `BaseAssetPort.listBaseInventory`；A provision 消费 `BaseIndustryInitPort`（B 实现，电力行种子）；结算的 simTime 推进政策（running+租约+追补上限）封装在 `BaseClockStorePort.lockAdvanceableBases` 实现内。

REST 面（路由线实现，C 消费，全部 json）：
- `POST /base/playtest-register` `{email,password}` → 201 `{user:{accountId,email}, baseId, csrfToken}` + 会话 cookie（仅 PLAYTEST_REGISTRATION_ENABLED 开放）
- `POST /base/provision` → `{baseId, duplicate}`（幂等，登录后调用）
- `GET /base/snapshot` → `BaseSnapshotDto`
- `POST /base/heartbeat` → `{leaseUntil, timeMode}`（csrf）
- `POST /base/clock` `{command:pause|resume|set_speed, speed?}` → `{timeMode, speed, simTime}`（csrf）
- `POST /base/projects` `{definitionRef, siteId, commandId?}` → `{projectId, duplicate}`（csrf）
- `POST /base/projects/:projectId/cancel` `{commandId?}` → `CancelProjectResultDto`（csrf）

## 7. 提交与验证

每线：失败测试 → 最小实现 → 自线测试绿；不改他线文件；不跑 git。集成（I）在分支 HEAD 上统一跑 typecheck + arch:check + arch:test + pnpm test + test:postgres。

## 8. A0-04 九项修正落实对照

1. 迁移目录 `apps/server/drizzle/` ✅（ownership.json 已改）
2. `packages/content/src/index.ts` barrel → M12-D 白名单 ✅（本文件 §2）
3. .env 样例/README/debt 台账/检查器 → P/I 单写 ✅（env.ts 本轮；README 与样例说明随 I）
4. web session 与 C 目录互斥 ✅（baseApi 在 features/base 内，gameApi 不动）
5. provisioning 账号作用域收据 ✅（§3.5）；控制租期写者=world.base ✅（§3.7）；基地 tick 落点=industry/base-settlement.service.ts ✅（boundaries 已登记）
6. 能力注册表归属：v0.12 校验在 content/base/schemas.ts（纯层）内完成；M13-P 落 catalog 时再定注册表模块
7. getBaseSnapshot 装配者=application/base-snapshot.ts（world.base 仅为组成提供方）✅（§2）
8. A0-01 Q3/Q4/Q8 追溯：Q3 未触发（ACP-B01 无 quests/game/dialogue 边）；Q4 双时钟并存+旧世界隔离（v0.12 spec §3 I）；Q8 0.11.1 发版时点留用户
9. 残留临时库清理：待用户显式授权，不混入 M12 提交
