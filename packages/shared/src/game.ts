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
  corruptForest: "corrupt_forest",
  oldMine: "old_mine",
  ashWatch: "ash_watch"
} as const;

export type GameLocationId = (typeof GAME_LOCATIONS)[keyof typeof GAME_LOCATIONS];

export type ItemId = string;

export const EQUIPMENT_SLOTS = ["weapon", "chest", "head", "accessory"] as const;
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

export type EquipmentRarityDto = "common" | "uncommon" | "rare" | "epic";

export interface EquipmentAffixDto {
  affixId: string;
  name: string;
  stat:
    | "attack"
    | "defense"
    | "agility"
    | "maxHp"
    | "gatherSpeedPct"
    | "repairDiscountPct"
    | "durabilityBonusPct"
    | "injuryRecoveryPct";
  value: number;
}

export interface EquipmentItemDto {
  id: string;
  slot: EquipmentSlot;
  itemKey: string;
  name: string;
  rarity: EquipmentRarityDto;
  itemLevel: number;
  attackBonus: number;
  defenseBonus: number;
  agilityBonus: number;
  maxHpBonus: number;
  affixes: EquipmentAffixDto[];
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

export interface GameSyncEventDto {
  id: number;
  eventType: string;
  stateDirty: boolean;
  payload: Record<string, unknown>;
  source: string;
  createdAt: string;
}

export interface ChatMessageDto {
  id: string;
  characterId: string;
  characterName: string;
  kind?: "player" | "system";
  channel: "lobby";
  body: string;
  createdAt: string;
}

export interface PresenceDto {
  accountId: string;
  characterId: string;
  characterName: string;
  currentLocation: GameLocationId;
  lastSeenAt: string;
}

export interface LeaderboardEntryDto {
  rank: number;
  characterId: string;
  characterName: string;
  level: number;
  xp: number;
  wealthCopper: number;
}

export interface GameSyncResponseDto {
  stateVersion: number;
  state: GameStateDto | null;
  events: GameSyncEventDto[];
  offlineReport?: OfflineReportDto;
  chat?: ChatMessageDto[];
  presence?: PresenceDto[];
  leaderboards?: {
    level?: LeaderboardEntryDto[];
    wealth?: LeaderboardEntryDto[];
  };
  nextCursor: number;
}

export interface OfflineReportDto {
  generatedAt: string;
  since: string;
  until: string;
  status: AiCallStatus;
  provider: string;
  model: string;
  fallbackReason: string | null;
  title: string;
  summary: string;
  highlights: string[];
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
  metrics: {
    minNpcHunger: number;
    hungryNpcCount: number;
    starvingNpcCount: number;
    totalNpcCopper: number;
    marketStockQuantity: number;
    activeActionCount: number;
    completedActionCount: number;
    idleNpcCount: number;
    idleRate: number;
    fedNpcCount: number;
    resourceStartCharges: number;
    resourceEndCharges: number;
    resourceDelta: number;
    marketTransactionsPerDay: number;
    taskTriggerRate: number;
    hungerDistribution: {
      starving: number;
      hungry: number;
      fed: number;
    };
  };
  resourceSnapshots: Array<{
    zoneId: GameLocationId;
    resourceId: string;
    name: string;
    remainingCharges: number;
  }>;
  mapResourceSnapshots: Array<{
    zoneId: GameLocationId;
    resourceCount: number;
    depletedResourceCount: number;
    refreshedAt: string;
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

export type AiCallStatus = "success" | "fallback" | "rejected" | "error" | "disabled";
export type AiCallPurpose =
  | "npc_dialogue"
  | "npc_task_copy"
  | "npc_memory_compression"
  | "world_rumor"
  | "npc_task_proposal"
  | "offline_summary";
export type AiAuthorityClass = "presentation" | "summary" | "classification";
export type NpcDialogueSpeakerType = "player" | "npc" | "system";

export type RumorSourceType =
  | "game_event"
  | "npc_event"
  | "market_event"
  | "world_event"
  | "system";
export type RumorAudience = "public";

export interface WorldRumorDto {
  id: string;
  sourceType: RumorSourceType;
  sourceId: string | null;
  audience: RumorAudience;
  message: string;
  tags: string[];
  generatedBy: "template" | "ai";
  createdAt: string;
  expiresAt: string | null;
}

export interface NpcDialogueTargetDto {
  npcActorId: string;
  npcKey: string;
  name: string;
  profession: NpcProfession;
  currentLocation: GameLocationId;
  statusLine: string;
  hasTask: boolean;
  taskStatus: "open" | "accepted" | null;
  taskTitle: string | null;
}

export interface NpcDialogueMessageDto {
  id: string;
  npcActorId: string;
  speakerType: NpcDialogueSpeakerType;
  message: string;
  createdAt: string;
}

export interface NpcDialogueResponseDto {
  target: NpcDialogueTargetDto;
  messages: NpcDialogueMessageDto[];
  ai: {
    status: AiCallStatus;
    provider: string;
    model: string;
    fallbackReason: string | null;
  };
}

export interface AiCallLogDto {
  id: string;
  purpose: AiCallPurpose;
  status: AiCallStatus;
  provider: string;
  model: string;
  promptVersion: number;
  accountId: string | null;
  characterId: string | null;
  npcActorId: string | null;
  inputSummary: string;
  outputSummary: string;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  errorCode: string | null;
  createdAt: string;
}

export interface AiPurposeStatusDto {
  purpose: AiCallPurpose;
  authorityClass: AiAuthorityClass;
  enabled: boolean;
  mutatesWorldState: false;
  maxOutputTokens: number;
  cooldownMs: number;
  fallbackRequired: true;
  promptVersion: number;
  callCount24h: number;
  successCount24h: number;
  fallbackCount24h: number;
  rejectedCount24h: number;
  errorCount24h: number;
  disabledCount24h: number;
  totalInputTokens24h: number;
  totalOutputTokens24h: number;
  averageLatencyMs24h: number | null;
  latestStatus: AiCallStatus | null;
  latestAt: string | null;
}

export interface AiLayerStatusDto {
  providerEnabled: boolean;
  providerName: string;
  model: string | null;
  promptVersion: number;
  budget: {
    dailyTokenBudget: number | null;
    usedTokens24h: number;
    remainingTokens24h: number | null;
    fallbackCount24h: number;
    latestFailureReason: string | null;
    exhausted: boolean;
  };
  purposes: AiPurposeStatusDto[];
}

export type NpcMemorySourceType = "dialogue" | "system";
export type NpcMemoryEvidenceLevel = "dialogue_claim" | "system_verified";
export type NpcMemoryKind =
  | "conversation"
  | "favor"
  | "conflict"
  | "trade"
  | "task"
  | "world_event";

export interface NpcMemoryEntryDto {
  id: string;
  npcActorId: string;
  characterId: string | null;
  sourceType: NpcMemorySourceType;
  memoryKind: NpcMemoryKind;
  evidenceLevel: NpcMemoryEvidenceLevel;
  sourceIds: string[];
  importance: number;
  summary: string;
  occurredAt: string;
  compressedAt: string | null;
}

export interface NpcMemoryFragmentDto {
  id: string;
  npcActorId: string;
  characterId: string | null;
  memoryKind: NpcMemoryKind;
  evidenceLevel: NpcMemoryEvidenceLevel;
  importance: number;
  summary: string;
  firstOccurredAt: string;
  lastOccurredAt: string;
  sourceEntryIds: string[];
  compressionLevel: number;
}

export type NpcTaskNeedType = "food_shortage" | "ore_shortage";
export type NpcTaskStatus = "open" | "accepted" | "completed" | "expired" | "cancelled";
export type NpcTaskProposalSource = "template" | "ai";

export interface NpcTaskDto {
  id: string;
  npcActorId: string;
  npcName: string;
  needType: NpcTaskNeedType;
  status: NpcTaskStatus;
  title: string;
  description: string;
  proposalSource: NpcTaskProposalSource;
  proposalReason: string | null;
  requestedItem: InventoryItemDto;
  rewardCopper: MoneyDto;
  acceptedByCharacterId: string | null;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
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
  category: string;
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
  category: string;
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
  backpackEquipment: EquipmentItemDto[];
  market: MarketDto | null;
  npcTasks: NpcTaskDto[];
  currentAction: CurrentActionDto | null;
  rumors: WorldRumorDto[];
  availableActions: Array<
    | "create_character"
    | "enter_corrupt_forest"
    | "enter_old_mine"
    | "move"
    | "gather"
    | "start_gathering"
    | "start_combat"
    | "cancel_action"
    | "return_to_village"
    | "open_market"
    | "repair_equipment"
    | "eat_food"
    | "view_npc_tasks"
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

export interface EquipEquipmentRequestDto {
  instanceId: string;
}

export interface EatFoodRequestDto {
  itemId: ItemId;
}

export interface NpcTaskCompleteRequestDto {
  taskId: string;
}
