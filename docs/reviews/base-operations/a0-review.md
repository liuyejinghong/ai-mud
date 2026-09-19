# A0-04 独立审查：《余电》基地经营 A0 收口终审

- 审查人：glm-architect（独立终审，只读；本轮未修改任何文件、未 commit/push、未执行任何写操作命令）
- 日期：2026-09-19
- 基线 HEAD：`d588a4072e5059a9440488dcced445b79e312ee1`（分支 `docs/base-operations-milestones-20260919`，工作树干净）
- 被审产物：`docs/reviews/base-operations/` 下 baseline.md（A0-01，commit `5dd76a9`）、scenario-lock.md（A0-02，`ef5d1b7`）、contracts.md＋ownership.json（A0-03，`d588a40`）
- 审查基准：`docs/implementation/2026-09-19-base-operations/` 00-scope-and-a0.md、01-domain-contracts.md、02-parallel-development.md、v0.12.0-first-base.md、milestones.json；代码事实 module-catalog.json / module-boundaries.json / legacy-boundary-debt.json / packages/shared/src/version.ts

## 1. 总体裁决

**APPROVE_CONTRACT_READY**

四份产物相互一致、与 00/01/02 无实质矛盾；五个退出条件全部满足；ACP-B01 不成环、不违反 platform 不反向依赖；未发现同文件双写。存在若干路径级错误与清单遗漏，均属 M12-P 落地时按既有授权可修正的细节（contracts.md §1 明文允许"细化路径与参数，不得收缩语义"），不构成阻塞。本轮审查自身验证边界见 §6。

## 2. 逐条审查清单结果

**（1）文档间及与 00/01/02 的一致性 —— 通过（含 2 处措辞级瑕疵）**

核对项与证据：12 台设备三组分工（00-scope §1 ↔ scenario-lock L-20 4+5+3 ↔ v0.12 spec §1）；四步工程（v0.12 §1 ↔ L-10/L-11）；kW/kWh 分离（L-14 ↔ contracts §5.3 BaseSnapshot power 字段）；错误 8 分类（01 §6 ↔ contracts §5 错误分类，逐类一致）；事实唯一写者（01 §1 ↔ contracts §6 ↔ v0.12 §4 "初始库存写assets、机器人运行状态写npc、项目/能源写industry、scope与simTime写world"）；旧世界处置（00 §5 ↔ L-28 ↔ contracts §8 均"归档不删除、不自动映射、reset 不当创建基地"）；五线职责（ownership.json lanes ↔ milestones.json M12 lanes A/B/C/D 描述逐一对应）；基线版本（baseline §1.2 ↔ version.ts 实读 0.11.0/schema 28/api 41/engine 2/ruleset 17/content 12/prompt 8/economy 4/worldSeed 1 ↔ README §代码基线）。commit 链核实：`7d8f242 → 5dd76a9 → ef5d1b7 → d588a40`，diff --stat 确认 4 个新增文件 +562 行、零源码/配置变更。

瑕疵 a：contracts §5.3 `getBaseSnapshot` 的提供者列写 "world.base → observation/客户端"，但快照聚合 industry/assets/npc 的事实；按字面由 world.base 提供完整快照则需要 world→industry 边（未提案）。应读作 application/observation 用例经各模块公开部分装配（observation→industry 边已提案）。措辞瑕疵，非语义矛盾。

瑕疵 b：contracts §9"上游开放问题转交表"未逐条回应 A0-01 的 Q3（DEBT-014 环）、Q4（时钟双轨）、Q8（0.11.1 是否单发）。经核：Q3 未被触发（ACP-B01 未给 industry 挂 quests/game/dialogue 任一边）；Q4 由 v0.12 spec §3 I"旧NPC timer不对新数据额外发工资/扣食物"＋contracts §8 实质裁决为"双时钟并存、旧世界隔离、退役另议"（可接受，因新基地 runtime 为新行新文件，与 `world_runtime_state` 单键无写冲突，且 world-runtime 既有文件不在任何线的写清单内）；Q8 属版本管理决定，不影响合同。属追溯性缺口，非冲突。

**（2）范围完整性（A0-G01—G05）—— 通过，逐条判定见 §5**

无虚标。特别核实：A0-G02 在设计层成立且诚实标注"正式验证由 M12-G02—G04 承担"（L-22 自评性质明示）；A0-G04 的"无自动清库"（contracts §8 数据行"不 RESET"）与"无付费批测授权"（README §5、v0.12 无真实模型调用，contracts §5.9 明示 M14 前仅 RULE）均有落点。唯一条件项：G02 的自举论证依赖 Q-01 冻结默认值（应急电源入列），contracts §9 已附推翻程序，见清单（7）。

