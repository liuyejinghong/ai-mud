# Fable5 代码与产品审核报告（v0.7.0）

日期：2026-07-02
审核对象：`main` @ `7eb4b5d`（产品版本 0.7.0，Schema 12，API 19，Prompt 7）
对应交接文档：`docs/reviews/2026-07-02-fable5-code-review-handoff.md`

## 审核方法

- 全套验证命令实跑通过：`CI=true pnpm -r test`（服务端 162 个测试全绿）、`typecheck`、`lint`、`build`、`git diff --check` 均通过。
- 精读：AI 边界链路（policy/orchestrator/parsers/boundary tests）、NPC 任务与经济闭环（service/repository/迁移）、世界推进（lease/tick）、对话服务（含物资让渡）、产品文档（roadmap/design/handoff/releases）。
- 三个独立专项审查通道：前端 UI 状态、账号/后台/重置安全、测试覆盖与迁移一致性。
- 两条最重发现（0012 迁移未入 journal、世界重置为空壳）已独立复核确认。

---

## 总体判断

**是否建议进入下一阶段**：有条件建议——先用约一周清掉 4 个 Critical（其中 2 个是"必现级"而非"理论级"），然后进入下一阶段，但下一阶段不应是路线图上的 Admin/Simulation，而应是玩家核心乐趣验证（见"建议下一阶段路线"）。

**当前最大风险**：两层。

- **代码层**：经济写路径（NPC 任务托管/结算/退款、对话物资让渡）完全没有事务和条件更新保护，并发下必然出现奖励双发、押金双扣、余额丢失更新——这是"AI 不能虚空造物"防线背后被漏掉的"规则系统自己虚空造物"漏洞。加上迁移链已断裂（0012 不在 journal 里），干净环境部署任务功能必炸。
- **产品层**：7 个版本过去，"暗黑刷宝"这个核心定位一件宝都刷不出来——没有装备掉落、没有词缀、XP 只累计不升级（`level` 全代码库只有一处读取用于展示）。底层引擎越建越厚，但还没有任何一个版本验证过"有人想玩这个游戏"。

注意：162 个测试全绿的安全感有水分——全仓库 41 个测试文件中没有一个对真实 Postgres 执行过增删改查，所有 repository 层 SQL、迁移文件、并发行为都从未被自动化验证过。

---

## 代码与架构优点

- **AI 权限边界是真关住了，五层闭环**：`ai-purpose-policy.ts` 权限表（全部 `mutatesWorldState: false` + `allowedStateEffects: "none"`）→ `ai-prompts` 每个 purpose 的安全 parser（拒绝奖励承诺/OOC/规则变更/需求变更）→ `AiOrchestrator` 每个 purpose 强制模板 fallback → `ai_call_logs` 全量审计 → `ai-layer-boundary.test.ts` 回归保护。专门找过绕过路径：AI 输出只能落到任务的 title/description/reason 展示字段，且经过 `isValidTaskPresentation` 长度复验（`npc-task.service.ts:301-328`）；需求、数量、奖励、押金全部由规则先行裁决。没有发现越权路径。
- **`packages/game-rules` 是真实的纯规则层**：战斗、采集、饥饿、经济、NPC 让渡决策全部是可参数化纯函数，有独立测试。`decideNpcResourceRequest` 把"玩家自由文本讨要物资"做成了纯规则裁决（上限、保留量、关系门槛、近期让渡计数）。
- **玩家侧 `GameService` 事务纪律完整**：每个玩家操作都包在 `db.transaction` 里（`game.service.ts:237` 起）。
- **激活码并发双花防护正确**：`markUsed` 用原子条件 UPDATE（`WHERE status='unused' AND used_by_account_id IS NULL`），安全边界在 SQL 层。
- **admin 路由权限校验无遗漏**：11 条路由逐条核对，GET 全部校验 admin 角色，POST 额外校验 CSRF 头。
- **世界推进 lease 设计正确**：`acquireLease` 用 `onConflictDoUpdate` 原子抢锁，tick 结算和进度保存在同一事务内（`app.ts:58-66`），补结算有步数上限防雪崩。
- **版本兼容常量体系 + 发布说明纪律**：每个版本有 spec/plan/release note 三件套，release note 附验证命令，`WORLD_COMPATIBILITY` 八个子版本可追溯。

## 产品与设计优点

