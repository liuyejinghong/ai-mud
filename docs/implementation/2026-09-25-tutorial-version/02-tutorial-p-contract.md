# 六段教程版 P 合同

状态：**CONTRACT_READY / NOT_IMPLEMENTED**。合同版本 `tutorial-p/1`，基线 `main@deaf40a125f5a72b1885e6a359589b96a4549976`；PRODUCT_VERSION 1.0.1，schema/api/engine/ruleset/content/economy 为 32/49/3/18/15/5。作者 2026-09-26 已选择 [六段方案](01-six-stage-tutorial-proposal.md) §5 的三个推荐方向。本批只交付教程闭环，不包含生产部署、数据重置、像素化、天气/清尘新玩法或毕业后离线收益。

## 1. 玩家与数据合同

| 事实 | 冻结行为 |
|---|---|
| 时间 | 基地运行只累计服务端确认过的前台控制时段；失焦/隐藏停止续租，关页后不补算离线时段。手动暂停优先。突然关页以最后一次成功心跳为检查站，不承诺毫秒级关页时刻。 |
| 新档 | 创建日的 **08:00Z** 作为基地 simTime 初值（日期取服务端创建日 UTC，旧档 simTime 不改）；初始物资仍恰好够首工程，期初任务预算 1200 credits，只给新档；旧档资金不重写。开局来源文字写为着陆区拨付。默认天气按现有晴天事实，不承诺已接通尘暴日程。 |
| 采购 | 普通采购统一交期 20 基地分钟，自付款记录的 simTime 起算；既有在途采购的 `base_purchases.arrives_at_sim` 不重写。 |
| 订单 | 同一模板 open/accepted 不补单；delivered/failed 的 `base_orders.resolved_at` 起 24 基地小时后才可补，该已有列由结案代码写入 simTime，不用墙钟 `created_at`。历史 terminal 行若 resolved_at 缺失，不自动补单并报可观测异常。现有三张初始订单仍是有限真实需求。 |
| 首工程 | 同基地同 stableId 有任一非终态或 completed 时不再创建；cancelled/failed 可按正常材料规则重试。旧完工档也适用。旧在途模板/配方修订必须继续能结算。 |
| 协作 | 首次真实缺工请求保留 pending 给玩家选“跨组支援”或“等本组充电”，不在创建它的 tick 内自动接受/过期。候选、根因和选择后果取服务端事实；同一步 terminal 请求不反复重建。未选择时安全等待，自身恢复或超时结案。本批后续请求只走确定性 RULE；不在 tick 事务里调用外部模型。Jev 仅可在事务外作独立对照，不能代替玩家的首次选择。 |
| 引导 | 六段只由项目、机器人、资产、订单、采购和时钟的现有快照推导，跳过不限制正常命令；反馈使用命令回执和已提交快照，不增教程状态机/第二事件真相。 |

### 两路线共同样例

从创建档并关闭开场卡开始计真实时间；×4，晴天 08:00，单一账号/基地，同一 PostgreSQL 存档。首工程 40/60/80/20 工作点，物料 6/6/2/1/8；初始备件 30。新造一台驮运耗支架 4、备件 6、配电单元 1，补回首工程缺口费用 220。备件订单交付 10 件得 450；第二阵列材料现价 1410。预算守恒：先施工 `1200+450-1410=240`；先制造 `1200-220+450-1410=20`；隔离真 PG 探针已复核两条路线的账款和物料，工程验收时须在集成代码上重跑。

| 路线 | 必须证明 |
|---|---|
| 先施工 | 首工程中有可操作 pending；支援与等待各有真实进度差。**选择支援的推荐路线**自然并网 15→20 kW，交订单、付款、自然到货，30 真实分钟内第二阵列开工，30–45 分钟看见第二次投入效果；选择等待要显示实际较长代价，不伪称也满足 30 分钟。 |
| 先制造 | 新驮运真实产出并参与运输；经付费补回材料后首工程中也能看到等价协作选择。**选择支援的路线** 45 分钟内并网且第二阵列开工；选择等待另记实际耗时。不能靠无限同模板订单。 |
| 失败/恢复 | 缺料、余额不足、候选失效、重复 commandId、不同 payload 同 key、跨基地、项目取消、关页 ≥20 分钟后同档回访，均不得伪造进度或资产。 |

