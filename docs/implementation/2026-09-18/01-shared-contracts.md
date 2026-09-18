# 01 共享产品与技术合同

这是未来各包共同约束；不是声称基线已具备全部字段。

## 1. 权威与职责

| 内容 | 唯一裁决者 | 模型权限 |
|---|---|---|
| 货币、物品、耐久、经验、掉落、价格 | 规则 + 事务 + 现有资产路径 | 不得输出执行参数或写入 |
| 世界/NPC 当前行动 | NpcService 与现有 npc_actions | 可以选择规则提供的意图，不另造执行引擎 |
| 人格、关系、已验证经历 | 游戏持久状态、规则更新 | 只能作为输入；生成摘要不覆盖事实 |
| 对白、气氛文案 | NarrativeProvider / 模板 | 非权威表现；不可充当任务完成证明 |
| 玩家和 NPC 可执行候选 | 规则候选生成器 | 只能选择，不增删参数 |
| 地图可通行性 | 服务端逻辑地图 | 不交给视觉素材或模型判断 |

AI “不直接修改世界”不等于“对世界毫无影响”：模型选择经规则提交后可以驱动真实行动；最终执行权限始终不在模型。

## 2. 状态作用域

- shared-settlement：四个 NPC 的钱包/库存/需求/行动、市场库存与金库，同一世界只有一份。不能为每个浏览器或玩家重新规划一次同一个 NPC。
- player-run：当前个人野外地图实例与资源/遭遇状态，沿用现有所有权，不假装已经是共享野外。
- player-npc：关系、已验证帮忙、个人首次补给进度和一次性服务券。
- presentation：UI 展开、动画进度、文本样式，不反写权威状态。

NPC 采集与个人野图资源当前有各自持有方式，本计划不暗中合并；必须在日志的 sourceScope 中写清真实来源。首轮文案只能说玩家贡献进入公共 NPC 库存，不能说玩家清理了只属于个人实例的狼群就永久解除了全服矿工威胁。

## 3. 原子资产变化与幂等

任何新转移必须有 `commandId`，绑定 account、操作类型与规范化 payloadHash。相同 ID + 相同 payload 返回同一结果；相同 ID + 不同 payload 拒绝。服务端从会话得出 characterId，客户端不可指定付款方/收款方身份。

v0.11.0 为市场写操作建立通用的最小命令去重存储；v0.12.0 的 barter、deliver、redeem 复用它。不要求本轮一次性重写所有旧接口。资产变化、业务状态、账本与 command result 在同一事务提交。命令表只负责去重，不是通用工作流引擎。

预览报价/候选不预留库存。执行前锁住实际参与实体，重算前提和价格；状态过期返回显式冲突，没有 side effect，不能悄悄换成另一份报价或候选。必须记录实际拒绝原因，但不要向玩家泄露其他人的隐私。

每个新增跨模块事务在实现前画出其锁顺序与现有被复用路径，真实 PostgreSQL 交叉并发测试是门槛。不要在新服务外层持有一组锁后调用内部另开事务的方法。统一通过同一个 tx 传递 repository/ledger；确有死锁的路径只做相关范围的锁顺序修正，并有限重试整个幂等命令，不能重试半笔账。

## 4. 结构化事实先于文案

未来新事件最少含：`eventId`、`eventType`、`eventVersion`、`occurredAt`、`sourceScope`、`actorId`、`targetId?`、`payload`。各 eventType 的 payload 必须是判别联合类型，不是任意 object 后随便读取。

战斗事件含实际 attacker/target、damage、targetHpAfter、atMs；采集事件含资源、itemId、实际数量；交易事件含实际数量与货币变化；NPC 决策含 decisionId 和 accepted outcome；新手进度由完成事件驱动。显示 message 可以保留，但不得由业务逻辑正则解析中文日志来算血量、数量或新手完成。

不得声称完整 Event Sourcing：数据库状态仍是权威，本轮事件用于同步、可观察性与核查。事件重放不得重复产生资产；动画重播不得重新发奖励。

## 5. 模型决策公共语义

内部统一 contract（具体 TypeScript 定义在 v0.13.0）：

```ts
type DecisionPurpose = 'npc_resource_decision' | 'npc_world_intent';
type DecisionSource = 'rule' | 'model';
interface DecisionInput {
  decisionId: string;
  purpose: DecisionPurpose;
  npcId: string;
  triggerKey: string;
  observedAt: string;
  relevantStateHash: string;
  candidateSetHash: string;
  candidates: ReadonlyArray<{ id: string; description: string }>;
  facts: Readonly<Record<string, unknown>>;
}
interface DecisionOutput {
  selectedCandidateId: string;
  source: DecisionSource;
  confidence: number | null;
  probabilities: Readonly<Record<string, number>> | null;
  provider: string;
  model: string | null;
  reasonCode: string | null;
}
```

完整执行参数只保存在服务端候选对象中。这里的 facts 仅是输入边界占位，各 purpose 落地必须有独立受校验 schema，不能直接序列化整个数据库行。

reasonCode 只能来自已声明的有限集合，或为 null；不能假装它是可验证的“模型内心原因”。不要求 Jev 生成自由文本理由。人格和关系不是本次概率；confidence 不是许可，也不是心理数值。实际执行还要二次校验。

只有一个候选时不调用；相同已处理 trigger 返回记录；模型不可用时规则路径继续。model 模式失败可执行预先指定规则 fallback，但必须明确 source=rule。stale 决策不能偷偷改选另一个动作，下一次合法触发才重新评估。

## 6. 认知与可信记忆

玩家文本是不可信陈述；服务端事件是可核对事实。玩家说“我给了你矿石”只能存 dialogue_claim，不能升级为 system_verified。承诺与实际完成分开；同一 sourceEventId 只计一次好感。

NPC 只接收它能知道的当前情况、相关记忆、人格、候选成本。不得发送其他玩家聊天、完整资产列表、API key、账号邮箱或管理员数据。重要已验证记忆先用结构化引用，模型摘要只能作为显示/检索辅助。

生成台词在提交后描述结果。没有成功提交就不能显示“已赠予、已修好、已发布任务”。模型输出不能给出系统不存在的服务，即使 schema 正确也要过表现校验；数值承诺尽量由模板插入权威值。

## 7. 时钟、预算与效果开关

所有规则接收可注入 now；DB 用 UTC，饭点/日预算明确使用世界时区（首轮 Asia/Shanghai），展示用玩家时区。不要把客户端时间当结算时间。

世界 goal 事件驱动，不逐帧调用。每 NPC 默认每天最多 4 次常规新目标判断 + 2 次重大失效事件判断；历史 catch-up 不补打历史模型调用。特定 NPC 的一次世界决定被所有观察者共享。

区分 `NPC_DECISION_PROVIDER=rule|deepseek|typesafe` 和原有叙事 provider，默认 rule。新增 provider 只在所属包启用。world tick、fallback、各判定 purpose 有独立失败统计；引擎关闭模型后仍可完整体验。

## 8. 数据演进与回退

优先加列/加表并兼容旧记录，不做未经授权的世界重置。active action 兼容策略必须有明确迁移与停写窗口，不能靠把旧 payload 当零伤害或把正在进行的行为删掉来“升级”。

新增命令幂等记录与版本证据按运行配置保留，未终结操作不得清除。世界重置只清理世界关联数据，保留需要保留的审计并解除引用，沿用项目既有边界。降级先关功能开关，资产已经合法转移的不能因关开关而凭空撤回。