- **"规则拥有世界状态、AI 只有表达权"是产品级正确的决策**——保证了经济数值可调参、可模拟、可回归，这是"AI NPC 社会 + 自循环经济"能长期运营的前提。
- **NPC 任务来自真实需求 + 真实钱包托管**是最有差异化潜力的种子：任务不是刷出来的填充物，而是世界状态的自然产物。
- **证据等级设计（`dialogue_claim` vs `system_verified`）**：玩家吹牛进不了 NPC 的"可信记忆"，防住了 AI 记忆污染，有回归测试保护（压缩不能升级证据等级）。
- **经济机制闭环成立**：战斗耗耐久 → 修理耗矿 → 矿来自采集/任务 → 饥饿耗食物 → 食物来自采集/市场 → NPC 有工资和需求，供需由真实库存驱动。

---

## Critical 必须修

### C1. 迁移 0012 未接入 journal，干净环境部署必炸；`db:generate` 已不可信

- 文件：`apps/server/drizzle/meta/_journal.json`（止于 `0011_world_rumors`，已复核）；`apps/server/drizzle/0012_npc_task_proposal.sql`；`meta/` 下 snapshot 只有 0000-0002。
- 问题：`drizzle-kit migrate` 按 journal 决定执行哪些迁移，0012 永远不会被执行；0003-0012 共 10 个迁移是手写的、无对应 snapshot，`db:generate` 会拿 0002 的陈旧快照去 diff 当前 26 张表的 schema，产出错误迁移。
- 影响：任何新环境跑 `pnpm db:migrate` 后 `npc_tasks` 缺 `proposal_source`/`proposal_reason` 列，任务创建直接 SQL 报错。必现 bug。
- 修法：短期把 0012 补进 journal；中期从零库按 journal 跑通全部迁移、introspect 重建当前快照，恢复 generate 工作流；加 CI 步骤"空库跑全部迁移 + 与 schema.ts introspect 比对"（同时堵住未来所有同类漂移）。

### C2. NPC 任务全部写路径无事务、无条件状态更新，经济可被并发刷爆

- 文件：`apps/server/src/modules/npc-task/npc-task.service.ts:99-243`；`npc-task.repository.ts:285-299`（`updateTask` 无状态守卫）；`game.routes.ts:222-227`（注入 `app.di.db` 而非事务）。
- 问题：`completeTask` 依次做 6 次独立读写（读库存→读 NPC 库存→写玩家库存→写 NPC 库存→发托管铜币→改任务状态），无事务包裹，`updateTask` 不带 `WHERE status='accepted'` 条件；`expireDueTasks` 退托管同样裸奔；`syncOpenTasks` 建任务扣押金用陈旧余额，且 `npc_tasks` 没有"每 NPC 只能有一个进行中任务"的部分唯一索引；所有铜币更新都是"读旧值→JS 计算→写绝对值"的丢失更新模式。
- 影响：同一任务双击/网络重试并发提交 = 奖励双发 + NPC 库存双入账；并发过期 = 托管双退；并发状态拉取 = 同一 NPC 重复建任务、押金双扣；中途崩溃 = 玩家物品已扣但没拿到钱的半完成状态。双击就能触发。
- 修法三件套：① accept/complete/expire/sync 整体包进 `db.transaction`；② 状态迁移改条件更新并检查影响行数（`UPDATE ... SET status='completed' WHERE id=? AND status='accepted' AND accepted_by=?`，0 行即拒绝）；③ 加部分唯一索引 `CREATE UNIQUE INDEX ... ON npc_tasks(npc_actor_id) WHERE status IN ('open','accepted')`。铜币改原子增量 `SET copper_balance = copper_balance + $1`。

### C3. 对话物资让渡两侧转账无事务，同样可并发双发

- 文件：`apps/server/src/modules/dialogue/dialogue.service.ts:653-694`。
- 问题：铜币让渡是"NPC 减、玩家加"两条独立 UPDATE，物品让渡同理，全部用陈旧读值算绝对量；防刷的 `recentGrantCount` 检查也是 check-then-act。
- 影响：并行发两条"给我 5 铜币"消息可拿到双份让渡，NPC 余额被写坏。
- 修法：与 C2 同一模式——事务 + 原子增量。建议顺势抽统一的 `WalletService`/`InventoryService`（见架构风险 R2，这也是三处重复代码的根源）。

### C4. 前端：任意弹窗打开时 WASD 仍会触发移动

- 文件：`apps/web/src/features/game/GameShell.tsx:132`（`canMove`）、`:247-260`（keydown）。
- 问题：键盘守卫只检查 `event.target` 是否为输入控件，完全没有感知 4 个弹窗状态。
- 影响：玩家在市场/NPC 对话弹窗里按到 S 键，角色在弹窗背后被移走，弹窗展示的数据与服务端状态撕裂。
- 修法：收敛 4 个弹窗布尔为单一 `activeModal` 状态，`canMove` 和 keydown 守卫感知它（同时消灭 I8 中的两个前端问题）。

