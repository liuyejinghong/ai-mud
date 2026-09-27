# FIX-A-REPORT — 修复批次 A 线（服务端）

- 分支：`fix/design-review-20260927-a`（worktree `/Users/ethan/Documents/yudian-fix-a`）
- 基线：`6450692`（未偏移；本报告时工作树含下述改动，未提交/未 push）
- 修复合同：`/Users/ethan/.yudian-review/runs/yudian-gdr-20260927-v102/FIX-PLAN.md`（D010-srv / D013-srv / D022-srv / D012-srv）
- 验证环境：本地独立 docker（compose project `yudian-fixa`，PG16 @127.0.0.1:5433）；tutorial 文件按其自身守卫要求跑在既有本地 `ai_mud_ci`（55432）。未触碰任何非本地环境。

## 一、根因定位（文件:行 以基线 6450692 为准）

### D010① 幽灵租约——租约 TTL 没有服务端释放
- `apps/server/src/modules/world-runtime/base.repository.ts`：`clearControlLease` 只在显式 `release`（base.service.ts heartbeat release）被调用；进程被杀/断网/断档后租约行**永久残留**。TTL（`lease_until`）只在 `requireActiveControl`（令牌持有者自证）与快照 `controlActive` 里被读，**没有任何服务端路径真正释放过期行**。久置会话的行以幽灵形态存在：接管覆盖它、快照诚实但推进闸门仍把它当"租约存在"参与确认边界计算。

### D010② 唤醒缺陷——推进闸门不随租约恢复（R06 核心症状）
- 闸门在 `base.repository.ts lockAdvanceableBases`：`confirmedEndMs = min(tickAt, lease.updatedAt, wallNow)`，到期清单 `listAdvanceableBaseIds` 谓词 `base_control_leases.updated_at > bases.last_advanced_at`（严格大于）。确认边界跟随的是**最后一次续租点（updated_at）**而不是租约有效性。
- `acquire` 路径（base.service.ts）：`settleConfirmedThrough`（幽灵租约 delta≈0 → 不结算）→ `alignClock` 把 `last_advanced_at := now`（丢弃断档，符合设计）→ 新租约 `updated_at := now`。**两者被推到同一时刻 → `updated_at > last_advanced_at` 恒假 → 到期清单永不含该基地**。此后唯一能再抬高 `updated_at` 的是 renew；一旦续租循环停摆（后台/失焦/节流——正是 R06 的环境），租约即使仍在 TTL 内有效，sim 也**永久冻结在 running 态**，没有任何服务端机制自愈。
- 「暂停/恢复」之所以能唤醒：`applyCommand` 在**同一事务内先刷新租约（updated_at=now）再结算**，把租约有效性一次性兑换成已确认时段——这正是玩家必须切 mode 才能恢复的原因。
- 修复语义：**有效租约本身就是服务端发出的前台凭证**——确认边界改为 `min(tickAt, wallNow)`（租约未过期时） / `min(tickAt, updated_at)`（过期后）；到期清单谓词改为 `lease_until > now OR updated_at > last_advanced_at`。acquire → 下个 tick 直接恢复推进，零 renew、零 mode 切换。L004（离开自动暂停）不受损：显式 release 立停；心跳断档在 TTL（120s）到点即停，过期租约只确认到 `updated_at`，断档不当生产时间。

### D010③ 接管静默 409
- `base.service.ts requireActiveControl`、`composition.ts requireLandingControl`、`base-session.routes.ts /base/clock` 无令牌分支：三处都抛/发裸 `CONTROL_EXPIRED`（`{code,message}`），前端无法区分"幽灵租约可接管收回"与"本会话心跳断档"。

### D013 事件无历史
- 无 base 事件表、无写入点、无读取端点（新增，见下）。

### D022 历史无时间戳
- `base_orders.created_at`/`base_purchases.created_at` 列存在、repo record 已带 `createdAt`，但 `economyRead` 端口与 snapshot DTO 未暴露。

