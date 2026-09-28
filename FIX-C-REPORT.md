# FIX-C-REPORT — 功能实现：重开基地（删档重开）

- 分支：`fix/reset-base-20260928`（worktree `/Users/ethan/Documents/yudian-fix-c`）
- 基线：`44fccdc`（main，PR #38 合并点）；工作树含下述改动，**未提交、未 push**，未触 `packages/shared/src/version.ts`，未碰 VPS。
- 验证环境：本地独立 docker 容器 `yudian-fixc-pg`（PG16 @127.0.0.1:5437，全量集成）与 `yudian-fixc-pg-ci`（PG16 @127.0.0.1:55434，tutorial 文件按其自身守卫要求）。未复用他人容器/端口，未触碰任何非本地环境。

## Task Understanding

v1.0.3 的事件记录与落地玩法只覆盖新档（`contentRelease=yudian-landing-1`）；旧档（`yudian-base-0`）玩家需要一条**显式、带确认**的自选路径进入新体验。交付：账号作用域的"重开基地"命令——一个事务内删除自己旧基地的全部数据（FK 安全闭包），按注册同款 provision 流程重建新档（landing 内容、初始 ×2 倍速、新 baseId）；失败整体回滚（旧档不丢）；前端账户区入口 + 两步确认。

## Relevant Existing Design（复用优先，未重造）

- **provision 流程**（`apps/server/src/modules/world-runtime/base.service.ts`）：账号作用域收据（`base.provision`，`command_receipts` 表 claim/replay）→ 插 bases 行（paused、speed 2、landing seed）→ sites/电力/资源节点/物资/12 台设备+作业者。重开必须走同一写者，禁止复刻种子逻辑。
- **既有重置设施**（复用其口径，未改其文件）：
  - `deploy/ops/reset-base-operations.sql` + `docs/deployment/phase0-deploy-and-reset.md` 附录 A：**21 张基地实例表 FK 闭包清单**（含 PR #38 纳入的 `base_events`），子→父删除顺序，`command_receipts` 只删 `base:{baseId}` 作用域 + `account:{accountId}` 的 `base.provision`（"provision 收据必须删，否则同 commandId 重放会返回已删除的旧 baseId"）。
  - `apps/server/src/modules/world-reset/`：全服维护重置（admin 用），登记为 `infra_exception` 精确横切例外——按账号重开沿用同一登记口径。
- **命令模式**：会话 Cookie + CSRF（`x-csrf-token`）→ 路由 → application 用例薄壳 → 模块服务（事务内 + `BaseOperationError` 形状错误 + 幂等收据）。landing 写命令的控制租约门槛不适用于重开（账号作用域维护操作，服务端以 `getBaseForUpdate` 基地行锁与 tick/命令互斥）。

## Implementation

### 服务端（新增 4 文件 + 修改 4 文件）

| 文件 | 内容 |
|---|---|
| `apps/server/src/modules/world-reset/base-reset.repository.ts`（新增） | 按单个 baseId 删除 FK 闭包：`base_extraction_outputs`→jobs、`base_extraction_jobs`、`base_production_slots`、`base_resource_nodes`、`base_manufacturing_outputs`→jobs、`cooperation_requests`、`decision_records`、`base_project_steps`→projects、`base_projects`、`base_manufacturing_jobs`、`robot_operators`、`base_devices`（清掉 `provision:{accountId}:…` 来源行，避免重开撞唯一索引）、`base_inventory`、`base_power_state`、`base_weather_schedule`、`base_orders`、`base_purchases`、`base_control_leases`、`base_events`、`base_sites`、`bases`；再删收据（`base:{baseId}` 全部 + `base.provision`@account）。`base.resetBase` 收据不删（保留幂等重放，防旧 commandId 重放二次删档）。顺序与维护脚本一致（全部 FK 为 ON DELETE RESTRICT） |
| `apps/server/src/modules/world-reset/base-reset.service.ts`（新增） | 单事务编排：`base.resetBase` 收据 claim/replay（同 commandId 重放返回收据结果，不删档）→ `findBaseIdByAccount` → `getBaseForUpdate` 锁基地行（与 tick/命令同一把锁）→ 删闭包+删收据 → `provisionInTx`（同一事务内）→ `DrizzleAuditWriter` 写 `base.reset` 审计（metadata: previousBaseId/previousContentRelease/newBaseId/commandId）→ 落收据结果。任一步失败整体回滚 |
| `apps/server/src/application/base/reset-base.ts`（新增） | 用例薄壳（transport 只消费端口，同 `ProvisionBaseUseCase` 模式） |
| `apps/server/src/modules/world-reset/base-reset.service.test.ts`（新增） | 编排单测：先删后建顺序、收据幂等重放不删档、无基地拒绝、重建失败不落审计/收据 |
| `base.service.ts`（修改） | **唯一重构**：把 `provision` 事务体提取为公开 `seedProvisionedBase(tx, repo, principal, input)`；`provision` = transact 包装。重开经组合根绑定同一写者，"注册同款开局"只有一条实现路径。行为零变化（provision 全量回归通过） |
| `base-session.routes.ts`（修改） | `POST /base/reset`（鉴权/CSRF 同其他写命令；body `{commandId?}`，缺省服务端生成；跟随 `/base/*` 命名习惯） |
| `ports.ts`（修改） | `ResetBaseResultDto { baseId, duplicate }`、`ResetUseCase`、`BaseSessionRouteDeps.reset` |
| `composition.ts`（修改） | 装配 `BaseResetService`：`openDeleter: (tx) => new BaseResetRepository(tx)`（按事务构造）、`provisionInTx` 绑 `seedProvisionedBase`、`openAudit` 绑 `DrizzleAuditWriter`；`session.reset` |