## Important 建议先修

### I1. AI 调用被内联在每个玩家请求的关键路径上

- 文件：`apps/server/src/modules/game/game.routes.ts:136-159`（`withNpcTasksAndRumors`）。
- 问题：每次移动/买卖/吃饭都会同步执行"全 NPC 过期检查 + 任务生成（可能触发 AI 提案，8 秒超时）+ 传闻同步（最多 3 次 AI 调用，各 8 秒超时）"。AI 关闭时只是 N+1 查询问题；开启 DeepSeek 后一次移动最坏挂几十秒。同时是 C2 竞态的放大器。
- 修法：任务生成、过期结算、传闻同步移进世界 tick（`WorldRuntimeService` 已有带 lease、事务化的现成入口），玩家请求只读。

### I2. NPC 任务和对话让渡的资产流动不写任何账本

- 文件：`npc-task.service.ts`（托管/发放/退款）、`dialogue.service.ts`（让渡）；对照 roadmap §8 "Avoid direct asset mutation outside Inventory/Ledger services"。
- 问题：`market_transactions` 只覆盖市场，任务和让渡的铜币流动无任何流水。v0.4 验收标准"3 天模拟无非法账本总额"实质上已不可验证。
- 修法：统一账本表 + "全世界铜币总量守恒"断言（初始铸币 + 系统注入 = 玩家 + NPC + 国库 + 托管之和），作为模拟和管理端的核心校验器。

### I3. 市场买卖在事务内仍有丢失更新

- 文件：`game.repository.ts:463-479, 603-611`。
- 问题：READ COMMITTED 下"SELECT → JS 计算 → UPDATE 写常量"两个并发事务都能读到旧值，后提交覆盖先提交。事务保证原子性，不保证隔离到可串行。
- 修法：改原子表达式 `SET quantity = quantity - $1` + `CHECK (quantity >= 0)` 约束，或 `SELECT ... FOR UPDATE`。

### I4. 世界重置是 v0.1 空壳，但对管理员显示成功

- 文件：`apps/server/src/modules/world-reset/world-reset.service.ts:7-23`（已复核：校验确认文本后直接返回 `ok: true, mode: "dry_run"`，全仓库无任何删除逻辑）。
- 影响：管理员点了会以为世界已重置；交接文档把它描述得像已实现功能，会误导协作者。
- 修法：短期把响应改成 `not_implemented` 并在前端禁用；实现时在单事务内清空 21 张世界表 + 重新初始化 + 写审计，显式保留 `accounts`/`activation_codes`/`audit_logs`。

### I5. 零真实数据库集成测试，E2E 全 mock

- 问题：所有 service 测试用内存 fake repo；两个 Playwright spec 用 `page.route()` mock 了 100% 后端接口；`schema.test.ts` 是"schema.ts 断言 schema.ts"的自我引用，防不了任何漂移；写得最讲究的 `acquireLease` 原子 SQL 从未在真 Postgres 上跑过。
- 修法：一个 docker/本地 Postgres 集成测试套件：空库跑全部迁移 → 种子 → 冒烟（注册/建角色/接任务/完成任务/买卖各一次）→ 铜币守恒断言。一个套件同时覆盖迁移链、repository SQL 和经济一致性三个盲区。

### I6. 无全局错误处理器，DB 原始报错回显客户端

- 文件：`app.ts`（无 `setErrorHandler`）；触发路径：`auth.routes.ts:126-129` 注册邮箱 check-then-act，并发重复注册会把 `duplicate key ... accounts_email_key` 原文返回给客户端。
- 修法：`app.setErrorHandler` 统一脱敏 + 唯一约束冲突特判为 400。

### I7. 登录无速率限制

- 文件：`app.ts:104-113`（未注册 rate-limit 插件）；`auth.routes.ts:156-184`。
- 修法：`@fastify/rate-limit` 按 IP + 邮箱维度限制 `/auth/login`、`/auth/register`。

### I8. 前端 API 层丢弃所有错误码

- 文件：`gameApi.ts:17-32`（`requestGame` 丢弃 `ApiErrorBody.error.code`）；`GameShell.tsx:228-231`（市场交易成功失败都强制关闭弹窗，失败原因不可见）；`App.tsx`（401 不导回登录页）。
- 修法：复用 `AuthPage.tsx` 已有的错误码映射模式，401 全局拦截清 session；市场弹窗只在成功后关闭或原地刷新。

### I9. `ADMIN_BOOTSTRAP_*` 是死配置

