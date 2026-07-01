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

export const ITEM_IDS = ["wild_berry", "beast_meat", "rough_hide", "iron_ore"] as const;
export type ItemId = (typeof ITEM_IDS)[number];

export const EQUIPMENT_SLOTS = ["weapon", "chest"] as const;
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];

export const DIRECTIONS = ["north", "south", "west", "east"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const ACTION_TYPES = ["gathering", "combat"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const ACTION_STATUSES = ["active", "completed", "cancelled"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export function isDirection(value: unknown): value is Direction {
  return typeof value === "string" && DIRECTIONS.includes(value as Direction);
}

export interface GridPositionDto {
  x: number;
  y: number;
}

export interface MoneyDto {
  gold: number;
  silver: number;
  copper: number;
  totalCopper: number;
}

export type HungerStatus = "fed" | "hungry" | "starving";
export type ActorType = "player" | "npc" | "municipal";
export type NpcProfession = "farmer" | "miner" | "blacksmith" | "municipal_officer";

export interface NeedsDto {
  hunger: {
    current: number;
    max: number;
    status: HungerStatus;
    nextMealAt: string;
  };
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
  injuryUntil: string | null;
  money: MoneyDto;
  needs: NeedsDto;
}

export interface InventoryItemDto {
  itemId: ItemId;
  name: string;
  quantity: number;
}

export interface EquipmentItemDto {
  id: string;
  slot: EquipmentSlot;
  itemKey: string;
  name: string;
  itemLevel: number;
  attackBonus: number;
  defenseBonus: number;
  maxDurability: number;
  currentDurability: number;
  durabilityPct: number;
  effectiveStatRatio: number;
  repairQuote: RepairQuoteDto | null;
}

export interface MapCellDto {
  x: number;
  y: number;
  markers: Array<"player" | "resource" | "encounter" | "exit" | "ordinary">;
}

export interface GameLogEntryDto {
  id: string;
  message: string;
  createdAt: string;
}

export interface NpcActionSummaryDto {
  actionType: "travel" | "gathering" | "market_buy" | "market_sell" | "eat" | "wage";
  description: string;
}

export interface NpcSummaryDto {
  id: string;
  actorType: "npc";
  npcKey: string;
  name: string;
  profession: NpcProfession;
  currentLocation: GameLocationId;
  position: GridPositionDto | null;
  money: MoneyDto;
  hunger: NeedsDto["hunger"];
  currentAction: NpcActionSummaryDto | null;
  inventory: InventoryItemDto[];
  recentEvents: GameLogEntryDto[];
}

export interface NpcSimulationReportDto {
  startedAt: string;
  endedAt: string;
  days: number;
  settlementId: "blackpine_outpost";
  treasury: MoneyDto;
  npcCount: number;
  actionCount: number;
  marketTransactionCount: number;
  resourceSnapshots: Array<{
    resourceId: string;
    name: string;
    remainingCharges: number;
  }>;
  health: {
    ok: boolean;
    issues: string[];
  };
}

export interface WorldRuntimeStatusDto {
  key: "npc_world";
  generatedAt: string;
  lastSettledAt: string | null;
  nextTickAt: string | null;
  leaseOwner: string | null;
  leaseUntil: string | null;
}

export interface CurrentActionDto {
  id: string;
  actionType: ActionType;
  status: ActionStatus;
  description: string;
  startedAt: string;
  endsAt: string;
  progressPct: number;
  cycleProgressPct: number | null;
  completedCycles: number | null;
  settledCycles: number | null;
  plannedCycles: number | null;
  expectedYield: InventoryItemDto[];
  combatLog: string[];
}

export interface MarketItemDto {
  itemId: ItemId;
  name: string;
  category: "food" | "material" | "ore";
  itemLevel: number;
  stockQuantity: number;
  playerQuantity: number;
  buyPrice: MoneyDto;
  sellPrice: MoneyDto;
  buyTax: MoneyDto;
  sellTax: MoneyDto;
}

export interface MarketDto {
  settlementId: "blackpine_outpost";
  settlementName: string;
  items: MarketItemDto[];
}

export interface EconomyTaxSummaryDto {
  transactionCount: number;
  grossCopper: number;
  taxCopper: number;
  buyTaxCopper: number;
  sellTaxCopper: number;
  netCopper: number;
}

export interface EconomyMarketItemDto {
  itemId: ItemId;
  name: string;
  category: "food" | "material" | "ore";
  itemLevel: number;
  stockQuantity: number;
  targetQuantity: number;
  baseBuyPrice: MoneyDto;
  baseSellPrice: MoneyDto;
}

export interface EconomyLedgerEntryDto {
  id: string;
  settlementId: "blackpine_outpost";
  actorId: string;
  actorType: ActorType;
  actorName: string;
  characterId: string | null;
  transactionType: "buy" | "sell";
  itemId: ItemId;
  itemName: string;
  quantity: number;
  unitPrice: MoneyDto;
  gross: MoneyDto;
  tax: MoneyDto;
  net: MoneyDto;
  createdAt: string;
}

export interface EconomySnapshotDto {
  settlementId: "blackpine_outpost";
  settlementName: string;
  generatedAt: string;
  taxSummary: EconomyTaxSummaryDto;
  marketItems: EconomyMarketItemDto[];
  recentTransactions: EconomyLedgerEntryDto[];
}

export interface MarketTradeRequestDto {
  itemId: ItemId;
  quantity: number;
}

export interface RepairQuoteDto {
  copperCost: MoneyDto;
  ironOreCost: number;
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
  equipment: EquipmentItemDto[];
  market: MarketDto | null;
  currentAction: CurrentActionDto | null;
  availableActions: Array<
    | "create_character"
    | "enter_corrupt_forest"
    | "move"
    | "gather"
    | "start_gathering"
    | "start_combat"
    | "cancel_action"
    | "return_to_village"
    | "open_market"
    | "repair_equipment"
    | "eat_food"
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

export interface StartGatheringRequestDto {
  plannedMinutes: 10 | 30 | 120;
}

export interface RepairEquipmentRequestDto {
  equipmentId: string;
}

export interface EatFoodRequestDto {
  itemId: ItemId;
}
