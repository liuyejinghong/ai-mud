# R1 领域、命令与兼容合同

本文是 P 阶段要落实为类型、schema 和共同 fixture 的接口设计。新增文件需逐个登记到现有 architecture 台账；不要求搬迁整仓旧代码。新增 API 名称在 P 提交冻结，后续调用者不能自行发明近义端点。

## 1. 唯一事实所有者

| 事实 | 唯一写者 | 实现位置/复用 |
| --- | --- | --- |
| 基地时钟、epoch、内容版本、建设位、资源节点及矿量 | world | world-runtime/base.repository.ts；新增 resource-node.repository.ts |
| 材料库存/预留、设备资产 | assets | modules/ledger/base-asset.service.ts；旧 asset-mutation 能力 |
| 机器人电量、状态、当前施工/采矿分配 | npc | robot-runtime.ts、robot-factory.ts |
| 工程、采矿作业、加工工单、逐批产出、供电、加工槽维护状态 | industry | 现有 construction/manufacturing/settlement + 新 extraction 文件 |
| 内容、设施效果、配方、规则参数 | content-catalog | packages/content 的纯定义及目录读取；不授予资产 |
| 旧版采购/订单/余额 | economy | 原有服务；按基地内容能力允许/拒绝新命令 |
| 命令编排、事务、快照组合 | application/composition | 命名用例和已有 base composition；不执行领域 SQL |
| 任务提示、队列展示、选择态 | client/read projection | 派生自上述事实；不拥有资产/完成真相 |

industry → world/assets/npc/content-catalog 已在当前 module-catalog 允许。R1 原则上不新增模块依赖边。资源节点放 world；采矿计划放 industry；工作分配放 npc，不能让采矿 repository 直接写这两个模块的表。P 必须单列新字段归属评审；若实际实现确需新增允许边，另列 Architecture Policy Change，不可改 allowlist 让非法 import 变绿。

## 2. 新内容能力，旧内容保持稳定

内容增加封闭的 rulesProfile：缺省 legacy，新增 landing-v1。它选择经过测试的规则实现，不是任意脚本。新 release 使用新设施/工程/机器人/配方 stableId，旧 built-in release、旧 @1/@2 配方原值保留。

最低内容扩展：

- 新 seed 明确 initialCredits、资源节点种子、临时电源参数；未提供字段时使用旧行为。新档显式写 0，不全库 UPDATE 钱包。
- 设施效果为有类型的有限字段：发电增量、储能容量增量、充电总上限增量、加工槽数，以及 warehouse/maintenance 等能力；不得提供任意 JSON 指令执行器。
- recipe.output 扩成 robot 或 item 二选一。旧未带 kind 的机器人 output 在目录边界规范化，旧持久化 payload 不重写。
- 新材料配方包括额定 W、每批所需工作分钟、需要的设施能力；三者有明确单位，旧 workPerUnit 继续按旧规则解释。
- 矿点定义包含矿物、初始量和勘探/开采工作；能力目录能返回合法来源，UI 不用单独写矿石与配方映射。
- 功耗、工作阈值、充电上限由基地 rulesProfile 和该机器人模板决定。共享代码不得把 landing 的小电池拿去跟旧 500 Wh 常量比较。

新档能力列表不含 external_trade；旧档照常含有。订单生成和新购买/接单/交付接口都检查内容能力，不能因为 UI 隐藏就留后门。已经存在的旧义务仍按其旧内容结算；未知 release 显式拒绝，不能 fallback 到最新内容。

## 3. 持久化最小变更

P/I 为 schema、新迁移、journal 的唯一写者。基线最后迁移为 0037；下一编号实施时重新核对，不预改已有迁移。