- 文件：`config/env.ts:19-20` 声明后无任何消费代码；管理员目前只能手工改库提权。
- 修法：要么删掉声明，要么补一次性、幂等、写审计的启动引导（仅账号不存在或非 admin 时生效，不得覆盖已有密码）。

## Minor 可后续优化

- `GameShell.tsx`：战斗弹窗状态跨行动残留（结束后再开战会自动弹出）；`market` 与 `state.market` 双份状态永不同步；无 ErrorBoundary；combatLog 用文本做 React key；无轮询导致挂机进度条冻结（也见"核心乐趣"节）。
- `GameShell.css`：传闻/日志/任务面板缺 `overflow-wrap`（AI 文本可能撑破面板），仅对话气泡做了处理。
- 前端硬编码 `"blackpine_outpost"`/`"corrupt_forest"` 字符串（`GameShell.tsx:142-145`、`gameApi.ts:50`），应改为服务端下发能力位。
- `auth.routes.ts:126-129` 注册泄露邮箱存在性；`:162-170` 登录 bcrypt 时间侧信道。
- session cookie 未真正启用签名（当前不可利用：cookie 是不透明随机 token + DB 哈希校验，但意图与实现不一致，未来往 cookie 里放可信数据时会引爆）。
- 激活码 `revoked` 状态在 schema 里存在但无任何路由可达；后台无"禁用账号 + 踢下线"能力（`accounts.status='disabled'` 同样不可达）。
- `dialogue.service.ts:266-273` 每条消息 familiarity +1 且无衰减——两句话满足讨要物资的关系门槛（`familiarity >= 2`），好在让渡上限和保留量兜住实际伤害。
- 根 `package.json` version 0.4.0 与 `PRODUCT_VERSION` 0.7.0 不一致；根目录游离的 `pnpm-lock 2.yaml` 应删除。
- `npc-task.service.ts:245-277` 任务需求检测硬编码野莓/铁矿/铁匠，应内容驱动化（见 R1）。

---

## 产品规划问题

### P1. 验证顺序错位：把"世界模拟深度"排在了"核心乐趣验证"之前（最大问题）

路线图 v0.4→v0.7 连续四个版本在做经济、NPC 生活、AI 表达、AI 提案，但设计文档第一句写的核心体验是"挂机刷宝"。现状：1 个村、1 张 5×5 野图、1 种怪、4 件物品、0 件可掉落装备、0 条词缀、XP 无升级逻辑。玩家唯一累积轴是铜币，而铜币没有大额消费点。**造了一台为刷宝游戏设计的精密发动机，但车上还没有装座位。** 世界模拟的价值只有被"想变强的玩家"反复路过时才会显形；没有乐趣钩子，再深的模拟也没有观众。

### P2. v0.4 的模拟验收从未兑现就滚入后续版本

路线图要求 v0.4 有"3 天无玩家模拟、账本总额合法"、v0.5 有"7 天模拟无死锁"，规划中的 v0.4.4（工资+模拟骨架）从未发布；模拟能力散落在 `runNpcSimulation` 里但没有账本守恒校验（账本本身不完整，见 I2）。经济类游戏跳过模拟验收，等于在没有仪表盘的情况下持续给经济加系统。

### P3. "现实时间流逝的世界"是设计支柱，但玩家下线回来什么都看不到

NPC 事件、传闻、记忆的数据全在库里，却没有"你离开的这段时间……"的呈现入口。数据已有、AI 表达层已有、规则边界已有，只缺一个离线摘要视图——这是全项目投入产出比最高的未开发功能。

### P4. 版本命名漂移开始出现

v0.7 在路线图里是 Admin/Simulation，实际做了 AI Task Proposal。建议立即重排 v0.8+ 路线图并在 roadmap 文档记录改动原因。版本纪律是这个项目的核心资产之一，别让它烂。

## 核心乐趣与体验风险

- **玩家能否感知 AI 和活世界：目前很弱，且是体验问题而非架构问题。** 玩家的全部 AI 感知面 = 2 个 NPC 的对话措辞 + 任务描述语气 + 8 条传闻。把 `AI_PROVIDER` 切回 template，玩家几乎无法察觉区别——四个版本建起来的 AI 层，体验增量接近于零。下一步 AI 工作应全部投向"可感知的连续性"：NPC 在对话里主动引用你上周交付的矿石（记忆已存）、传闻提到你的名字、NPC 因你的历史行为改变让渡态度（favor 已有雏形）。**放大表达，而不是扩大权限**——方向已选对，力度不够。
- **玩家是否有明确目标和成长动力：没有。** XP 不升级、装备不掉落、没有更难的区域。前 30 分钟体验：建角色→挪格子→采野莓→打狼（进度条还不会自动动）→卖材料→修装备→吃饭。这是经济模拟 demo 的体验，不是游戏的体验。
- **当前闭环哪里最弱：动机环。** 机制环（吃饭/修理/买卖/任务）成立，但全是"维持性开销"——玩家花铜币是为了不变弱，而不是为了变强。挂机游戏的铁律：成长收益必须持续压过维持成本，否则挂机就是纯损耗。