### 前端（新增 2 文件 + 修改 5 文件）

| 文件 | 内容 |
|---|---|
| `apps/web/src/features/base/BaseResetControl.tsx`（新增） | 账户区入口按钮（`base`/`landing` 两种样式）+ 两步确认对话框。第一步列后果（全部进度/资源/工程/机器人永久删除无法恢复；账号与登录保留；从落地第一天重新开始）+「继续」；第二步才出现「**确认重开**」。commandId 在首次点确认时生成、失败重试复用同一 id（网络丢包时重放命中服务端收据，不会删两次档）。进行中禁用、Esc/取消可退（busy 中不可） |
| `BaseResetControl.test.tsx`（新增） | 7 例：确认前不可触发、两步各自可取消、成功关闭、busy 禁用防二击、失败保留对话框且重试同 commandId、Esc、disabled |
| `BaseShell.tsx` / `LandingShell.tsx`（修改） | 账户区（退出登录/退出旁）渲染入口；prop 可选，缺省不渲染（既有测试不受扰） |
| `BaseApp.tsx`（修改） | `handleResetBase`：调 API → 丢弃本地控制态（旧租约随旧基地删除）→ 清旧档反馈/选区 → `refreshSnapshot()`（既有 baseId 变化逻辑清空选区/完工横幅，`key={baseId}` 重挂 shell，新档首屏；旧档引导按新 baseId 重新出现） |
| `baseApi.ts`（修改） | `resetBase(csrfToken, commandId)` → `POST /base/reset`；结果类型沿用本地声明惯例（shared 未冻结该 DTO） |
| `base.css`（修改） | `.base-reset-*` 对话框样式 + `.base-secondary-button`（两 shell 均已 import base.css） |

### FK 闭包清单（21 表，与维护脚本互为镜像；集成测试独立抄录防静默缩水）

`bases`、`base_sites`、`base_control_leases`、`base_inventory`、`base_devices`、`robot_operators`、`base_power_state`、`base_projects`、`base_project_steps`、`base_manufacturing_jobs`、`base_manufacturing_outputs`(经 job)、`decision_records`(base_id 可空)、`cooperation_requests`、`base_weather_schedule`、`base_orders`、`base_purchases`、`base_resource_nodes`、`base_extraction_jobs`、`base_extraction_outputs`(经 job)、`base_production_slots`、`base_events`。

### 实施中发现并修复的真缺陷

初版把 `BaseResetRepository` 绑在根连接上，删除游离到重开事务**之外**逐条自动提交，并在 `DELETE FROM bases` 处与本事务的行锁形成循环等待（30s idle-in-transaction 被杀，回滚测试当场抓出"删了回不去"）。修复为 `(tx) => new BaseResetRepository(tx)` 事务绑定工厂（与 `BaseEventRepository`/`DrizzleAuditWriter` 同模式）。集成测试的回滚用例（重建阶段注入失败→逐表行数零变化）由此从"必失败"变为通过。

## Validation

| 命令 | 结果 |
|---|---|
| `pnpm install` | OK |
| `pnpm -r typecheck` | 0 error |
| `pnpm --filter @ai-mud/web test` | **38 文件 / 266 用例全过**（含新组件 7 例） |
| server 全量（无 DATABASE_URL） | 744 passed / **4 failed —— 基线既有失败**：`independent-assignment.integration.test.ts` 无 DATABASE_URL 时按其自身 `throw` 失败；已在干净 HEAD（`git stash` 后）复现同样 4 败，与本改动无关 |
| server 全量 + `DATABASE_URL=@5437` | **788 passed / 6 skipped / 1 failed**：唯一失败是 tutorial 文件自身守卫（"require ai_mud_ci on port 55432/3/4"） |
| tutorial（其守卫要求的端口，跑在我的 55434 容器） | **6/6 通过**（provision 重构的最重消费者回归） |
| `reset-account-base.integration.test.ts`（新增，真 PG） | **5/5 通过**：①旧闭包 21 表+探针行全空、新档与新号开局形态逐字段一致（×2 倍速/paused/12 设备/credits 0）、同 cookie 会话保留、`base.reset` 审计落库；②B 账号基地/探针/会话逐行不受影响且 B 可独立重开；③重建抛错→逐表行数零变化、收据/审计不落（原子回滚）；④同 commandId 重放返回收据不删档、换 id 再次重开（设备来源唯一键不冲突） |
| `reset-base-operations.integration.test.ts`（既有，回归） | 6/6 通过（维护脚本与 provision 流程未被重构破坏） |
| `m12/base-provision.integration.test.ts`（既有） | 通过（provision 幂等/并发回归） |
| `node scripts/architecture/arch-check.mjs` | **PASS**（files 384 全登记，UNCOVERED violations: 0） |

## 遗留风险

1. **并发命令窗口**：不持基地行锁的读改写路径（如有）在重开提交瞬间可能撞 FK RESTRICT 失败收场（其收据随事务回滚，无半态）。重开是玩家显式确认的低频操作，未为此加全命令租约门槛。
2. 重放语义：更旧的 reset commandId（被更新 commandId 覆盖后）重放会返回已不存在的 baseId——与 provision 收据同一性质的陈旧读，客户端仅作成功信号处理；如需更强语义需总控裁决（未擅自扩大范围）。
3. 服务器全量回归依赖两个本地容器（5437/55434，容器保留未删，可直接复跑）；CI 上的 DATABASE_URL 指向需按各文件自身守卫配置。
4. 未做浏览器端 E2E/真人验证（本环境无运行栈）；两步确认交互由组件测试覆盖。