**（3）可实现性 —— 通过（现有 UoW／行锁／AssetMutationService 模式可承载），4 点附注**

- provision 幂等续建：可行。command_receipts 模式（schema.ts:542 scope_kind_id_epoch_unique，真库故障注入测试 asset-mutation.integration.test.ts 在案）可直接承载"账号成功、基地失败→按唯一 provisioning operation 续建、不重发物资"（S1 语义已冻结）。附注 i：contracts §4 冻结的 CommandId 格式为 `{baseId, epoch, operation, requestHash}`，而 provisioning 首次执行时 baseId 尚不存在；M12-P 须显式定义账号作用域的 provisioning 幂等键（01 §6 已给语义，只是格式表未覆盖）。
- createProject 同事务预留＋回滚：可行。assets 拥有"货物预留"（01 §1）、npc 拥有"当前执行分配"、industry 拥有项目/步骤事实，同事务经 UoW 绑定公开参与接口——与 world-runtime 事务绑定参与仓储、AssetMutationService claim-receipt 两个已验证模式同型；S3 已冻结回滚语义（无悬挂预留）。
- 心跳租期暂停与多标签页单一控制：语义冻结一致（contracts §5.4 ↔ 01 §5 ↔ v0.12 §4：按服务端授予的控制有效期结算、不依赖 unload、resume 不补暂停期）。附注 ii："控制租期"这一事实未列入 contracts §6 唯一写者表（隐含归 world.base），M12-P 补一行即可。附注 iii：contracts §5.6 引用的"基地 tick 用例（内部）"（供能结算唯一写入口）在 ownership.json 与 contracts §3 文件清单中均无落点文件，M12-P 必须显式放置（world-runtime 每基地行锁 tick 模式已被 world-runtime.integration.test.ts 真库证明可平移）。
- BaseId 与现有鉴权骨架：可行。module-boundaries.json 实测 `modules/auth/*` 全部映射 identity 模块；试玩注册改动落在 M12-A 已授权的 auth 既有文件内（现注册强制 activationCode：auth.routes.ts:21/93，实读确认，试玩分支在该处实现）；transport→application 边已存在，无新违规风险；会话→账号→基地成员授权链为新增表＋中间件，无全库放宽（ADR-B01）。

**（4）并发写交集 —— 无同文件双写；共享单写者清单有 5 处遗漏（均非阻塞）**

五条线（M12-A/B/C/D/Q）文件两两不相交，world-runtime、npc、GameShell 既有文件不在任何线写清单内（正确）。遗漏：

- `packages/content/src/index.ts`（barrel）：content 包 exports 仅暴露 "."（package.json 实读），M12-D 新增 base/ 三文件必须经此文件导出方可被 server 消费，但该文件不在 M12-D 清单也不在 P 共享清单（P 清单只覆盖 packages/shared）。这是唯一一处"不补登记就装不上"的硬遗漏。
- 迁移路径错误：ownership.json 写 `apps/server/src/db/migrations/`，实际迁移目录为 `apps/server/drizzle/`（drizzle.config.ts `out: "./drizzle"`；0026—0028 迁移实存于该目录；src/db/migrations 不存在）。写者归属（P）无歧义，纯路径错误。
- .env 样例／部署模式配置注册：试玩模式开关需要配置落点与样例说明，v0.12 spec §2 M12-P 行含"env"但 ownership.json 未列路径。
- README（根/包级）：无人认领。
- legacy-boundary-debt.json、scripts/architecture 检查器、drizzle journal：02-parallel §3 默认归 P，ownership.json 复述时遗漏（上位合同仍生效，故只是复述不完整，非真空）。

另有 1 处潜在重叠：P 的"client session 与公共 API client 共享文件 (apps/web)"与 M12-C 的 `apps/web/src/features/base/` 整目录授权若把 session 文件放进该目录会撞车；M12-P 冻结精确清单时须把共享 session 文件排除出 C 的目录范围或外置。M12-A 动 auth 既有文件与 P 共享清单（app.ts/package.json/CI 等）不重叠（auth.routes 已挂载，无需动 app.ts）。

**（5）ACP-B01 与现有模块图兼容性 —— 通过**

