export const EQUIPMENT_SLOTS = ["weapon", "chest", "head", "accessory"] as const;
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];

export type ItemCategory = "food" | "material" | "ore" | "equipment";

export interface ItemDefinitionBase {
  id: string;
  name: string;
  description: string;
  itemLevel: number;
  category: ItemCategory;
}

export interface MarketItemFields {
  baseBuyPriceCopper: number;
  baseSellPriceCopper: number;
  targetMarketQuantity: number;
}

export interface FoodDefinition extends ItemDefinitionBase, MarketItemFields {
  category: "food";
  satietyRestore: number;
}

export interface MaterialDefinition extends ItemDefinitionBase, MarketItemFields {
  category: "material";
}

export interface OreDefinition extends ItemDefinitionBase, MarketItemFields {
  category: "ore";
}

export interface EquipmentDefinition extends ItemDefinitionBase {
  category: "equipment";
  slot: EquipmentSlot;
  baseStats: {
    attack?: number;
    defense?: number;
    agility?: number;
    maxHp?: number;
  };
  maxDurability: number;
  affixable: boolean;
}

export type ItemDefinition =
  | FoodDefinition
  | MaterialDefinition
  | OreDefinition
  | EquipmentDefinition;

export type MarketItemDefinition = FoodDefinition | MaterialDefinition | OreDefinition;

export type ItemId = (typeof ITEM_DEFINITIONS)[number]["id"];

export type AffixStat =
  | "attack"
  | "defense"
  | "agility"
  | "maxHp"
  | "gatherSpeedPct"
  | "repairDiscountPct"
  | "durabilityBonusPct"
  | "injuryRecoveryPct";

export interface AffixDefinition {
  id: string;
  name: string;
  stat: AffixStat;
  applicableSlots: EquipmentSlot[];
  tiers: Array<{ minItemLevel: number; valueMin: number; valueMax: number }>;
}

export const ITEM_DEFINITIONS = [
  {
    id: "wild_berry",
    name: "野莓",
    description: "腐林边缘还能入口的酸涩浆果。",
    category: "food",
    itemLevel: 1,
    baseBuyPriceCopper: 5,
    baseSellPriceCopper: 8,
    targetMarketQuantity: 100,
    satietyRestore: 1
  },
  {
    id: "beast_meat",
    name: "兽肉",
    description: "处理粗糙但能果腹的野兽肉块。",
    category: "food",
    itemLevel: 1,
    baseBuyPriceCopper: 12,
    baseSellPriceCopper: 20,
    targetMarketQuantity: 60,
    satietyRestore: 1
  },
  {
    id: "rough_hide",
    name: "粗糙皮革",
    description: "还带着林地腥味的皮革边料。",
    category: "material",
    itemLevel: 1,
    baseBuyPriceCopper: 10,
    baseSellPriceCopper: 18,
    targetMarketQuantity: 40
  },
  {
    id: "iron_ore",
    name: "基础铁矿石",
    description: "旧矿脉中还能挖出的低品位铁矿。",
    category: "ore",
    itemLevel: 1,
    baseBuyPriceCopper: 18,
    baseSellPriceCopper: 30,
    targetMarketQuantity: 80
  },
  {
    id: "wolfbone_shiv",
    name: "狼骨短刃",
    description: "用腐化野狼腿骨磨出的短刃，刃口粗糙但比训练剑更轻。",
    category: "equipment",
    itemLevel: 3,
    slot: "weapon",
    baseStats: { attack: 3, agility: 1 },
    maxDurability: 70,
    affixable: true
  },
  {
    id: "rusted_mine_cleaver",
    name: "锈蚀矿坑砍刀",
    description: "矿坑匪徒留下的厚背砍刀，刀身锈蚀但重量足够破甲。",
    category: "equipment",
    itemLevel: 8,
    slot: "weapon",
    baseStats: { attack: 6, defense: 1 },
    maxDurability: 90,
    affixable: true
  },
  {
    id: "miner_guard_harness",
    name: "矿工护具",
    description: "用旧皮带和薄铁片加固的护具，适合在狭窄矿道里防身。",
    category: "equipment",
    itemLevel: 8,
    slot: "chest",
    baseStats: { defense: 5, maxHp: 10 },
    maxDurability: 110,
    affixable: true
  },
  {
    id: "training_sword",
    name: "训练短剑",
    description: "哨站仓库发放的短剑，刃口钝但足够自卫。",
    category: "equipment",
    itemLevel: 5,
    slot: "weapon",
    baseStats: { attack: 2, defense: 0 },
    maxDurability: 100,
    affixable: true
  },
  {
    id: "patched_leather_vest",
    name: "缝补皮甲",
    description: "多次修补过的皮甲，仍能挡住野兽爪击。",
    category: "equipment",
    itemLevel: 5,
    slot: "chest",
    baseStats: { attack: 0, defense: 2 },
    maxDurability: 100,
    affixable: true
  }
] as const satisfies readonly ItemDefinition[];

