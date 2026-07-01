import type { MoneyDto } from "@ai-mud/shared";

export type MarketTradeDirection = "buy" | "sell";

export interface MarketQuoteInput {
  direction: MarketTradeDirection;
  basePriceCopper: number;
  stockQuantity: number;
  targetQuantity: number;
  quantity: number;
  taxRate?: number;
}

export interface MarketQuoteResult {
  direction: MarketTradeDirection;
  unitPriceCopper: number;
  quantity: number;
  grossCopper: number;
  taxCopper: number;
  totalCopper: number;
}

export interface RepairQuoteInput {
  itemLevel: number;
  durabilityLossPct: number;
  baseRepairFactor?: number;
}

export interface RepairQuoteResult {
  copperCost: number;
  ironOreCost: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function formatMoney(totalCopper: number): MoneyDto {
  const normalized = Math.max(0, Math.floor(totalCopper));
  const gold = Math.floor(normalized / 10_000);
  const silver = Math.floor((normalized % 10_000) / 100);
  const copper = normalized % 100;

  return {
    gold,
    silver,
    copper,
    totalCopper: normalized
  };
}

export function calculateMarketQuote(input: MarketQuoteInput): MarketQuoteResult {
  const quantity = Math.max(1, Math.floor(input.quantity));
  const targetQuantity = Math.max(1, input.targetQuantity);
  const stockQuantity = Math.max(0, input.stockQuantity);
  const stockFactor = targetQuantity / Math.max(stockQuantity, 1);
  const boundedFactor =
    input.direction === "buy" ? clamp(stockFactor, 0.8, 3) : clamp(stockFactor, 0.5, 2);
  const unitPriceCopper = Math.max(1, Math.round(input.basePriceCopper * boundedFactor));
  const grossCopper = unitPriceCopper * quantity;
  const taxCopper = Math.ceil(grossCopper * (input.taxRate ?? 0.05));

  return {
    direction: input.direction,
    unitPriceCopper,
    quantity,
    grossCopper,
    taxCopper,
    totalCopper: input.direction === "buy" ? grossCopper + taxCopper : grossCopper - taxCopper
  };
}

export function calculateRepairQuote(input: RepairQuoteInput): RepairQuoteResult {
  const itemLevel = Math.max(1, Math.floor(input.itemLevel));
  const durabilityLossPct = clamp(input.durabilityLossPct, 0, 1);
  const baseRepairFactor = input.baseRepairFactor ?? 25;
  const copperCost = Math.max(1, Math.ceil(itemLevel * durabilityLossPct * baseRepairFactor));
  const ironOreCost = Math.max(1, Math.ceil((itemLevel * durabilityLossPct) / 10));

  return {
    copperCost,
    ironOreCost
  };
}
