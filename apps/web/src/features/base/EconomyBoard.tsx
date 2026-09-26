import { useState } from "react";
import { PURCHASE_CATALOG, PURCHASE_TRANSIT_SIM_MINUTES } from "@ai-mud/shared";
import type {
  BaseOrderDto,
  BaseResourceDto,
  BaseSnapshotDto,
  CreatePurchaseInputDto,
  PurchaseOrderDto
} from "@ai-mud/shared";

const ORDER_STATUS_LABELS: Record<string, string> = {
  open: "可接单",
  accepted: "进行中",
  delivered: "已交付",
  failed: "已失败"
};

const PURCHASE_STATUS_LABELS: Record<string, string> = {
  in_transit: "运输途中",
  delivered: "已入库"
};

export interface EconomyBoardProps {
  credits: number;
  orders: BaseOrderDto[];
  purchases: PurchaseOrderDto[];
  resources: BaseResourceDto[];
  targetProject?: BaseSnapshotDto["buildableProjects"][number] | undefined;
  simTime: string;
  isBusy: boolean;
  onAcceptOrder: (orderId: string) => void;
  onDeliverOrder: (orderId: string) => void;
  onPurchase: (itemId: string, quantity: number) => void;
}

export function EconomyBoard({
  credits,
  orders,
  purchases,
  resources,
  targetProject,
  simTime,
  isBusy,
  onAcceptOrder,
  onDeliverOrder,
  onPurchase
}: EconomyBoardProps) {
  const supply = targetProject?.inputs?.map((input) => {
    const resource = resources.find((item) => item.itemId === input.itemId);
    const available = Math.max(0, (resource?.quantity ?? 0) - (resource?.reservedQuantity ?? 0));
    const short = Math.max(0, input.quantity - available);
    const inTransit = purchases.filter((purchase) =>
      purchase.itemId === input.itemId && purchase.status === "in_transit"
    ).reduce((sum, purchase) => sum + purchase.quantity, 0);
    const toBuy = Math.max(0, short - inTransit);
    const unitCost = PURCHASE_CATALOG.find((item) => item.itemId === input.itemId)?.unitCostCredits;
    return { ...input, available, short, inTransit, toBuy, unitCost };
  }) ?? [];
  const totalQty = supply.reduce((sum, item) => sum + item.toBuy, 0);
  const totalCost = supply.reduce((sum, item) => sum + item.toBuy * (item.unitCost ?? 0), 0);
  const allPriced = supply.every((item) => item.toBuy === 0 || item.unitCost !== undefined);
  const now = Date.parse(simTime);
  const newArrival = Number.isNaN(now) ? null : formatSimDateTime(new Date(
    now + PURCHASE_TRANSIT_SIM_MINUTES * 60_000
  ).toISOString());
  return (
    <section className="base-panel base-economy" aria-label="经营">
      <h2 className="base-panel-title">经营</h2>
      <p className="base-summary-line">
        账款余额：<strong>{credits} credits</strong>
        <span className="base-copy">（账款与电力分开记账，交付订单赚得）</span>
      </p>

      {orders.length === 0 ? (
        <p className="base-copy">暂时没有外部订单，稍后会刷新。</p>
      ) : (
        <ul className="base-order-list">
          {[...orders]
            .sort(
              (a, b) =>
                a.name.localeCompare(b.name) || a.orderId.localeCompare(b.orderId)
            )
            .map((order) => {
            const resource = resources.find((row) => row.itemId === order.requiredItemId);
            const available = resource ? resource.quantity - resource.reservedQuantity : 0;
            const sourceSummary = describeReservationSources(resource);
            return (
              <li key={order.orderId}>
                <div
                  className="base-order-card"
                >
                  <span className="base-order-name">{order.name}</span>
                  <span className="base-copy">
                    需要 {order.requiredItemName} ×{order.quantity} · 报酬{" "}
                    {order.rewardCredits} credits · {ORDER_STATUS_LABELS[order.status] ?? order.status}
                    {order.deadlineSim ? ` · 期限 ${formatSimDateTime(order.deadlineSim)}` : ""}
                  </span>
                  {order.status === "accepted" ? (
                    <span className="base-project-step">
                      可支配 {available} · 总量 {resource?.quantity ?? 0} · 已占用 {resource?.reservedQuantity ?? 0}
                      {available < order.quantity ? ` · 尚缺 ${order.quantity - available}` : ""}
                      {sourceSummary ? ` · 占用去向：${sourceSummary}` : ""}
                    </span>
                  ) : null}
                </div>
                {order.status === "open" ? (
                  <button
                    type="button"
                    className="base-primary-button"
                    disabled={isBusy}
                    onClick={() => onAcceptOrder(order.orderId)}
                  >
                    接下这单
                  </button>
                ) : null}
                {order.status === "accepted" ? (
                  <button
                    type="button"
                    className="base-primary-button"
                    disabled={isBusy}
                    onClick={() => onDeliverOrder(order.orderId)}
                  >
                    交付物资
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <h3 className="base-panel-title">补给采购</h3>
      {supply.length > 0 ? (
        <section className="base-supply-plan" aria-label={`${targetProject?.name}材料预算`}>
          <strong>{targetProject?.name} · 开工材料</strong>
          <ul>
            {supply.map((item) => (
              <li key={item.itemId}>
                {BASE_ITEM_NAMES[item.itemId] ?? item.itemId}：需 {item.quantity}，可支配 {item.available}，现缺 {item.short}，在途 {item.inTransit}（未入库），净缺口 {item.toBuy}
                {item.unitCost === undefined
                  ? " · 暂无采购价"
                  : ` · ${item.unitCost} credits/件 · 小计 ${item.toBuy * item.unitCost} credits`}
              </li>
            ))}
          </ul>
          <p className="base-summary-line">
            {allPriced
              ? `按当前库存与在途计算，还需采购 ${totalQty} 件 · 合计 ${totalCost} credits`
              : `还需采购 ${totalQty} 件；部分材料暂无采购价，无法核算总价。`}
            {allPriced && totalCost > credits ? ` · 当前账款还差 ${totalCost - credits} credits` : ""}
          </p>
          {totalQty > 0 && allPriced ? (
            <p className="base-copy">现在付款后预计 {PURCHASE_TRANSIT_SIM_MINUTES} 基地分钟到货{newArrival ? `（按当前基地时间约 ${newArrival}）` : ""}；新购材料到货前不可用于开工。</p>
          ) : totalQty > 0 ? (
            <p className="base-copy">部分材料暂无采购价，请先核对可购材料。</p>
          ) : supply.some((item) => item.short > 0) ? (
            <p className="base-copy">当前缺料已有采购在途，到货后请重新核对库存。</p>
          ) : <p className="base-copy">当前材料可支配量已满足开工需求。</p>}
        </section>
      ) : null}
      <ul className="base-purchase-list">
        {PURCHASE_CATALOG.map((entry) => (
          <li key={entry.itemId}>
            <PurchaseRow
              itemId={entry.itemId}
              unitCost={entry.unitCostCredits}
              isBusy={isBusy}
              onPurchase={onPurchase}
            />
          </li>
        ))}
      </ul>

      {purchases.length > 0 ? (
        <ul className="base-purchase-status">
          {purchases.map((purchase) => (
            <li key={purchase.purchaseId}>
              {purchase.itemName} ×{purchase.quantity}（{purchase.costCredits} credits）·{" "}
              {PURCHASE_STATUS_LABELS[purchase.status] ?? purchase.status}
              {purchase.status === "in_transit" ? ` · 预计到货 ${formatSimDateTime(purchase.arrivesAtSim)}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function PurchaseRow({
  itemId,
  unitCost,
  isBusy,
  onPurchase
}: {
  itemId: string;
  unitCost: number;
  isBusy: boolean;
  onPurchase: (itemId: string, quantity: number) => void;
}) {
  const itemName = BASE_ITEM_NAMES[itemId] ?? itemId;
  const [quantity, setQuantity] = useState(1);
  return (
    <div className="base-purchase-row">
      <span>{itemName}</span>
      <span className="base-copy">{unitCost} credits/件</span>
      <input
        type="number"
        min={1}
        aria-label={`购买数量·${itemName}`}
        value={quantity}
        onChange={(event) =>
          setQuantity(Math.max(1, Math.floor(Number(event.target.value) || 1)))
        }
      />
      <button
        type="button"
        className="base-primary-button"
        disabled={isBusy}
        onClick={() => onPurchase(itemId, quantity)}
      >
        购入
      </button>
    </div>
  );
}

// 基地历时间（simTime 的 UTC 字段即基地昼夜基准）。
function formatSimDateTime(sim: string): string {
  const date = new Date(sim);
  if (Number.isNaN(date.getTime())) return sim;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

export const BASE_ITEM_NAMES: Record<string, string> = {
  solar_panel_set: "太阳电池阵组件",
  support_frame: "支架结构件",
  cable: "线缆",
  power_box: "配电单元",
  anchor: "锚固件",
  spare_parts: "通用备件"
};

export function describeReservationSources(resource: BaseResourceDto | undefined): string | null {
  if (!resource || resource.reservedQuantity === 0) return null;
  const sources = resource.reservationSources.map((source) =>
    `${source.kind === "project" ? "工程" : "制造工单"}「${source.name}」×${source.quantity}`
  );
  return sources.length > 0 ? sources.join("、") : "占用来源暂未同步";
}
