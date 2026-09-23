// M16-D 经济面板：账款、外部订单（接单/交付）、采购（付款→在途→到货）。
// 展示即事实：所有数字来自快照，本地不做任何计算。
import { useState } from "react";
import { PURCHASE_CATALOG } from "@ai-mud/shared";
import type {
  BaseOrderDto,
  BaseResourceDto,
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
  isBusy,
  onAcceptOrder,
  onDeliverOrder,
  onPurchase
}: EconomyBoardProps) {
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
