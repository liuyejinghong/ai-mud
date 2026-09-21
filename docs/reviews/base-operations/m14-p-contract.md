# M14-P：v0.14.0 接口包冻结（Jev 协作，RULE 模式）

## 1. 模式与范围裁决

- **本版交付 RULE 全链 + 决策审计**；SHADOW/LIVE 只留接口 seam 与 mode 字段（provider 未配置→安全回退 RULE 并记录）。**不调用付费模型**（LIVE_MODEL_GATE 留待用户授权）。
- **协作场景冻结（合同首批 purpose 之一）**：`transport_assistance`——施工步骤 ready 而本组无空闲机器人时，工程组发出跨组支援请求；决策在合法 helper 候选中选择；接受后 helper 机器人临时接入该步骤作业（跨组 working），步骤完成标记 fulfilled。
- 决策只选 ID：候选与 score 全部由服务端规则生成，provider 返回值不得改变候选语义。

## 2. 数据契约（schema 0031）

| 表 | 写者 | 说明 |
|---|---|---|
| decision_records | ai | decisionId unique / purpose / mode / provider / candidates / selected / latencyMs——只审计，不授权 |
| cooperation_requests | industry | base/project/step / from_group / helper_group / status / helper_operator / decision_id——真实调度事实 |

## 3. 结算语义（冻结）

1. 基地 tick 项目结算后：对 running 步骤，本组 working 机器人数为 0 且状态非 completed → 创建 pending 协作请求（同步骤同组已有 pending 则不重复），候选 = 其他组空闲机器人（battery ≥ ROBOT_WORK_DRAIN_WH），score = 电量比例。
2. 决策网关：组请求 → RuleDecisionProvider 选最高分候选（唯一候选直接选；无候选 abstain→请求保持 pending 等待下次 tick；TTL 过期→expired）→ 写 decision_records → 更新请求 accepted + helper_operator_id。
3. accepted 的 helper 在后续 tick 按该步骤出工（跨组 working），步骤 completed → 请求 fulfilled，helper 回 idle。
4. 协作请求不支持玩家创建/取消（v0.14 玩家看到的是可解释的协作状态；玩家指令面在 M14 合同后续扩展）。

## 4. REST/快照

- `GET /base/snapshot` 扩展：`cooperationRequests: CooperationRequestDto[]`（本基地全部，新→旧）。
- 无新写路由。

## 5. 文件归属

| 线 | 文件 |
|---|---|
| A（决策提供者） | ai/decision-provider.ts、ai/decision-gateway.ts、ai/decision-provider.test.ts、ai/decision-gateway.test.ts |
| B（协作调度） | industry/cooperation.service.ts、industry/cooperation.repository.ts、industry/cooperation.service.test.ts |
| C（客户端展示） | web features/base/CooperationPanel.tsx（+test）——挂 ProjectBoard 上方，I 接线 |
| D（表达模板） | packages/ai-prompts/src/decision.ts（+test）：决策输入/结果的中文表达模板（RULE reason 文案来源） |
| I/P | shared/decision.ts、schema+0031、composition、BaseSnapshotDto 扩展、boundaries 登记 |

Q：tests/base-operations/m14/（真 PG 协作闭环 + 决策审计 + 过期/拒绝路径）。