### D012 初始倍速
- `base.service.ts provision` 创建默认 `speed: 1`。

## 二、改动清单

### 新增文件（均登记 `docs/architecture/module-boundaries.json`）
| 文件 | 说明 |
|---|---|
| `apps/server/drizzle/0040_base_events.sql` | 手写迁移：`base_events` 表（base_id FK / type / title / detail / sim_time / created_at）+ `(base_id, created_at DESC)` 索引。**未用 drizzle-kit generate**，journal `_journal.json` 手工追加 idx 39 |
| `apps/server/src/modules/world-runtime/base-event.repository.ts` | `base_events` 唯一写者（world）：`append`（调用方事务内）+ `listForBase`（created_at DESC, id DESC 稳定降序）。与 AssetMutationService 同模式：`(tx) => new BaseEventRepository(tx)` |
| `apps/server/src/application/base/base-events.ts` | 事件历史用例薄壳：鉴权同快照（账号作用域）、limit 钳制 1–200（缺省 100）、投影契约 DTO |
| `apps/server/src/app.base-lease-recovery.integration.test.ts` | D010/D013 真 PG 集成（composition 层，buildApp + 假 Date 时钟） |

### 修改文件（按主题）
**D010**
- `base.repository.ts`：`lockAdvanceableBases` 确认边界随租约有效性（有效→min(tick, wallNow)；过期→updated_at）；`listAdvanceableBaseIds` 谓词加 `lease_until > now` 分支；新增 `sweepExpiredLeases(tx, now)`（TTL 到期真正删除，返回行数）
- `app.ts`：世界 tick 的 isolated participants 追加 `leaseSweep`（每步结算后清扫过期租约行，保证"先结清最后确认时段、再释放"）
- `base.service.ts`：`BaseOperationError` 增加可选 `reason`；`requireActiveControl` 分类 `HEARTBEAT_STALE`（令牌匹配但过期）/`GHOST_LEASE`（无令牌/令牌不匹配，含幽灵残留）；快照输出 `effectiveRunning`/`pauseReason`（真实计算：`timeMode==='running' && leaseUntil > now`；running 且租约失效 → `pauseReason='foreground-required'`，玩家暂停 → null）
- `construction.service.ts`（该模块 `BaseOperationError` 增加可选 reason）+ `composition.ts requireLandingControl`：同样的 reason 分类
- `base-session.routes.ts`：错误响应透传 `reason`（`{error:{code,message,reason?}}`，shared `ApiErrorBody` 增可选字段）；`/base/clock` 无令牌分支带 `GHOST_LEASE`
- `packages/shared/src/base.ts`：`BasePauseReason`/`ControlFailureReason` 类型 + `BaseSnapshotDto.effectiveRunning/pauseReason` + `BaseEventDto`/`BaseEventsResponseDto`（契约 1/2 冻结形）
- `packages/shared/src/errors.ts`：`ApiErrorBody.error.reason?`

**D013**
- `landing-settlement.ts`：deps 增可选 `events` 写口（(tx)=>工厂）+ catalog 可选 `getItemInfo`；三个结算点同事务写事件——工程完工（`project.completed`）、采矿送达（`extraction.delivered`，与 markOutputDelivered+入库同事务，重放不触发）、制造工单完工（`manufacturing.completed`，与 saveLandingProgress(completed) 同事务）
- `base-settlement.service.ts`：legacy 工程完工结算点同事务写 `project.completed`
- `order.service.ts`：`deliverOrder` 在扣料/加钱/落状态/回执同一事务写 `order.delivered`（命令幂等回执保证重放不重复）；`EconomyCatalogPort` 增可选 `getItemInfo`
- `composition.ts`/`application/economy/usecases.ts`/`application/base/ports.ts`：绑定 events 工厂到 settlement/landing/economy；session deps 增 `events`；`BaseSessionRouteDeps.events`
- `base-session.routes.ts`：`GET /api/base/events?limit=100`（鉴权同快照，只读）
- `db/schema.ts`：`baseEvents` 表定义

