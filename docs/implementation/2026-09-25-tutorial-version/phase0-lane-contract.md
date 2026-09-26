# 第 0 阶段：完整性修复——车道合同（CONTRACT_READY）

日期：2026-09-25。基线：`main` @ `ae4d7fa`（v1.0.1 合入后；基线验证：`pnpm -r typecheck`、`pnpm -r test`（带隔离 PG，server 63 个测试文件）、`pnpm arch:check` 全部通过）。集成分支：`fix/phase0-integrity`。

依据：评审 `docs/reviews/base-operations/2026-09-25-design-review-v101/`（分支 `docs/design-review-20260925-v101`）的 B001、B005、B006、B008 与架构评审 ARCH-domain-01/02/03/08/11、ARCH-boundaries-01/02；回归卡 G112、G116、G117、G119。用户已确认：这些问题不管教程版怎么设计都要先修；B002（离开暂停时钟泄漏）随第 2 阶段“毕业后离线推进”模型一起改，本阶段不动租约/心跳语义。

## 1. 车道与文件所有权（同一文件只有一个写者）

| 车道 | 分支 / 工作树 | 目标 | 独占可写文件（含同目录新增测试文件） |
|---|---|---|---|
| A 结算 | `fix/p0-a-settlement` / `/tmp/yudian-dev/p0-a` | B001、B008 | `apps/server/src/modules/industry/base-settlement.service.ts`、`manufacturing.settlement.ts`、`manufacturing.repository.ts`、`industry.pure.ts`、`manufacturing.service.ts`（仅在必须时）、`apps/server/src/application/base/composition.ts`、`packages/content/src/base/schemas.ts`（仅单位语义/注释，如需改字段名须回报）、以上文件的同名 `*.test.ts`；新增 `apps/server/src/tests/base-operations/p0-integrity/*.integration.test.ts`（多基地真 PG） |
| B 协作 | `fix/p0-b-cooperation` / `/tmp/yudian-dev/p0-b` | B005 | `apps/server/src/modules/industry/cooperation.service.ts`、`cooperation.repository.ts`、`construction.service.ts`、`industry.repository.ts`（仅在必须时）、以上文件的同名 `*.test.ts` |
| C tick 编排与遗留 | `fix/p0-c-tick-legacy` / `/tmp/yudian-dev/p0-c` | 旧西幻世界移出基地 tick、下线世界重置、逐基地隔离结算、连接池/语句超时 | `apps/server/src/app.ts`、`apps/server/src/modules/world-runtime/world-runtime.service.ts`、`world-runtime.repository.ts`、`base.repository.ts`（仅 `lockAdvanceableBases` 等 tick 相关查询）、`apps/server/src/modules/world-reset/*`、`apps/server/src/modules/admin/admin.routes.ts`（仅世界重置路由）、`apps/server/src/config/env.ts`、`apps/server/src/db/client.ts`、`apps/web/src/features/game/ui/AdminShell.tsx`、`apps/web/src/features/admin/WorldResetAdmin.tsx` 及其测试、`apps/web/src/App.test.tsx`（仅世界重置相关断言）、`deploy/docker-compose.prod.yml`（仅新增环境变量）、根 `package.json` 中 `verify:npc-simulation` 脚本（如需带开关）、以上文件的同名测试 |
| D 前端退出 | `fix/p0-d-logout` / `/tmp/yudian-dev/p0-d` | B006 | `apps/web/src/features/base/BaseApp.tsx`（仅退出处理与登录表单状态）、登录表单组件文件、其同名测试 |

**禁止任何车道修改**：`packages/shared/src/version.ts` 及其测试、`docs/architecture/module-boundaries.json`、`module-catalog.json`、`legacy-boundary-debt.json`、`pnpm-lock.yaml`。新增文件与版本号由集成步骤统一登记与递增；车道在本地运行 `pnpm arch:check` 若只因“新文件未登记”失败，在交付说明里列出需登记的文件即可。

需要改动所有权以外的文件时：停下来，在交付说明里写明文件与理由，不要自行修改。

## 2. 各车道通过条件（开发侧，先写失败测试）

### A 结算（B001、B008）
- A1 制造结算按基地隔离：`settleBase(baseId)` 只结算该基地的工单；暂停或租约失效的基地，其工单在任何其他基地结算时都不推进、不扣料、不产出（新增真 PG 多基地测试：A 运行、B 暂停，B 的工单、库存、设备逐字段不变）。修正 `manufacturing.settlement.test.ts` 中标题为“多基地逐基地 FIFO 推进”但断言 `basesSettled=1` 的测试，使其真正断言多基地隔离。
- A2 产速与在线基地数无关：同一基地、同一 Δsim 下，结算结果与全服运行基地数（1、2、5）无关。
- A3 同基地多张工单按 FIFO 分摊该基地本子 tick 的制造能量预算，合计不超过预算（按 `m13-p-contract.md` 的制造负载合同）。
- A4 制造计入电力：制造取能从本基地储能扣减并计入负载（`lastLoadW` 或等价字段），与 `m13-p-contract.md:38-44` 一致；若合同与现有显示冲突，按合同实现并在交付说明里写明。
- A5 施工与耗电按模拟时长计量（B008）：工作量贡献与机器人耗电按子 tick 的模拟时长缩放，同一工序每基地分钟的增量与子 tick 切分方式、调用频率无关（纯规则测试：同一 Δsim 切成 1、4、10 个子 tick，结果相同，允许明示的取整规则）。
- A6 移除 `composition.ts` 中开工成功后在请求路径触发的**全服** `settleBases`；幂等重放（同一 commandId）不产生任何结算副作用（真 PG 或合同测试覆盖）。开工后首次进度变化最长约一个 tick 是预期行为。
- A7 既有测试全部保持通过（尤其 09-22 B001/B002 回归与 `review-p0.integration.test.ts`），或在交付说明里逐条说明为什么断言必须随合同改变。