## 架构风险

### R1. 规则层是引擎，编排层还不是

`game-rules` 可复用性合格（`movePosition` 接受任意 zone 定义、战斗/采集全参数化），但 service/routes 层是"单张地图的手工装配"——`enterCorruptForest` 是专用方法+专用路由，`BLACKPINE_OUTPOST_ID`、`DIALOGUE_NPC_KEYS`（写死 2 个 NPC）、任务需求检测（写死野莓/铁矿/铁匠）遍布服务层。新增第二张野图或第三个可对话 NPC 需要改动多处服务代码。**做副本之前必须先做一次"内容驱动化"重构**：进入区域、可对话 NPC、任务需求检测全部改为读 `packages/content` 的声明式定义，否则副本系统会把硬编码问题放大十倍。

### R2. 模块间共享写路径正在发散

`NpcTaskRepositoryPort` 和 `DialogueGameRepositoryPort` 各自重复声明了角色库存/铜币的读写方法，三个模块用三套代码写同一批表——这是 C2/C3 和账本缺失（I2）的共同根源。需要统一的 `WalletService`/`InventoryService`（roadmap §8 本来的要求）。

### R3. 请求驱动模型开始顶不住"活世界"

无 WebSocket、无前端轮询，世界 tick 靠 setInterval + 玩家请求兜底，任务/传闻同步塞在请求路径里（I1）。做副本和实时事件之前需要决策推送模型；roadmap 技术栈里写了 WebSocket 但从未实现。

### R4. GameShell 已到重构阈值

870 行、15 个 `useState`、4 个互不感知的弹窗布尔，前端最严重的 3 个问题共享同一根因（无单一事实来源）。可维护性评分 4/10。建议弹窗状态机重构与乐趣切片的 UI 改动合并做。

## 测试缺口

1. 迁移从未在空库自动化跑通（C1 事故的直接成因，也是唯一能防住此类事故的手段）。
2. 零真实 Postgres 集成测试——所有 Drizzle SQL（包括 `acquireLease` 原子抢锁）只被内存 fake 的"JS 复刻版"测过。
3. 零并发测试——任务双完成、市场丢失更新、让渡双发全部测不到；现有测试全是单线程顺序调用。
4. E2E 两个 spec 均 100% mock 后端，是 UI 交互测试而非端到端测试；市场买卖、NPC 对话、任务闭环无 E2E。
5. 经济守恒无断言——没有任何测试检查"世界铜币总量守恒"，这是经济游戏最便宜也最值钱的一条不变量。
6. `audit` 模块零测试。

---

## 建议下一阶段路线

### 1. v0.7.1 —— 停止扩功能，补"不可逆损坏"级债务（约 1 周）

- 修迁移链：journal/snapshot 重建 + 空库跑通脚本进 CI（C1）。
- NPC 任务与对话让渡：事务化 + 条件状态更新 + 部分唯一索引 + 铜币原子增量（C2/C3）。
- AI 提案/传闻同步移出玩家请求路径，进世界 tick（I1）。
- 统一账本 + 铜币守恒断言（I2）。
- 世界重置标注未实现或真正实现（I4）。
- 最小 Postgres 集成测试套件（I5）。

理由：这些债不修，内测第一天双击提交任务就会刷钱，新环境部署直接炸；越晚修，需要事务化的写路径越多。**只修这些，不做大重构**——GameShell 重构、内容驱动化可并入后续版本顺带做。

### 2. v0.8 —— 玩家乐趣垂直切片，第一个"能回答好不好玩"的版本（2-3 周）

- 升级逻辑与属性成长曲线。
- 最小刷宝循环：装备掉落 + 稀有度 + 2-3 条随机词缀（规模不用大，多巴胺回路要通）。
- 第二种怪/更深的危险区域，给成长一个用武之地。
- **离线世界报告**："你不在的 6 小时里：Borin 修好了炉子，市场铁矿涨了 2 铜……"——数据全在 `npc_events`/`world_rumors` 里，投入产出比全项目最高，一次性兑现"真实时间世界"和"AI 表达"两大支柱的体感。
- 前端轮询让进度条动起来 + 弹窗状态机重构（C4/R4 顺带解决）。