**D022**
- `base.service.ts` economyRead 端口与 snapshot 映射：orders/purchases 暴露 `createdAt`（ISO）；`packages/shared/src/economy.ts` `BaseOrderDto`/`PurchaseOrderDto` 增 `createdAt`

**D012**
- `base.service.ts`：provision 默认 `speed: 2`

**运维必需连带（迁移 0040 的 FK 闭包后果）**
- `deploy/ops/reset-base-operations.sql`：守卫数组/LOCK 表/DELETE 清单补 `base_events`（否则 reset 会因未登记 base_* 表拒绝、且 DELETE bases 撞 FK）
- `docs/architecture/module-boundaries.json`：登记 3 个新文件

**测试（合法更新，逐条理由）**
| 文件 | 改动 | 理由 |
|---|---|---|
| `base.repository.test.ts` | fake 到期清单引擎适配新 OR 谓词（参数含墙钟）；due-list 参数断言更新；新增：有效租约 updated_at==last_advanced_at 也到期（唤醒）、sweep 只删过期行、过期租约确认到 updated_at 不外推 | 谓词变化是被测行为本身；新增两例即 D010②/① 的最小行为测试 |
| `base.service.test.ts` | provision 速度断言 1→2（D012 授权的行为变化）；快照全等断言补 `effectiveRunning/pauseReason`；新增：过期租约→foreground-required、玩家暂停→null、409 reason 分类（HEARTBEAT_STALE/GHOST_LEASE）、orders/purchases createdAt | D012/D010/D022 行为变化 + 契约字段存在性最小测试 |
| `base-settlement.service.test.ts` | makeHarness 增可选 events 参数；新增：完工同事务追加 `project.completed` 事件、未完工不写事件 | D013 结算点写入的最小行为测试 |
| `landing.integration.test.ts` / `landing-fix.integration.test.ts` / `independent-assignment.integration.test.ts` / `m12/base-construction.integration.test.ts` | ① 各 harness `advanceMinutes`/`provisionFreshAccount` 把基地钉回 `speed=1`（SQL UPDATE 或同句）；② settle 循环的 `settleBases` 时间参数固定为本轮起点 | D012 改默认倍速后这些文件验证的是"每基地分钟"机械语义，×1 才是断言口径（文件内原有注释"Δsim = 60s × speed 1"即此意图），非删断言凑绿。②是 D010② 的连带：有效租约确认到墙钟后，循环内每轮传新 `new Date()` 会让确认边界随真实时钟滴流推进（200/400 轮不收敛→超时）；固定终点即恢复"结清到终点即收敛"的原语义 |
| `reset-base-operations.integration.test.ts` | 表清单补 `base_events`；种子阶段按该文件既有"表生命周期探针"模式补一条事件行；settleOnce 时间参数固定 | schema 新表必须进 FK 闭包清单（该测试的守卫断言本身要求）；探针行是清单既有惯例；settle 固定同② |
| `landing.integration.test.ts` G08b | 用例超时 5s→60s（`{ timeout }`，与同文件 beforeAll 180_000 同口径） | 全量并行时最重制造链因 CPU 争用偶发超 5s（standalone ~400ms）；不放宽任何断言 |

## 三、测试运行结果（摘要原文）

