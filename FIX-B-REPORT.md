# FIX-B-REPORT — design-review-20260927 修复批次 B 线（前端）

- 分支：`fix/design-review-20260927-b`（git worktree `/Users/ethan/Documents/yudian-fix-b`）
- 基线：`6450692`（origin/main，产品 1.0.2 资产口径）
- 改动范围：仅 `apps/web/**` ＋ `docs/architecture/module-boundaries.json`（只 append 新文件条目）。未触 apps/server、packages/**、migrations、version.ts；未 push。
- 验收命令（全绿）：
  - `pnpm install` ✓
  - `pnpm --filter @ai-mud/web typecheck` ✓
  - `pnpm --filter @ai-mud/web test` → **37 文件 / 259 测试全过**（229 既有 + 30 新增；无既有测试删除或弱化）
  - `node scripts/architecture/arch-check.mjs` → `RESULT: PASS (baseline clean, debts accounted)`，UNCOVERED violations: 0

## 一、改动文件清单

新增（5，均已登记 module-boundaries.json）：
- `apps/web/src/features/base/runtimeState.ts` — 冻结契约 2 的消费与回退语义
- `apps/web/src/features/base/runtimeState.test.ts`
- `apps/web/src/features/base/useSimClock.ts` — 运行态时钟本地插值
- `apps/web/src/features/base/EventsPanel.tsx` — 事件记录面板（契约 1）
- `apps/web/src/features/base/EventsPanel.test.tsx`

修改（8）：
- `apps/web/src/features/base/LandingShell.tsx`（主战场：D010/D011/D013/D014/D015/D016/D017/D021/D023/D024/D025）
- `apps/web/src/features/base/LandingShell.test.tsx`（新增 13 条行为测试）
- `apps/web/src/features/base/BaseApp.tsx`（D010 接管反馈/D011 轮询守卫/D018 toast/D020 串行化/D024 横幅/D013 接线）
- `apps/web/src/features/base/BaseApp.test.tsx`（新增 4 条测试；BaseShell mock 扩一个时钟连点按钮）
- `apps/web/src/features/base/BaseShell.tsx`（旧档 D010 冻结态如实显示）
- `apps/web/src/features/base/ProjectBoard.tsx`（旧档冻结期机组措辞）
- `apps/web/src/features/base/baseApi.ts`（契约 1 的本地类型与端点函数）
- `apps/web/src/features/base/base.css`（D016 滚动可供性＋新增 UI 元素样式）
- `docs/architecture/module-boundaries.json`（append 5 条）

## 二、逐项落点（文件:行）

### D010-ui 如实状态（冻结契约 2）
- 契约消费/回退语义：`runtimeState.ts:20-43`（`effectiveRunning` 缺失 → 回退现有行为只看 timeMode；`pauseReason: 'foreground-required'`）
- 顶栏冻结徽标「已暂停：等待前台接管」：`LandingShell.tsx:467-470`；冻结期顶栏不提供"暂停"、倍速禁用（`:471-483`）
- 接管失败可见原因＋重试入口：`BaseApp.tsx:213,596-607`（controlNotice state＋handleAcquireControl）→ `LandingShell.tsx:488-492`（role="alert"，接管按钮保留可点）
- 清除冻结期矛盾措辞：
  - 机组 chip 冻结显示"已暂停"（不再"作业 · 出工中"）：`LandingShell.tsx:796-800` 附近 DeviceChip（`frozen && busy → 已暂停`）
  - 队列卡逐卡"已暂停"标记＋冻结总说明：`LandingShell.tsx:593-595,609,626,656,672`
  - 旧档同治：`BaseShell.tsx:109-111,190,217,327,337-345,361-362`（徽标/设备chip/工程队"暂停待恢复"）；`ProjectBoard.tsx:60,64,91,131,151`（"机组 N 台暂停待恢复"）
- 受 D010 影响的既有测试：**无需更新**（回退语义保证字段缺失时行为不变，259 全过）

### D011-low 推进感
- 时钟本地插值（按当前 speed 走字，快照到达/运行切换时重校准；停针期不补算）：`useSimClock.ts:17-45`；接线 `LandingShell.tsx:429`
- 轮询稳健性：acquire 请求挂死超 8s 不再阻塞快照轮询（R05"空闲 0 请求/成波跳变"的一种成因）：`BaseApp.tsx:43,210,250,262,344`
- 轮询间隔：现有 5s（`SNAPSHOT_POLL_MS`）已是合同上限 10–15s 以内，未改；命令受理后主动刷新快照为既有路径（runCommand/runLandingCommand 均 await refreshSnapshot），未破坏
- 测试：`BaseApp.test.tsx` D011 挂死 acquire 用例；`LandingShell.test.tsx` ×4 每 15s 走 1 基地分钟/暂停停针两用例

### D013-ui 事件历史面板（冻结契约 1）
- 契约类型与端点：`baseApi.ts:130-148`（`BaseEventDto`/`getBaseEvents`，GET `/base/events?limit=100`，本地声明不 import A 线类型）
- 面板组件：`EventsPanel.tsx`（折叠面板挂右栏底部；类型标签/标题/明细/simTime"MM-DD HH:MM"；refreshKey=baseRevision 变化即刷新；404/失败/无会话→整个面板隐藏，无报错弹窗）
- 接线：`BaseApp.tsx:1026-1027`；挂载点 `LandingShell.tsx:588`
- 测试：`EventsPanel.test.tsx` 4 条（契约字段、404 降级、无会话不请求、refreshKey 重拉）

### D014 就地反馈
- 维护前置移进动作现场：队列卡"维护（1 备件）"按 `maintenanceReadiness` 就地禁用＋原因（"需要先建成维护工位（先在维护工位安装位开工）"/"缺 1 备件（可用 N）"）：`LandingShell.tsx:182-197,665-677`；加工间面板槽行同治 `:1387-1402`
- 下采矿单/勘探就地原因与下一步：`LandingShell.tsx:1206-1217,1275-1277`（未选筑垒/驮运/余量不足）、`:1127-1131`（先选望山）
- 测试：`LandingShell.test.tsx` D014 三条（未建工位禁用＋原因、缺备件禁用＋缺口、条件齐备可用）＋采矿原因一条

### D015 配方级缺料路径
- 配方行就地"可用 N · 缺 M"＋复用项目级 `SourceChain` 组件（不重造）：`LandingShell.tsx:1346-1435`（renderRecipe 缺口行＋准备材料＋获取路径展开）
- 仓库对可用 0 的已知名目显示芯片（knownItemIds = 库存 ∪ 配方输入/输出 ∪ 工程输入）：`LandingShell.tsx:69-82,894-910`；ResourcePanel 支持无库存物名目（可用 0＋获取路径）`:1288-1301`
- 地图已建成加工间行加"前往加工"入口：`LandingShell.tsx:722-748`（组合卡片：主体选择钮＋快捷钮，避免嵌套 button）
- 测试：`LandingShell.test.tsx` D015 三条

### D016 滚动可供性
- `base.css` `.landing-panel.has-overflow-affordance` / `.landing-map`：可见细滚动条（webkit+scrollbar-color）＋上下 14px 渐隐边；aside 加类 `LandingShell.tsx:560`

### D017 返回原工程保留获取路径展开态
- 展开态从 SitePanel 局部 state 上提为 Shell 层 `sourceChain`（`LandingShell.tsx:436,585,837-852,1016-1036`）；"返回原工程"后按 buildKey 复原展开；"返回地图"显式收起
- 测试：`LandingShell.test.tsx` D017（深链离开→返回→获取路径仍展开）

### D018 Tab 序＋toast 自动消隐
- 完工 toast（completion banner）10s（≥8s）自动消隐、hover 暂停计时：`BaseApp.tsx:45,215,407-412` ＋ banner onMouseEnter/Leave（`:955-969` 附近）
- Tab 序：landing DOM 序＝视觉序（顶栏→目标→地图→右栏→队列）；R02 记录的 BODY 焦点站来自永驻 toast 容器，随自动消隐消除
- 测试：`BaseApp.test.tsx` D018（悬停不消失/离开后到期消隐）

### D020 暂停/恢复点击串行化
- 时钟命令链式串行（上一条完成再受理下一条；in-flight 期间按钮本就禁用，同帧连点也排队不吞）：`BaseApp.tsx:217,528-551`
- 测试：`BaseApp.test.tsx` D020（pause 未完成前 resume 不发出，完成后受理）

### D021 充电吞吐实测口径
- `LandingShell.tsx:419-420,1307-1313`："充电吞吐 每机约 0.3 kW × 可充 N 台（电路上限 X kW）"，替换误导性的裸"充电上限 2.0 kW"
- 测试：`LandingShell.test.tsx` D021

### D023 术语统一
- 统一为"预留（本工程）/已占用"：
  - 仓库首现注释："可用＝总量−已占用；已占用＝已为进行中的工程或工单预留。" `LandingShell.tsx:894`
  - 库存 chip/详情 `（总量 X，已占用 Y）`（原"占用""工程占用"）：`LandingShell.tsx:900-906,1310-1313` 附近
  - 采矿单"下采矿单（为本工程预留 N 矿）"：`LandingShell.tsx:1273`；受理文案同步 `BaseApp.tsx:707`
  - 资源详情来源行"预留 N"：`LandingShell.tsx:1318-1322`
- 范围注记：旧档面板（EconomyBoard/ManufacturingBoard/ObjectPanel）沿用"可支配/已占用/占用去向"自成体系，且既有测试锁定该文案；D023 证据全部来自 landing（R05-F04），本轮不改旧档词汇，避免无证据范围的测试翻动

### D024 投产收益行＋完工横幅
- 收益 fallback：无数值收益的解锁类设施补用途行（仓储棚"矿石入库与加工前置"；维护工位"解锁加工槽维护（每 10 批消耗 1 备件）"）：`LandingShell.tsx:147-166`
- 完工横幅写明提升内容（如"增建太阳能已完工：发电 +4.0 kW。"）：`BaseApp.tsx:292-300`（`projectBenefitSummary` `LandingShell.tsx:170-177`；无模板时保持旧句兜底）
- 测试：`LandingShell.test.tsx` D024 两条；`BaseApp.test.tsx` D024 横幅一条

### D025 倍速档 aria-pressed
- landing 倍速按钮 aria-pressed 原已存在并随冻结语义修正（`LandingShell.tsx:475-479`），本轮补测试锁定＋给旧档 `.base-speed-row button[aria-pressed="true"]` 可见选中样式（`base.css`，原来无任何选中态样式）

## 三、Mock 契约清单（集成时需与 A 线对齐）

1. **快照运行态字段（契约 2）**：B 按 `{ effectiveRunning: boolean; pauseReason: 'foreground-required' | null }` 消费（本地类型 `runtimeState.ts:8-11`，测试 fixture 直接塞字段）。字段**缺失时回退现有行为**，因此 A 线若改字段名/语义，UI 不会报错但会静默回退——集成时确认字段名与取值逐字一致。
2. **事件端点（契约 1）**：`GET /base/events?limit=100`，响应 `{ events: Array<{ id, type, title, detail, simTime, createdAt }> }`，createdAt 降序。B 的 type→标签映射表（`EventsPanel.tsx:10-19`）按推测类型词表 mock：`project_started/project_completed/project_cancelled/manufacturing_started/manufacturing_completed/survey_completed/extraction_delivered/order_delivered`；**未知 type 显示原文不隐藏**。集成时按 A 实际 type 枚举校正映射（顺带把 `is-other` 样式类收紧）。鉴权：GET 带 cookie＋`x-csrf-token` 头（与 request 封装一致）；若 A 要求 controlToken 头需在 `getBaseEvents` 补一行。
3. **事件刷新节奏**：refreshKey=snapshot.baseRevision（运行态每 sim 分钟一变，×4 下约 15s 一次全量拉 limit=100）。若 A 认为过频，可改为单独的轻量轮询/游标——集成时议。
4. **维护前置判定**：B 用 `snapshot.capabilities` 含 `"maintenance"`＋`spare_part 可用 ≥1` 就地禁用（`LandingShell.tsx:182-197`）；与服务端 `REQUIREMENTS_NOT_MET`（production-slot.service.ts:74）条件一致，但 B 是 UI 预判，最终仍以服务端为准（禁用只是预告，不替代服务端校验）。
5. **充电吞吐常数**：`PER_DEVICE_CHARGE_KW = 0.3`（R03-F05 实测 0.26–0.33 的显示近似）。若后续契约把单机充电速率下发到快照/模板，应改为读真实值。

## 四、测试结果摘要

- `pnpm --filter @ai-mud/web test`：**37 个文件 / 259 条测试全部通过**（既有 229 条零删除、零弱化、期望未改；新增 30 条：LandingShell 13＋BaseApp 4＋EventsPanel 4＋runtimeState 4＋既有文件内零星 D025 断言并入新用例）。
- `pnpm --filter @ai-mud/web typecheck`：通过（含 `exactOptionalPropertyTypes` 严格项）。
- `node scripts/architecture/arch-check.mjs`：PASS，UNCOVERED violations 0；新文件已按 `client_text/client_view|test` 登记。
- 未跑 playwright e2e（本批验收口径不含；`下采矿单` 等 e2e 定位串已核对仍兼容——按钮文案前缀未变）。

## 五、遗留风险

1. **契约对齐**（见 §三）：字段名/type 枚举/鉴权细节以 A 线实际实现为准；B 侧全部做了降级（回退/隐藏），对不齐不会崩，但会少功能（事件面板隐藏、冻结态不显示）。
2. **D011 成因未定案**：B 只做了两类低风险改善（插值＋挂死 acquire 不阻塞轮询）。若真人复测确认成因为服务端推进闸门/其他，显示滞后可能仍在——以真人复测结论为准。
3. **插值的每秒重渲染**：运行态 LandingShell 每秒重渲染一次（仅文本差量上 DOM）。文字原型体量下无感；像素期改造时应把时钟收敛到独立订阅点。
4. **旧档词汇残留**：旧档面板仍用"可支配/占用去向"词汇（自成体系、测试锁定）；若总控要求全局统一需另开一个小工作包翻动旧档测试。
5. **冻结期队首措辞**：landing 队列卡的进度数字（如"已送 0/4 批"）在冻结期仍显示（是服务端事实），仅以"已暂停"标记消除"仍在跑"的暗示；若验收代理认为数字也应隐藏，属一行改动。
6. **`useSimClock` 依赖 `Date.now()`**：真实浏览器正常；如未来引入服务端时钟偏移校正，需在该 hook 单点改。
7. **`maintenanceReadiness` 的 `"spare_part"`/`"maintenance"` 为字面量 ID**：与现有内容包一致；内容目录化后应随 DTO 下发（与 §三.5 同类）。
