import type { ItemId } from "@ai-mud/shared";
import type { EquipmentRarity } from "./item-rules.js";

export interface DropTableEntry {
  itemId: ItemId;
  quantity: number;
  chance: number;
}

export interface RolledDrop {
  itemId: ItemId;
  quantity: number;
  sourceId: string | null;
  entryIndex: number;
}

export type RarityWeights = Record<EquipmentRarity, number>;

export const DEFAULT_RARITY_WEIGHTS: RarityWeights = {
  common: 800,
  uncommon: 160,
  rare: 35,
  epic: 5
};

function hashToUnit(seed: string, index: number) {
  let hash = 2166136261;
  const text = `${seed}:${index}`;

  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967296;
}

export function rollDropTable(input: {
  seed: string;
  sourceId?: string | null;
  entries: readonly DropTableEntry[];
}): RolledDrop[] {
  return input.entries.flatMap((entry, entryIndex) => {
    const chance = Math.min(1, Math.max(0, entry.chance));
    const quantity = Math.max(0, Math.floor(entry.quantity));
    const dropped = hashToUnit(input.seed, entryIndex) <= chance;

    if (!dropped || quantity <= 0) return [];

    return [
      {
        itemId: entry.itemId,
        quantity,
        sourceId: input.sourceId ?? null,
        entryIndex
      }
    ];
  });
}

export function mergeRolledDrops(drops: readonly Pick<RolledDrop, "itemId" | "quantity">[]) {
  return drops.reduce<Array<{ itemId: ItemId; quantity: number }>>((merged, drop) => {
    const existing = merged.find((item) => item.itemId === drop.itemId);
    if (!existing) {
      merged.push({ itemId: drop.itemId, quantity: drop.quantity });
      return merged;
    }

    existing.quantity += drop.quantity;
    return merged;
  }, []);
}

export function rollEncounterLoot(input: {
  seed: string;
  encounters: ReadonlyArray<{ id: string; lootTable: readonly DropTableEntry[] }>;
}) {
  return mergeRolledDrops(
    input.encounters.flatMap((encounter, encounterIndex) =>
      rollDropTable({
        seed: `${input.seed}:${encounterIndex}`,
        sourceId: encounter.id,
        entries: encounter.lootTable
      })
    )
  );
}

export function rollRarity(
  seed: string,
  index: number,
  weights: RarityWeights = DEFAULT_RARITY_WEIGHTS
): EquipmentRarity {
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + Math.max(0, weight), 0);
  const roll = hashToUnit(seed, index) * totalWeight;
  let cursor = 0;

  for (const rarity of ["common", "uncommon", "rare", "epic"] as const) {
    cursor += Math.max(0, weights[rarity]);
    if (roll < cursor) return rarity;
  }

  return "common";
}
