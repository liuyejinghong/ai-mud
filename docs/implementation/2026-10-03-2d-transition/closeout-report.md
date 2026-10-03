# 旧文字路线收尾执行报告

日期：2026-10-03。基线查验时间：2026-10-03T10:57:13Z。执行依据：[00-old-route-closeout.md](00-old-route-closeout.md) 与 [02-closeout-agent-prompt.md](02-closeout-agent-prompt.md) §三.D。

**边界（先读）**：本报告只是旧文字路线（2026-10-01 M1–M4 排期）的收尾交接记录。本轮**未合并 PR #41、未部署、未进入 G1、未安装引擎或任何依赖、未修改源码／依赖／配置／锁文件／版本／迁移／数据库**；未删除旧档、测试、迁移、内容包或审计证据。结论 `CLOSED_AS_PLAN` 仅表示旧排期交接完成，不表示游戏好玩、旧缺陷清零、所有建议已实现。

## 1. 现场基线与进行中工作归属

| 项 | 值 |
|---|---|
| 仓库 | `liuyejinghong/ai-mud` |
| 本地分支 | `docs/external-playability-review-20261003` |
| 本地 HEAD | `620e195f`（"docs: retire old M1-M4 default schedule and link closeout handoff"） |
| origin/main | `c6bd33e`（Merge PR #40 docs/playability-roadmap-20261001） |
| PR #41 | **OPEN，未合并**；head `620e195f` |
| 已部署版本 | 据基线快照 `e13910a`（PR #39 合并提交，`PRODUCT_VERSION = "1.0.4"`）；**生产实际行为 NOT_ACCESSIBLE**（本轮无生产读取通道，不把任何 HEAD 当已部署验证） |
| 当前检出源码版本 | `packages/shared/src/version.ts:1` → `1.0.4`（AGENTS.md 所记 2026-09-19 基线 `0.11.0` 已过时，不作当前结论） |
| 工作树 | 主工作树在 `620e195`；3 个 prunable（`/private/tmp/yudian-*`，本轮不 prune）；其余为归档检查出与评审机 worktree（清单见基线快照，未改动） |
| 未提交改动 | 文档 7 文件 +14 行（见 §4，属本收尾批）；另有 43 个未跟踪「 2」文件——归属＝本机 Finder 复制残留（`review-remediation-20260925/evidence/*.png 2` 等），非进行中开发，保留原样 |

版本区分：**源码版本**＝1.0.4 @ `620e195`（文档分支，含本批未提交文档改动）；**文档版本**＝PR #41（open）；**已部署**＝`e13910a`（快照记录，未实地核验）。历史历史读取锚点 main `c6bd33e` 仅为溯源，不据此重写需求。

## 2. 问题处置矩阵（逐项：处置／现场事实／证据或继承依据／未知项）

状态语义照 [00-old-route-closeout.md](00-old-route-closeout.md) §2 六状态执行。本轮**无一行使用 `VERIFIED_FIXED`**：各行对象为跨版本不变量或未实现项，无「单点修复＋本轮独立验证」可指认；两个 PROTECT 行的历史绿灯均如实标注为继承依据而非本轮验证。行序同 00 §3。

**行号基准**：对 `2026-10-01-playability-roadmap/01–06` 的引用一律按本批插入 2 行历史横幅后的**当前工作树行号**计（HEAD `620e195` 未加横幅版行号＝本文所引行号−2）；其余被引文件未被本批改动，行号与 HEAD `620e195` 一致。01–06 与评审报告的全部被引原文已逐条 `grep -n` 按此基准复核（§4.2）。

### 1｜账本诚实、库存预留、原子结算、命令幂等、账号／基地隔离

- **处置**：PROTECT（沿用 00 文件建议；现场无矛盾事实）。
- **现场事实**：实现齐全，本轮 targeted 回归可跑通。copper 流水唯一写者 `LedgerService.recordCopperTransfer`（整数化、只记正额），`getHealth` 对账 expected（流水净额）vs actual（四桶余额），drift≠0 报 `drift_detected`。`AssetMutationService` 头注释明确「Assets 是 copper 余额／市场库存／金库／托管唯一写者，必须在调用方事务内调用」；`debitXxxIfAvailable` 用 `col - amount WHERE col >= amount` 条件更新防超扣，`reserveNpcCopper`／`debitMarketStockAboveReserve` 实现预留语义；命令幂等走 `command_receipts`：`findReceiptForUpdate` 用 `SELECT … FOR UPDATE`，`claimReceipt` 按 `(actor_scope,command_kind,command_id,world_epoch)` 冲突不插入、重放返回既有 result。库存预留：`BaseAssetService`「预留≠消耗，可用量=quantity−reserved_quantity」条件更新 reserve/consume/release/consumeIfAvailable。原子结算：`manufacturing.settlement.ts` 头注释明确在调用方事务内执行、永不自开事务，`(job_id,ordinal)` 唯一索引兜底重复产出不重复扣料；`base-settlement.service.ts` settleBases 在 world tick 事务内逐基地结算，B001 注明暂停／离线基地不推进不扣料。隔离：`bases.account_id UNIQUE`＋`credits>=0 CHECK`，`getBaseByAccount` 单账号单基地，越界抛 `BASE_SCOPE_INVALID`；删档重开为单事务 FK 闭包删除＋同事务重建、失败整体回滚（本轮未对真实数据调用）。
- **证据／继承依据**：`apps/server/src/modules/ledger/asset-mutation.service.ts:13-15`（单写者约定）、`:82-119`（条件更新扣减/预留）、`:189-249`（FOR UPDATE 收据+claimReceipt 幂等）；`apps/server/src/modules/ledger/base-asset.service.ts:29-90`；`apps/server/src/modules/industry/manufacturing.settlement.ts:1-22`、`apps/server/src/modules/industry/base-settlement.service.ts:1-12`；`apps/server/src/db/schema.ts:862-886`、`apps/server/src/modules/world-runtime/base.repository.ts:204`、`apps/server/src/modules/ledger/ledger.service.ts:76-123`；`docs/implementation/2026-09-19-base-operations/review-remediation-20260927/README.md`（D010 根因与修复、778 passed 记录）；PR #38（MERGED，44fccdc，v1.0.3）／PR #39（MERGED，e13910a，v1.0.4）验收记录（gh pr view）——历史绿灯。本轮实跑（核查员执行）：单元 5 文件 49 passed＋真 PG 集成 4 文件 17 passed（命令见 §4）。
- **未知项**：已部署／生产行为 NOT_ACCESSIBLE；全量套件（server ~778、web 267）及 db/postgres-integration、db/world-runtime.integration、app.world-tick.integration、reset-base-operations 等 NOT_RUN（本轮仅上述 66 例 targeted）；PR #38/#39 引用的 Q-ACCEPTANCE／评审报告包实体 NOT_ACCESSIBLE（评审机 `~/.yudian-review/runs/`，未入库）；CI 历史与本分支关系 UNKNOWN（未调取 Actions 清单；历史 CI 按定义不覆盖本收尾分支与 2D 新玩法）；AGENTS.md 所述「BaseId 与 CharacterId 分开」未找到独立品牌类型定义（`grep packages/shared/src` 无显式类型），实际隔离机制为分表＋account_id UNIQUE＋每基地事务作用域，对应关系未深查。

