import type { EquipmentDefinition } from "@ai-mud/content";
import type { EquipmentSlot } from "@ai-mud/shared";
import { calculateRepairQuote, type RepairQuoteResult } from "./economy-rules.js";
import type { RolledEquipment, RolledEquipmentAffix } from "./item-rules.js";

export interface EquipmentDurabilityInput {
  currentDurability: number;
  maxDurability: number;
}

export interface CombatDurabilityEquipment {
  slot: EquipmentSlot;
  currentDurability: number;
  maxDurability: number;
}

export interface EquipmentStatBlock {
  attack: number;
  defense: number;
  agility: number;
  maxHp: number;
  gatherSpeedPct: number;
  repairDiscountPct: number;
  durabilityBonusPct: number;
  injuryRecoveryPct: number;
}

export type CanEquipResult =
  | { ok: true }
  | { ok: false; reason: "not_equipment" | "slot_mismatch" | "invalid_durability" };

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

export function isValidDurability(input: EquipmentDurabilityInput): boolean {
  return (
    Number.isInteger(input.currentDurability) &&
    Number.isInteger(input.maxDurability) &&
    input.maxDurability > 0 &&
    input.currentDurability >= 0 &&
    input.currentDurability <= input.maxDurability
  );
}

export function canEquip(input: {
  item: EquipmentDefinition | RolledEquipment | null;
  targetSlot: EquipmentSlot;
}): CanEquipResult {
  if (!input.item) return { ok: false, reason: "not_equipment" };
  if (input.item.slot !== input.targetSlot) return { ok: false, reason: "slot_mismatch" };
  if (
    "currentDurability" in input.item &&
    !isValidDurability({
      currentDurability: input.item.currentDurability,
      maxDurability: input.item.maxDurability
    })
  ) {
    return { ok: false, reason: "invalid_durability" };
  }

  return { ok: true };
}

function emptyStats(): EquipmentStatBlock {
  return {
    attack: 0,
    defense: 0,
    agility: 0,
    maxHp: 0,
    gatherSpeedPct: 0,
    repairDiscountPct: 0,
    durabilityBonusPct: 0,
    injuryRecoveryPct: 0
  };
}

function addAffix(stats: EquipmentStatBlock, affix: RolledEquipmentAffix, ratio: number) {
  stats[affix.stat] += Math.floor(affix.value * ratio);
}

export function aggregateEquipmentStats(
  equipment: ReadonlyArray<
    Pick<RolledEquipment, "baseStats" | "affixes" | "currentDurability" | "maxDurability">
  >
): EquipmentStatBlock {
  const stats = emptyStats();

  for (const item of equipment) {
    const ratio = calculateEffectiveStatRatio(item);
    stats.attack += Math.floor((item.baseStats.attack ?? 0) * ratio);
    stats.defense += Math.floor((item.baseStats.defense ?? 0) * ratio);
    stats.agility += Math.floor((item.baseStats.agility ?? 0) * ratio);
    stats.maxHp += Math.floor((item.baseStats.maxHp ?? 0) * ratio);

    for (const affix of item.affixes) {
      addAffix(stats, affix, ratio);
    }
  }

  return stats;
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