做完发给 5 个朋友，收集"你玩了多久、为什么停"。这是整个项目第一次真正的产品验证——在此之前所有工程投入的价值都是假设。

### 3. v0.9 —— Admin/Simulation 回归路线图（顺序调整后）

- 优先：账本一致性校验器和经济仪表盘（保护 v0.8 引入的更复杂经济）。
- 其次：3/7 天模拟报告、真正的世界重置、账号管理（禁用/踢线/激活码作废）。

理由：Admin/Simulation 的价值前提是"有玩家在玩、有经济在跑"。观测工具应在被观测对象值得观测之后到位——但不能更晚，因为 v0.8 的掉落系统会显著加大经济调参需求。

## 最终结论

**暂停扩功能先补债（约一周），然后调整路线转向玩家体验验证。**

工程底盘在同类原型里罕见的好——AI 权限边界五层闭环、规则纯函数层、版本纪律、文档链路都是真材实料，方向没有规划错，不需要推倒重来。但有两个必须立刻正视的失衡：

1. 经济一致性保护只做了一半（玩家侧有事务，NPC 任务/让渡侧裸奔），加上迁移链断裂，这两处是"内测第一周就会出事故"级别的债。
2. 验证顺序倒置——在一个 4 件物品、刷不出宝、升不了级的世界上，已经盖起了 26 张表的治理体系。

接下来最危险的路径是继续向下打地基（Admin/Simulation 或更多 AI 能力），最正确的路径是用最小的乐趣切片去验证有人愿意在这个世界里花时间——已经为"世界活着"付了全款，现在该让玩家看见它活着。

---

## 补充审核：MUD 引擎层专项（2026-07-02 追加）

初版报告只覆盖了 `game-rules` 纯函数质量和编排层硬编码（R1），未对引擎本体做专项审查。本节补上：行动状态机、时间/结算模型、战斗确定性、地图实例模型、NPC 行动引擎、世界再生机制、副本就绪度。

### 引擎现状盘点（当前"引擎"由六块组成）

1. **玩家行动引擎**：`character_actions` 单活动行动状态机（active → completed/cancelled），惰性结算——每次玩家请求开头在事务内跑 `settleDueAction` 追赶。
2. **战斗引擎**：`simulateCombat`（combat-rules.ts）——种子确定性 ATB 预演算。战斗在 `startCombat` 瞬间全部算完（种子 = `characterId:encounterId:时间戳`），完整时间线和结局存进 action payload，到 `endsAt` 才结算入账。敏捷决定攻击间隔（`intervalMs`），时长由数值推导，满足设计支柱 #11。
3. **采集引擎**：`calculateGatheringPlan/Settlement`（gathering-rules.ts）——带 `settledCycles` 游标的幂等追赶结算，取消保留已完成周期（设计支柱 #13 忠实实现）。
4. **地图引擎**：`ZoneDefinition` 网格 + `map_instances` **每角色私有实例**（含私有 `resourceCharges`），movePosition 只做边界检查。
5. **NPC 行动引擎**：`npc_actions` + 固定优先级行为树（结算到期行动 → 需求 → 卖余货 → 回市场 → 开工作），由世界 tick 驱动（lease + 60s 步长 + 补结算上限）。
6. **模拟器**：`runNpcSimulation` 克隆现场数据到内存、按小时步长快进 1-7 天，带 `validateNpcSimulationHealth` 非负校验。

### 引擎层优点

- **行动状态机是全项目最有复用价值的引擎资产**：单活动行动、payload 类型化、游标式幂等追赶、取消语义清晰。roadmap v0.3 验收（"无全局每秒 tick"、"取消保留已完成周期产出"）被忠实实现。
- **战斗预演算模型聪明**：确定性、可回放、可测试、零运行时开销，正确规避了 per-second tick。
- **世界时钟 lease 设计正确**（原子抢锁 + 事务化结算 + 步数上限防雪崩）。
- **模拟器非破坏性设计**（克隆到内存跑），health 校验骨架已就位。

### E1【Critical·引擎/产品双料】世界没有任何再生机制，动力学单调递减，稳态是死寂

这是引擎层最重要的发现，直接命中产品支柱"世界自己过日子"：

