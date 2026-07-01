import type { GameLocationId, GridPositionDto, ItemId } from "@ai-mud/shared";

export interface ItemDefinition {
  id: ItemId;
  name: string;
  category: "food" | "material" | "ore";
  itemLevel: number;
  baseBuyPriceCopper: number;
  baseSellPriceCopper: number;
  targetMarketQuantity: number;
  satietyRestore?: number;
}

export interface ResourceDefinition {
  id: string;
  name: string;
  position: GridPositionDto;
  charges: number;
  cycleSeconds: number;
  gatherResult: { itemId: ItemId; quantity: number };
}

export interface LootEntry {
  itemId: ItemId;
  quantity: number;
  chance: number;
}

export interface MonsterDefinition {
  id: string;
  name: string;
  hp: number;
  attack: number;
  defense: number;
  agility: number;
  xp: number;
  lootTable: LootEntry[];
}

export interface EncounterDefinition {
  id: string;
  name: string;
  position: GridPositionDto;
  monsterIds: string[];
}

export interface ZoneDefinition {
  id: GameLocationId;
  title: string;
  description: string;
  width: number;
  height: number;
  entry: GridPositionDto;
  exits: Array<{ id: string; position: GridPositionDto; toLocation: GameLocationId }>;
  resources: ResourceDefinition[];
  encounters: EncounterDefinition[];
}

export const FIRST_ITEMS: ItemDefinition[] = [
  {
    id: "wild_berry",
    name: "野莓",
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
    category: "material",
    itemLevel: 1,
    baseBuyPriceCopper: 10,
    baseSellPriceCopper: 18,
    targetMarketQuantity: 40
  },
  {
    id: "iron_ore",
    name: "基础铁矿石",
    category: "ore",
    itemLevel: 1,
    baseBuyPriceCopper: 18,
    baseSellPriceCopper: 30,
    targetMarketQuantity: 80
  }
];

export const FIRST_MONSTERS: MonsterDefinition[] = [
  {
    id: "corrupted_wolf",
    name: "腐化野狼",
    hp: 35,
    attack: 7,
    defense: 2,
    agility: 11,
    xp: 8,
    lootTable: [
      { itemId: "beast_meat", quantity: 1, chance: 1 },
      { itemId: "rough_hide", quantity: 1, chance: 0.5 }
    ]
  }
];

export const FIRST_ENCOUNTERS: EncounterDefinition[] = [
  {
    id: "corrupt_wolf_pack_01",
    name: "腐化野狼群",
    position: { x: 3, y: 3 },
    monsterIds: ["corrupted_wolf", "corrupted_wolf"]
  }
];

export const BLACKPINE_OUTPOST = {
  id: "blackpine_outpost" as const,
  title: "黑松哨站",
  description: "潮湿黑松围住木墙，哨塔上的火盆把灰雾照成暗红色。"
};

export const CORRUPT_FOREST: ZoneDefinition = {
  id: "corrupt_forest",
  title: "腐林",
  description: "腐烂树根盘住泥地，林间偶尔传来野兽拖拽物体的声音。",
  width: 5,
  height: 5,
  entry: { x: 2, y: 4 },
  exits: [{ id: "south_gate", position: { x: 2, y: 4 }, toLocation: "blackpine_outpost" }],
  resources: [
    {
      id: "forest_berry_patch_01",
      name: "野莓灌木",
      position: { x: 1, y: 3 },
      charges: 3,
      cycleSeconds: 30,
      gatherResult: { itemId: "wild_berry", quantity: 2 }
    },
    {
      id: "fallen_carcass_01",
      name: "被撕裂的兽尸",
      position: { x: 3, y: 2 },
      charges: 2,
      cycleSeconds: 45,
      gatherResult: { itemId: "beast_meat", quantity: 1 }
    },
    {
      id: "discarded_hide_01",
      name: "粗糙兽皮",
      position: { x: 4, y: 1 },
      charges: 1,
      cycleSeconds: 60,
      gatherResult: { itemId: "rough_hide", quantity: 1 }
    },
    {
      id: "abandoned_iron_vein_01",
      name: "废弃铁矿脉",
      position: { x: 0, y: 1 },
      charges: 120,
      cycleSeconds: 60,
      gatherResult: { itemId: "iron_ore", quantity: 1 }
    }
  ],
  encounters: FIRST_ENCOUNTERS
};

export function getResourceById(resourceId: string) {
  return CORRUPT_FOREST.resources.find((resource) => resource.id === resourceId) ?? null;
}

export function getItemById(itemId: ItemId) {
  return FIRST_ITEMS.find((item) => item.id === itemId) ?? null;
}

export function getMonsterById(monsterId: string) {
  return FIRST_MONSTERS.find((monster) => monster.id === monsterId) ?? null;
}

export function getEncounterById(encounterId: string) {
  return FIRST_ENCOUNTERS.find((encounter) => encounter.id === encounterId) ?? null;
}