1. `pnpm --filter @ai-mud/server typecheck` → **exit 0**
2. `node scripts/architecture/arch-check.mjs` → `UNCOVERED violations: 0 / RESULT: PASS`
3. `tsx scripts/verify-migrations.ts`（DATABASE_URL=5433 容器）→ `Migration verification passed in temporary database …`（0040 进链可用）
4. 全量 `pnpm --filter @ai-mud/server test`（DATABASE_URL=5433 容器）→ **Tests: 778 passed / 0 failed / 6 skipped**；唯一文件级失败 `tutorial.integration.test.ts` 为其**自身环境守卫**（要求 55432–55434 的 `ai_mud_ci`，本容器按任务要求用 5433）；该文件在 55432 `ai_mud_ci` 上单独运行 **6/6 passed**。基线（stash 后）同环境全量运行存在同一 tutorial 文件失败，其余全绿——即本批改动引入的失败已全部清零。
5. 新增集成 `app.base-lease-recovery.integration.test.ts`：3/3 passed（含：幽灵租约 tick 清扫、接管后零 renew/零 mode 切换 sim 恢复推进且增量=确认墙钟×2、断档段不确认、409 reason、快照契约字段、事件端点鉴权/降序/limit/字段/账号隔离）
6. `pnpm --filter @ai-mud/shared build` 随 typecheck 链通过。

未跑：E2E/真人浏览器（A 线范围外）；apps/web 未触碰、`packages/shared/src/version.ts` 未触碰、未 push。

## 四、契约符合性声明

1. **事件历史 API**：`GET /api/base/events?limit=100`，鉴权同其他 base 端点（会话 Cookie）；响应 `{ events: [{id,type,title,detail,simTime,createdAt}] }` 按 createdAt 降序（同刻 id DESC 稳定）；A 实现 server + shared DTO（`BaseEventDto`/`BaseEventsResponseDto`），未改既有字段语义。✔
2. **如实运行态字段**：`BaseSnapshotDto` 追加 `effectiveRunning: boolean`（= timeMode==='running' 且 `lease_until > now`）与 `pauseReason: 'foreground-required' | null`（running 且租约失效才有值），服务端真实计算，非透传 timeMode。✔
3. 迁移 **0040** 手写 SQL + meta journal 追加，未运行 drizzle-kit generate；`db:verify-migrations` 全链应用通过。✔
4. 错误响应 `{error:{code,message,reason?}}` 向后兼容（reason 可选，仅 CONTROL_EXPIRED 携带 `GHOST_LEASE`/`HEARTBEAT_STALE`）。✔

## 五、遗留风险与注记

1. **L004 数值边界微移**：心跳断档（如 kill -9）后基地不再"立即零推进"，而是确认到租约 TTL 上限——最坏多计入 ≤120s 墙钟（×1 下 ≤2 基地分，×4 下 ≤8 分）。R06 记录的杀进程宽限为"+≤1 基地分"，回归复验时此数值会放宽到 TTL 上限；这是"有效租约=前台凭证"语义的直接推论（12–24 分钟量级的断网/关页零推进结论不变）。若不可接受，后续可把有效租约确认边界从 `wallNow` 收紧为 `min(wallNow, updated_at + BASE_LEASE_HINT_MS)`。
2. **R06 现象的归因保留**：本批修掉了静态可证的三处闸门缺陷（TTL 不释放、acquire 后零确认推进、暂停/恢复独占唤醒）。R06 r02 会话"lease 刷新但冻结"的完整现场无法从黑盒证据完全复原（不排除当时前端心跳循环实际未续租）；修复后该表型的三条形成路径均被堵死，建议 Q 线按回归卡复验久置档登录一次点击恢复。
3. **前端契约缺口（B 线承接）**：`reason` 字段、`effectiveRunning/pauseReason`、`/base/events` 均已按冻结契约就绪；B 线未消费前，前端行为不变（字段缺失回退）。
4. **tutorial 全量运行的环境前置**：该文件要求本地 `ai_mud_ci`（55432–55434），与本批无关，属既有约定。
5. 测试容器：`yudian-fixa`（5433）与本次临时用过的 `yudian-fixa-ci`（未起成，已清理 compose 文件留存 /tmp）均在本地，可随时 `docker compose down`。跑测试遗留的 `ai_mud_vitest_*` 临时库已清理（我方 pid 命中的 9 个；dev 实例上更早遗留的 30 个非本批产物，未动）。