内容数值冻结：新档驮运 4 台各 **5,500Wh**；新造驮运 **1,000Wh**（配方新修订，旧 @1 保留）；首个 pending 的 TTL **12 基地分钟**，本组先恢复时可提前结案。隔离真 PG 探针在临时源码副本注入这些数值、20 基地分钟交期和 1200 credits：先施工支援第 20 分钟遇请求、第 58 分钟并网、第 79 分钟第二阵列可开工；先制造支援分别为第 43/76/97 分钟，新驮运第 30 分钟真实参与运输。等待分支首工程分别第 101/107 分钟，代价约 10.75/7.75 真实分钟。报告在 `/private/tmp/yudian-tutorial-pg-sim/probe-report.md`；其支援仍是旧 RULE 自动接受、等待是临时 abstain，**玩家按钮、旧修订和真实浏览器尚未验收**。若实现后真 PG 不达标，回 P 重算，不由各线私改初值。

## 2. 时间、事务与错误

现有 `base_control_leases.updated_at` 是服务端确认的最后前台活跃点，`lease_until` 是控制权期限；`bases.last_advanced_at` 是已结算活跃墙钟。每个 tick 只结算到 `min(tickAt, updatedAt)`，即使控制租约到期，也只补此前已确认的时段；单次 10 分钟上限只能推进到实际结算终点，不能丢弃余量。基地不再走“只推进 simTime 不生产”的旧世界追补分支。结算按基地独立事务，沿既有基地根锁与资源/项目写者。

一个前台标签通过 `acquire` 获得新随机控制 token；`renew` 只续 `updatedAt/leaseUntil`，不重置结算游标；`release` 在 token 匹配时结算到服务端收到的离开时点并结束控制。重新 `acquire` 先结清旧确认时段，再把游标对齐当前墙钟，断档不补。页面可见且获焦才续租，失焦/隐藏尽力 release；网络丢失仍以最后 renew 为截止。多标签由最近获焦者控制，旧 token 的迟到 renew/release/时钟命令返回 `CONTROL_EXPIRED`，不得改新租约。首次有效快照要在 acquire 成功后显示；快照 `heldByThisSession` 按 token 而非仅按到期时间计算，新增服务端 `controlActive` 区分手动暂停和其他标签正在控制。

公开 HTTP（均用现有账号会话、CSRF、base scope）：`POST /base/heartbeat` 接 `{action:"acquire"|"renew"|"release", controlToken?}`，acquire 返回新 token、leaseUntil、timeMode，renew/release 必须提交当前 token；`GET /base/snapshot` 和 `POST /base/clock` 带 `X-Base-Control-Token`。改变倍速前先按旧倍速结清旧活跃段；暂停前结清，恢复从当前墙钟开新段，不回补。只有有效控制者能执行时钟命令。现有基地事务用例负责装配 industry 结算参与接口，world 仓储不得直写行业/资产表。

