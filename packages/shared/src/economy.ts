import type { DefinitionRefDto } from "./base.js";

// M16-P 订单经济公共协议（contractVersion 0.16.0-p1）。
// 账款单位 credits（整数），与物理电力（W/Wh）严格分离；不设第二钱包——
// 唯一账款余额在 bases.credits，写者 economy 模块。

export const ORDER_STATUSES = [
  "open",
  "accepted",
  "delivered",
  "failed"
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface OrderTemplateDto {
  ref: DefinitionRefDto;
  name: string;
  description: string;
  requiredItemId: string;
  quantity: number;
  rewardCredits: number;
  // 订单接单后须在 N 模拟小时内交付；超时 failed（预付扣押归零，材料不退）。
  deadlineSimHours: number;
}

export interface BaseOrderDto {
  orderId: string;
  orderRef: DefinitionRefDto;
  name: string;
  status: OrderStatus;
  requiredItemId: string;
  requiredItemName: string;
  quantity: number;
  rewardCredits: number;
  deadlineSim: string | null;
  acceptedAtSim: string | null;
}

export interface PurchaseOrderDto {
  purchaseId: string;
  itemId: string;
  itemName: string;
  quantity: number;
  costCredits: number;
  status: "in_transit" | "delivered";
  arrivesAtSim: string;
}

export interface AcceptOrderInputDto {
  orderId: string;
  commandId: string;
}

export interface DeliverOrderInputDto {
  orderId: string;
  commandId: string;
}

export interface CreatePurchaseInputDto {
  itemId: string;
  quantity: number;
  commandId: string;
}

// 采购价目（credits/件，fixture）与到货延迟（模拟小时）。
export const PURCHASE_CATALOG: ReadonlyArray<{
  itemId: string;
  unitCostCredits: number;
}> = [
  { itemId: "solar_panel_set", unitCostCredits: 120 },
  { itemId: "support_frame", unitCostCredits: 40 },
  { itemId: "cable", unitCostCredits: 25 },
  { itemId: "power_box", unitCostCredits: 60 },
  { itemId: "anchor", unitCostCredits: 15 },
  { itemId: "spare_parts", unitCostCredits: 30 }
];

export const PURCHASE_TRANSIT_SIM_HOURS = 4;
export const ORDER_REFRESH_SIM_HOURS = 24;
