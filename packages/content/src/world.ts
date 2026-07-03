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
  },
  {
    id: "mine_rat",
    name: "矿坑巨鼠",
    hp: 48,
    attack: 10,
    defense: 4,
    agility: 12,
    xp: 14,
    lootTable: [
      { itemId: "beast_meat", quantity: 1, chance: 0.65 },
      { itemId: "rough_hide", quantity: 1, chance: 0.45 },
      { itemId: "rusted_mine_cleaver", quantity: 1, chance: 0.14 }
    ]
  },
  {
    id: "mine_raider_boss",
    name: "矿道掠夺者头目",
    hp: 90,
    attack: 14,
    defense: 7,
    agility: 9,
    xp: 30,
    lootTable: [
      { itemId: "iron_ore", quantity: 2, chance: 1 },
      { itemId: "rusted_mine_cleaver", quantity: 1, chance: 0.35 },
      { itemId: "miner_guard_harness", quantity: 1, chance: 0.25 }
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

export const OLD_MINE: ZoneDefinition = {
  id: "old_mine",
  title: "旧矿坑",
  description: "废弃矿道向山腹深处倾斜，潮湿木梁在黑暗里发出细碎呻吟。",
  width: 5,
  height: 5,
  entry: { x: 2, y: 4 },
  exits: [{ id: "mine_mouth", position: { x: 2, y: 4 }, toLocation: "blackpine_outpost" }],
  resources: [
    {
      id: "old_mine_iron_vein_01",
      name: "旧矿坑铁矿脉",
      position: { x: 1, y: 2 },
      charges: 80,
      cycleSeconds: 75,
      gatherResult: { itemId: "iron_ore", quantity: 1 }
    },
    {
      id: "old_mine_coppery_iron_vein_01",
      name: "含铜铁矿脉",
      position: { x: 3, y: 1 },
      charges: 50,
      cycleSeconds: 90,
      gatherResult: { itemId: "iron_ore", quantity: 2 }
    }
  ],
  encounters: [
    {
      id: "old_mine_rat_pack_01",
      name: "矿坑巨鼠群",
      position: { x: 2, y: 2 },
      monsterIds: ["mine_rat", "mine_rat"]
    },
    {
      id: "old_mine_raider_boss_01",
      name: "矿道掠夺者头目",
      position: { x: 4, y: 0 },
      monsterIds: ["mine_raider_boss"]
    }
  ]
};

export const ASH_WATCH: ZoneDefinition = {
  id: "ash_watch",
  title: "灰烬哨路",
  description: "一条被焦灰覆盖的哨路贴着山脊延伸，远处能看到旧王国的断墙。",
  width: 3,
  height: 3,
  entry: { x: 1, y: 2 },
  exits: [{ id: "watch_return", position: { x: 1, y: 2 }, toLocation: "blackpine_outpost" }],
  resources: [],
  encounters: []
};

export const WORLD_ZONES: ZoneDefinition[] = [CORRUPT_FOREST, OLD_MINE, ASH_WATCH];

export function getZoneById(zoneId: GameLocationId) {
  return WORLD_ZONES.find((zone) => zone.id === zoneId) ?? null;
}

export function listWorldZones() {
  return [...WORLD_ZONES];
}

export function getResourceById(resourceId: string) {
  return WORLD_ZONES.flatMap((zone) => zone.resources).find(
    (resource) => resource.id === resourceId
  ) ?? null;
}

export function getZoneByResourceId(resourceId: string) {
  return (
    WORLD_ZONES.find((zone) => zone.resources.some((resource) => resource.id === resourceId)) ??
    null
  );
}

export function getMonsterById(monsterId: string) {
  return FIRST_MONSTERS.find((monster) => monster.id === monsterId) ?? null;
}

export function getEncounterById(encounterId: string) {
  return WORLD_ZONES.flatMap((zone) => zone.encounters).find(
    (encounter) => encounter.id === encounterId
  ) ?? null;
}

export function getZoneByEncounterId(encounterId: string) {
  return WORLD_ZONES.find((zone) =>
    zone.encounters.some((encounter) => encounter.id === encounterId)
  ) ?? null;
}

export function getNpcByKey(npcKey: string) {
  return FIRST_NPCS.find((npc) => npc.key === npcKey) ?? null;
}
