# M16-P：v0.16.0 接口包冻结（订单经济）

## 1. 裁决

- **账款**：credits（整数）存 `bases.credits`，唯一写者 economy（经用例）；与 W/Wh 严格分离，不设第二钱包。开局 500 credits（fixture，M10 平衡可调）。
- **订单**：内容定义 order_templates（M16-C 加入 release payload；首个 release 由 I 合并时补 order_templates 数组与校验）。接单 open→accepted（记 deadlineSim=acceptSim+deadlineSimHours）；交付 accepted→delivered（校验库存≥quantity→同事务扣库存+加 reward→receipt）；deadline 过期 accepted→failed（材料不退，账款不变）。
- **采购**：固定价目（shared PURCHASE_CATALOG）；POST 扣 credits→in_transit（arrivesAtSim=now+4h）；基地 tick 到货→delivered+入库（同事务）。
- **采购物流简化裁决（BOUNDARY-03）**：到货结算由基地 tick 统一做，无独立运输设备占用；"付款≠到货"语义保留。
- **幂等**：accept/deliver/purchase 全走回据（actorScope=base:{id}，kind 分别 base.acceptOrder/base.deliverOrder/base.purchase）。
- **超时失败**：订单失败由 tick 检查（deadlineSim < simTime → failed），不扣任何已入账资源。

## 2. REST（transport→application）

- `POST /base/orders/:orderId/accept {commandId?}`
- `POST /base/orders/:orderId/deliver {commandId?}`
- `POST /base/purchases {itemId, quantity(1..50), commandId?}`
- `GET /base/snapshot` 扩展：`credits: number`、`orders: BaseOrderDto[]`、`purchases: PurchaseOrderDto[]`

## 3. 结算语义

交付事务：锁定订单行（FOR UPDATE，status accepted 且归属基地）→ 库存条件扣减（不足 RESOURCE_INSUFFICIENT）→ credits += reward → base_orders delivered → saveReceiptResult。采购事务：credits 条件扣减（不足 RESOURCE_INSUFFICIENT）→ 插 in_transit。到货事务：in_transit 且 arrivesAtSim<=simTime → inventory credit + delivered。

## 4. fixture

订单模板（M16-C 内容单写者，进 release）：首批三个——
1. 「补给站收购太阳电池组件」solar_panel_set×4 → 700 credits, 48h
2. 「前哨建设招标：支架结构件」support_frame×6 → 500 credits, 48h
3. 「设备维护耗材采购」spare_parts×10 → 450 credits, 72h
订单刷新：开单数<3 且距上次刷新≥24 模拟小时 → tick 补足（M16-A 实现，简化为 tick 内每次补足至 3 个 open）。