实测 module-catalog.json 现有 **21 个**逻辑模块（kernel/content/rules/protocol/platform/identity/world/assets/characters/economy/npc/quests/social/ai/observation/application/transport/composition/client_session/client_text/client_pixel；baseline.md §3.9"21 个"正确），加 industry、content-catalog 后为 23。

- 环检测：industry 依赖 {kernel, content, rules, platform, world, assets, npc, content-catalog}，而 world 实际依赖 {kernel,content,rules,platform}、assets {kernel,content,rules,platform}、npc {kernel,content,rules,platform,world,assets}、content-catalog 提案 {kernel,content,platform}——均无指向 industry 的回边；新增消费边 application→industry/content-catalog、observation→industry、composition→industry/content-catalog 均为单向，industry 不依赖 application/observation/composition/transport。**无环**（DEBT-014 环在 game/npc-task/dialogue 之间，ACP 未触碰）。
- platform 保持仅依赖 kernel，无反向业务依赖。
- transport 声明"仅 → protocol/platform/application/kernel"与 catalog 实测完全一致。
- content-catalog 依赖集对 v0.12（只读 bootstrap、schema 校验在 content 包内自洽）够用。但 01 §9"引擎不支持新效果时拒绝发布"的整包校验（能力/流程可达性）在 M13 需要访问引擎能力注册表：该注册表必须放在 kernel/rules/content 纯层或由 application 用例执行校验，**不能**做成 content-catalog→industry（会与已提案的 industry→content-catalog 成环）。文档未写明注册表归属，见非阻塞建议。

**（6）诚实性 —— 通过**

本轮独立复核：`pnpm arch:check` 在 d588a40 实跑 PASS，输出与 baseline §2 逐字一致（files 220 / classified 221 / debt-matched 87 of 28 / UNCOVERED 0）；`pnpm arch:test` 12/12 PASS；NEG-08 确为"a new production file with no boundary entry → OWNERSHIP_UNCLASSIFIED_FILE"（scripts/architecture/arch-test.mjs:170），contracts §2"登记前新生产文件被负例拦截"的引述属实；legacy-boundary-debt.json 实数 35 条，baseline Q1 口径差真实存在且如实上报；试玩 P2（AuthPage.tsx:128 硬编码 "v0.1 Foundation"）实读确认；baseline 的 NOT_RUN 清单（lint/e2e/db:verify-migrations/仿真/真人试玩）自守边界，未把规划当已交付（§3/§5 每行带"全新/部分可复用/已有"分级）。contracts 标注"提案，待 A0-04"、ownership 标注"PROPOSED_FROZEN_PENDING_A004"、Q-01 标注"待作者确认"，状态字段全部如实。

**（7）Q-01 与 Q-06 的 M12-P 返工风险 —— 低，可控**

- Q-01（裂变应急电源入列）：contracts §9 按入列冻结并附推翻程序（"推翻须重算 L-22.1 并更新本表"）。若作者推翻为纯储能案，返工面=scenario-lock L-21 一行＋L-22.1 重算＋M12-D scenario.ts 内容与 M12-P fixture 数值；不动任何接口形状、标识格式或写归属。不构成合同返工。
- Q-06（sol 归 M12-P）：与 00-scope §2"P 包在编写平衡测试前冻结 fixture"一致，决策时点正确；simTime 的表示单位属"参数"非"语义"（contracts §1 明文允许 P 细化），只影响 fixture 数值与内容包声明。风险：sol 取值晚冻结会改动昼/夜功率 fixture，建议 M12-P 在写第一条平衡测试前先冻结（其任务定义已如此要求）。

## 3. 阻塞项列表

无。

## 4. 非阻塞建议（不阻塞 A0 收口，转 M12-P）

