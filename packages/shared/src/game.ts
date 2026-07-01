export const CHARACTER_CLASS_IDS = ["warrior", "ranger", "warlock"] as const;
export type CharacterClassId = (typeof CHARACTER_CLASS_IDS)[number];

export const CHARACTER_CLASSES: Array<{
  id: CharacterClassId;
  name: string;
  description: string;
  baseStats: { strength: number; agility: number; intellect: number; vitality: number };
}> = [
  {
    id: "warrior",
    name: "战士",
    description: "生命和护甲更高，适合稳定推进。",
    baseStats: { strength: 12, agility: 8, intellect: 6, vitality: 14 }
  },
  {
    id: "ranger",
    name: "游侠",
    description: "敏捷更高，移动和采集更轻快。",
    baseStats: { strength: 9, agility: 14, intellect: 7, vitality: 10 }
  },
  {
    id: "warlock",
    name: "术士",
    description: "智力更高，后续接入法术和诅咒玩法。",
    baseStats: { strength: 6, agility: 8, intellect: 15, vitality: 9 }
  }
];

export const GAME_LOCATIONS = {
  blackpineOutpost: "blackpine_outpost",
  corruptForest: "corrupt_forest"
} as const;

export type GameLocationId = (typeof GAME_LOCATIONS)[keyof typeof GAME_LOCATIONS];

export const ITEM_IDS = ["wild_berry", "beast_meat", "rough_hide"] as const;
export type ItemId = (typeof ITEM_IDS)[number];

export const DIRECTIONS = ["north", "south", "west", "east"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export function isDirection(value: unknown): value is Direction {
  return typeof value === "string" && DIRECTIONS.includes(value as Direction);
}

export interface GridPositionDto {
  x: number;
  y: number;
}

export interface CharacterDto {
  id: string;
  name: string;
  classId: CharacterClassId;
  level: number;
  xp: number;
  hp: number;
  maxHp: number;
  currentLocation: GameLocationId;
  position: GridPositionDto | null;
}

export interface InventoryItemDto {
  itemId: ItemId;
  name: string;
  quantity: number;
}

export interface MapCellDto {
  x: number;
  y: number;
  markers: Array<"player" | "resource" | "exit" | "ordinary">;
}

export interface GameLogEntryDto {
  id: string;
  message: string;
  createdAt: string;
}

export interface GameStateDto {
  character: CharacterDto | null;
  locationTitle: string;
  locationDescription: string;
  map: {
    zoneId: GameLocationId;
    width: number;
    height: number;
    cells: MapCellDto[];
  } | null;
  inventory: InventoryItemDto[];
  availableActions: Array<
    "create_character" | "enter_corrupt_forest" | "move" | "gather" | "return_to_village"
  >;
  log: GameLogEntryDto[];
}

export interface CreateCharacterRequestDto {
  name: string;
  classId: CharacterClassId;
}

export interface MoveRequestDto {
  direction: Direction;
}
