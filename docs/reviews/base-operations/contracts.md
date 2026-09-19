# A0-03：v0.12 合同与文件归属冻结

状态：CONTRACT_READY（提案，待 A0-04 独立审查确认）。
输入：A0-01 基线盘点（5dd76a9）、A0-02 场景锁定（ef5d1b7）、01-domain-contracts.md、module-catalog.json / module-boundaries.json 实况。
基线：HEAD `7d8f242`（产品代码 = main e2677ea）。

## 1. 效力范围

本文件冻结 v0.12 的：模块落点与边界变更提案、五类标识格式、公开接口形状与错误分类、事实唯一写者映射、正反样例、旧能力处置。具体 TS 签名、迁移编号、数值 fixture 由 M12-P 在此基础上落码——可以细化路径与参数，不得收缩语义。本文件不修改 catalog/boundaries/debt 或检查器配置；模块与边变更以 ACP-B01 提案登记，由 M12-P 单列落地并随 arch:check/arch:test 生效。

## 2. 模块落点与 ACP-B01（Architecture Policy Change 提案）

**新增两个逻辑模块**（proposed `allowedDependencies`，对齐现有同类模块基线）：

| 模块 | kind | owns（唯一写事实） | 提案 allowedDependencies |
|---|---|---|---|
| `industry` | domain | 设施实例/状态、建设/制造工单、项目步骤与依赖、站内供能结算 | kernel, content, rules, platform, world, assets, npc, content-catalog |
| `content-catalog` | domain | 内容草稿/修订/发布快照/激活记录；运行时只读目录 | kernel, content, platform |

**既有模块子域扩展**（不新增模块、不改既有允许边）：

- `world` += 基地子域：BaseId、成员授权、建设位/空间、simTime/epoch、天气事实挂点（M15 使用）。
- `npc` += 作业者子域：机器人运行身份、载体状态、电量、位置、当前分配。

**新增消费边（提案）**：`application → industry, content-catalog`；`observation → industry`；`composition → industry, content-catalog`。transport 维持现状（仅 → protocol/platform/application/kernel），基地路由一律走 application 新用例——这是 DEBT-007/008 口径的延续，不是新债。

**禁止边重申**：industry 不得直写 assets/npc/world 的表（跨模块写入只经 UoW 绑定的公开参与接口，同事务提交）；weather（M15）不得直扣电；content 包与前端不直写任何资产；pure 规则不查 DB。

**落地方式**：M12-P 以唯一写者身份把上述模块、边与文件登记进 module-catalog.json / module-boundaries.json；登记前任何新生产文件都会被 arch:test 负例拦截（A0-01 已实证）。本提案不为任何存量违规开豁免。

## 3. 新增文件落点（生产文件，全部 NEW，登记后方 created）

| 线 | 路径（apps/server/src 下，除注明） |
|---|---|
| M12-A（world 基地子域） | `modules/world-runtime/base.service.ts`、`modules/world-runtime/base.repository.ts`、`application/base/provision-base.ts` |
| M12-B（industry + 作业者） | `modules/industry/construction.service.ts`、`modules/industry/construction.repository.ts`、`modules/industry/power.service.ts`、`modules/industry/industry.pure.ts`、`modules/npc/robot-factory.ts`、`modules/npc/robot-runtime.ts` |
| M12-C（客户端） | `apps/web/src/features/base/`（BaseShell、BaseMap、ObjectPanel、ProjectBoard、styles + 同名测试） |
| M12-D（内容） | `packages/content/src/base/schemas.ts`、`default-release.ts`、`scenario.ts` + 校验测试；`modules/content-catalog/catalog.service.ts`、`catalog.repository.ts`、`bootstrap-release.ts` |
| M12-Q（独立验收） | `tests/base-operations/m12/`（合同/PG/浏览器） |
| 共享（P 单写） | `packages/shared/src/base.ts`（NEW）、`packages/shared/src/errors.ts`（扩展）、`apps/server/src/db/schema.ts` + 新迁移（编号 P 定）、`apps/server/src/app.ts` 与 composition 装配、module-catalog/boundaries 登记、client session 与公共 API client、package.json/pnpm-lock |

路径可在 M12-P 细化（保持模块归属不变即可）；语义收缩视为合同变更，须走握手（02-parallel §5）。

## 4. 五类标识（冻结格式）