1. **[修正] 迁移目录路径**：ownership.json `apps/server/src/db/migrations/` 改为 `apps/server/drizzle/`（含 meta/_journal.json）；journal 归 P。
2. **[补登记] `packages/content/src/index.ts`**：列入 P 共享单写者清单或 M12-D 独占清单（二选一，保持单写者），否则 M12-D 的新定义对 server 不可达。
3. **[补登记] 共享清单增补**：.env 样例/部署模式配置注册、README、legacy-boundary-debt.json、scripts/architecture 检查器（后两项 02-parallel §3 已默认 P，补进 ownership.json 复述即可）。
4. **[消歧] web session 落点**：P 的共享 client session/API client 文件路径须与 M12-C 的 `features/base/` 目录授权显式互斥。
5. **[补定义] 三处语义细则**：provisioning 幂等键（账号作用域，不套用含 baseId 的 CommandId 格式）；控制租期事实写者（建议 world.base 一行进 contracts §6 同构表）；基地 tick 用例文件落点（application 或 world-runtime，进 ownership 清单）。
6. **[前瞻] 能力注册表归属**：ACP-B01 落地时（或最迟 M13-P）写明引擎能力/step kind 注册表所在模块（kernel/rules 纯层或 application 校验用例），确保"引擎不支持新效果→拒绝发布"的实现不需要 content-catalog→industry 边。
7. **[措辞] contracts §5.3 提供者列**：将 getBaseSnapshot 的装配者写明为 application/observation（world.base 仅为组成提供方），避免被读成需要 world→industry 边。
8. **[追溯] contracts §9 转交表**：补三行显式关闭 A0-01 Q3（未触发）、Q4（v0.12 双时钟并存＋隔离，退役另议）、Q8（0.11.1 发版决定时点）。
9. **[运维] A0-01 Q5 残留临时库**：10 个 `ai_mud_vitest_worldtick_*` 待一次显式授权清理，与 v0.12 无耦合，勿拖入 P 包提交。

## 5. A0-G01—G05 逐条判定表

| 退出条件 | 判定 | 依据（证据等级：本轮实跑/实读 ＞ 产物自述） |
|---|---|---|
| A0-G01 实际 HEAD/版本/可复用接口列清，未验证不标完成 | **通过** | HEAD 链 7d8f242→d588a40 与 4 文件 +562 零源码变更（git 实跑）；version.ts 实读与 baseline/README 一致；arch:check/arch:test 本轮重跑结果与 baseline §2 逐字一致；606 单测等未复核项依 baseline 自证，其 NOT_RUN 边界自守 |
| A0-G02 初始场景无互相卡死，每种物资有来源和用途 | **通过（设计层）** | L-17 六类资源均有来源＋用途；L-22.1 以"初始阵列＋应急电源"破供电死锁、L-22.4 排除隐藏依赖；条件：Q-01 默认值（入列）待作者确认，推翻须重算 L-22.1（contracts §9 已绑定程序）；正式验证按产物自述由 M12-G02—G04 承担，非虚标 |
| A0-G03 时钟/模板实例/项目状态/写归属/并发清单无未裁决冲突 | **通过** | 时钟：ADR-B02＋contracts §5.4＋v0.12 §4 一致；实例：DefinitionRef＋assets/npc 1:1＋setup receipt；项目：01 §4 生命周期＋S3/S5 样例；写归属：contracts §6 与 01 §1 无冲突；文件清单：无双写，遗漏项均归 02-parallel §3 默认 P 或 M12-P 补登记（见 §4），属未列明非冲突 |
| A0-G04 旧世界/许可/试玩边界清楚，无自动清库或付费批测授权 | **通过** | contracts §8 处置表覆盖 00 §5 各类目（回执并入 KEEP 行、教程/传闻/离线简报 MAP、路由 ARCHIVE）；L-24—L-27 双许可/摘录/试玩/重置授权；M12-G01"正式模式不无声继承"；v0.12 无真实模型调用（contracts §5.9）；许可声明文本 Q-08 已排期 M12-D，非遗漏 |
| A0-G05 接口变更与图检查要求明确，不得放宽 | **通过** | ACP-B01 单列、landingOwner=M12-P 唯一写者、"本提案不使存量违规变绿"；语义收缩须走 02-parallel §5 握手；NEG-08 负例实存且 arch:test 本轮 12/12 PASS；与 AGENTS"不得改台账变绿"一致 |

## 6. 本审查自身的证据边界（如实声明）

- 未运行 `pnpm test` / `test:postgres` / `typecheck`（全量重跑成本高，且 test:postgres 会创建临时库，超出本次只读授权）——baseline 相应数字维持其自证，未被推翻亦未被复核。
- 正典引用（yudian-universe@e839275）在本机不可达（未找到该仓库本地检出），scenario-lock 的全部来源标注**未独立验证**（NOT_RUN）；其标注格式完整（仓库@commit/文件/章节），可验证性留给持有该仓库的作者/主代理。
- 本次审查指令所述"现有 22 模块"与实况不符：module-catalog.json 实为 21 模块（直接实读），baseline.md 表述正确。

**结论：A0 四份产物达到 CONTRACT_READY，批准进入 M12-P；§4 九项修正与补登记随 M12-P 首个冻结动作一并落实，不因批准而豁免。**
