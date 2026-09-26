# R1 Agent 工作包与开工提示词

本包可由一个 agent 顺序完成，也可由协调者按 AGENTS.md 组织 P → A/B/C/D → Q → I。角色划分是文件写入边界，不要求开很多代理。禁止在合同未稳定时让四个 agent 分别设计机器人分配或设施规则。

## 1. P：开工前冻结共同事实

先从 codex/post-playtest-design-review-20260926 读取并保留本包，再从最新 main 建 codex/landing-r1-contract，带入文档。记录实际 HEAD、工作树、迁移 journal、版本、运行合同，确认与 ac61a17 的差异；新变化只对受影响部分复核，不机械重做全仓。

P 的具体交付：

1. 将本包的默认设计落实为内容 fixture、DTO/错误样例、精确 schema 变更和端口签名；旧接口的 optional/default 行为逐一写清。
2. 先跑无浏览器的数值探针：首套设施自举、铁/铜原料到首扩建、第二种扩建、维护软锁恢复、全队低电恢复。只在隔离数据/纯计算中试，不改生产数据库，不伪称真人验证。
3. UI 提供开局、缺料、采矿运输、加工与首扩建完成五个可交互状态。按 02 的视口验，不用一张截图冻结全部 UI。
4. 在本目录补 p-contract.md、fixtures/ 和 status.md。p-contract 明确字段、单位、端口、文件归属、稳定错误和内容修订；status 每条标 DRAFT/READY/IMPLEMENTED/VERIFIED。
5. 所有 probe 通过且无关键未定接口后提交 P 基线；若自举/功耗不成立，先在本方案范围内调整候选数字并重跑，不把调参留给各线。

P 阶段的 UI 样稿用于审阅，不把它当成已经交付。若用户在实施请求中已接受本包，常规数值调定、组件拆分和样式选择不重复索要授权；改变主循环、删除随船设备、重置旧档或新增模块依赖才升级说明。

## 2. 唯一文件所有权

以下路径均相对仓库根；同名测试随实现归属。未列新文件先由 I 登记所有者，不能抢改共享文件。

