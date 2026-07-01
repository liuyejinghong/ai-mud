import type { EquipmentSlot } from "@ai-mud/shared";
import { calculateRepairQuote, type RepairQuoteResult } from "./economy-rules.js";

export interface EquipmentDurabilityInput {
  currentDurability: number;
  maxDurability: number;
}

export interface CombatDurabilityEquipment {
  slot: EquipmentSlot;
  currentDurability: number;
  maxDurability: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizedDurability(input: EquipmentDurabilityInput) {
  const maxDurability = Math.max(1, Math.floor(input.maxDurability));
  const currentDurability = clamp(Math.floor(input.currentDurability), 0, maxDurability);
  return { currentDurability, maxDurability };
}

export function calculateDurabilityPct(input: EquipmentDurabilityInput): number {
  const durability = normalizedDurability(input);
  return Math.round((durability.currentDurability / durability.maxDurability) * 100);
}

export function calculateEffectiveStatRatio(input: EquipmentDurabilityInput): number {
  return normalizedDurability(input).currentDurability <= 0 ? 0.2 : 1;
}

export function applyCombatDurabilityLoss<T extends CombatDurabilityEquipment>(
  equipment: T[]
): T[] {
  return equipment.map((item) => {
    const loss = item.slot === "weapon" ? 2 : 1;
    return {
      ...item,
      currentDurability: Math.max(0, item.currentDurability - loss)
    };
  });
}

export function calculateEquipmentRepairQuote(input: {
  itemLevel: number;
  currentDurability: number;
  maxDurability: number;
}): RepairQuoteResult | null {
  const durability = normalizedDurability(input);
  if (durability.currentDurability >= durability.maxDurability) return null;

  return calculateRepairQuote({
    itemLevel: input.itemLevel,
    durabilityLossPct:
      (durability.maxDurability - durability.currentDurability) / durability.maxDurability
  });
}
