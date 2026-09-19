// M16-D 经济面板：账款、外部订单（接单/交付）、采购（付款→在途→到货）。
// 展示即事实：所有数字来自快照，本地不做任何计算。
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
  selectedOrderId: string | null;
  onSelectOrder: (orderId: string) => void;
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
  selectedOrderId,
  onSelectOrder,
  onAcceptOrder,
  onDeliverOrder,
  onPurchase
}: EconomyBoardProps) {
  const selectedOrder = orders.find((order) => order.orderId === selectedOrderId) ?? null;
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
          {orders.map((order) => {
            const selected = selectedOrderId === order.orderId;
            return (
              <li key={order.orderId}>
                <button
                  type="button"
                  className={`base-order-card${selected ? " is-selected" : ""}`}
                  aria-pressed={selected}
                  onClick={() => onSelectOrder(order.orderId)}
                >
                  <span className="base-order-name">{order.name}</span>
                  <span className="base-copy">
                    需要 {order.requiredItemName} ×{order.quantity} · 报酬{" "}
                    {order.rewardCredits} credits · {ORDER_STATUS_LABELS[order.status] ?? order.status}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selectedOrder ? (
        <div className="base-order-actions">
          {selectedOrder.status === "open" ? (
            <button
              type="button"
              className="base-primary-button"
              disabled={isBusy}
              onClick={() => onAcceptOrder(selectedOrder.orderId)}
            >
              接下这单
            </button>
          ) : null}
          {selectedOrder.status === "accepted" ? (
            <button
              type="button"
              className="base-primary-button"
              disabled={isBusy}
              onClick={() => onDeliverOrder(selectedOrder.orderId)}
            >
              交付物资
            </button>
          ) : null}
        </div>
      ) : null}

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
  const itemName = ITEM_NAMES[itemId] ?? itemId;
  return (
    <div className="base-purchase-row">
      <span>{itemName}</span>
      <span className="base-copy">{unitCost} credits/件</span>
      <button
        type="button"
        className="base-primary-button"
        disabled={isBusy}
        onClick={() => onPurchase(itemId, 1)}
      >
        购入 ×1
      </button>
    </div>
  );
}

const ITEM_NAMES: Record<string, string> = {
  solar_panel_set: "太阳电池阵组件",
  support_frame: "支架结构件",
  cable: "线缆",
  power_box: "配电单元",
  anchor: "锚固件",
  spare_parts: "通用备件"
};
