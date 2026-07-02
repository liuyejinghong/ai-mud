import { AFFIX_POOLS, getItemById, type AffixStat, type EquipmentDefinition } from "@ai-mud/content";
import type { EquipmentSlot, ItemId } from "@ai-mud/shared";

export type EquipmentRarity = "common" | "uncommon" | "rare" | "epic";

export interface StackQuantity {
  itemId: ItemId;
  quantity: number;
}

export interface RolledEquipmentAffix {
  affixId: string;
  name: string;
  stat: AffixStat;
  value: number;
}

export interface RolledEquipment {
  itemDefId: string;
  name: string;
  rarity: EquipmentRarity;
  slot: EquipmentSlot;
  itemLevel: number;
  baseStats: EquipmentDefinition["baseStats"];
  affixes: RolledEquipmentAffix[];
  maxDurability: number;
  currentDurability: number;
}

const RARITY_AFFIX_COUNT: Record<EquipmentRarity, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3
};

export function addStackQuantity<T extends StackQuantity>(
  inventory: T[],
  itemId: ItemId,
  quantity: number
): T[] {
  const existing = inventory.find((item) => item.itemId === itemId);

  if (!existing) {
    return [...inventory, { itemId, quantity } as T];
  }

  return inventory.map((item) =>
    item.itemId === itemId ? { ...item, quantity: item.quantity + quantity } : item
  );
}

export function removeStackQuantity<T extends StackQuantity>(
  inventory: T[],
  itemId: ItemId,
  quantity: number
): { ok: true; inventory: T[] } | { ok: false; reason: "insufficient_quantity" | "invalid_quantity" } {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, reason: "invalid_quantity" };
  }

  const existing = inventory.find((item) => item.itemId === itemId);
  if (!existing || existing.quantity < quantity) {
    return { ok: false, reason: "insufficient_quantity" };
  }

  return {
    ok: true,
    inventory: inventory.flatMap((item) => {
      if (item.itemId !== itemId) return [item];
      const nextQuantity = item.quantity - quantity;
      return nextQuantity > 0 ? [{ ...item, quantity: nextQuantity }] : [];
    })
  };
}

export function isValidStackQuantity(quantity: number): boolean {
  return Number.isInteger(quantity) && quantity > 0;
}

function hashToUnit(seed: string, index: number) {
  let hash = 2166136261;
  const text = `${seed}:${index}`;

  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967296;
}

function pickIndex(seed: string, index: number, length: number) {
  return Math.floor(hashToUnit(seed, index) * length) % length;
}

function rollInt(seed: string, index: number, min: number, max: number) {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  return low + Math.floor(hashToUnit(seed, index) * (high - low + 1));
}

function statBonus(
  affixes: RolledEquipmentAffix[],
  stat: AffixStat
): number {
  return affixes
    .filter((affix) => affix.stat === stat)
    .reduce((sum, affix) => sum + affix.value, 0);
}

function rollAffixes(
  seed: string,
  definition: EquipmentDefinition,
  rarity: EquipmentRarity
): RolledEquipmentAffix[] {
  if (!definition.affixable) return [];

  const desiredCount = RARITY_AFFIX_COUNT[rarity];
  const candidates = AFFIX_POOLS.flatMap((affix) => {
    if (!(affix.applicableSlots as readonly EquipmentSlot[]).includes(definition.slot)) return [];
    const tiers = affix.tiers.filter((tier) => tier.minItemLevel <= definition.itemLevel);
    const tier = tiers.sort((left, right) => right.minItemLevel - left.minItemLevel)[0];
    return tier ? [{ affix, tier }] : [];
  });
  const selected: RolledEquipmentAffix[] = [];
  const remaining = [...candidates];

  for (let i = 0; i < desiredCount && remaining.length > 0; i += 1) {
    const selectedIndex = pickIndex(seed, i, remaining.length);
    const [choice] = remaining.splice(selectedIndex, 1);
    if (!choice) continue;

    selected.push({
      affixId: choice.affix.id,
      name: choice.affix.name,
      stat: choice.affix.stat,
      value: rollInt(seed, i + 100, choice.tier.valueMin, choice.tier.valueMax)
    });
  }

  return selected;
}

export function rollEquipment(
  seed: string,
  itemDefId: string,
  rarity: EquipmentRarity
): RolledEquipment | null {
  const definition = getItemById(itemDefId);
  if (!definition || definition.category !== "equipment") return null;

  const affixes = rollAffixes(seed, definition, rarity);
  const durabilityBonusPct = statBonus(affixes, "durabilityBonusPct");
  const maxDurability = Math.max(
    1,
    Math.round(definition.maxDurability * (1 + durabilityBonusPct / 100))
  );

  return {
    itemDefId: definition.id,
    name: definition.name,
    rarity,
    slot: definition.slot,
    itemLevel: definition.itemLevel,
    baseStats: { ...definition.baseStats },
    affixes,
    maxDurability,
    currentDurability: maxDurability
  };
}
