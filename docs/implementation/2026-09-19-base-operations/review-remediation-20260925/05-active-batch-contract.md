# 2026-09-25 修复批次 P 合同

状态：`CONTRACT_READY`（U/C/T 和下述 M 增量）。基线为本地 `main` 的 `041fe3f86278c85869ef5b47e06873fdb9d8750c`，产品 1.0.0，`schemaVersion=31`、`apiVersion=47`、`contentVersion=15`。远端 main 本轮因本机代理不可用未核实。当前实现分支为 `codex/review-remediation-20260925`，与原评审分支隔离。

## 玩家任务流

主入口显示目标、时间状态、地图和当前任务。选择建设位进入就地详情，条件、开工、项目状态与暂停恢复在同一任务区域。经营、制造、协作作为可返回的工作区；切换时保留所选对象及采购/制造输入，轮询不切换工作区或抢焦点。窄屏在地图与详情间显式返回，桌面并排展示。历史默认不占主场景。所有命令继续走现有 `BaseApp`/`baseApi`，不增加路由、计时器、请求或业务状态机。

## 现有数据与失败语义

- U/C/T 不新增 shared DTO、数据库字段、public API、版本号、依赖或允许边。读取现有 `BaseSnapshotDto` 的 `timeMode`、项目/工单状态、资源、协作请求和订单；不在客户端计算权威库存、ETA、成功条件或奖励。
- 命令处理中、成功回读和服务端错误显示在发起命令的工作区。快照刷新失败单独提示，不能把提交成功误写成已完成。暂停由 `timeMode` 判断；项目步骤的 `ready` 不代表正在计时。终态工单不提供取消，服务端拒绝仍保留。
- C 按 `requestId` 保留每条真实请求，只折叠历史呈现；不以相同文字合并不同请求、不删历史。后端已发现可重复建单的路径，按下文 C07 增量先固定失败用例，再修复；线上 53 条的逐条成因仍未读回。
- M 调查已追到 canonical 资产与订单交付写路径。库存 `quantity` 是总量，`reservedQuantity` 是占用，可支配量为两者之差；在途采购单列且到货前不入库存。开局锚固件 8 个被首工程预留 8 个，快照丢失占用字段，足以解释 F04。订单交付现只按总量判断，可能由数据库约束而非业务错误拒绝，需按可支配量做条件更新；不改资产归属、预留状态机或订单奖励。

## 文件所有权

| 线 | 唯一可写源码/测试文件 |
|---|---|
| U | `BaseApp.tsx`、`BaseApp.test.tsx`、`BaseShell.tsx`、`BaseShell.test.tsx`、`BaseMap.tsx`、`BaseMap.test.tsx`、`ObjectPanel.tsx`、`ObjectPanel.test.tsx`、`ProjectBoard.tsx`、`ProjectBoard.test.tsx`、`base.css`（均在 `apps/web/src/features/base/`） |
| C 前端 | `apps/web/src/features/base/CooperationPanel.tsx`、`CooperationPanel.test.tsx` |
| C 后端 | `apps/server/src/modules/industry/base-settlement.service.ts`、`base-settlement.service.test.ts`、`cooperation.service.ts`、`cooperation.service.test.ts`、`cooperation.repository.ts`；`apps/server/src/application/base/composition.ts`；必要真 PG 回归限 `apps/server/src/tests/base-operations/m14/cooperation-shadow.integration.test.ts` |
| T | `apps/web/src/features/base/BaseIntroModal.tsx`、`BaseIntroModal.test.tsx`、`ManufacturingBoard.tsx`、`ManufacturingBoard.test.tsx` |
| M 后端 | `packages/shared/src/base.ts`；`apps/server/src/modules/world-runtime/base.service.ts`、`base.service.test.ts`；`apps/server/src/modules/economy/order.repository.ts`；新增订单条件写回归限 `apps/server/src/tests/base-operations/m12/base-provision.integration.test.ts` |
| M 前端 | U/C/T 集成后由 I 串行接手 `ObjectPanel.tsx`、`ObjectPanel.test.tsx`、`ManufacturingBoard.tsx`、`ManufacturingBoard.test.tsx`、`EconomyBoard.tsx`、`EconomyBoard.test.tsx`、`BaseShell.tsx`、`BaseShell.test.tsx`；U/C/T 活跃时不得并写 |
| Q | 独立验收证据，不改业务代码；若需新增测试，先指定精确文件 |
| I | 本目录与上级 `README.md` 的状态、证据和集成提交；共享源码变更先更新所有权表 |

