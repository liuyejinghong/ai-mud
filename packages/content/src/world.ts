import type { GameLocationId, GridPositionDto, ItemId, NpcProfession } from "@ai-mud/shared";
import { listMarketItemDefinitions } from "./items.js";
import type { MarketItemDefinition } from "./items.js";

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

export interface NpcDefinition {
  key: string;
  name: string;
  profession: NpcProfession;
  homeLocation: GameLocationId;
  homePosition: GridPositionDto | null;
  startingCopper: number;
  wageCopper: number;
  workResourceId: string | null;
  producesItemId: ItemId | null;
  demandItemIds: ItemId[];
  paysWages: boolean;
}

export const FIRST_ITEMS: MarketItemDefinition[] = listMarketItemDefinitions();

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
      { itemId: "rough_hide", quantity: 1, chance: 0.5 },
      { itemId: "wolfbone_shiv", quantity: 1, chance: 0.2 }
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

export const BLACKPINE_DAILY_NPC_WAGE_COPPER = 25;

export const FIRST_NPCS: NpcDefinition[] = [
  {
    key: "blackpine_farmer_mara",
    name: "玛拉",
    profession: "farmer",
    homeLocation: "blackpine_outpost",
    homePosition: null,
    startingCopper: 40,
    wageCopper: 25,
    workResourceId: "forest_berry_patch_01",
    producesItemId: "wild_berry",
    demandItemIds: ["wild_berry", "beast_meat"],
    paysWages: false
  },
  {
    key: "blackpine_miner_torin",
    name: "托林",
    profession: "miner",
    homeLocation: "blackpine_outpost",
    homePosition: null,
    startingCopper: 35,
    wageCopper: 30,
    workResourceId: "abandoned_iron_vein_01",
    producesItemId: "iron_ore",
    demandItemIds: ["wild_berry", "beast_meat"],
    paysWages: false
  },
  {
    key: "blackpine_blacksmith_borin",
    name: "伯林",
    profession: "blacksmith",
    homeLocation: "blackpine_outpost",
    homePosition: null,
    startingCopper: 120,
    wageCopper: 35,
    workResourceId: null,
    producesItemId: null,
    demandItemIds: ["iron_ore"],
    paysWages: false
  },
  {
    key: "blackpine_officer_elian",
    name: "艾廉",
    profession: "municipal_officer",
    homeLocation: "blackpine_outpost",
    homePosition: null,
    startingCopper: 80,
    wageCopper: 40,
    workResourceId: null,
    producesItemId: null,
    demandItemIds: ["wild_berry", "beast_meat"],
    paysWages: true
  }
];

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

export function getMonsterById(monsterId: string) {
  return FIRST_MONSTERS.find((monster) => monster.id === monsterId) ?? null;
}

export function getEncounterById(encounterId: string) {
  return FIRST_ENCOUNTERS.find((encounter) => encounter.id === encounterId) ?? null;
}

export function getNpcByKey(npcKey: string) {
  return FIRST_NPCS.find((npc) => npc.key === npcKey) ?? null;
}