### 2｜时钟／租约、离开暂停、存档与重开隔离

- **处置**：PROTECT（沿用 00 文件建议；现场无矛盾事实）。
- **现场事实**：服务端语义与代码注释一致。`BASE_LEASE_TTL_MS=120_000`、`BASE_MAX_CATCHUP_MS=10 分钟`；租约有效性以服务端墙钟判定（`lease.leaseUntil > now`），快照如实携带 `effectiveRunning=timeMode==='running' && leaseValid`、失效时 `pauseReason='foreground-required'`（不谎报运行中）；acquire/renew/release 与 `requireActiveControl` 返回 `GHOST_LEASE`／`HEARTBEAT_STALE` 机器可读原因。`lockAdvanceableBases` 只取 running 且有租约的基地，有效租约确认边界=min(tick, wallNow)，过期租约只确认到 `updated_at`（断档时间不当作生产时间，L004），FOR UPDATE SKIP LOCKED 防跨事务排队；`listAdvanceableBaseIds` 允许过期租约结清最后确认时段；`sweepExpiredLeases` 过期租约真释放；tick 按 scopeTickTransactionToBase 绑定单基地，别的事务持锁的基地本次跳过不卡全局。重开：`POST /base/reset` → ResetBaseUseCase 薄壳 → 单事务 21 表 FK 闭包删档＋seedProvisionedBase 同事务重建（landing 内容/×2/新 baseId），失败整体回滚、收据防重放二次删档、写 `base.reset` 审计（old/new baseId）；全服 world-reset 需确认文本 RESET BLACKPINE。
- **证据／继承依据**：`packages/shared/src/base.ts:442-444`；`apps/server/src/modules/world-runtime/base.repository.ts:363-454`（sweepExpiredLeases、lockAdvanceableBases 确认边界/D010②/L004、listAdvanceableBaseIds）；`apps/server/src/modules/world-runtime/base.service.ts:578-580, 739-741, 992-1031, 1094-1108`；`apps/server/src/modules/world-reset/base-reset.service.ts:1-13`、`apps/server/src/modules/world-runtime/base-session.routes.ts:208`、`apps/server/src/modules/world-reset/world-reset.service.ts:4`；`apps/server/src/app.base-lease-recovery.integration.test.ts:221-355`（本轮 3 passed）、`apps/server/src/tests/ops/reset-account-base.integration.test.ts:319-545`（本轮 5 passed，含跨账号隔离、失败整体回滚、同 commandId 幂等）；历史：PR #39 验收记录（F1 重开端到端 21 表闭包实证、F2 断网 160s→sweep→~5s 自动重接管、Q-ACCEPTANCE-2 本地真栈 4/4）、20260927 README D010 根因记录。重开为破坏性操作，本轮仅在测试自建临时库内执行，未对任何真实／开发库存数据调用 reset。
- **未知项**：已部署租约与暂停实际表现 NOT_ACCESSIBLE；`app.world-tick.integration.test.ts`（7 例）、`reset-base-operations.integration.test.ts`（6 例）、`db/world-runtime.integration.test.ts`（6 例）NOT_RUN（前两者也不在 `pnpm test:integration:postgres` 的 5 文件清单内，须单独指名运行）；F2 自愈「最坏 ~32s」与 D011 真人浏览器定案 NOT_RUN（历史声称，本轮未复现）；评审机报告包 NOT_ACCESSIBLE。

### 3｜R1：反复手动续单

- **处置**：TRANSFER_TO_G1。
- **现场事实**：持续采集与加工安排未实现，属预期未完成而非已修复。采矿单是一次性有界批量：`maxBatches=min(10, 余量/4)`，每批 4 矿、两矿点各 200，采完一个矿点约需连续 5 次手动下单；采矿送完即停，制造工单为固定 outputsPlanned 的一次性产出。已有的仅是单工单级暂停/恢复/取消（LandingShell.tsx:633-671）。全仓 grep「续单/自动续/重复上一单/autoRenew/持续采集」在 apps/web、apps/server、packages/shared 均无命中。00 文件建议的最小持续安排、可暂停/取消、资源不足说明均未落地。
- **证据／继承依据**：`apps/web/src/features/base/LandingShell.tsx:1213`；`packages/content/src/base/landing-release.ts:259`；`apps/web/src/features/base/LandingShell.tsx:633`；`docs/implementation/2026-10-03-2d-transition/00-old-route-closeout.md:32`；`docs/reviews/base-operations/2026-10-03-external-playability-review/report.md`（R1 裁决行：同意，中）。
- **未知项**：未实测玩家实际续单负担（只读源码核查，NOT_RUN）；已部署版本 NOT_ACCESSIBLE。

### 4｜R2：目标被代答

- **处置**：TRANSFER_TO_G1。
- **现场事实**：字面 `nextAdvice` 已不存在（全仓源码 grep 无命中，仅历史诊断文档引用），目标系统重构为 deriveGoal 从服务端快照派生。但 2026-10-01 诊断指认的「代答」机制改名后原样保留：`bestGapExpansion = expansionTemplates[0]` 钦定第一个扩建模板、缺口代算并直接展示「还缺 …」、「前往处理」按钮预选目标并导航，目标条以「第 N 步 · 标题」呈现唯一正解。closeout 要求保留的缺口计算与来源导航、「返回原工程」上下文在位（deriveSourceSteps，返回原工程按钮）——即「辅助保留、代答未消除」，与 TRANSFER 判定一致，无改判依据。
- **证据／继承依据**：`apps/web/src/features/base/LandingShell.tsx:238`、`:508`；`docs/reviews/base-operations/2026-10-01-fun-diagnosis/report.md:29`；`00-old-route-closeout.md:33`。
- **未知项**：未运行 UI 验证真人是否感知为代答（NOT_RUN，静态源码事实核查）。