协作公开命令：`POST /base/cooperation/:requestId/decision`，输入 `{action:"support"|"wait",commandId,expectedHelperOperatorId?}`；support 必须给快照上看到的候选 ID，wait 不需要。输出 `{requestId,status:"accepted"|"declined",helperOperatorId?,duplicate}`。应用层 `CooperationDecisionUseCase.execute(principal,input)` 在同一事务中只锁**基地行 → command_receipt**，再调用 industry 的 `decideFirstRequest(tx,baseId,input)` 锁其请求行，industry 经 npc 的事务参与端口锁定/条件分配机器人；总体锁序为基地 → 回执 → 请求 → 机器人，各模块只写自有事实。回执固定 `actorScope=base:<baseId>`、`commandKind=base.cooperation_decision`、`worldEpoch=当前基地 epoch`、`requestHash=hash({requestId,action,expectedHelperOperatorId??null})`。持基地锁后先按回执去重，再重验账号/基地、request pending、项目步骤仍缺本组可出工设备、候选异组 idle 且电量≥500Wh；support 记 accepted 和具名 helper 并经 npc 端口分配机器人，wait 记 declined 并让本组自然充电。请求状态或候选变化返回 `REVISION_EXPIRED`，跨基地按既有隐藏式权限错误；同 key 不同 payload 返回 `IDEMPOTENCY_CONFLICT`。不因客户端文本直接改电池或工程。

快照 `CooperationRequestDto` 增 `proposedHelper: {operatorId,groupId,batteryWh,batteryCapacityWh}|null`；它由 industry 只读端口 `previewPending(tx,baseId,requestId)` 经 npc 的机器人查询端口、复用命令的候选资格规则计算，I 装配到现有 `cooperationRead`，A 的 world 快照只消费投影，不复制规则。预览不预留设备。命令以 `expectedHelperOperatorId` 重验，过期时刷新而不悄悄换人。历史中的 `helperOperatorId` 仍指实际接手者。请求说明存创建时本组低电数量/阈值；本组恢复时 pending 结为 expired/`no_longer_needed`，需在新迁移扩展现有 resolution_reason 约束。等待/超时终态不得让同一步每 tick 重开。所有 pending 的 TTL 改为 **12 基地分钟**，不沿用当前 2 分钟常量。

共同合同样例：`{action:"support",commandId:"c1",expectedHelperOperatorId:"00000000-0000-4000-8000-000000000003"}` 在同基地 pending 且该候选仍 idle、≥500Wh 时接受并返回 `duplicate:false`；同一 `c1` 原样重发返回原结果且 `duplicate:true`，改为 wait 则 `IDEMPOTENCY_CONFLICT`。候选已出工或请求已取消时不换机器人，返回 `REVISION_EXPIRED`。新 release 下已有 `manufacture-yd-h1@1` 工单继续按 @1 产出 12,000Wh，但新创建的 @2 工单产出 1,000Wh；旧 release 基地的可创建列表仍是 @1。

## 3. 内容与旧档

保留已发布 `install-solar-array@1`、机器人模板 @1、`manufacture-yd-h1@1` 的定义不变。新 built-in release `yudian-base-tutorial-1` 给新基地的种子和 `manufacture-yd-h1@2`；运行目录必须能按在途工单保存的 revision 找回 @1，创建新工单只从基地当前 release 列表选模板。旧基地、不相关已发布 release 及在途义务不能被静默切成新模板。当前 `composition.ts` 固定默认目录且后台激活未接运行时；本轮接入已有 `loadReleaseCatalog`，按 `bases.content_release` 选择当前目录，旧 built-in 与新 built-in 都可读，未知 release 显式拒绝。新目录的归档读取支持已知旧 @1；激活其它 release 时若有在途项目/工单且目标目录不能解析其修订，拒绝激活，不伪装成功。

P 冻结的类型化端口：应用 `CatalogResolver.forBase(tx,baseId): Promise<ContentCatalogPort>` 只经 world 的只读 `getContentRelease(tx,baseId): Promise<string|null>` 查询取 releaseId，再交 content-catalog 的 `loadReleaseCatalog(tx,releaseId)`；快照和普通查询不得为此拿基地写锁。`forProvision()` 返回新 built-in。各服务在已有事务里按基地取目录，一次 tick 对同一基地只解析一次。目录 `getRecipeTemplate(stableId,revision?)` 无 revision 时只返当前可创建修订；带 revision 只用于旧在途结算/历史显示，未列在 `listRecipes()` 的旧修订不可新建。其他模板查找保持现有签名；不建全局服务定位器。默认设施文案去掉未实现的“定期巡检清理”承诺，天气功能留后续。