| 表/列 | 必须持久化的事实与约束 |
| --- | --- |
| 新 base_resource_nodes | id、base_id、node_key、definition_ref、discovered、remaining_quantity、reserved_quantity；唯一 base/node；0≤reserved≤remaining |
| 新 base_extraction_jobs | id、base_id、node_id、kind(survey/mine)、status、批数/已采/已送、当前工序与工作量、创建顺序、取消请求；数量上限和计数顺序约束 |
| 新 base_extraction_outputs | job_id+ordinal 唯一、item_id、quantity、状态(extracted/delivered)；记录现场物资归属，不能仅靠 UI 显示在途 |
| robot_operators 新列 | current_extraction_job_id nullable；与 current_project_id 互斥；继续由 npc 写。不是通用字符串 task_id |
| base_manufacturing_outputs 扩展 | output_kind 默认 robot；原 device_id/operator_id 改 nullable；新增 item_id/quantity。CHECK：robot 时设备字段齐全且无 item；item 时物料字段齐全且无设备；job/ordinal 唯一继续保留 |
| base_manufacturing_jobs 新列 | production_site_id nullable（旧单为 null）；新单指已建成加工间/手工恢复着陆器；持久化新规则每批加工能量。稳定 createdAt/id 作为 FIFO，暂停不改原序 |
| 新 base_production_slots | base_id+site_id 唯一；完成批次维护计数；停机原因；不再保存另一份设施建成状态 |
| base_power_state / 制造进度精度 | 新规则需保留固定点能量余数与 production/charging 优先项；旧字段/路径兼容；字段名和单位在 P 定案，不用舍入丢能量 |

设施是否已建成仍以 base_sites 为权威。加工槽是建成设施的运行状态，创建槽与设施完成同事务；不再新增一张重复 facilities 表。采矿作业持矿点引用，机器人分配仍以 npc 行为权威，UI 不能用“计划人数”冒充实际出工人数。

## 4. 玩家命令

所有写命令有会话、CSRF、账号→基地校验、有效控制租约、commandId；除旧接口兼容外携带 expectedBaseRevision。旧 token 不能下新任务。服务端从主体查基地，客户端提交 baseId 不可越权。

| 入口 | 输入要点 | 原子结果/回读 |
| --- | --- | --- |
| 复用 POST /base/projects | definitionRef、siteId、选择的工程设备、revision、commandId | 预留套件/材料、创建项目、预留位置；snapshot 显示同一项目 |
| POST /base/resource-nodes/:nodeId/survey | 望山 operatorId、revision、commandId | 创建勘探单并占用设备，完成时揭示矿点 |
| POST /base/extraction-jobs | nodeId、batches、builderOperatorIds(1–2)、haulerOperatorId、revision、commandId | 预留矿量、独占设备、创建采矿单；不立即发矿石 |
| POST /base/extraction-jobs/:id/pause 或 resume | revision、commandId；resume 重验/可替换设备 | 工序进度保留；pause 释放设备，矿量/货物义务保留 |
| POST /base/extraction-jobs/:id/cancel | revision、commandId | 未采部分释放；现场货物有则进入 stopping 送完再 cancelled |
| 复用制造创建/取消，增加暂停/恢复 | recipeRef、批数、slotId 或自动槽位、revision、commandId | 预留/消耗/入库和产出记录一致；不可重复产出 |
| POST /base/production-slots/:siteId/maintain | revision、commandId | 合法维护窗口内消耗备件 1，计数清零，回读恢复运行 |
| POST /base/power-policy | priority(production/charging)、revision、commandId | 先按旧策略结清已确认时间，再更新新策略 |

P 冻结 fixture 至少包括：同命令重放、不同 payload 同 key、跨基地 ID、条件过期、空闲设备被抢占、缺料、低电、缺设施、节点耗尽、旧内容无此能力。使用已有错误码优先；新增细节用结构化 blockers，不把文案当规则。

预览及 snapshot 对动作返回 canStart、blockers（类型、itemId/required/available/inTransit/sourceRefs 或设施/设备原因）、成本、预计产出、时间估计条件。预览不预留任何资产。提交后的权威回读仍决定成功，UI 不因乐观动画加库存。

P 端口最少应包含：world 的 listResourceNodes/reserveNode/debitReservedNode/releaseNodeReservation/revealNode；npc 的 claimForExtraction/releaseExtractionAssignments；assets 的 reserve/consumeReserved/release/creditInventory；industry 的 measureExtraction/settleExtraction、measureProduction/settleProduction。参数统一含 baseId，写端口绑定调用方事务。行业服务不得拿 world/npc repository 当端口。

示例：采矿创建传 nodeId、batches:4、builderOperatorIds:[b1,b2]、haulerOperatorId:h1、expectedBaseRevision:7、commandId:c1；响应 jobId、status:active、reservedOre:16、duplicate:false。相同 c1 重放仍是原 jobId，不再预留 16；更换 batches 为 5 则冲突。builder 已被别的任务占用返回结构化 DEVICE_BUSY 和冲突任务引用，不能默默换另一台。所有 ID 在真实 DTO 中为 UUID，此处符号仅帮助阅读。

## 5. 事务与结算