### 5｜R4：状态与成长不可感知

- **处置**：TRANSFER_TO_G1。
- **现场事实**：「部分改进＋核心缺口仍在」，不是已修复。2026-09-25 整改批次已交付：目标条「第 N 步 · 标题/原因」、队列卡分步进度与阻塞原因汉化、冻结/暂停徽标、投产收益行、事件面板。但仍无产量速率、无瓶颈归因、无能力/成长变化对比；「成长」仅体现为快照数字与一行文本收益，G1 要求的「场景显示真实建设、产出、阻塞和能力变化」未达成。外部审查 R4 裁决「同意，高置信度」并修正证据表述（「建成前后零变化」不按字面成立），本轮未做视觉实测。
- **证据／继承依据**：`apps/web/src/features/base/LandingShell.tsx:506`；`apps/web/src/features/base/EventsPanel.tsx:57`；`docs/reviews/base-operations/2026-10-03-external-playability-review/report.md`（R4 裁决行）；`00-old-route-closeout.md:34`。
- **未知项**：真人/浏览器实测可感知性 NOT_RUN；review-remediation-20260925 证据截图为工作树未入库副本（「 2.md/ 2.png」），本轮未引用其为依据。

### 6｜R8：开场与机器人称呼

- **处置**：TRANSFER_TO_G1。
- **现场事实**：旧开场弹窗文案原文逐字保留、未删未改（「第一个任务：把运抵的太阳能设施安装到建设位 A…再增加 5 kW」「…现在就能接外部订单赚账款、采购材料、制造新机器人」）。两处承诺对 landing 新档失实：种子太阳能峰值 `generationWPeak: 0`、`initialCredits: 0`、`orderTemplates: []`、`capabilities: []`——外部审查「旧文案不能原样解禁」的告诫与源码现状一致。现场门禁核查：showIntro 含 `!isLandingSnapshot(snapshot)`，landing 档（yudian-landing-1）不显示旧弹窗，开场由 deriveGoal 目标条承担；旧文案仅对 legacy 非 landing 档仍生效，属**休眠而非移除**。机器人称呼：种子与 UI 一致使用驮运/筑垒/望山，displayNames 缺失时兜底「未知设备」，命名稳定映射已在位；G1 待办是新开场与新规则一致的叙事。
- **证据／继承依据**：`apps/web/src/features/base/BaseIntroModal.tsx:55`；`apps/web/src/features/base/BaseApp.tsx:1031`；`packages/content/src/base/landing-release.ts:257`；`apps/web/src/features/base/LandingShell.tsx:714`；`00-old-route-closeout.md:35`。
- **未知项**：未运行 UI 验证首屏呈现与弹窗触发路径（NOT_RUN）；已部署版本 NOT_ACCESSIBLE。

### 7｜R3：目标缺少意义（问题本体）

- **处置**：TRANSFER_TO_G1（问题）。
- **现场事实**：问题本体在文字版未解决，且当前内容包把意义出口显式关闭：landing-release 注释「credits 显式 0、无订单模板（无 external_trade 能力）」，`initialCredits: 0`、`orderTemplates: []`、`capabilities: []`。当前唯一回报形态是扩建产能数字（describeProjectBenefits）与 deriveGoal 第 6 步「继续下一轮生产」的开放式循环，无阶段性成果、无「钱/建设改变下一步选择」的叙事。按 00 文件：G1 首轮回报＝自产扩建＋新的安排能力；「暂缓 credits」是方案转向，**不得记为「不再需要成长目标」**。
- **证据／继承依据**：`packages/content/src/base/landing-release.ts:257, 490`；`apps/web/src/features/base/LandingShell.tsx:320`；`00-old-route-closeout.md:36`。
- **未知项**：「自产扩建＋新安排能力能否形成意义」属 G1 待验证假设，本轮无任何实测（NOT_RUN）。

### 8｜首单、credits、稀缺件采购与持续订单经济

- **处置**：DEFER（方案）——与 00 文件建议一致，现场事实支持维持。
- **现场事实**：方案代码完整保留且未退役：order.service.ts 382 行实现接单/交付/补单全链（同事务订单行 FOR UPDATE、命令幂等收据、过期先标 failed、交付真消耗扣减、credits 入账、D013 事件）；补单上限 `ORDER_OPEN_TARGET=3`、同模板结案后冷却 24 基地小时。新档关闭点全部核实且**服务端显式拒绝而非仅 UI 隐藏**——无 external_trade 时接单/交付/补单抛 `CAPABILITY_UNAVAILABLE`，采购同样拒绝。旧档履约语义成立：`bases.content_release` 按基地存档，旧 release「yudian-base-0」无 capabilities 字段时 catalog 缺省回落 legacy/["external_trade"]，旧档订单/采购经济继续可跑。防套利约束：PURCHASE_CATALOG 仅含 solar_panel_set/support_frame/cable/power_box/anchor/spare_parts 六项旧物资，controller/pv_cell/structural_frame/wire_cable 不可采购。00 文件交接要求（重启前核定初始库存、用途、冷却、矿量与建设位）尚无实施批次。
- **证据／继承依据**：`apps/server/src/modules/economy/order.service.ts:115, 331`；`packages/content/src/base/landing-release.ts:257`；`apps/server/src/modules/content-catalog/catalog.service.ts:266`；`docs/reviews/base-operations/2026-10-03-external-playability-review/report.md:187`。
- **未知项**：order.service.test.ts / purchase.service.test.ts 本轮未运行（NOT_RUN）；已部署新旧档实际行为 NOT_ACCESSIBLE。

### 9｜R5：揭晓信息与内容深度