### B 协作（B005）
- B1 取消项目时，同一项目下 pending/accepted 的协作请求在同一事务内结案（状态与结案原因写明，如 `cancelled`/`project_cancelled`），helper 被释放、可再次被选为候选。
- B2 项目因缺内容/阻塞而无法继续时，相关 accepted 请求不会永久停留；按现有状态机给出可测试的结案或回收规则。
- B3 快照/主屏计数只统计活动请求（取消后 ≤1 个结算 tick 内徽标消失）——若计数逻辑在前端或快照服务中而不在本车道文件内，写明需要的对接点，不越权修改。
- B4 单测覆盖取消、阻塞、helper 再次可选；如需真 PG，放在本车道新增测试文件。

### C tick 编排与遗留
- C1 旧西幻世界（旧 NPC 世界结算、旧副本资源刷新、post-tick 的旧 NPC 任务与传闻）默认不再作为基地 tick 的参与者运行；新增配置开关（如 `LEGACY_WORLD_ENABLED`，默认 false）保留启用能力；`verify:npc-simulation` 与相关测试在开关开启下仍可运行。代码与数据保留，不删除（A0 §5）。
- C2 世界重置：默认不注册 `POST /admin/world-reset`（或返回 410），管理台移除“世界重置”页签；开关开启时行为不变且不得把基地时钟设为 1970（至少把 `lastSettledAt` 设为当前 tick 对齐时刻）。
- C3 旧 `/game` 路由与旧 admin 接口按同一开关决定是否注册；基地、认证、管理台（非旧世界部分）不受影响。
- C4 逐基地隔离结算：一个基地结算抛错不影响其他基地与世界时钟推进（每基地独立事务或保存点），错误可观测（日志含 baseId）；`lockAdvanceableBases` 有确定顺序（ORDER BY）并避免持锁等待放大（SKIP LOCKED 或等价）。不改变租约/暂停语义。
- C5 数据库连接池与会话超时：连接获取超时、`statement_timeout`、`idle_in_transaction_session_timeout` 有合理默认值且可配置（env 校验）。
- C6 测试：注入某基地结算失败，其他基地照常推进；开关关闭时旧世界参与者不运行；开关开启时既有旧世界测试通过。

### D 前端退出（B006）
- D1 退出登录后，登录表单的邮箱与密码均为空，提交按钮禁用；切换“试玩注册/账号登录”页签不带回旧值。
- D2 组件测试覆盖“登录→退出→表单为空”。不改变引导重置（09-21 UX-02）等既有行为。

## 3. 每条车道的工作方式与交付

1. 在自己的工作树里工作，只改所有权内的文件；先写失败测试并确认失败，再实现。
2. 本地验证：`CI=true pnpm -r typecheck`；相关包测试；需要真 PG 的测试用 `DATABASE_URL="$AI_MUD_TEST_DATABASE_URL"`（变量指向隔离 PG 的测试库，测试框架会建随机临时库）；`git diff --check`。
3. 提交到本车道分支，提交信息为中文 conventional commit，逻辑改动附 `Constraint:`/`Rejected:`/`Directive:`/`Confidence:`/`Scope-risk:` 结构化尾注，末尾附 `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`。不推送。
4. 交付说明：改了什么、测试如何证明、未解决/越权需求、需登记的新文件、建议的版本号递增（ruleset/engine/api 等，由集成步骤执行）。

## 4. 集成与验收

- 集成者以已按 A→C→B→D 顺序提交的本地基线为起点，在公开 PR 分支 `codex/phase0-integrity` 上加入净化与集成修复提交；不直接发布原 `fix/phase0-integrity` 分支。登记新文件到架构台账，递增 `WORLD_COMPATIBILITY` 中受影响的子版本（`0036_phase0_integrity.sql` 增加协作结案原因、将积尘列改为 `double precision`→`schemaVersion`；结算语义变化→`rulesetVersion`；tick 编排变化→`engineVersion`；路由注册变化→`apiVersion`；不改 `PRODUCT_VERSION`，实际发布时再定），更新版本测试。
- E 的原本地提交含公网 IP；公开分支只纳入脱敏的最终文件，不带该提交的旧历史。
- 全量验证：`CI=true pnpm -r typecheck`、`CI=true pnpm -r test`（带 `DATABASE_URL`）、`pnpm -r lint`、`pnpm -r build`、`pnpm arch:check`、`pnpm arch:test`、`pnpm db:migrate && CI=true pnpm test:postgres`、`pnpm verify:npc-simulation`（开关开启）、`git diff --check`。
- 独立验证者（不参与实现）重跑验证并逐条核对本合同通过条件。
- 通过后推送 `codex/phase0-integrity`、开 PR 到 `main`；CI 绿后仍需按 `AGENTS.md` 获得合并授权。**不部署**：线上部署另行授权。此前会话的上线手册已记录内测基地数据重置的选择（原始授权待上线前核对）；本轮开发不执行重置，具体范围见 `docs/deployment/phase0-deploy-and-reset.md`。

## 5. 回退

原 A—D 车道提交可供定位，但公开分支还含净化与集成修复，不能假设可按 D→B→C→A 机械逆序回退；应按最终 PR 差异与依赖确定回退。`0036_phase0_integrity.sql` 已应用时，仅回退代码不会还原 schema，须按上线手册 §8 处理。C 的开关默认关闭旧世界；若只需恢复旧世界 tick，可设置开关，无需回退代码。