沿用基地根锁及每基地事务；命令按基地 → 回执 → 资源节点/工程/工单 → 设备 → 库存的已冻结顺序获取锁，多个 ID 排序。同基地根锁序列化不是豁免跨域写者。P 逐项与现有方法核对，不能两线各造一套锁序。

一条采矿单：

1. 下单：验证矿点/设备/设施 → 预留矿量 → 认领 npc 设备 → 写工单与命令回执；任一失败全回滚。
2. 一批采出：world 扣 remaining/reserved 4 → industry 写唯一 extracted ordinal → 保存开采进度；原矿此时尚未计入仓库。
3. 送达：assets 加库存 4 → 同 ordinal 标 delivered → 工单已送计数推进；全在一个事务，重复 tick 不能重复加料。
4. 取消：释放尚未采的矿量；已经采出的 ordinal 完成送货后释放设备、结案。处于 stopping 不再开新批。

一批材料制造：读取冻结配方修订 → 校验本批供能与设施 → 消耗本批预留 → assets 入库或创建设备 → 记录唯一 job/ordinal → 更新批数及槽位维护计数。第 10 批完成后停机，第 11 批不能偷偷开工。取消不退已经完成批次的材料和电。

所有条件扣减必须检查实际命中行数；库存/预留不足时中止整个事务。现有部分 assets 方法返回 void，P/I 需要补足失败语义，不能让 B 在零行更新后继续记成功产出。该改动也对旧档作回归。

旧规则路径继续由原 computeBaseTick 执行；landing-v1 可增加一个同模块纯计算入口，并共用受控读写参与者。不得复制全套 HTTP/DB 应用。新 profile 每一个整基地分钟：

- 取得分钟开始的设施、设备、任务与能量；只分配一次设备，施工/采矿互斥，暂停任务不能占活动出工名额。
- 按供电策略分配同一个站内能量池，机器人工作从各自电池扣，充电电量来自站内池。
- 推进当分钟已经存在的工序；本分钟刚完成的设施和刚到货原料在下一分钟可参与新工作，不追溯改变过去一分钟。
- 提交电力、机器人、工序、矿量、库存、逐批记录和终态；已有时钟代码最后推进游标。

内部能量采用能表示 1/60 Wh 的固定精度（如整数 W·min），站内存量落盘保留余数；机器人可按整 Wh 接受充电，分配舍入剩余留回站内池，不能消失或重复。新制造所需能量=额定 W×工作分钟，不因一次调用跨 5 分钟而多得预算。大步/小步等价探针必须覆盖余数、工序边界和设施刚投产。

公平性只做需要的部分：活动施工/采矿所需的低电机器人优先获得充电；随后按稳定轮转选择其他设备。满电设备不占充电预算。不可让数据库返回顺序决定某个关键机器人永久拿不到电。

多加工槽在分到的总加工能量内按相同供能比例分摊；一槽停机/暂停时不占份额，余量给其他可运行槽。不得每槽各拿一次基地总能量。分摊顺序和余数处理固定且与输入数组顺序无关。

## 6. 读取、教程与兼容

GET /base/snapshot 增加 capabilities、resourceNodes、extractionJobs、productionSlots、设施效果、powerPolicy、动作 blockers 和最近已提交结果。每条作业显示实际设备 ID、实际 delivered 数、当前工序和阻塞原因；矿脉 reserved、现场矿物、在途矿物、仓库库存不能混为“可用”。

教程进度通过完成设施、材料产出记录和已完成扩建派生；关闭/跳过讲解可本地保存，但不能据 localStorage 判世界任务完成。新档原始结构件/线缆为 0、外购禁用，因此它们来自本地产出；无需为每个单位建立新的 provenance 系统。读取库存余额不足以判定曾生产，须用产出记录。

存量基地按 bases.content_release 分流，保持旧种子/配方/时钟/预留/订单/在途数据。新 UI 必须有明确 legacy 分支，不把旧基地硬画成未安装；旧式在途工单输出和 schema 检查都回归。未知 capability/revision 给出兼容错误，不写回最新内容。

新增内容激活工具若不能支持所有设施/节点/规则字段，应明确拒绝该 release 的后台编辑/切换；不能提供“保存成功但运行忽略”的入口。新 release 可先作为只读 built-in。旧后台编辑能力不扩大。

安全回退以切回能读取新 schema/profile 的前一个兼容应用为准；出现新档/新工单后不可直接换回 ac61a17 二进制。优先前向修复；从上线前备份整库恢复会丢掉其后玩家数据，必须另行评估和授权。