- **处置**：DEFER；地名保留可随 G1——与 00 文件建议一致，现场无已落地差异。
- **现场事实**：揭晓机制现状为确定性开关而非随机惊喜：勘探完成仅把矿点 `discovered` 置 true，landing-rules 与 settlement 中无 Math.random/意外概率代码，全库 grep「五次/意外概率」常量零命中。内容深度载体单薄：资源节点 schema 字段仅 nodeKey/name/itemId/initialQuantity，DB 表 base_resource_nodes 无 description/lore 列。当前储量固定种子 200/200，命名保留「北坡磁异常/脊线蓝绿氧化带」。120–280 储量与「五次勘探 ≤20% 意外」只是旧 M3 草案验收参数，从未进入实现；「五次勘探必须出现意外」已 RETIRE_WITH_PLAN（见行 20）。R5 原问题（揭晓是否改变计划、有无可信后续期待）仍开放。
- **证据／继承依据**：`apps/server/src/db/schema.ts:1264`；`apps/server/src/modules/world-runtime/resource-node.repository.ts:156`；`packages/content/src/base/schemas.ts:115`；`packages/content/src/base/landing-release.ts:258`；`docs/reviews/base-operations/2026-10-03-external-playability-review/report.md:203`（复核：120–280 是储量范围、≤20% 是意外概率）、`:215`（揭晓检验：揭晓前记录计划、揭晓后看是否因信息而改计划——原引 ：198 为空行，已改）。
- **未知项**：揭晓体验类验收（揭晓前/后计划对比）从未执行：无真人试玩，本轮也未运行任何勘探测试（NOT_RUN）。

### 10｜R6：缺少可理解的压力与取舍

- **处置**：DEFER（完整昼夜）；G1 保留资源机会成本——与 00 文件建议一致，现场无已落地差异。
- **现场事实**：昼间窗口 06:00–18:00 出处确认：`SIM_DAY_HOURS=24`、`SIM_DAYLIGHT_START_HOUR=6`、`SIM_DAYLIGHT_END_HOUR=18`（注释「Q-06 已按简化值冻结」）；运行侧三处用同一常量判 isDaylight，太阳能=峰值×日照×(1−尘/200) 仅昼间出力，应急电源恒定分列不混算；玩家可见文案「供电时段 昼间（基地时间 06:00–18:00）」与规则一致。完整昼夜（整日周期重做）无任何实现，属 DEFER 无误。00 文件要求的「保留应急与恢复路径」现场成立：应急发电 1000W＋着陆器「应急供电与手工恢复」，手工备件配方 200W/4 分钟/不计槽维护、明确注释为维护停机恢复路径。review §3.1 反对「必须真实损失」推论，G1 不要求新手受损、暂不重做整日周期。
- **证据／继承依据**：`packages/shared/src/base.ts:44`；`apps/server/src/modules/industry/landing-rules.ts:228, 862`；`packages/content/src/base/landing-release.ts:407`；`docs/reviews/base-operations/2026-10-03-external-playability-review/report.md:169`。
- **未知项**：首夜压力/恢复路径真人体验未验证（NOT_RUN）；已部署环境行为 NOT_ACCESSIBLE。

### 11｜R7：世界中的对方与 AI 共在

- **处置**：DEFER——与 00 文件建议一致，现场事实支持「固定回应在、LLM 不在」。
- **现场事实**：两条线已分离：(1) 基地线无 chat/presence——`/game/chat` 与 `/game/presence/heartbeat` 只注册在旧世界路由，registerGameRoutes 受 `legacyWorldEnabled` 门控，env 缺省关闭、仅字面 "true" 开启；web 端 chat UI 只在旧 features/game，features/base 目录无任何 chat/presence 文件。(2) LLM 供应者（AiOrchestrator/DeepSeekAiProvider）仅绑定旧世界 composition 与离线战报摘要，基地组合根未注入任何模型。(3) 基地组合根有 DecisionGateway 但未注入 provider，缺省确定性 RuleDecisionProvider、mode 常量 "rule"，仅用于基地间协作缺工检测，web 侧对应固定任务回应 UI CooperationPanel。(4) review §3.5 设想的「远征站」代码不存在（全库 grep「远征」零命中）。
- **证据／继承依据**：`apps/server/src/app.ts:286`；`apps/server/src/config/env.ts:41`；`apps/server/src/application/base/composition.ts:401`；`apps/server/src/modules/game/game.composition.ts:59`；`apps/web/src/features/base/CooperationPanel.tsx`。
- **未知项**：运行环境 `LEGACY_WORLD_ENABLED` 实际取值 NOT_ACCESSIBLE（.env 不在库内且不读环境）；协作决策是否曾以 live/shadow provider 运行 UNKNOWN（decision_records 未查，不连库）。

### 12｜内部 ID、错误文案与状态名泄漏

- **处置**：TRANSFER_TO_G1（被触及的玩家界面）。
- **现场事实**：2026-10-01 诊断点名的两处泄漏原样在，均未修复：①制造完工事件 detail 直出内部工单 ID 前 8 位（「工单 ${job.id.slice(0, 8)} 产出 …」），EventsPanel 原样渲染 detail；②「解锁能力：warehouse」能力串直出到投产收益行。同族未点名泄漏：未知事件类型原样显示点分码（`EVENT_TYPE_LABELS[type] ?? type`）、采矿送达事件标题回退原始 itemId。错误文案现状较好：枚举服务端 OperationError message 均为中文散文，英文 code 仅用于分支不展示（describeError 透传 message 不显示 code）；设备状态/分组有中文标签映射与「未知设备/未知物料」兜底。管理员面板显示原始 code 属特权界面，不计入玩家界面泄漏。属打磨项未修复，处置维持。
- **证据／继承依据**：`apps/server/src/modules/industry/landing-settlement.ts:594`；`apps/web/src/features/base/LandingShell.tsx:166`；`apps/web/src/features/base/EventsPanel.tsx:15`；`docs/reviews/base-operations/2026-10-01-fun-diagnosis/report.md:83`；`apps/web/src/features/base/BaseApp.tsx:59`。
- **未知项**：Fastify 框架层默认错误（5xx/超时）返回前端的实际文本未逐项验证（NOT_RUN，仅枚举业务层 OperationError）；未实测泄漏项在真实事件流中的出现频率（NOT_RUN）。

### 13｜旧 M1a/M1b/M2/M3/M4 的顺序与版本号

- **处置**：RETIRE_WITH_PLAN。
- **现场事实**：原表述确认：02:74-79 版本映射表（M1→1.1.0…M4→1.4.0）、02:85 M1 内分 M1a/M1b、03–06 各自声明版本目标 1.1.0–1.4.0。这些版本号均未开工——`PRODUCT_VERSION="1.0.4"`（AGENTS.md 所记 0.11.0 已过时）。文档现状：路线总纲 README 已由 `620e195` 加顶部横幅「历史方案（停止默认实施）」，但 01–06 六文件正文此前均未加横幅——00:65 要求的「01–06 文件顶部标注历史方案」由本收尾批路由改动补齐（见 §4），与 00:3「交接就绪；执行现场收尾待完成」衔接。
- **证据／继承依据**：`docs/implementation/2026-10-01-playability-roadmap/02-milestones-and-acceptance.md:74-79`；`03-M1-first-game-day.md:5`；`README.md:5`；`packages/shared/src/version.ts:1`；`00-old-route-closeout.md:42`。
- **未知项**：线上部署版本未核查（NOT_ACCESSIBLE）；01–06 顶部标注在本批路由改动前属执行 agent 待办（现已由 §4 变更覆盖）。