| 标识 | 格式 | 规则 |
|---|---|---|
| BaseId | `b_<22位urlsafe>` | 服务端生成；永不复用 CharacterId；权限只认会话解析出的授权，不接受客户端自报 |
| InstanceId | `i_<22位urlsafe>` | 机器人/设施/工单唯一实体；退役身份不复用 |
| DefinitionRef | `{kind, stableId, revision}` | stableId 为 kebab-case 字符串；revision 正整数；在途工单固定开工时 revision |
| CommandId | `{baseId, epoch, operation, requestHash}` | principal 来自会话不入 key；同 key 同 payload 重放返回同结果，不同 payload 报幂等冲突 |
| DecisionId / PlanRevision | `d_<ulid>` / 正整数 | 一次模型提案与当前计划的关联；只按相关前提过期，不因无关 UI 事件全量失效 |

DTO 一律运行时可验证字符串 ID；禁止把具体内容编译成联合字面量；kind 受程序注册表约束。

## 5. v0.12 公开接口（形状冻结）

| # | 接口 | 提供者 → 消费者 | 语义要点 | 错误 |
|---|---|---|---|---|
| 1 | 试玩注册（HTTP） | identity → transport | 简化注册+自动登录+直达基地；仅部署模式显式开放；空/超长密码仍拒绝；普通账号无内容管理权 | 幂等冲突、校验失败 |
| 2 | `provisionBase(principal)` | world.base → application | 幂等可恢复：账号已建而基地未成时按唯一 provisioning operation 重试续建；一账号一个初始基地；初始物资一次 seed，丢失不补发 | 权限、幂等冲突 |
| 3 | `getBaseSnapshot(baseId, cursor?)` | world.base → observation/客户端 | BaseSnapshot：`{baseId, epoch, baseRevision, simTime, timeMode, activeContentRelease, power{generationKw,storedKwh,capacityKwh,loadKw}, resources, devices, projects, visibleContentRefs}`；断线/过期 cursor 回全量；旧 epoch/低 revision 不覆盖新事实 | 权限、scope |
| 4 | 时钟命令 `pauseBase/resumeBase/setBaseSpeed` | world.base → application | 授权命令，只影响该基地 simTime；控制会话断开按心跳租期到期暂停（租期长度 P 冻结）；多标签页单一控制；resume 不补暂停期 | 权限、scope |
| 5 | `createProject(baseId, definitionRef, siteId)` / `cancelProject` / `getProjects` | industry.construction → application | 材料/工位/设备同事务预留，消耗与产出原子+receipt；缺料/缺电/缺设备不能倒计时到点自动完成；取消只释放未消耗预留 | 资源不足、占用、前置未满足、内容不兼容 |
| 6 | `getPowerBalance(baseId)` | industry.power → observation/客户端 | 纯读投影；供能结算唯一写入口是基地 tick 用例（内部） | scope |
| 7 | `initializeRobot({assetId, templateRef, baseId, sourceOperationId})` | npc.robotFactory → application/industry | 设备资产（assets 写）与运行实例（npc 写）1:1 关联；唯一 setup receipt，重放返回同 instance；重启不因少一台补发 | 幂等冲突、内容不兼容 |
| 8 | `getActiveRelease(baseId) / getDefinition(ref) / validateRef(ref)` | content-catalog → industry/客户端 | v0.12 只读 bootstrap（内置不可变快照经同一 port）；发布 API 属 M13；未知 revision 拒绝，不 fallback latest | 内容不兼容 |
| 9 | `propose(purpose, candidates, deadline)`（DecisionPort seam） | ai → application | v0.12 仅 RULE 实现（`{candidateId|abstain, source:"rule"}`）；接口先冻结防 M14 撕裂；任何真实模型调用、预算与网关属 M14 | 预算/超时（预留） |

**错误分类（8 类，进 shared/errors.ts 由 P 扩展）**：权限、过期 scope/revision、内容不兼容、资源不足、设备/工位占用、前置未满足、预算/超时、幂等冲突。玩家可见原因安全化，不泄漏其他基地/供应商信息。

## 6. 事实唯一写者（v0.12 范围）