- **资源永不刷新**：玩家侧 `map_instances.resourceCharges` 只在首次进入时初始化、只减不增（game.service.ts:293/1092，全文件无 refresh 逻辑）；NPC 侧 `world_resource_nodes.charges` 同样只 -1（npc.service.ts:654-657）。野莓丛全世界共 **3** 次采集机会、兽尸 2 次、兽皮 1 次——农夫这个职业的全部工作寿命是 3 个采集周期，之后永远无事可做。铁矿 120 次后世界再无矿。
- **NPC 饥饿永不衰减**：`settleHunger` 只对玩家角色调用（game.service.ts:243/833），NPC hunger 初始 5、只增不减 → `chooseNpcMealIntent` 永远返回 none → **NPC 永远不吃饭、不买食物、food_shortage 任务是死代码**（触发条件 `hunger <= 2` 永不满足）。两种已实现任务里只有铁匠的 ore_shortage 能真实触发。
- **工资系统是死代码**：`payNpcWage`（npc.service.ts:207）除定义外零调用点 → 国库→NPC 的货币注入通道不存在，v0.4 验收的"NPC 工资"没有接线。
- **NPC 持有资源没有任何消耗端**：铁匠通过任务收到的矿不用于任何事（玩家修理消耗的是玩家自己的矿），下一 tick 会被 `sellNpcSurplusToMarket`（对第一个数量>0 的物品无差别抛售）卖回市场 → 矿存量 <3 → 再发任务再托管。矿在玩家↔铁匠↔市场之间空转，形成结构性套利循环（若任务奖励 36 铜 > 市场购入 3 矿成本，玩家可无限薅铁匠钱包直到其破产，之后矿任务永久停摆）。
- **稳态推演**：几天内农夫/矿工资源耗尽、铁匠钱包被任务循环抽干、市政官和铁匠本来就无工作意图（`workResourceId: null`）→ 全部 NPC 永久空闲，唯一的物资注入只剩狼的无限掉落。**"自循环经济"目前只有"供"和"倒手"，没有"需"和"再生"，数学上必然走向死寂。** 7 天模拟的 health 校验（只查非负和超期行动）完全检测不到这种"活性死亡"。

修法（最小版，三处都是现成函数缺调用/缺配置）：世界 tick 里加资源按日 refresh（world_resource_nodes 和 map_instances 都要）、NPC hunger 按小时衰减（复用 `settleHunger`）、接通 `payNpcWage`（市政官 `paysWages: true` 的内容定义已经写好了）；给 NPC 资源加消耗端（最简单：铁匠"使用"矿修炉——定期销毁 + 产出事件，同时解决抛售循环——`sellNpcSurplusToMarket` 需要排除 NPC 自身需求物品，保留量规则 `ITEM_RESERVE` 在让渡路径已有，抛售路径没用上）。

### E2【Critical·玩法完整性】战斗结局预泄露 + 零代价逃跑 = 风险系统完全可绕过

- `toCurrentActionDto` 在战斗开始瞬间把**完整战斗时间线**全量下发给客户端（game.service.ts:1240-1250，`combatLog: payload.combatLog`）——包括最后几刀谁倒下。
- `cancelAction` 对战斗只写一条 escape 事件就取消（game.service.ts:478-483）：HP 损失、耐久损耗、受伤判定**全部只在完成结算时应用**（settleCombatAction），取消 = 零代价。
- 种子含毫秒时间戳 → 每次重开重摇结局；遭遇无消耗/冷却状态 → 无限重开。

支配性策略：开战 → 读 combatLog 看结局 → 要输就取消 → 立刻重开，直到摇出胜利。**受伤回村（设计支柱 #12，倒逼参与生活经济的核心机制）事实上不存在**，且可无风险无限刷狼（xp + 100% 兽肉掉落）。修法：① DTO 按 elapsed 时间截断 timeline，只下发"已播放到"的前缀；② 逃跑按已播放时间线结算部分伤害/耐久（或明确逃跑代价）；③ 遭遇加冷却/消耗状态。

### E3【Critical·与主报告 C2 同类】玩家行动结算无并发守卫

`markActionCompleted`/`markActionCancelled` 是无条件 UPDATE（game.repository.ts:735-747，无 `AND status='active'`）。`settleDueAction` 在每个玩家请求的事务开头执行，READ COMMITTED 下两个并发请求（双开标签页/连点）都能读到同一个 active 战斗行动并各自完整结算 → **战斗奖励双入账**；cancel 与 settle 并发交错同理。修法与 C2 相同：条件更新 + 检查影响行数，0 行即另一事务已处理。

### Important（引擎专项）