### 14｜15:00 开局且 ×2 约 90 秒日落

- **处置**：RETIRE_WITH_PLAN + 文档纠错。
- **现场事实**：原表述确认（01:64「×2≈90 秒」、03:18、02:19「≤5 真实分钟」）。独立复算（node 实算）：昼窗来自 base.ts（06:00–18:00），15:00 开局到日落=3 模拟时；倍速语义在 runtime：`deltaSimMs: deltaWallMs * row.speed`、`nextSimTime = simTime + deltaSimMs`——无隐藏系数。结果：×1=180 真实分钟、×2=90 真实分钟、×4=45 真实分钟。**「×2≈90 秒」错 60 倍**，00:43 成立；02:19 的 ≤5 真实分钟验收在现公式下不可达。连带错误：01:66「夜长 12 游戏时（×1≈12 真实分）」实为 720 分钟，01:67「×4 压到 3 分钟」实为 180 分钟——全路线按「1 游戏时≈1 真实分」臆算，恰为实际速率的 60 倍。新档默认 ×2 与代码一致（base.service.ts:489-490 D012 speed: 2）。文档正文按政策保留历史数字不改写，纠错记载于 00:43 与路线 README:24；01–06 顶部横幅已提示以本报告台账为准（§4）。
- **证据／继承依据**：`docs/implementation/2026-10-01-playability-roadmap/01-playability-design.md:64`；`02-milestones-and-acceptance.md:19`；`packages/shared/src/base.ts:47`；`apps/server/src/modules/world-runtime/base.repository.ts:425`；`apps/server/src/modules/industry/base-settlement.service.ts:166`。
- **未知项**：复算为静态代码推导＋node 算式，未运行真实 sim 实测日落时刻（NOT_RUN，只读不启服）；比率取自 runtime 两处源码，若该两处改动数字需重算。

### 15｜离线暂停同时承诺离线“昨夜战报”

- **处置**：RETIRE_WITH_PLAN。
- **现场事实**：矛盾成立：现行契约是离线即暂停——2026-09-19 领域合同「v0.12 默认断开控制会话后暂停……不把停服时间当生产时间」；实现侧注释「断档时间不当作生产时间（L004）」且租约过期只确认到 `lease.updatedAt`；快照携带 `effectiveRunning`/`pauseReason="foreground-required"`。玩家下线后夜不推进，「昨夜战报」要么只能描述未发生的模拟，要么要求整夜保持前台租约在线；01:66 明确把「下线」与「昨夜战报」配对，01:70 一边宣布「离线暂停语义**不变**（L004 契约保留）」、一边称「首夜设计已兼容它」，冲突未解决。00:44「只允许报告实际发生的模拟；不补造离线事实」为对症处置。文档正文未改。
- **证据／继承依据**：`docs/implementation/2026-10-01-playability-roadmap/01-playability-design.md:66, 70`；`03-M1-first-game-day.md:34`；`docs/implementation/2026-09-19-base-operations/01-domain-contracts.md:64`；`apps/server/src/modules/world-runtime/base.repository.ts:409`；`packages/shared/src/base.ts:224`。
- **未知项**：真人/代理过夜流程实测 NOT_RUN；「昨夜战报」无任何实现可考（grep 于 apps/server 源码 0 命中），最终形态属 G1 设计决策。

### 16｜每条路线可无损过夜，同时每人必须受损

- **处置**：RETIRE_WITH_PLAN。
- **现场事实**：三份 M1 文档互不一致：03:23/03:51/01:71 承诺「部署得当无损过夜」，02:19 无条件要求「首夜造成过一次可感知的暂停/损失」，01:65 把首夜损失定义为夜间工单暂停次日重跑——而夜间太阳能归零是现行窗口事实，部署得当也必然停工，02 的无条件验收与 01/03 的无损承诺不能同时满足；03:58 自身也让步「允许部署得当零损失」，与 02:19 直接冲突。03:53 提到的「三条路线各跑一遍」探针脚本在仓库中不存在（grep 无）。00:45「风险存在、优秀部署有效、恢复可理解；不保留强制受损验收」与外部审查一致。文档正文未改。
- **证据／继承依据**：`docs/implementation/2026-10-01-playability-roadmap/03-M1-first-game-day.md:23, 58`；`02-milestones-and-acceptance.md:19`；`01-playability-design.md:65`；`docs/reviews/base-operations/2026-10-03-external-playability-review/report.md:145`。
- **未知项**：三条路线首夜能量推演未执行（NOT_RUN：无探针脚本，只读不启服）；「无损」是否计入工单暂停/重跑未定义，属 G1 P 冻结待定项。

### 17｜直接打开旧开场门禁

- **处置**：RETIRE_WITH_PLAN（具体做法）。
- **现场事实**：与行 6 同源核查：旧开场门禁仍存在但已对 landing 档关闭——showIntro 含 `!isLandingSnapshot(snapshot)`，landing 新档（yudian-landing-1）不弹旧窗，开场由 deriveGoal 目标条承担；旧文案（含失实的 5 kW/外部订单承诺）对 legacy 非 landing 档仍生效，属休眠而非移除。开场问题本体转 G1（行 6），旧文案不可原样复用。
- **证据／继承依据**：`apps/web/src/features/base/BaseApp.tsx:1031`；`apps/web/src/features/base/BaseIntroModal.tsx:55`；`packages/content/src/base/landing-release.ts:257`；`00-old-route-closeout.md:46`。
- **未知项**：legacy 档打开旧弹窗的实际触发路径未实测（NOT_RUN）；已部署 NOT_ACCESSIBLE。

### 18｜循环单称为“重放同一个幂等命令”