| 包 | 独占文件/范围 | 不可跨写 |
| --- | --- | --- |
| P/I 集成 | packages/shared/src/{base,economy,errors,index,version}.ts 及版本测试；packages/content/src/base/schemas.ts 及 schema tests；apps/server/src/db/schema.ts、新迁移/journal；apps/server/src/application/base/{ports,composition,base-snapshot,base-clock,provision-base}.ts 和新增命名用例；app.ts；world-runtime/{base.service,base.repository,base-session.routes}.ts；npc/{robot-runtime,robot-factory}.ts；ledger/{base-asset.service,asset-mutation.service}.ts；economy/{order.service,purchase.service}.ts 的 capability 门；全部架构台账、版本与整合脚本 | 工程/采矿/制造规则分别交 A/B；不代替 Q 出具独立结论 |
| A 设施/能源/施工 | industry/{construction.service,industry.repository,industry.pure,base-settlement.service}.ts；新增 industry/{landing-rules,facility-effects}.ts；已有 base-projects.routes.ts | 不改 schema/shared/npc，不代写 B 的采矿或制造仓储 |
| B 采矿/加工 | 新 world-runtime/resource-node.{repository,service}.ts；新 industry/extraction.{service,repository}.ts、base-extraction.routes.ts；industry/manufacturing.{service,repository,settlement}.ts、base-manufacturing.routes.ts；新 industry/production-slot.{service,repository}.ts、base-production.routes.ts | 不改基地时钟和 A 的总能量分配，不直接写 world/npc/assets 表 |
| C 内容 | 新 packages/content/src/base/landing-release.ts 与对应测试；base/index.ts；content-catalog/{catalog.service,catalog-db.loader}.ts；新增内容来源映射仅从配方/节点数据派生 | default-release/tutorial-release 已发布数值不改；schema 由 P/I 写 |
| D 客户端 | apps/web/src/features/base/ 下组件、baseApi.ts、base.css、同名组件测试；必要的新组件限定同目录；其他根样式仅由 I 审核并整合 | 不改 shared、服务端、内容规则，不用本地假计时/假库存 |
| Q 独立验收 | 新 apps/server/src/tests/base-operations/landing/*.integration.test.ts；apps/web/e2e/landing-real.spec.ts；本目录 evidence/、acceptance.md；只提交验收资产 | 不改业务代码、不得删失败检查或调 fixture 迎合实现 |

开发需要的新增 public 类型在已有登记边界或 P 创建的精确入口里暴露，不临时导出 repository/ORM 类型。P/I 对 npc 与 assets 的共同接口先做可运行版本；A/B 只消费接口，避免最后一天才接上。

## 3. 分包完成条件

### A：设施必须真的改变能力

输入 P 内容 fixture、机器人/资产端口、B 的 measure/settle 类型。实现初始着陆器、新 profile 规则、六种安装项目和三种扩建效果，按同一电力池驱动工序/充电。完成效果幂等、储能增容不发电、设施门槛真实、旧 profile 数值不变。将采矿/加工活动设备排除在重复施工分配外。向 I 交 exact HEAD、功耗账本、首安装/低电恢复样例与失败回滚证据。

### B：生产和消费必须守恒

实现矿点勘探、矿量预留、采出/运输/取消收尾、每批入库；扩展 item/robot 制造产出、暂停/恢复、维护与手工恢复配方。使用 A 分配的实际能量；设备只经 npc 端口、矿量只经 world 端口、物资只经 assets 端口。交同档铁矿→结构件及铜矿→线缆链、并发/重放/取消/维护真 PG 证据。

### C：新内容自洽且旧内容不漂移

实现新 release、货单、地图节点、配方、设施与规则参数。建立“每项非初始必需材料至少一条可达来源”的检查；保证每个新 UI 可展示条目有真实能力消费者。新造设备 0 电，初始设备电量作为一次性种子来源。按旧 release/配方 revision 的 golden fixture 验证未改原值。

### D：玩家能在现场完成一件事

重构固定工作区和任务引导，接真实 DTO；完整实现 02 所列状态、缺料来源往返、采矿设备分配、加工维护、收益反馈。不得把“可支配”替换成别的术语后就算修好；缺口必须连到实际动作。先保存 1280×800、720×450 和真实 200% 缩放五状态截图，再交用户路径录制或动作日志。

### I：集成真实链

按 P → C → A/B → D 的依赖整合（C 的 fixture 在 P 已提供；实际各线可并行）。给接口加真实装配、鉴权/CSRF/租约/错误映射、snapshot、legacy 路由、迁移和版本。集成后的数据库不得含测试 helper 直接赠送资源的生产路径。最终独立 Q 使用同一候选 SHA。

### Q：按玩家问题重新裁决

先读 01/02/05 的承诺和界面操作，不预读数值最优路线；封存首访后再读源码和跑数据库负例。至少完成一个新档首循环、一条替代路线、三轮再投资/生产，以及同档离开重进。浏览器无法用或时长不足就记录缺口，不能用 mock/SQL 回放补称真人体验通过。

## 4. 可直接复制给协调 agent 的完整提示词

> 从本地文档分支 codex/post-playtest-design-review-20260926 读取 docs/implementation/2026-09-26-landing-rebuild/README.md 及其五份合同，按它们实施 R1。先核对最新 main 和工作树，带入文档，从 P 开始；产品默认决策以本包为准：约 12 台设备及设施组件随船运抵，常设设施由玩家安装；铁/铜采集运输、加工、制造、扩建形成真实链；桌面固定工作区；新档无 credits/系统回购主循环，旧档数据与义务保留。目标是完整 R1 的本地实现、隔离真 PG 与真实浏览器验收、可审查提交/草稿 PR。先冻结共同 schema/DTO/端口/fixture 与精确文件归属，再执行 A/B/C/D；可按需要分配 agents，每线独立 worktree/数据库/端口。所有 worker 都不是独自在仓库工作，不得回滚其他人的编辑。P/I 为共享文件唯一写者，Q 不改业务实现。完成一个包不代表整个 R1 完成，持续推进到 05 的交付门槛或明确的真实阻塞。不要改旧迁移或发布内容，不得用 SQL 赠料/改时钟代替正常试玩，不改 allowlist 掩盖违规，不新增通用任务引擎。已有授权内自行决定常规实现与 P 数值调定。不得自动合并、部署或清档。最终报告 exact SHA、真实测试/浏览器证据、玩家验收缺口、数据兼容及回退限制。

## 5. 各线提示词

把下列段落和 P 提交 SHA 一并交给 worker，禁止只传一句“修采矿”。

- **A**：负责本文件所有权表 A 的路径。先读 P 合同、01 的设施/能量和 03 的事务。按分包完成条件实现。你不是独自在代码库工作，不得回滚其他线；接口不足报 I，不能自行改 shared/schema/npc。交失败→修复验证、exact HEAD、需要 I 的装配点。停止条件是你的包完成，不能替 Q 宣称可玩。
- **B**：负责本文件所有权表 B 的路径。先冻结矿量、现场物资、送达库存三态及 item 产出的 ordinal 不变量，再实现真实作业。你不是独自在代码库工作，不得改 A 的能量池/结算总入口或其他线成果。接口问题交 I；交并发、取消和断点恢复真 PG 证据及 exact HEAD。
- **C**：负责本文件所有权表 C 的路径。按 01 建新 release 和来源图，只改新内容；默认值按 P 已验证 fixture。你不是独自在代码库工作，schema 修改请 I 处理，不覆盖其变化。交可达性/旧内容 golden 检查、exact HEAD。
- **D**：负责本文件所有权表 D 的路径。按 02 实现五组状态与真实动作，消费 P DTO，开始阶段可用标明的 fixture。你不是独自在代码库工作，不改后端规则和 shared。最终所有演示数据退出生产入口；交视口/键盘/缺料恢复/真实回读证据与 exact HEAD。
- **Q**：负责本文件所有权表 Q 的路径，只读候选业务实现。按 05 独立验证，首访先不看最佳路线。任何失败按原状记录给 I，不能改规则或删断言使结果通过。给出工程、AI 浏览器、真人三种状态，不互相替代。

## 6. 意外、范围和交接

工作中发现 current main 已有同能力先复用，不重复创建；明确未列路径只由 I 更新归属后使用。需要新增依赖、改变单位/输入输出、修改公开协议时先更新 P 合同并通知所有消费者。普通修复不让用户重复批准；设计目标改变、未知线上数据操作、合并部署仍需要对应授权。

每包交接固定六项：提交 SHA、改动文件、公开接口差异、实际命令/测试数据库身份、剩余缺口、与其他包的集成事项。数据库密码/会话不入文档。证据不足不能写 PASS。