| 事实 | 唯一写者 | 备注 |
|---|---|---|
| 账号/会话 | identity | 现有能力复用 |
| base scope、simTime/epoch、建设位 | world 基地子域 | 与 character 严格分离 |
| 项目/步骤/工单/供能结算 | industry | 纯规则求计划、公开写入口提交 |
| 物料数量/设备所有权/账款 | assets | AssetMutationService 模式延续，同事务参与 |
| 机器人运行状态/电量/位置 | npc 作业者子域 | industry 供电经用例调用，不直写电量 |
| 已发布内容定义 | content-catalog | v0.12 只读，无发布写路径 |
| 快照/项目板/todo 投影 | observation | 多视图同一事实，仅展示 |
| 模型调用审计 | ai | v0.12 仅 RULE，无外部调用 |

## 7. 样例（冻结语义用）

- **S1（有效）**：注册后 provision 中断，重试注册 → 同一 baseId 续建，初始物资不重复。
- **S2（无效）**：账号 A 携带账号 B 的 baseId 调 getBaseSnapshot → 权限错误，不泄漏该基地存在性。
- **S3（有效）**：createProject 时备件不足 → 资源不足错误，已发生的部分预留原事务回滚，无悬挂预留。
- **S4（无效）**：携带旧 contentRevision 的 createProject → 内容不兼容错误；不用 latest 静默顶替。
- **S5（有效）**：暂停期间 getBaseSnapshot → simTime 不变、无产出增量；resume 后从暂停点继续，不补算暂停期。

## 8. 旧能力处置表（KEEP / ARCHIVE / MAP / RESET / RETIRE）

| 能力 | 处置 | 说明 |
|---|---|---|
| 账号/会话/权限骨架 | KEEP | 直接复用；试玩模式叠加显式部署开关 |
| AssetMutationService/回执、世界 tick 行锁、同步三分离、纯读观察 | KEEP | 新基地直接受益（A0-01 §3 已交付能力） |
| 西幻内容包（packages/content world/items） | ARCHIVE | 保留为只读旧 release；新基地加载《余电》release，同一 CatalogPort |
| 旧角色战斗/职业/饥饿/装备耐久 | RETIRE（对新作用域） | 新基地不可达；旧档只读归档，不删除 |
| 玩家间市场 | RETIRE（对新作用域） | 新基地无玩家间实时市场；v0.16 有限订单另建 |
| 任务托管/义务生命周期 | MAP | quests 义务语义供 v0.16 订单复用；旧委托模板文案随旧世界归档 |
| 教程/传闻/离线简报机制 | MAP | 机制复用，文案按新宇宙重写 |
| 旧游戏路由与 GameShell | ARCHIVE | 新 base 路由为默认游戏入口；旧入口开发期隐藏，后台不推进旧世界经济作用于新账号 |
| 数据 | 不 RESET | 无生产重置；重置/删数据另行授权；新基地 seed 只对新 base 执行一次 |

## 9. 上游开放问题的裁决与转交

| 来源 | 问题 | A0-03 处理 |
|---|---|---|
| A0-01 Q1 | arch:check "28 debt entries" 与台账 35 条口径差 | 转 M12-P 核实计数逻辑；只许修 bug 不许放宽；UNCOVERED=0，不影响本合同 |
| A0-01 | DEBT-007/008（路由内嵌组合根） | 写入 P 包职责：基地路由仅 import application/protocol/platform/kernel，不在 game.routes 堆新路由 |
| A0-02 Q-01 | 裂变应急电源去留 | 合同按"入列（低功率、燃料有限）"冻结（与 L-21/L-22.1 自举检查一致）；**待作者确认**，M12-P 前可推翻为纯储能案，推翻须重算 L-22.1 并更新本表 |
| A0-02 Q-02—Q-05/Q-07 | 命名/措辞/IP 边界 | 不阻塞接口合同；属内容层，M12-D 前由作者拍板 |
| A0-02 Q-06 | sol 时长与 simTime 换算 | M12-P 冻结进 fixture，在内容包中声明 |
| A0-02 Q-08 | 内容包许可声明文本 | 随 M12-D 首个内容包交付 |
| 试玩 P2 | AuthPage 硬编码旧版本串 | 转 v0.12-C 顺带修复 |

## 10. 门槛对照

- **A0-G03**：接口无未裁决冲突——§2—§6 覆盖模块、标识、接口、写者；并发文件清单见 ownership.json，跨线改动必须走 P 握手。
- 事务可行性：§5/§6 全部接口标注事务参与方式；无靠可丢事件完成的付款/任务；无事务内等模型（v0.12 无真实模型调用）。
- 本状态为提案，最终 CONTRACT_READY 以 A0-04 独立审查结论为准。