- **处置**：文档澄清，TRANSFER_TO_G1。
- **现场事实**：措辞与代码语义冲突：command_receipts 以 `(actorScope,commandKind,commandId,worldEpoch)` 唯一索引去重；`findReceiptForUpdate` 对同 commandId 并发事务 FOR UPDATE 阻塞后重放已存结果，claimReceipt 撞唯一键即须重放；`CreateExtractionJobResultDto.duplicate` 即「重放同一命令只会返回既有结果，不再发资产」。因此「循环=重放同一个幂等命令」字面不成立：第 2..N 批必须各持稳定独立的新命令身份，否则幂等层把续批吞成 duplicate。00:47 澄清正确。实现状态：循环模式/autoRenew/auto_renew/续作 于 apps/server/src 与 packages 源码 0 命中——循环属未实现提案，无代码缺陷，只改文档措辞。
- **证据／继承依据**：`docs/implementation/2026-10-01-playability-roadmap/01-playability-design.md:15`；`02-milestones-and-acceptance.md:41`；`apps/server/src/db/schema.ts:542`；`apps/server/src/modules/ledger/asset-mutation.service.ts:188`；`packages/shared/src/base.ts:362`。
- **未知项**：循环模式无实现可运行验证（NOT_RUN/N/A）；派生批次身份方案（父单 commandId 派生规则）未定义，属 G1 P 冻结内容。

### 19｜“排队最久”直接命名为瓶颈

- **处置**：文档澄清，TRANSFER_TO_G1。
- **现场事实**：矛盾成立：排队最久可能源自上游缺料/缺电/维护饥饿，排序≠因果瓶颈；这与仓库已有结构化阻塞分类相抵触——`BaseActionBlockerDto` 已区分 material/facility/expansion_quota/device/node/slot/site 七类阻塞原因，现有合同本就把「等待」与「缺料缺电维护」分开。澄清记载于 00:48；外部审查同判（「可以先叫最长等待，不给一个排序附加强因果」）。实现状态：瓶颈/bottleneck 于 apps/server/src、apps/web/src、packages 源码 0 命中——M2-4 未实现，「与实测一致」验收对象尚不存在。
- **证据／继承依据**：`docs/implementation/2026-10-01-playability-roadmap/04-M2-self-running-base.md:25`；`01-playability-design.md:42`；`packages/shared/src/base.ts:324`；`docs/reviews/base-operations/2026-10-03-external-playability-review/report.md:197`；`00-old-route-closeout.md:48`。
- **未知项**：瓶颈判定算法未实现、无实测数据（NOT_RUN）；G1 若实现，「最长等待」改名/降级为提示的具体文案未定。

### 20｜“五次勘探必须出现意外”

- **处置**：RETIRE_WITH_PLAN。
- **现场事实**：原表述确认（05:35「勘探 5 次 ≥3 种不同结果（含 ≥1 次意外）」、05:31 意外概率 15%、02:50 同款、01:59 ≤20%）。算术复算（node 实算）：p=0.15 时 P(5 次内 ≥1 次意外)=1−0.85^5≈55.6%，约 44.4% 新号五次全无意外；p=0.20 时约 32.8%——把「含 ≥1 次意外」当验收/CI 硬门槛等于抽签（外部审查同结论）；「≥3 种不同结果」同样依赖抽样分布。00:49「固定种子覆盖测试与真人体验分别验收，不能让随机概率决定 CI 通过」为对症处置。实现状态：意外/surprise/windfall 于源码 0 命中，industry.pure.ts 无 Math.random，勘探揭示当前为内容目录确定性数值——该验收描述的是未实现功能的随机行为，M3 从未开工。文档正文未改。
- **证据／继承依据**：`docs/implementation/2026-10-01-playability-roadmap/05-M3-text-and-revelation.md:35, 31`；`02-milestones-and-acceptance.md:50`；`docs/reviews/base-operations/2026-10-03-external-playability-review/report.md:211`；`apps/server/src/modules/industry/extraction.service.ts:31`。
- **未知项**：意外池未实现，概率参数无运行验证（NOT_RUN）；P(≥1 意外)≈55.6% 为静态二项式算术，非随机采样；固定种子验收方案属将来的 G1/M3 设计，当前无代码或测试。

## 3. 保护资产、源码入口、可用测试入口与证据边界

### 3.1 保护资产（PROTECT，跨版本继续维护；非本轮重新测得的证明）

- **账本诚实**：copper 流水唯一写者＋整数化＋getHealth 对账（drift≠0 报 drift_detected）。
- **资产单写者与条件更新**：Assets 唯一写者、调用方事务内、`WHERE col >= amount` 条件更新防超扣。
- **库存预留语义**：预留≠消耗，可用量=quantity−reserved_quantity。
- **命令幂等**：command_receipts 唯一索引＋FOR UPDATE 收据；重放只返回既有结果，不再发资产。
- **原子结算**：结算在调用方事务内、永不自开事务；(job_id,ordinal) 唯一索引防重复产出。
- **时钟／租约／离开暂停**：服务端墙钟判租约、断档不当生产时间（L004）、GHOST_LEASE/HEARTBEAT_STALE 机器可读原因、SKIP LOCKED 单基地事务。
- **账号／基地隔离与重开**：account_id UNIQUE＋credits>=0 CHECK；删档重开单事务闭包＋同事务重建＋整体回滚＋审计（破坏性操作，未授权不调用）。
- **既有领域合同、账本、隔离、时间／租约、内容修订纪律、旧档兼容**（2026-09-19 总控）：继续有效，旧档 catalog legacy 回落保留。

### 3.2 源码入口（追溯起点，非重构清单）

| 资产 | 入口 |
|---|---|
| 账本/单写者/幂等 | `apps/server/src/modules/ledger/asset-mutation.service.ts`、`ledger/base-asset.service.ts`、`ledger.service.ts` |
| 原子结算 | `apps/server/src/modules/industry/manufacturing.settlement.ts`、`base-settlement.service.ts` |
| 租约/暂停/tick | `apps/server/src/modules/world-runtime/base.repository.ts`、`base.service.ts` |
| 删档重开 | `apps/server/src/modules/world-reset/base-reset.service.ts`、`world-reset.service.ts`；路由 `base-session.routes.ts:208` |
| 隔离约束 | `apps/server/src/db/schema.ts:862-886`（bases）、`:542-557`（command_receipts） |
| 目标条/事件/称呼 | `apps/web/src/features/base/LandingShell.tsx`（deriveGoal）、`EventsPanel.tsx`、`BaseIntroModal.tsx`、`BaseApp.tsx:1030-1031` |
| landing 内容包 | `packages/content/src/base/landing-release.ts`、`schemas.ts` |
| 昼窗/租约常量/幂等 DTO | `packages/shared/src/base.ts:44-49, 224-229, 324-332, 362, 442-444` |
| 订单/采购经济（DEFER 保留） | `apps/server/src/modules/economy/order.service.ts`、`purchase.service.ts`、`content-catalog/catalog.service.ts:266` |
| 模型边界（R7） | `apps/server/src/application/base/composition.ts:401`、`modules/game/game.composition.ts:59`、`config/env.ts:41` |