U 唯一修改 `BaseShell` 的面板接线和 `base.css`，C/T 只改自己的组件并按现有 props 消费容器。各线使用独立 worktree；文件和分支所有者不能交叉写。`EconomyBoard` 的本地采购输入与 `ManufacturingBoard` 的本地数量须在工作区切换后留存；U 可通过保持组件挂载达成，无需改这两个组件。

## M 合同增量（调查后冻结）

`BaseResourceDto` 兼容性增加必填 `reservedQuantity: number` 与 `reservationSources: Array<{kind: "project" | "manufacturing"; id: string; name: string; quantity: number}>`。服务端仍以 `base_inventory` 为总量/占用的唯一事实；来源只从同基地既有项目与制造工单的持久 `reservedInputs` 生成，不作第二套库存。快照内 `quantity - reservedQuantity` 是可支配量；UI 可用它预览，但每条命令仍由服务端原子重验。未入库的 `purchases.in_transit` 不计入可支配量。旧客户端忽略新增响应字段；本批前后端同构建交付，不改版本号、数据库、迁移或 allowlist。

订单交付的现有 economy 条件写路径改为 `quantity - reservedQuantity >= 需求`；失败沿用 `RESOURCE_INSUFFICIENT` 与原事务回滚，成功只扣非预留量。最小回归为总 8/占 8/交 3 被业务拒绝、总 8/占 2/交 3 成功并剩总 5/占 2，订单/账款/回执按原子合同处理；真 PG 仅在明确隔离的临时库执行。M 前端在工程、制造、订单和物资详情显示总量、占用、可支配量及来源；批量制造按计划产出总数计算材料需求。服务端若拒绝，客户端刷新快照并将失败与新缺口留在原工作区。不为错误文案另增通用 `details` 协议。

## C07 后端增量（源码路径核对后冻结）

既有 M14 合同要求“本组缺工时请求、accepted helper 为指定步骤出工、步骤完成即 fulfilled”。当前结算只把本 tick 进度变动的 running 步骤送协作，且不检查本组是否在出工；请求查重只看 pending；跨组 helper 身份没有传给纯结算；整个项目完成才结案中途步骤。C 后端仅修这些已存在的同一步生命周期，不删历史、不改 Jev 选择预算或规则数值。新增测试要先证明：ready 且本组无人可请求、running 且本组正在工作不请求、已有 accepted 不新建、accepted helper 下一 tick 能出工、中途步骤完成即时结案。隔离真 PG 验证本事务的机器人状态读可见；保留 `recordAuditInCallerTx`，不能复发 B001 的跨连接审计死锁。

## 共同样例与门槛

复用各组件已有的 `buildSnapshot` 测试工厂，不为这批内部视图另造跨包 fixture。至少覆盖：空项目和可建位；进行中的项目在暂停与恢复后显示正确说明；1200×800、1200×701、720×450 与长邮箱；53 条历史中含两个活动项目和阻塞请求；制造工单 `active/paused/blocked/completed/cancelled`；切工作区时已输入的采购/制造数量及所选建设位不丢。模拟数据不得注入线上存档。

U 按 A01–A04/A07，C 按 A05，T 按 A08/A09 验收；相关 A10 回归及 A12 身份检查由 I 记录。先运行相关 web 单测与 typecheck，再做隔离浏览器的视口/键盘/真实接线检查；真实 PG 与生产部署另列。若浏览器或数据库环境不可用写 `NOT_RUN`，不把静态推断、零测试或 mock 当真实玩法验收。

回退按 U/C/T 独立提交撤销前端变更，保留存档和资产；任何 M 的数据合同变更另列回退办法。本批不改物流/离线/节奏数值、不合并或上线。