新档资金 DB default 需新增迁移（预计 `0037_tutorial_budget.sql`）及 schema 同步；不 UPDATE 旧钱包。采购间隔、订单冷却和内容/程序兼容版本由 I 在集成时按真实差异递增，PRODUCT_VERSION 留到实际发布决定。已执行迁移不得改。回退代码不会撤回已付货运、已完成项目或重写新档余额；一旦存在新 @2 工单，旧 `deaf40a` 二进制不能读该修订，**不可仅回滚到旧二进制**，须保留兼容读取的新代码或做前向修复。

## 4. 精确所有权与并发

P/I 为唯一共享写者；A–D 从同一 P 提交建独立 worktree、测试库/端口。未列路径先由 I 更新合同再改，不跨线自行扩权。

| 线 | 独占可写文件（含同名测试） | 交付 |
|---|---|---|
| A 时钟 | `apps/server/src/modules/world-runtime/base.repository.ts`、`base.service.ts`、`apps/server/src/modules/industry/base-settlement.service.ts`、`apps/server/src/application/base/base-clock.ts`、`base-snapshot.ts` | 已确认活跃段结算、控制 token、快照时间口径；不写前端与 shared |
| B 内容/经营 | `packages/content/src/base/default-release.ts`（旧模板/种子不改；只允许删除该文件未实现的清尘承诺）、新增教程 release 文件及 `packages/content/src/base/index.ts`；`apps/server/src/modules/content-catalog/catalog.service.ts`、`catalog-db.loader.ts`；`apps/server/src/modules/economy/order.service.ts`、`order.repository.ts`；`apps/server/src/modules/industry/construction.service.ts`、`industry.repository.ts`、`manufacturing.service.ts`、`manufacturing.settlement.ts` | 内容修订/旧工单解析、有限订单、基地行锁下首工程唯一 |
| C 协作 | `apps/server/src/modules/industry/cooperation.service.ts`、`cooperation.repository.ts` 及原有协作测试 | 首次 pending、候选重验与玩家选择、状态生命周期 |
| D 界面 | `apps/web/src/features/base/BaseApp.tsx`、`BaseShell.tsx`、`CooperationPanel.tsx`、`BaseIntroModal.tsx`、`ProjectBoard.tsx`、`baseApi.ts`、`base.css` 及同名测试 | 首屏目标、在操作处显示回执/结果、协作可操作、控制状态与最近事实 |
| P/I 共享 | `packages/shared/src/base.ts`、`decision.ts`、`economy.ts`、`errors.ts`、`version.ts`；`apps/server/src/db/schema.ts`、新迁移及 journal；`apps/server/src/application/base/composition.ts`、`ports.ts`、新增协作决策用例、`apps/server/src/application/economy/usecases.ts`、`apps/server/src/application/content-admin/usecases.ts`、`apps/server/src/modules/world-runtime/base-session.routes.ts`、新增协作路由、`apps/server/src/app.ts`；架构台账和 PR 文档 | DTO、路由装配、迁移、版本、真实连接，审查所需允许边 |
| Q 独立 | 新增 `apps/server/src/tests/base-operations/tutorial/*.integration.test.ts` 及独立浏览器验收记录 | 只在集成候选 HEAD 上判定，不改业务实现 |

## 5. 门槛

P：两路线数值、旧修订/时间/错误样例与文件归属审查后标 `CONTRACT_READY`；否则保持 DRAFT。A–D：先失败检查，再最小实现，逐线 typecheck/相关单测/真 PG，并交出 exact HEAD。I：同一 HEAD 跑全量 typecheck/test/build/arch、迁移后真 PG、两路线同档脚本；Q 独立重跑并用真实浏览器在 1200×701、720×450、200% 缩放检验当前视口目标和操作反馈、关页回访。真人盲玩与试玩服状态单独报告；没有这两类证据就不能写 `PLAYTEST_PASS` 或“线上已修”。