### 3.3 可用测试入口（本轮实际运行过的命令，见 §4.3；运行者为核查员）

- 单元（在 `apps/server` 下）：`npx vitest run src/modules/ledger/ledger.service.test.ts src/modules/industry/base-settlement.service.test.ts src/modules/industry/manufacturing.settlement.test.ts src/modules/world-reset/base-reset.service.test.ts src/modules/account-ops/account-ops.service.test.ts` → 5 文件 49 passed。
- 真 PG 集成（仓库 source 根，.env `DATABASE_URL=127.0.0.1:55432`＝仓库自带 docker-compose 开发容器 ai-mud-dev-postgres-1；测试自建临时库并删除，未触生产）：`npx vitest run src/db/asset-mutation.integration.test.ts src/db/game-concurrency.integration.test.ts src/app.base-lease-recovery.integration.test.ts src/tests/ops/reset-account-base.integration.test.ts` → 4 文件 17 passed / 0 failed。
- 合计 66 例 targeted 回归。注意：`app.world-tick.integration.test.ts`（7 例）与 `reset-base-operations.integration.test.ts`（6 例）**不在** `pnpm test:integration:postgres` 的 5 文件清单内，须单独指名运行；实际脚本以 package.json 为准。

### 3.4 证据边界

1. **本轮 66 例 ≠ 全量**：非全量套件、非 CI、非部署环境、无真人试玩；结论仅限 targeted 回归覆盖面。
2. **历史绿灯不覆盖本分支**：review-remediation-20260927 README（server 778 passed）、PR #38（MERGED 44fccdc v1.0.3）、PR #39（MERGED e13910a v1.0.4，web 267/267、Q 本地真栈 4/4）均为各分支合并时点记录；历史 CI 按定义不覆盖本收尾分支与 2D 新玩法。
3. **NOT_ACCESSIBLE**：生产／已部署行为无读取通道；PR #38/#39 引用的评审报告包实体在评审机 `~/.yudian-review/runs/`（未入库）；运行环境 `LEGACY_WORLD_ENABLED` 取值未读。
4. **NOT_RUN**：见 §4.4。
5. **不做环境伪装**：测试连的是仓库自带隔离开发容器＋临时库；未连接未知数据库、未执行迁移、未对真实数据调用 reset。
6. **未入库证据**：review-remediation-20260925 的「 2.md/ 2.png」为 Finder 复制残留副本，本报告未引用其截图为依据。

## 4. 变更文件清单、实际检查命令与结果

### 4.1 本批变更文件（未提交，待所有者审查后决定 PR 处置）

| 文件 | 改动 | 内容 |
|---|---|---|
| `AGENTS.md` | +2 −0 | 「历史排期入口」节下补路由说明：旧 M1–M4 自 2026-10-03 停止默认实施，当前入口指向本目录 README；纪律段落原文未动 |
| `2026-10-01-playability-roadmap/01–06`（6 文件） | 各 +2 −0 | 标题下插入 2–3 行 blockquote 历史状态说明（2026-10-01 历史方案、停止默认实施、正文保留供对照、链接本目录 README、证伪/退役表述以本报告台账为准）；正文零改动 |
| `2026-10-03-2d-transition/closeout-report.md` | 新增 | 本报告（收尾执行者计划内交付物，落盘后 01–06 内 6 处指向本文件的链接即生效） |

`git diff --stat` 实测：7 files changed, 14 insertions(+)（本报告文件另计）。**未动**：`2026-10-01-playability-roadmap/README.md`（620e195 已含横幅，按指示不动正文）、`CLAUDE.md`、本目录四件既有文件、`07-external-review-prompt.md`、全部源码／依赖／配置／版本／迁移／数据库。遗留观察（未改，不属本批）：`CLAUDE.md:7` 的 "dark-fantasy web MUD" 产品框定及 superpowers 产品入口已过时，仅记录。

### 4.2 检查命令与结果（报告撰写人本会话复跑）

| 命令 | 结果 |
|---|---|
| `git rev-parse HEAD && git branch --show-current` | `620e195f0f5f…`、`docs/external-playability-review-20261003` —— 与基线一致 |
| `test -e …/2026-10-03-2d-transition/closeout-report.md` | 写入前 REPORT_ABSENT（无既有报告可覆盖） |
| `git diff --stat` | 7 files changed, 14 insertions(+) —— 与路由批记录一致 |
| `git status --porcelain \| grep '^??' \| wc -l` | 43（全部「 2」Finder 残留，与基线注记一致） |
| `sed` 抽查 8 处关键锚点（`version.ts:1`、`base.ts:44-49,442-444`、`landing-release.ts:257,259-260,490-493`、`schema.ts:542-545,862-866`、`LandingShell.tsx:1213`、`BaseApp.tsx:1030-1031`） | 全部与 §2 台账引文一致 |
| 6 个 01–06 文件内全部 markdown 链接 `grep` 提取＋`test -e` 解析 | `../2026-10-03-2d-transition/README.md` OK×6；`../2026-10-03-2d-transition/closeout-report.md` MISS×6（本报告落盘后生效） |
| 行号复核（独立通读返工后补跑）：对 01–06 被引原文逐条 `grep -n`（「90 秒」「≤5 真实分钟」「可感知的暂停」「勘探 5 次」「排队最久」「循环为服务端派生重放」「底层仍一次性命令」「1.1.0」「M1a」「三条路线各跑一遍」「零损失」「意外概率」「意外事件概率」「昨夜战报」「无损过夜」「12 游戏时」「次日重跑」共 17 组）；评审报告 `sed -n '194,200p'` 与 ：211/:215 抽读 | §2 全部 01–06 引用已按加横幅后工作树行号重编（原按 HEAD 620e195 未加横幅计，普遍差 2 行）；02:18 在任何基准下均非被引内容，两处已改为 ：19（该行同时含「≤5 真实分钟」与「可感知的暂停/损失」两句）；评审报告 ：198 为空行，行 9 的 R5 引用改为 ：203/:215 |