export const AFFIX_POOLS = [
  {
    id: "sharp",
    name: "锋利",
    stat: "attack",
    applicableSlots: ["weapon", "accessory"],
    tiers: [
      { minItemLevel: 1, valueMin: 1, valueMax: 2 },
      { minItemLevel: 6, valueMin: 2, valueMax: 4 }
    ]
  },
  {
    id: "sturdy",
    name: "坚固",
    stat: "defense",
    applicableSlots: ["chest", "head"],
    tiers: [
      { minItemLevel: 1, valueMin: 1, valueMax: 2 },
      { minItemLevel: 6, valueMin: 2, valueMax: 4 }
    ]
  },
  {
    id: "swift",
    name: "迅捷",
    stat: "agility",
    applicableSlots: ["weapon", "chest", "head", "accessory"],
    tiers: [
      { minItemLevel: 1, valueMin: 1, valueMax: 1 },
      { minItemLevel: 6, valueMin: 1, valueMax: 2 }
    ]
  },
  {
    id: "vital",
    name: "活力",
    stat: "maxHp",
    applicableSlots: ["chest", "head", "accessory"],
    tiers: [
      { minItemLevel: 1, valueMin: 3, valueMax: 6 },
      { minItemLevel: 6, valueMin: 6, valueMax: 12 }
    ]
  },
  {
    id: "deft",
    name: "巧手",
    stat: "gatherSpeedPct",
    applicableSlots: ["head", "accessory"],
    tiers: [
      { minItemLevel: 1, valueMin: 3, valueMax: 5 },
      { minItemLevel: 6, valueMin: 5, valueMax: 8 }
    ]
  },
  {
    id: "craft",
    name: "匠心",
    stat: "repairDiscountPct",
    applicableSlots: ["accessory"],
    tiers: [
      { minItemLevel: 1, valueMin: 5, valueMax: 8 },
      { minItemLevel: 6, valueMin: 8, valueMax: 12 }
    ]
  },
  {
    id: "resilient",
    name: "韧性",
    stat: "durabilityBonusPct",
    applicableSlots: ["weapon", "chest"],
    tiers: [
      { minItemLevel: 1, valueMin: 10, valueMax: 15 },
      { minItemLevel: 6, valueMin: 15, valueMax: 25 }
    ]
  },
  {
    id: "restorative",
    name: "复元",
    stat: "injuryRecoveryPct",
    applicableSlots: ["accessory"],
    tiers: [
      { minItemLevel: 1, valueMin: 10, valueMax: 15 },
      { minItemLevel: 6, valueMin: 15, valueMax: 20 }
    ]
  }
] as const satisfies readonly AffixDefinition[];

export function getItemById(itemId: string): ItemDefinition | null {
  return ITEM_DEFINITIONS.find((item) => item.id === itemId) ?? null;
}

export function listMarketItemDefinitions(): MarketItemDefinition[] {
  return ITEM_DEFINITIONS.flatMap((item) => {
    if (item.category === "food" || item.category === "material" || item.category === "ore") {
      return [item];
    }
    return [];
  });
}

export function isMarketItemDefinition(item: ItemDefinition): item is MarketItemDefinition {
  return item.category === "food" || item.category === "material" || item.category === "ore";
}

export function isFoodDefinition(item: ItemDefinition): item is FoodDefinition {
  return item.category === "food";
}

export function getMarketItemById(itemId: string): MarketItemDefinition | null {
  const item = getItemById(itemId);
  return item && isMarketItemDefinition(item) ? item : null;
}

export function getFoodItemById(itemId: string): FoodDefinition | null {
  const item = getItemById(itemId);
  return item && isFoodDefinition(item) ? item : null;
}