- **E4 双轨行动系统**：玩家（`character_actions`，请求驱动惰性结算）和 NPC（`npc_actions`，tick 驱动）是两套平行实现，结算代码、地图资源（私有实例 vs 共享节点）互不相通。后果：玩家在野外永远看不到 NPC、不与 NPC 竞争资源——"共享世界"目前只存在于市场/任务/对话层，野外是单机。走向副本和共享野图前需要显式决策：统一 actor 模型，还是接受双轨并明确各自边界。
- **E5 结算代码硬编码内容**：`settleGatheringAction` 直接引用 `CORRUPT_FOREST` 常量（game.service.ts:1060）、NPC 行为树硬编码腐林/黑松哨站坐标——新增第二张地图必须改引擎代码，这是主报告 R1 在引擎侧的具体证据。
- **E6 模拟保真度**：模拟器步长 1 小时 vs 生产 60 秒 tick，二者动力学不等价；health 校验缺"活性"指标（NPC 空闲率、资源存量趋势、货币流速、任务触发率）——正是这些指标能暴露 E1。
- **E7 无事件总线**：`gameEvents`/`npcEvents` 是展示日志，传闻系统直接查表挖掘。roadmap 预留的"事件总线"边界未成形——副本的脚本化事件、天气、随机事件（设计支柱 #14）都没有挂载点。

### 副本就绪度评估（对照设计目标 #15：文字版五人本）

可复用积木已有：每角色 `map_instance`（天然适合副本实例化）、种子确定性战斗、行动状态机、注入式 repo（可做副本专属数据域）。
缺失的引擎子系统：多房间地图结构（当前 zone 是单层网格）、房间推进/Boss 阶段机制（当前遭遇 = 固定格子上的一次性即时演算，无阶段、无机制、无脚本）、脚本化事件系统（依赖 E7）、副本专属产出隔离、组队/多人边界（当前所有系统假设单角色）。
结论：距离副本还缺 4-5 个子系统，但地基（实例地图 + 确定性战斗 + 状态机）方向正确，不需要推倒。

### 引擎层结论

行动状态机、确定性战斗、lease 时钟是真正可复用的引擎资产，"类 MUD 引擎"的雏形存在且方向对。但引擎缺一个最关键的子系统——**世界再生调度器**（资源刷新、饥饿衰减、工资发放、消耗端）。没有它，"世界自己过日子"是一句反话：世界只会自己走向死寂（E1）；而战斗风险可完全绕过（E2）意味着当前唯一的"代价机制"也是空的。**E1-E3 应并入 v0.7.1 补债清单**，其中 E1 的最小修复量很小（三处现成函数缺调用），但对产品支柱的意义最大。

---

## 附：Critical/Important 修复清单（可直接作为 v0.7.1 任务列表）

| 编号 | 内容 | 文件 | 级别 |
| --- | --- | --- | --- |
| C1 | 0012 迁移补入 journal + 重建 snapshot + CI 空库迁移验证 | `apps/server/drizzle/meta/_journal.json` | Critical |
| C2 | NPC 任务事务化 + 条件状态更新 + 部分唯一索引 + 铜币原子增量 | `npc-task.service.ts` / `npc-task.repository.ts` | Critical |
| C3 | 对话物资让渡事务化 + 原子增量 | `dialogue.service.ts:653-694` | Critical |
| C4 | 弹窗打开时禁用移动快捷键（activeModal 状态机） | `GameShell.tsx` | Critical |
| E1 | 世界再生调度器：资源刷新 + NPC 饥饿衰减 + 接通工资 + NPC 消耗端/抛售排除需求品 | `npc.service.ts` / `game.service.ts` / 世界 tick | Critical |
| E2 | 战斗时间线按已播放前缀下发 + 逃跑代价 + 遭遇冷却 | `game.service.ts:1240-1250` / `cancelAction` | Critical |
| E3 | 玩家行动结算/取消改条件更新，防并发双结算 | `game.repository.ts:735-747` | Critical |
| I1 | 任务生成/过期/传闻同步移出请求路径进世界 tick | `game.routes.ts:136-159` | Important |
| I2 | 统一账本 + 铜币守恒断言 | 新增 ledger 模块 | Important |
| I3 | 市场库存改原子递减或 FOR UPDATE | `game.repository.ts` | Important |
| I4 | 世界重置标注未实现或真正实现 | `world-reset.service.ts` | Important |
| I5 | 最小 Postgres 集成测试套件（迁移+冒烟+守恒） | 新增 | Important |
| I6 | 全局 setErrorHandler + 唯一约束冲突特判 | `app.ts` | Important |
| I7 | 登录/注册速率限制 | `app.ts` | Important |
| I8 | 前端错误码解析 + 401 全局拦截 + 市场弹窗错误处理 | `gameApi.ts` / `GameShell.tsx` / `App.tsx` | Important |
| I9 | ADMIN_BOOTSTRAP 死配置：删除或实现 | `config/env.ts` | Important |