路由批另有的检查（路由核查记录，未由报告撰写人重跑）：AGENTS.md 内 11 个被引用文档路径逐一 `test -e` 全部存在；01–06 同款链接检查结果与上表一致。

### 4.3 测试命令（核查员于本轮执行；报告撰写人未复跑，结果按核查员记录转述）

见 §3.3 两条命令与结果：单元 5 文件 49 passed；真 PG 隔离集成 4 文件 17 passed / 0 failed。共 66 例，全部通过。

### 4.4 NOT_RUN / NOT_ACCESSIBLE 清单（如实保留）

- **NOT_RUN**：全量测试套件（server ~778 例、web 267 例）；`db/postgres-integration`、`db/world-runtime.integration`（6 例）、`app.world-tick.integration`（7 例）、`reset-base-operations.integration`（6 例）、`order.service.test.ts`/`purchase.service.test.ts`；浏览器试玩与任何真人可玩性验证；F2 自愈与 D011 复现；三条路线首夜能量推演（无探针脚本）；真实 sim 日落时刻实测（只读不启服）。
- **NOT_ACCESSIBLE**：生产／已部署环境与线上行为；评审机报告包 `~/.yudian-review/runs/`；运行环境 env 取值。
- **UNKNOWN**：CI 历史运行清单未调取（且历史 CI 不覆盖本分支与 2D 新玩法）；协作 decision_records 是否有 live/shadow provider 运行记录。
- **主动不执行（保护性）**：`world-reset` 全服重开与 `POST /base/reset` 未对任何真实数据调用；未 reset/clean/stash 他人改动、未删除分支、未关闭或合并 PR、未 prune prunable worktrees。

## 5. 需另行授权的真实阻断及最小处置建议

本轮处置矩阵核查**未发现**已确证的数据丢失、安全、隔离或结算故障；以下为真实的授权闸门与不可达项，不是缺陷清单：

1. **2D 框架确认**：`01-game-framework-proposal.md` 仍为 PROPOSED，所有者未签字。最小处置：所有者逐项确认框架级决策（引擎、视角、权威模拟归属、美术基线），确认前不安装依赖、不写引擎代码。
2. **G1 未指派**：无人有权开始第一段 2D 可玩切片。最小处置：框架确认后由所有者单独指定 G1 工作包；届时才在该批次范围内更新依赖／协议／文件所有权与架构策略（Architecture Policy Change 单列），不得借本次路由变更一并解除限制。
3. **生产读取通道缺失**：已部署版本与线上行为 NOT_ACCESSIBLE，租约／隔离／重开的线上表现无法核验。最小处置：所有者授权只读生产检查人或提供部署清单与版本号；在此之前「已部署＝e13910a/1.0.4」仅为快照记录。
4. **PR #41 合并**：本批文档改动未提交未合并。最小处置：所有者审查后自行合并或指示追加；agent 不合并、不强推。
5. **破坏性操作**：删档重开与全服 world-reset 有完整实现与审计，但属破坏性操作。最小处置：维持「仅在隔离测试环境执行」，任何真实数据重开需所有者单独指令。

## 6. 下一批（G1）接手所需的接口／内容／场景风险

框架仍为 **PROPOSED**，以下风险在 G1 实施前须由 P 冻结处理，不是已批准方案：

- **接口**：command_receipts 幂等键 `(actorScope,commandKind,commandId,worldEpoch)`——G1 的续单/循环/派生批次**必须**各持稳定独立命令身份，重放同一命令只返回既有结果（矩阵行 18）；Assets 单写者＋调用方事务内调用约定不可绕过；BaseId 与 CharacterId 的隔离形式为分表＋account_id UNIQUE＋每基地事务作用域，G1 命名需与其对齐。
- **接口**：基地组合根 DecisionGateway 缺省 RuleDecisionProvider（mode="rule"）未注入任何模型；若 G1 需要 LLM，须按合同做事务外预算/超时/取消/迟到保护。
- **内容**：landing 内容包现状＝initialCredits 0、orderTemplates []、capabilities []、矿 200/200、默认倍速 ×2、昼窗 06:00–18:00——R1/R3/R8 的 G1 方案以此为起点，不是以旧 M1 文案的 15 kW/外部订单为起点；catalog legacy 回落 ["external_trade"] 仅服务旧档，新档显式拒绝。
- **场景**：离线即暂停语义下，任何「战报/离线摘要」只能报告实际发生的模拟（不补造离线事实）；「无损过夜 vs 强制受损」的定义分歧须在 G1 P 冻结中裁定；LEGACY_WORLD_ENABLED 默认关闭，部署若显式开启则旧线 chat 路由注册——G1 场景不依赖旧世界线。
- **性能／租约**：BASE_LEASE_TTL_MS=120s、BASE_MAX_CATCHUP_MS=10min、确认边界=min(tick, wallNow)——2D 前端的帧率/轮询不得变成收益决定者，接管语义沿用 D012/D010。

## 7. 收尾验收对照与结论

对照 [00-old-route-closeout.md](00-old-route-closeout.md) §5 完成条件：

| 条件 | 状态 |
|---|---|
| 旧路线不再误导自动开工 | 达成：AGENTS.md 路由＋01–06 顶部历史标注＋总纲 620e195 横幅 |
| 每个有效问题有去向 | 达成：§2 矩阵 20 行，处置/事实/证据/未知四项齐备 |
| 可信资产与证据边界可追踪 | 达成：§3 资产/入口/测试/边界四小节 |
| 存档和线上行为未被动过 | 达成：全程只读＋隔离测试临时库＋破坏性操作未调用 |
| G1 仍有清晰授权闸门 | 达成：§5 五项阻断＋§6 PROPOSED 框架边界 |

不要求项（旧 M1–M4 全实现、文案全润色、游戏好玩、第一完整游戏日可玩、安装 Phaser、生成美术、部署收尾版本）均未做，也不冒认。

**结论：CLOSED_AS_PLAN。** 该结论仅表示：旧文字排期（2026-10-01 M1–M4）已按所有者转向决定停止默认实施，收尾交接完成——处置台账齐备、文档路由收口、保护资产与证据边界可追踪、G1 闸门清晰。它**不**表示游戏好玩、旧缺陷清零、所有建议已实现、框架已确认、或 G1/合并/部署获得任何授权；PROTECT 行的历史绿灯与本轮 66 例 targeted 回归均非全量验证，生产环境不可访问。
