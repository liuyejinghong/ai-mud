import {
  AFFIX_POOLS,
  BLACKPINE_OUTPOST,
  FIRST_ITEMS,
  getEncounterById,
  getFoodItemById,
  getItemById,
  getMarketItemById,
  getMonsterById,
  getZoneByEncounterId,
  getZoneById,
  getZoneByResourceId,
  isFoodDefinition
} from "@ai-mud/content";
import type { ZoneDefinition } from "@ai-mud/content";
import {
  applyCombatDurabilityLoss,
  buildMapCells,
  calculateDurabilityPct,
  calculateEffectiveStatRatio,
  calculateEquipmentRepairQuote,
  calculateHungerCombatMultiplier,
  calculateHungerStatus,
  calculateMarketQuote,
  calculateMunicipalReliefEligibility,
  calculateNextMealAt,
  calculateRepairQuote,
  calculateGatheringPlan,
  calculateGatheringSettlement,
  formatMoney,
  movePosition,
  rollRarity,
  settleLevelProgression,
  settleHunger,
  simulateCombat
} from "@ai-mud/game-rules";
import {
  CHARACTER_CLASSES,
  type CharacterClassId,
  type CharacterDto,
  type CreateCharacterRequestDto,
  type CurrentActionDto,
  type Direction,
  type EatFoodRequestDto,
  type EquipEquipmentRequestDto,
  type EquipmentItemDto,
  type EquipmentSlot,
  type RepairEquipmentRequestDto,
  type GameStateDto,
  type GameSyncResponseDto,
  type GameLocationId,
  type GridPositionDto,
  type InventoryItemDto,
  type MarketDto,
  type MarketTradeRequestDto,
  type NeedsDto,
  type RepairQuoteDto,
  type StartGatheringRequestDto
} from "@ai-mud/shared";
import type { Db } from "../../db/client.js";
import { ItemRepository, type ItemInstanceRecord } from "../item/item.repository.js";
import { ItemService } from "../item/item.service.js";
import { LedgerRepository } from "../ledger/ledger.repository.js";
import { LedgerService } from "../ledger/ledger.service.js";
import { LobbyRepository } from "../lobby/lobby.repository.js";
import { LobbyService } from "../lobby/lobby.service.js";
import {
  GameRepository,
  type CharacterActionRecord,
  type CharacterRecord,
  type CombatActionPayload,
  type CombatTimelineEntry,
  type EquipmentRecord,
  type GatheringActionPayload
} from "./game.repository.js";

const BLACKPINE_MARKET_ID = "blackpine_outpost";
const ENCOUNTER_VICTORY_COOLDOWN_MS = 10 * 60_000;
const MUNICIPAL_RELIEF_COOLDOWN_MS = 24 * 60 * 60_000;
const MUNICIPAL_RELIEF_MARKET_RESERVE = 1;
const MUNICIPAL_RELIEF_EMERGENCY_ITEM_ID = "wild_berry" as const;
const STARTER_EQUIPMENT: Array<{
  slot: "weapon" | "chest";
  itemKey: string;
  name: string;
  itemLevel: number;
  attackBonus: number;
  defenseBonus: number;
  maxDurability: number;
  currentDurability: number;
}> = [
  {
    slot: "weapon",
    itemKey: "training_sword",
    name: "训练短剑",
    itemLevel: 5,
    attackBonus: 2,
    defenseBonus: 0,
    maxDurability: 100,
    currentDurability: 100
  },
  {
    slot: "chest",
    itemKey: "patched_leather_vest",
    name: "缝补皮甲",
    itemLevel: 5,
    attackBonus: 0,
    defenseBonus: 2,
    maxDurability: 100,
    currentDurability: 100
  }
];

export class GameServiceError extends Error {
  constructor(
    readonly code: "VALIDATION_ERROR",
    message: string
  ) {
    super(message);
  }
}

const ACTIVE_ACTION_UNIQUE_CONSTRAINT = "character_actions_one_active_per_character_idx";

function isActiveActionUniqueConflict(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const postgresError = error as { code?: unknown; constraint?: unknown };
  return (
    postgresError.code === "23505" && postgresError.constraint === ACTIVE_ACTION_UNIQUE_CONSTRAINT
  );
}

async function translateActiveActionConflict<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isActiveActionUniqueConflict(error)) {
      throw new GameServiceError("VALIDATION_ERROR", "已有进行中的行动。");
    }
    throw error;
  }
}

interface GatheringSettlementResult {
  changed: boolean;
  settledCycles: number;
  quantityGranted: number;
  completed: boolean;
}

interface ReadableSettlementResult {
  stateChanged: boolean;
  actionActive: boolean;
}

interface CharacterSettlementResult {
  character: CharacterRecord;
  stateChanged: boolean;
}

function classMaxHp(classId: CharacterClassId) {
  const characterClass = CHARACTER_CLASSES.find((entry) => entry.id === classId);
  if (!characterClass) throw new GameServiceError("VALIDATION_ERROR", "Unknown class");
  return characterClass.baseStats.vitality * 10;
}

function classAttack(classId: CharacterClassId) {
  const characterClass = CHARACTER_CLASSES.find((entry) => entry.id === classId);
  if (!characterClass) throw new GameServiceError("VALIDATION_ERROR", "Unknown class");
  return characterClass.baseStats.strength + Math.floor(characterClass.baseStats.agility / 2);
}

function classDefense(classId: CharacterClassId) {
  const characterClass = CHARACTER_CLASSES.find((entry) => entry.id === classId);
  if (!characterClass) throw new GameServiceError("VALIDATION_ERROR", "Unknown class");
  return Math.floor(characterClass.baseStats.vitality / 2) + 2;
}

function classAgility(classId: CharacterClassId) {
  const characterClass = CHARACTER_CLASSES.find((entry) => entry.id === classId);
  if (!characterClass) throw new GameServiceError("VALIDATION_ERROR", "Unknown class");
  return characterClass.baseStats.agility;
}

function initialResourceCharges(zone: ZoneDefinition) {
  return Object.fromEntries(zone.resources.map((resource) => [resource.id, resource.charges]));
}

function findLiveResourceAt(
  zone: ZoneDefinition,
  position: GridPositionDto,
  resourceCharges: Record<string, number>
) {
  return (
    zone.resources.find(
      (resource) =>
        resource.position.x === position.x &&
        resource.position.y === position.y &&
        (resourceCharges[resource.id] ?? resource.charges) > 0
    ) ?? null
  );
}

function findEncounterAt(zone: ZoneDefinition, position: GridPositionDto) {
  return (
    zone.encounters.find(
      (encounter) => encounter.position.x === position.x && encounter.position.y === position.y
    ) ?? null
  );
}

function encounterCooldownEndsAt(
  map: { encounterCooldowns: Record<string, string> },
  encounterId: string
) {
  const value = map.encounterCooldowns[encounterId];
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

function isEncounterReady(
  map: { encounterCooldowns: Record<string, string> },
  encounterId: string,
  now: Date
) {
  const endsAt = encounterCooldownEndsAt(map, encounterId);
  return !endsAt || endsAt.getTime() <= now.getTime();
}

function withReadyEncounters(
  zone: ZoneDefinition,
  map: { encounterCooldowns: Record<string, string> },
  now: Date
): ZoneDefinition {
  return {
    ...zone,
    encounters: zone.encounters.filter((encounter) => isEncounterReady(map, encounter.id, now))
  };
}

function directionLabel(direction: Direction) {
  return {
    north: "北",
    south: "南",
    west: "西",
    east: "东"
  }[direction];
}

function progressPct(startedAt: Date, endsAt: Date, now: Date) {
  const totalMs = Math.max(1, endsAt.getTime() - startedAt.getTime());
  const elapsedMs = Math.max(0, now.getTime() - startedAt.getTime());
  return Math.min(100, Math.round((elapsedMs / totalMs) * 100));
}

function playedCombatTimeline(
  payload: CombatActionPayload,
  startedAt: Date,
  now: Date
): CombatTimelineEntry[] {
  const elapsedMs = Math.max(0, now.getTime() - startedAt.getTime());
  return payload.combatTimeline.filter((entry) => entry.atMs <= elapsedMs);
}

function visibleCombatLog(payload: CombatActionPayload, startedAt: Date, now: Date) {
  return playedCombatTimeline(payload, startedAt, now).map((entry) => entry.message);
}

function playerDamageFromCombatLog(messages: string[], characterName: string) {
  return messages
    .filter((message) => !message.startsWith(`${characterName} 攻击`))
    .reduce((sum, message) => {
      const damage = message.match(/造成\s+(\d+)\s+点伤害/)?.[1];
      return sum + (damage ? Number.parseInt(damage, 10) : 0);
    }, 0);
}

function toNeedsDto(character: CharacterRecord, now: Date): NeedsDto {
  return {
    hunger: {
      current: character.hunger,
      max: 5,
      status: calculateHungerStatus(character.hunger),
      nextMealAt: calculateNextMealAt(now).toISOString()
    }
  };
}

function toCharacterDto(character: CharacterRecord, now: Date): CharacterDto {
  return {
    id: character.id,
    name: character.name,
    classId: character.classId,
    level: character.level,
    xp: character.xp,
    hp: character.hp,
    maxHp: character.maxHp,
    currentLocation: character.currentLocation,
    position: character.position,
    injuryUntil: character.injuryUntil?.toISOString() ?? null,
    money: formatMoney(character.copperBalance),
    needs: toNeedsDto(character, now)
  };
}

function toInventoryDto(items: Array<{ itemId: InventoryItemDto["itemId"]; quantity: number }>) {
  return items.map((item) => ({
    itemId: item.itemId,
    name: getItemById(item.itemId)?.name ?? item.itemId,
    quantity: item.quantity
  }));
}

const EQUIPMENT_AFFIX_STATS = new Set([
  "attack",
  "defense",
  "agility",
  "maxHp",
  "gatherSpeedPct",
  "repairDiscountPct",
  "durabilityBonusPct",
  "injuryRecoveryPct"
]);

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readBaseStats(value: unknown) {
  const stats = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    attack: readNumber(stats.attack),
    defense: readNumber(stats.defense),
    agility: readNumber(stats.agility),
    maxHp: readNumber(stats.maxHp)
  };
}

function affixName(affixId: string) {
  return AFFIX_POOLS.find((affix) => affix.id === affixId)?.name ?? affixId;
}

function readAffixes(value: unknown): EquipmentItemDto["affixes"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    if (
      typeof record.affixId !== "string" ||
      typeof record.stat !== "string" ||
      !EQUIPMENT_AFFIX_STATS.has(record.stat) ||
      typeof record.value !== "number"
    ) {
      return [];
    }
    return [
      {
        affixId: record.affixId,
        name: affixName(record.affixId),
        stat: record.stat as EquipmentItemDto["affixes"][number]["stat"],
        value: record.value
      }
    ];
  });
}

function equipmentRecordFromInstance(
  characterId: string,
  instance: ItemInstanceRecord
): EquipmentRecord {
  const definition = getItemById(instance.itemDefId);
  const stats = readBaseStats(instance.baseStats);
  const affixes = readAffixes(instance.affixes);
  const affixStats = affixes.reduce(
    (sum, affix) => {
      if (affix.stat === "attack") sum.attack += affix.value;
      if (affix.stat === "defense") sum.defense += affix.value;
      if (affix.stat === "agility") sum.agility += affix.value;
      if (affix.stat === "maxHp") sum.maxHp += affix.value;
      return sum;
    },
    { attack: 0, defense: 0, agility: 0, maxHp: 0 }
  );

  return {
    id: instance.id,
    characterId,
    slot: (instance.slot ?? "weapon") as EquipmentSlot,
    itemKey: instance.itemDefId,
    name: definition?.name ?? instance.itemDefId,
    rarity: instance.rarity,
    itemLevel: instance.itemLevel,
    attackBonus: stats.attack + affixStats.attack,
    defenseBonus: stats.defense + affixStats.defense,
    agilityBonus: stats.agility + affixStats.agility,
    maxHpBonus: stats.maxHp + affixStats.maxHp,
    affixes,
    maxDurability: instance.maxDurability,
    currentDurability: instance.currentDurability
  };
}

function toEquipmentDto(equipment: EquipmentRecord): EquipmentItemDto {
  const quote = calculateEquipmentRepairQuote(equipment);
  return {
    id: equipment.id,
    slot: equipment.slot,
    itemKey: equipment.itemKey,
    name: equipment.name,
    rarity: equipment.rarity ?? "common",
    itemLevel: equipment.itemLevel,
    attackBonus: equipment.attackBonus,
    defenseBonus: equipment.defenseBonus,
    agilityBonus: equipment.agilityBonus ?? 0,
    maxHpBonus: equipment.maxHpBonus ?? 0,
    affixes: equipment.affixes ?? [],
    maxDurability: equipment.maxDurability,
    currentDurability: equipment.currentDurability,
    durabilityPct: calculateDurabilityPct(equipment),
    effectiveStatRatio: calculateEffectiveStatRatio(equipment),
    repairQuote: quote
      ? { copperCost: formatMoney(quote.copperCost), ironOreCost: quote.ironOreCost }
      : null
  };
}

function equipmentAttackBonus(equipment: EquipmentRecord[]) {
  return equipment.reduce(
    (sum, item) => sum + Math.floor(item.attackBonus * calculateEffectiveStatRatio(item)),
    0
  );
}

function equipmentDefenseBonus(equipment: EquipmentRecord[]) {
  return equipment.reduce(
    (sum, item) => sum + Math.floor(item.defenseBonus * calculateEffectiveStatRatio(item)),
    0
  );
}

export class GameService {
  constructor(private readonly db: Db) {}

  async getState(
    accountId: string,
    options: { settle?: boolean } = { settle: true }
  ): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const now = new Date();
      if (options.settle !== false) {
        await this.settleReadableState(repo, accountId, now);
      }
      return this.buildState(repo, accountId, now);
    });
  }

  async getSync(accountId: string, cursor = 0): Promise<GameSyncResponseDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const lobby = new LobbyService(new LobbyRepository(tx));
      const now = new Date();
      const settlement = await this.settleReadableState(repo, accountId, now);
      const character = await repo.findCharacterByAccountId(accountId);
      const events = await repo.listSyncEvents({
        accountId,
        characterId: character?.id ?? null,
        cursor,
        limit: 100
      });
      const nextCursor = events.at(-1)?.id ?? cursor;
      const includeState =
        cursor <= 0 ||
        settlement.stateChanged ||
        settlement.actionActive ||
        events.some((event) => event.stateDirty);
      const lobbyPayload = await lobby.buildSyncPayload({
        events: events.map((event) => ({
          eventType: event.eventType,
          payload: event.payload
        })),
        now
      });

      return {
        stateVersion: nextCursor,
        state: includeState ? await this.buildState(repo, accountId, now) : null,
        events: events.map((event) => ({
          id: event.id,
          eventType: event.eventType,
          stateDirty: event.stateDirty,
          payload: event.payload,
          source: event.source,
          createdAt: event.createdAt.toISOString()
        })),
        ...lobbyPayload,
        nextCursor
      };
    });
  }

  private async settleReadableState(
    repo: GameRepository,
    accountId: string,
    now: Date
  ): Promise<ReadableSettlementResult> {
    const lockedCharacter = await repo.findCharacterByAccountIdForUpdate(accountId);
    if (!lockedCharacter) return { stateChanged: false, actionActive: false };

    const actionChanged = await this.settleDueAction(repo, lockedCharacter, now);
    const characterAfterAction = await repo.findCharacterByAccountId(accountId);
    const injuryChanged = characterAfterAction
      ? await this.healExpiredInjury(repo, characterAfterAction, now)
      : false;

    const gatheringSettlement = await this.settleGatheringAction(repo, lockedCharacter.id, now, {
      completeAction: false
    });

    const latestCharacter = await repo.findCharacterByAccountId(accountId);
    const hungerSettlement = latestCharacter
      ? await this.settleHungerForCharacter(repo, latestCharacter, now)
      : null;
    const activeAction = await repo.findActiveActionByCharacterId(lockedCharacter.id);

    return {
      stateChanged:
        actionChanged ||
        injuryChanged ||
        gatheringSettlement.changed ||
        (hungerSettlement?.stateChanged ?? false),
      actionActive: activeAction !== null
    };
  }

  async createCharacter(
    accountId: string,
    input: CreateCharacterRequestDto
  ): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const existing = await repo.findCharacterByAccountId(accountId);
      if (existing) {
        throw new GameServiceError("VALIDATION_ERROR", "Character already exists");
      }

      const maxHp = classMaxHp(input.classId);
      const character = await repo.createCharacter({
        accountId,
        name: input.name.trim(),
        classId: input.classId,
        hp: maxHp,
        maxHp
      });
      for (const item of STARTER_EQUIPMENT) {
        await repo.createEquipment({ characterId: character.id, ...item });
      }
      await repo.writeEvent({
        characterId: character.id,
        eventType: "character.create",
        message: `${character.name} 抵达黑松哨站。`
      });

      return this.buildState(repo, accountId, new Date());
    });
  }

  async enterZone(accountId: string, zoneId: GameLocationId): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const now = new Date();
      const character = await this.requireSettledCharacter(repo, accountId, now);
      const zone = getZoneById(zoneId);
      if (!zone) {
        throw new GameServiceError("VALIDATION_ERROR", "未知区域。");
      }
      await this.requireNoActiveAction(repo, character.id);
      this.requireCanLeaveVillage(character, now);
      const existingMap = await repo.findMapInstance(character.id, zone.id);

      if (!existingMap) {
        await repo.createMapInstance({
          characterId: character.id,
          zoneId: zone.id,
          resourceCharges: initialResourceCharges(zone)
        });
      }

      await repo.updateCharacterLocation({
        characterId: character.id,
        currentLocation: zone.id,
        position: zone.entry
      });
      await repo.writeEvent({
        characterId: character.id,
        eventType: "zone.enter",
        message: `你离开黑松哨站，进入${zone.title}。`,
        metadata: { zoneId: zone.id }
      });

      return this.buildState(repo, accountId, now);
    });
  }

  async enterCorruptForest(accountId: string): Promise<GameStateDto> {
    return this.enterZone(accountId, "corrupt_forest");
  }

  async move(accountId: string, direction: Direction): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const { character, zone } = await this.requireReadyExploringCharacter(
        repo,
        accountId,
        new Date()
      );
      await this.requireNoActiveAction(repo, character.id);
      const result = movePosition(zone, character.position, direction);

      if (!result.ok) {
        throw new GameServiceError("VALIDATION_ERROR", "前方道路无法通行。");
      }

      await repo.updateCharacterLocation({
        characterId: character.id,
        currentLocation: zone.id,
        position: result.position
      });
      await repo.writeEvent({
        characterId: character.id,
        eventType: "character.move",
        message: `你向${directionLabel(direction)}移动，继续探索${zone.title}。`,
        metadata: { direction, position: result.position, zoneId: zone.id }
      });

      return this.buildState(repo, accountId, new Date());
    });
  }

  async startGathering(
    accountId: string,
    input: StartGatheringRequestDto
  ): Promise<GameStateDto> {
    return translateActiveActionConflict(() =>
      this.db.transaction(async (tx) => {
        const repo = new GameRepository(tx);
        const now = new Date();
        const { character, zone } = await this.requireReadyExploringCharacter(
          repo,
          accountId,
          now,
          { forUpdate: true }
        );
        await this.requireNoActiveAction(repo, character.id);
        const map = await this.requireZoneMap(repo, character, zone);
        const resource = findLiveResourceAt(zone, character.position, map.resourceCharges);

        if (!resource) {
          throw new GameServiceError("VALIDATION_ERROR", "这里没有可采集的资源。");
        }

        const plan = calculateGatheringPlan({
          baseCycleSeconds: resource.cycleSeconds,
          classId: character.classId,
          agility: classAgility(character.classId),
          plannedMinutes: input.plannedMinutes,
          remainingCharges: map.resourceCharges[resource.id] ?? resource.charges
        });
        const item = getItemById(resource.gatherResult.itemId);

        await repo.createAction({
          characterId: character.id,
          actionType: "gathering",
          startedAt: now,
          endsAt: new Date(now.getTime() + plan.cycleMs * plan.plannedCycles),
          payload: {
            resourceId: resource.id,
            itemId: resource.gatherResult.itemId,
            itemName: item?.name ?? resource.gatherResult.itemId,
            quantityPerCycle: resource.gatherResult.quantity,
            cycleMs: plan.cycleMs,
            plannedCycles: plan.plannedCycles,
            settledCycles: 0
          }
        });
        await repo.writeEvent({
          characterId: character.id,
          eventType: "action.gathering.start",
          message: `你开始采集${resource.name}。`
        });

        return this.buildState(repo, accountId, now);
      })
    );
  }

  async startCombat(accountId: string): Promise<GameStateDto> {
    return translateActiveActionConflict(() =>
      this.db.transaction(async (tx) => {
        const repo = new GameRepository(tx);
        const now = new Date();
        const { character, zone } = await this.requireReadyExploringCharacter(
          repo,
          accountId,
          now,
          { forUpdate: true }
        );
        await this.requireNoActiveAction(repo, character.id);
        const map = await this.requireZoneMap(repo, character, zone);
        const encounter = findEncounterAt(zone, character.position);

        if (!encounter) {
          throw new GameServiceError("VALIDATION_ERROR", "这里没有可攻击的敌人。");
        }
        if (!isEncounterReady(map, encounter.id, now)) {
          const cooldownEndsAt = encounterCooldownEndsAt(map, encounter.id);
          throw new GameServiceError(
            "VALIDATION_ERROR",
            cooldownEndsAt
              ? `这处遭遇正在冷却，${cooldownEndsAt.toLocaleTimeString("zh-CN", { hour12: false })} 后再来。`
              : "这处遭遇正在冷却。"
          );
        }

        const monsters = encounter.monsterIds.map((monsterId) => getMonsterById(monsterId));
        if (monsters.some((monster) => !monster)) {
          throw new GameServiceError("VALIDATION_ERROR", "遭遇配置无效。");
        }

        const combatSeed = `${character.id}:${encounter.id}:${now.toISOString()}`;
        const result = simulateCombat({
          seed: combatSeed,
          player: {
            name: character.name,
            hp: character.hp,
            maxHp: character.maxHp,
            attack: Math.floor(
              (classAttack(character.classId) +
                equipmentAttackBonus(await this.listEquippedEquipment(repo, character.id))) *
                calculateHungerCombatMultiplier(character.hunger)
            ),
            defense: Math.floor(
              (classDefense(character.classId) +
                equipmentDefenseBonus(await this.listEquippedEquipment(repo, character.id))) *
                calculateHungerCombatMultiplier(character.hunger)
            ),
            agility: classAgility(character.classId)
          },
          monsters: monsters.map((monster) => monster!)
        });

        if (result.outcome === "stalemate") {
          throw new GameServiceError("VALIDATION_ERROR", "这场战斗短时间内无法结束。");
        }

        await repo.createAction({
          characterId: character.id,
          actionType: "combat",
          startedAt: now,
          endsAt: new Date(now.getTime() + result.durationMs),
          payload: {
            encounterId: encounter.id,
            combatLog: result.timeline.map((entry) => entry.message),
            combatTimeline: result.timeline,
            lootSeed: combatSeed,
            expectedEndsAtMs: now.getTime() + result.durationMs,
            outcome: result.outcome,
            playerRemainingHp: result.playerRemainingHp,
            xp: result.xp,
            loot: result.loot
          }
        });
        await repo.writeEvent({
          characterId: character.id,
          eventType: "action.combat.start",
          message: `你开始与${encounter.name}战斗。`
        });

        return this.buildState(repo, accountId, now);
      })
    );
  }

  async cancelAction(accountId: string): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const now = new Date();
      const character = await this.requireSettledCharacter(repo, accountId, now);
      const gatheringSettlement = await this.settleGatheringAction(repo, character.id, now, {
        completeAction: false,
        cancelAction: true
      });
      const action = await repo.findActiveActionByCharacterId(character.id);

      if (gatheringSettlement.changed && !action) {
        await repo.writeEvent({
          characterId: character.id,
          eventType: "action.gathering.cancel",
          message: "你停止采集，带走了已经完成周期的收获。"
        });
        return this.buildState(repo, accountId, now);
      }

      if (!action || action.actionType === "gathering") {
        return this.buildState(repo, accountId, now);
      }

      const marked = await repo.markActionCancelled(action.id, now);
      if (!marked) return this.buildState(repo, accountId, now);

      await this.settleCombatEscapeCost(repo, character, action, now);
      await repo.writeEvent({
        characterId: character.id,
        eventType: "action.combat.escape",
        message: "你撤离了战斗，敌人没有离开原地追击。"
      });

      return this.buildState(repo, accountId, now);
    });
  }

  async returnToVillage(accountId: string): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const character = await this.requireSettledCharacter(repo, accountId, new Date());
      await this.requireNoActiveAction(repo, character.id);

      await repo.updateCharacterLocation({
        characterId: character.id,
        currentLocation: BLACKPINE_OUTPOST.id,
        position: null
      });
      await repo.writeEvent({
        characterId: character.id,
        eventType: "zone.return",
        message: "你返回黑松哨站。"
      });

      return this.buildState(repo, accountId, new Date());
    });
  }

  async gather(accountId: string): Promise<GameStateDto> {
    return this.startGathering(accountId, { plannedMinutes: 10 });
  }

  async getMarket(accountId: string): Promise<MarketDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const character = await this.requireSettledCharacter(repo, accountId, new Date());
      return this.buildMarketDto(repo, character);
    });
  }

  async claimMunicipalRelief(accountId: string): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const now = new Date();

      await this.ensureMarketInventory(repo);
      const marketInventory = await repo.listMarketInventory(BLACKPINE_MARKET_ID);
      const lockedMarketFood = [];
      const foodItemIds = marketInventory
        .filter((entry) => getFoodItemById(entry.itemId) !== null)
        .map((entry) => entry.itemId)
        .sort((left, right) => left.localeCompare(right));
      for (const itemId of foodItemIds) {
        const marketItem = await repo.findMarketInventoryItemForUpdate(
          BLACKPINE_MARKET_ID,
          itemId
        );
        if (marketItem) lockedMarketFood.push(marketItem);
      }

      const character = await this.requireSettledCharacterForUpdate(repo, accountId, now);
      const inventory = await repo.listInventory(character.id);
      const foodQuantity = inventory.reduce(
        (total, entry) => total + (getFoodItemById(entry.itemId) ? entry.quantity : 0),
        0
      );
      const quotedMarketFood = lockedMarketFood
        .flatMap((marketItem) => {
          const item = getFoodItemById(marketItem.itemId);
          if (!item) return [];
          const quote = calculateMarketQuote({
            direction: "buy",
            basePriceCopper: marketItem.baseSellPriceCopper,
            stockQuantity: marketItem.quantity,
            targetQuantity: marketItem.targetQuantity,
            quantity: 1
          });
          return [{ item, marketItem, priceCopper: quote.totalCopper }];
        })
        .sort(
          (left, right) =>
            left.item.itemLevel - right.item.itemLevel ||
            left.priceCopper - right.priceCopper ||
            left.item.id.localeCompare(right.item.id)
        );
      const cheapestFoodPriceCopper = quotedMarketFood
        .filter((entry) => entry.marketItem.quantity > 0)
        .reduce<number | null>(
          (cheapest, entry) =>
            cheapest === null ? entry.priceCopper : Math.min(cheapest, entry.priceCopper),
          null
        );
      const eligibility = calculateMunicipalReliefEligibility({
        inVillage:
          character.currentLocation === BLACKPINE_OUTPOST.id && character.position === null,
        hunger: character.hunger,
        foodQuantity,
        copperBalance: character.copperBalance,
        cheapestFoodPriceCopper,
        lastClaimedAt: character.lastReliefClaimedAt,
        now
      });
      if (!eligibility.eligible) {
        throw new GameServiceError("VALIDATION_ERROR", "当前不符合市政救济领取条件。");
      }

      const cooldownClaimed = await repo.claimMunicipalReliefCooldown({
        characterId: character.id,
        claimedAt: now,
        cooldownCutoff: new Date(now.getTime() - MUNICIPAL_RELIEF_COOLDOWN_MS)
      });
      if (!cooldownClaimed) {
        throw new GameServiceError("VALIDATION_ERROR", "市政救济领取冷却尚未结束。");
      }

      let grantedItemId: MarketTradeRequestDto["itemId"] = MUNICIPAL_RELIEF_EMERGENCY_ITEM_ID;
      let source: "market" | "system" = "system";
      let marketInventoryId: string | null = null;
      for (const candidate of quotedMarketFood) {
        const debited = await repo.decrementMarketInventoryAboveReserve({
          marketInventoryId: candidate.marketItem.id,
          quantity: 1,
          reserveQuantity: MUNICIPAL_RELIEF_MARKET_RESERVE
        });
        if (!debited) continue;
        grantedItemId = candidate.item.id;
        source = "market";
        marketInventoryId = candidate.marketItem.id;
        break;
      }

      await repo.grantMunicipalReliefItem({
        characterId: character.id,
        itemId: grantedItemId,
        quantity: 1,
        source,
        reason: "municipal.relief",
        metadata: {
          settlementId: BLACKPINE_MARKET_ID,
          ...(marketInventoryId ? { marketInventoryId } : { emergency: true })
        }
      });
      await repo.writeEvent({
        characterId: character.id,
        eventType: "municipal.relief.claimed",
        message: `你领取了市政救济口粮：${getItemById(grantedItemId)?.name ?? grantedItemId} x1。`,
        metadata: { source, itemId: grantedItemId, quantity: 1 }
      });

      return this.buildState(repo, accountId, now);
    });
  }

  async buyMarketItem(
    accountId: string,
    input: MarketTradeRequestDto
  ): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const unlockedCharacter = await this.requireCharacter(repo, accountId);
      const quantity = this.requireTradeQuantity(input.quantity);
      const market = await this.requireMarketInventoryItemForUpdate(repo, input.itemId);
      const lockedCharacter = await this.requireCharacterForUpdate(repo, unlockedCharacter.id);
      const { character } = await this.settleHungerForCharacter(
        repo,
        lockedCharacter,
        new Date()
      );
      const item = getItemById(input.itemId);
      if (!item) throw new GameServiceError("VALIDATION_ERROR", "Unknown item");
      if (market.quantity < quantity) {
        throw new GameServiceError("VALIDATION_ERROR", "市政集市库存不足。");
      }

      const quote = calculateMarketQuote({
        direction: "buy",
        basePriceCopper: market.baseSellPriceCopper,
        stockQuantity: market.quantity,
        targetQuantity: market.targetQuantity,
        quantity
      });
      if (character.copperBalance < quote.totalCopper) {
        throw new GameServiceError("VALIDATION_ERROR", "铜币不足。");
      }
      const stockDebited = await repo.decrementMarketInventoryIfAvailable({
        marketInventoryId: market.id,
        quantity
      });
      if (!stockDebited) {
        throw new GameServiceError("VALIDATION_ERROR", "市政集市库存不足。");
      }
      const paymentDebited = await repo.decrementCharacterCopperIfAvailable({
        characterId: character.id,
        amount: quote.totalCopper
      });
      if (!paymentDebited) {
        throw new GameServiceError("VALIDATION_ERROR", "铜币不足。");
      }
      const treasury = await repo.findMunicipalTreasuryForUpdate(BLACKPINE_MARKET_ID);
      if (!treasury) {
        throw new GameServiceError("VALIDATION_ERROR", "市政集市金库未初始化。");
      }

      await repo.incrementMunicipalTreasury({
        settlementId: BLACKPINE_MARKET_ID,
        delta: quote.totalCopper
      });
      await repo.grantCharacterItem({
        characterId: character.id,
        itemId: input.itemId,
        quantity,
        reason: "market.buy",
        metadata: { settlementId: BLACKPINE_MARKET_ID, unitPriceCopper: quote.unitPriceCopper }
      });
      await repo.createMarketTransaction({
        settlementId: BLACKPINE_MARKET_ID,
        characterId: character.id,
        actorType: "player",
        actorId: character.id,
        actorName: character.name,
        transactionType: "buy",
        itemId: input.itemId,
        quantity,
        unitPriceCopper: quote.unitPriceCopper,
        grossCopper: quote.grossCopper,
        taxCopper: quote.taxCopper,
        netCopper: quote.totalCopper
      });
      await new LedgerService(new LedgerRepository(tx)).recordCopperTransfer({
        operation: "market_buy",
        fromBucket: "player",
        fromEntityId: character.id,
        toBucket: "municipal",
        toEntityId: BLACKPINE_MARKET_ID,
        amountCopper: quote.totalCopper,
        reason: "player.market.buy",
        metadata: {
          itemId: input.itemId,
          quantity,
          unitPriceCopper: quote.unitPriceCopper,
          taxCopper: quote.taxCopper
        }
      });
      await repo.writeEvent({
        characterId: character.id,
        eventType: "market.buy",
        message: `你在市政集市购买了${item.name} x${quantity}。`
      });

      return this.buildState(repo, accountId, new Date());
    });
  }

  async sellMarketItem(
    accountId: string,
    input: MarketTradeRequestDto
  ): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const unlockedCharacter = await this.requireCharacter(repo, accountId);
      const quantity = this.requireTradeQuantity(input.quantity);
      const market = await this.requireMarketInventoryItemForUpdate(repo, input.itemId);
      const item = getItemById(input.itemId);
      if (!item) throw new GameServiceError("VALIDATION_ERROR", "Unknown item");

      const existingStack = await repo.findCharacterInventoryItemForUpdate(
        unlockedCharacter.id,
        input.itemId
      );
      if (!existingStack || existingStack.quantity < quantity) {
        throw new GameServiceError("VALIDATION_ERROR", "背包物品不足。");
      }
      const lockedCharacter = await this.requireCharacterForUpdate(repo, unlockedCharacter.id);
      const { character } = await this.settleHungerForCharacter(
        repo,
        lockedCharacter,
        new Date()
      );

      const quote = calculateMarketQuote({
        direction: "sell",
        basePriceCopper: market.baseBuyPriceCopper,
        stockQuantity: market.quantity,
        targetQuantity: market.targetQuantity,
        quantity
      });
      const treasuryDebited = await repo.decrementMunicipalTreasuryIfAvailable({
        settlementId: BLACKPINE_MARKET_ID,
        amount: quote.totalCopper
      });
      if (!treasuryDebited) {
        throw new GameServiceError("VALIDATION_ERROR", "市政集市金库余额不足。");
      }

      await repo.consumeCharacterItem({
        characterId: character.id,
        itemId: input.itemId,
        quantity,
        reason: "market.sell",
        metadata: { settlementId: BLACKPINE_MARKET_ID, unitPriceCopper: quote.unitPriceCopper }
      });
      await repo.incrementMarketInventory({
        marketInventoryId: market.id,
        quantity
      });
      await repo.incrementCharacterCopper({
        characterId: character.id,
        delta: quote.totalCopper
      });
      await repo.createMarketTransaction({
        settlementId: BLACKPINE_MARKET_ID,
        characterId: character.id,
        actorType: "player",
        actorId: character.id,
        actorName: character.name,
        transactionType: "sell",
        itemId: input.itemId,
        quantity,
        unitPriceCopper: quote.unitPriceCopper,
        grossCopper: quote.grossCopper,
        taxCopper: quote.taxCopper,
        netCopper: quote.totalCopper
      });
      await new LedgerService(new LedgerRepository(tx)).recordCopperTransfer({
        operation: "market_sell",
        fromBucket: "municipal",
        fromEntityId: BLACKPINE_MARKET_ID,
        toBucket: "player",
        toEntityId: character.id,
        amountCopper: quote.totalCopper,
        reason: "player.market.sell",
        metadata: {
          itemId: input.itemId,
          quantity,
          unitPriceCopper: quote.unitPriceCopper,
          taxCopper: quote.taxCopper
        }
      });
      await repo.writeEvent({
        characterId: character.id,
        eventType: "market.sell",
        message: `你向市政集市出售了${item.name} x${quantity}。`
      });

      return this.buildState(repo, accountId, new Date());
    });
  }

  async getRepairQuote(
    accountId: string,
    input: RepairEquipmentRequestDto
  ): Promise<RepairQuoteDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const character = await this.requireRepairContext(repo, accountId);
      const equipment = await this.requireEquipment(repo, character.id, input.equipmentId);
      const quote = calculateEquipmentRepairQuote(equipment);
      if (!quote) {
        throw new GameServiceError("VALIDATION_ERROR", "装备不需要修理。");
      }
      return {
        copperCost: formatMoney(quote.copperCost),
        ironOreCost: quote.ironOreCost
      };
    });
  }

  async repairEquipment(
    accountId: string,
    input: RepairEquipmentRequestDto
  ): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const character = await this.requireRepairContext(repo, accountId);
      const equipment = await this.requireEquipmentForUpdate(repo, character.id, input.equipmentId);
      await this.repairEquipmentRecords(repo, new LedgerService(new LedgerRepository(tx)), character, [
        equipment
      ]);
      return this.buildState(repo, accountId, new Date());
    });
  }

  async repairAllEquipment(accountId: string): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const character = await this.requireRepairContext(repo, accountId);
      const equipment = await this.listEquippedEquipment(repo, character.id);
      const lockedEquipment: EquipmentRecord[] = [];
      for (const item of [...equipment].sort((left, right) => left.id.localeCompare(right.id))) {
        const locked = await repo.findEquipmentByIdForUpdate(character.id, item.id);
        if (locked) lockedEquipment.push(locked);
      }
      await this.repairEquipmentRecords(
        repo,
        new LedgerService(new LedgerRepository(tx)),
        character,
        lockedEquipment.filter((item) => calculateEquipmentRepairQuote(item) !== null)
      );
      return this.buildState(repo, accountId, new Date());
    });
  }

  async equipEquipment(
    accountId: string,
    input: EquipEquipmentRequestDto
  ): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const now = new Date();
      const character = await this.requireSettledCharacter(repo, accountId, now);
      await this.requireNoActiveAction(repo, character.id);

      const backpackEquipment = await this.listBackpackEquipment(repo, character.id);
      const equipment = backpackEquipment.find((item) => item.id === input.instanceId);
      if (!equipment) {
        throw new GameServiceError("VALIDATION_ERROR", "背包里没有这件装备。");
      }

      await repo.deleteLegacyEquipmentBySlot({ characterId: character.id, slot: equipment.slot });
      await new ItemService(new ItemRepository(tx, false)).equip({
        owner: { ownerType: "character", ownerId: character.id },
        instanceId: input.instanceId,
        targetSlot: equipment.slot,
        reason: "character.equip"
      });
      await repo.writeEvent({
        characterId: character.id,
        eventType: "equipment.equip",
        message: `你装备了${equipment.name}。`,
        metadata: { itemInstanceId: input.instanceId, slot: equipment.slot }
      });

      return this.buildState(repo, accountId, now);
    });
  }

  async eatFood(accountId: string, input: EatFoodRequestDto): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const now = new Date();
      const character = await this.requireSettledCharacter(repo, accountId, now);
      await this.requireNoActiveAction(repo, character.id);

      if (character.hunger >= 5) {
        throw new GameServiceError("VALIDATION_ERROR", "你现在不饿。");
      }

      const item = getFoodItemById(input.itemId);
      if (!item || !item.satietyRestore) {
        throw new GameServiceError("VALIDATION_ERROR", "这个物品不能食用。");
      }

      const inventory = await repo.listInventory(character.id);
      const stack = inventory.find((entry) => entry.itemId === input.itemId);
      if (!stack || stack.quantity < 1) {
        throw new GameServiceError("VALIDATION_ERROR", "背包里没有这种食物。");
      }

      await repo.consumeCharacterItem({
        characterId: character.id,
        itemId: input.itemId,
        quantity: 1,
        reason: "character.eat"
      });
      await repo.updateCharacterNeeds({
        characterId: character.id,
        hunger: Math.min(5, character.hunger + item.satietyRestore),
        lastHungerSettledAt: now
      });
      await repo.writeEvent({
        characterId: character.id,
        eventType: "character.eat",
        message: `你吃下${item.name}，恢复了一些饱腹感。`
      });

      return this.buildState(repo, accountId, now);
    });
  }

  private requireTradeQuantity(quantity: number) {
    const normalized = Math.floor(quantity);
    if (!Number.isFinite(normalized) || normalized < 1) {
      throw new GameServiceError("VALIDATION_ERROR", "交易数量无效。");
    }
    return normalized;
  }

  private async ensureMarketInventory(repo: GameRepository) {
    const existing = await repo.listMarketInventory(BLACKPINE_MARKET_ID);
    const existingItemIds = new Set(existing.map((entry) => entry.itemId));

    for (const item of FIRST_ITEMS) {
      if (existingItemIds.has(item.id)) continue;
      await repo.upsertMarketInventory({
        settlementId: BLACKPINE_MARKET_ID,
        itemId: item.id,
        quantity: Math.floor(item.targetMarketQuantity / 2),
        targetQuantity: item.targetMarketQuantity,
        baseBuyPriceCopper: item.baseBuyPriceCopper,
        baseSellPriceCopper: item.baseSellPriceCopper
      });
    }
  }

  private async requireMarketInventoryItem(repo: GameRepository, itemId: MarketTradeRequestDto["itemId"]) {
    await this.ensureMarketInventory(repo);
    const marketInventory = await repo.listMarketInventory(BLACKPINE_MARKET_ID);
    const item = marketInventory.find((entry) => entry.itemId === itemId);
    if (!item) {
      throw new GameServiceError("VALIDATION_ERROR", "市政集市没有这种物品。");
    }
    return item;
  }

  private async requireMarketInventoryItemForUpdate(
    repo: GameRepository,
    itemId: MarketTradeRequestDto["itemId"]
  ) {
    await this.ensureMarketInventory(repo);
    const marketItem = await repo.findMarketInventoryItemForUpdate(BLACKPINE_MARKET_ID, itemId);
    if (!marketItem) {
      throw new GameServiceError("VALIDATION_ERROR", "市政集市暂不交易该物品。");
    }
    return marketItem;
  }

  private async buildMarketDto(
    repo: GameRepository,
    character: CharacterRecord
  ): Promise<MarketDto> {
    await this.ensureMarketInventory(repo);
    const marketInventory = await repo.listMarketInventory(BLACKPINE_MARKET_ID);
    const inventory = await repo.listInventory(character.id);

    return {
      settlementId: BLACKPINE_MARKET_ID,
      settlementName: "黑松哨站市政集市",
      items: marketInventory
        .map((marketItem) => {
          const item = getMarketItemById(marketItem.itemId);
          if (!item) return null;
          const buyQuote = calculateMarketQuote({
            direction: "buy",
            basePriceCopper: marketItem.baseSellPriceCopper,
            stockQuantity: marketItem.quantity,
            targetQuantity: marketItem.targetQuantity,
            quantity: 1
          });
          const sellQuote = calculateMarketQuote({
            direction: "sell",
            basePriceCopper: marketItem.baseBuyPriceCopper,
            stockQuantity: marketItem.quantity,
            targetQuantity: marketItem.targetQuantity,
            quantity: 1
          });

          const dto: MarketDto["items"][number] = {
            itemId: item.id,
            name: item.name,
            category: item.category,
            itemLevel: item.itemLevel,
            stockQuantity: marketItem.quantity,
            playerQuantity:
              inventory.find((inventoryItem) => inventoryItem.itemId === item.id)?.quantity ?? 0,
            buyPrice: formatMoney(buyQuote.unitPriceCopper),
            sellPrice: formatMoney(sellQuote.unitPriceCopper),
            buyTax: formatMoney(buyQuote.taxCopper),
            sellTax: formatMoney(sellQuote.taxCopper)
          };
          return dto;
        })
        .filter((item): item is MarketDto["items"][number] => item !== null)
    };
  }

  private async requireCharacter(repo: GameRepository, accountId: string) {
    const character = await repo.findCharacterByAccountId(accountId);
    if (!character) {
      throw new GameServiceError("VALIDATION_ERROR", "Character required");
    }
    return character;
  }

  private async requireCharacterForUpdate(repo: GameRepository, characterId: string) {
    const character = await repo.findCharacterByIdForUpdate(characterId);
    if (!character) {
      throw new GameServiceError("VALIDATION_ERROR", "Character required");
    }
    return character;
  }

  private async requireSettledCharacter(repo: GameRepository, accountId: string, now: Date) {
    const character = await this.requireCharacter(repo, accountId);
    return (await this.settleHungerForCharacter(repo, character, now)).character;
  }

  private async requireSettledCharacterForUpdate(
    repo: GameRepository,
    accountId: string,
    now: Date
  ) {
    const character = await repo.findCharacterByAccountIdForUpdate(accountId);
    if (!character) {
      throw new GameServiceError("VALIDATION_ERROR", "Character required");
    }
    return (await this.settleHungerForCharacter(repo, character, now)).character;
  }

  private foodDefinitions() {
    return FIRST_ITEMS.filter(isFoodDefinition).filter((item) => item.satietyRestore).map(
      (item) => ({
        itemId: item.id,
        itemLevel: item.itemLevel,
        satietyRestore: item.satietyRestore ?? 0
      })
    );
  }

  private async settleHungerForCharacter(
    repo: GameRepository,
    character: CharacterRecord,
    now: Date
  ): Promise<CharacterSettlementResult> {
    const settlement = settleHunger({
      currentHunger: character.hunger,
      lastSettledAt: character.lastHungerSettledAt,
      now,
      inventory: await repo.listInventory(character.id),
      foods: this.foodDefinitions()
    });

    if (settlement.missedMeals === 0) return { character, stateChanged: false };

    for (const consumed of settlement.consumed) {
      await repo.consumeCharacterItem({
        characterId: character.id,
        itemId: consumed.itemId,
        quantity: consumed.quantity,
        reason: "character.hunger.auto_eat"
      });
    }

    await repo.updateCharacterNeeds({
      characterId: character.id,
      hunger: settlement.hunger,
      lastHungerSettledAt: now
    });

    if (settlement.consumed.length > 0) {
      await repo.writeEvent({
        characterId: character.id,
        eventType: "character.hunger.auto_eat",
        message: "到了饭点，你自动吃掉了背包里的普通食物。"
      });
    }

    if (settlement.injured) {
      const injuryUntil = new Date(now.getTime() + 30 * 60_000);
      await repo.updateCharacterLocation({
        characterId: character.id,
        currentLocation: BLACKPINE_OUTPOST.id,
        position: null
      });
      await repo.updateCharacterVitals({
        characterId: character.id,
        hp: 1,
        injuryUntil
      });
      await repo.writeEvent({
        characterId: character.id,
        eventType: "character.hunger.injury",
        message: "你因为饥饿倒下，被送回黑松哨站休养。"
      });
      return {
        character: {
          ...character,
          hp: 1,
          hunger: settlement.hunger,
          lastHungerSettledAt: now,
          currentLocation: BLACKPINE_OUTPOST.id,
          position: null,
          injuryUntil
        },
        stateChanged: true
      };
    }

    if (settlement.hunger <= 2) {
      await repo.writeEvent({
        characterId: character.id,
        eventType: "character.hunger.warning",
        message: "你感到饥饿，继续外出前最好准备食物。"
      });
    }

    return {
      character: {
        ...character,
        hunger: settlement.hunger,
        lastHungerSettledAt: now
      },
      stateChanged: true
    };
  }

  private requireCanLeaveVillage(character: CharacterRecord, now: Date) {
    if (character.injuryUntil && character.injuryUntil.getTime() > now.getTime()) {
      throw new GameServiceError("VALIDATION_ERROR", "你正在养伤，暂时不能出城。");
    }
    if (character.hunger <= 1) {
      throw new GameServiceError("VALIDATION_ERROR", "你已经饿到虚弱，不能出城。");
    }
  }

  private async requireRepairContext(repo: GameRepository, accountId: string) {
    const character = await this.requireSettledCharacter(repo, accountId, new Date());
    if (character.currentLocation !== BLACKPINE_OUTPOST.id) {
      throw new GameServiceError("VALIDATION_ERROR", "必须在黑松哨站修理装备。");
    }
    await this.requireNoActiveAction(repo, character.id);
    return character;
  }

  private async listEquippedEquipment(repo: GameRepository, characterId: string) {
    const [legacyEquipment, instanceEquipment] = await Promise.all([
      repo.listEquipment(characterId),
      repo.listItemInstances({ characterId, locationType: "equipped" })
    ]);
    return [
      ...legacyEquipment,
      ...instanceEquipment.map((instance) => equipmentRecordFromInstance(characterId, instance))
    ];
  }

  private async listBackpackEquipment(repo: GameRepository, characterId: string) {
    const instances = await repo.listItemInstances({ characterId, locationType: "inventory" });
    return instances.map((instance) => equipmentRecordFromInstance(characterId, instance));
  }

  private async requireEquipment(
    repo: GameRepository,
    characterId: string,
    equipmentId: string
  ) {
    const equipment = (await this.listEquippedEquipment(repo, characterId)).find(
      (item) => item.id === equipmentId
    );
    if (!equipment) {
      throw new GameServiceError("VALIDATION_ERROR", "装备不存在。");
    }
    return equipment;
  }

  private async requireEquipmentForUpdate(
    repo: GameRepository,
    characterId: string,
    equipmentId: string
  ) {
    const equipment = await repo.findEquipmentByIdForUpdate(characterId, equipmentId);
    if (!equipment) {
      throw new GameServiceError("VALIDATION_ERROR", "装备不存在。");
    }
    return equipment;
  }

  private async repairEquipmentRecords(
    repo: GameRepository,
    ledger: LedgerService,
    character: CharacterRecord,
    equipment: EquipmentRecord[]
  ) {
    if (equipment.length === 0) {
      throw new GameServiceError("VALIDATION_ERROR", "没有需要修理的装备。");
    }

    const quotes = equipment.map((item) => ({
      item,
      quote: calculateEquipmentRepairQuote(item)
    }));
    if (quotes.some((entry) => entry.quote === null)) {
      throw new GameServiceError("VALIDATION_ERROR", "装备不需要修理。");
    }
    const totalCopper = quotes.reduce((sum, entry) => sum + (entry.quote?.copperCost ?? 0), 0);
    const totalIronOre = quotes.reduce((sum, entry) => sum + (entry.quote?.ironOreCost ?? 0), 0);

    if (character.copperBalance < totalCopper) {
      throw new GameServiceError("VALIDATION_ERROR", "铜币不足。");
    }

    const inventory = await repo.listInventory(character.id);
    const ironOre = inventory.find((item) => item.itemId === "iron_ore")?.quantity ?? 0;
    if (ironOre < totalIronOre) {
      throw new GameServiceError("VALIDATION_ERROR", "基础铁矿石不足。");
    }

    const paymentDebited = await repo.decrementCharacterCopperIfAvailable({
      characterId: character.id,
      amount: totalCopper
    });
    if (!paymentDebited) {
      throw new GameServiceError("VALIDATION_ERROR", "铜币不足。");
    }
    await repo.consumeCharacterItem({
      characterId: character.id,
      itemId: "iron_ore",
      quantity: totalIronOre,
      reason: "equipment.repair",
      metadata: { equipmentIds: equipment.map((item) => item.id), totalCopper, totalIronOre }
    });
    await ledger.recordCopperTransfer({
      operation: "equipment_repair",
      fromBucket: "player",
      fromEntityId: character.id,
      toBucket: "system_sink",
      toEntityId: "equipment_repair",
      amountCopper: totalCopper,
      reason: "equipment.repair",
      metadata: { equipmentIds: equipment.map((item) => item.id), totalIronOre }
    });
    for (const entry of quotes) {
      await repo.updateEquipmentDurability({
        equipmentId: entry.item.id,
        currentDurability: entry.item.maxDurability,
        maxDurability: entry.item.maxDurability
      });
    }
    await repo.writeEvent({
      characterId: character.id,
      eventType: "equipment.repair",
      message: `你修理了 ${equipment.length} 件装备，消耗 ${totalCopper} 铜和基础铁矿石 x${totalIronOre}。`,
      metadata: { equipmentIds: equipment.map((item) => item.id), totalCopper, totalIronOre }
    });
  }

  private async requireReadyExploringCharacter(
    repo: GameRepository,
    accountId: string,
    now: Date,
    options: { forUpdate?: boolean } = {}
  ): Promise<{ character: CharacterRecord & { position: GridPositionDto }; zone: ZoneDefinition }> {
    const character = options.forUpdate
      ? await this.requireSettledCharacterForUpdate(repo, accountId, now)
      : await this.requireSettledCharacter(repo, accountId, now);
    if (character.injuryUntil && character.injuryUntil.getTime() > now.getTime()) {
      throw new GameServiceError("VALIDATION_ERROR", "你正在养伤，暂时不能出城。");
    }
    if (character.hunger <= 0) {
      throw new GameServiceError("VALIDATION_ERROR", "你已经饿到虚弱，不能出城。");
    }
    if (!character.position) {
      throw new GameServiceError("VALIDATION_ERROR", "Character is not exploring");
    }
    const zone = getZoneById(character.currentLocation);
    if (!zone) {
      throw new GameServiceError("VALIDATION_ERROR", "Unknown current zone");
    }
    return { character: character as CharacterRecord & { position: GridPositionDto }, zone };
  }

  private async requireZoneMap(
    repo: GameRepository,
    character: CharacterRecord,
    zone: ZoneDefinition
  ) {
    const map = await repo.findMapInstance(character.id, zone.id);
    if (!map) {
      throw new GameServiceError("VALIDATION_ERROR", "Map state required");
    }
    return map;
  }

  private async requireNoActiveAction(repo: GameRepository, characterId: string) {
    const action = await repo.findActiveActionByCharacterId(characterId);
    if (action) {
      throw new GameServiceError("VALIDATION_ERROR", "已有进行中的行动。");
    }
  }

  private async settleDueAction(
    repo: GameRepository,
    character: CharacterRecord,
    now: Date
  ): Promise<boolean> {
    const action = await repo.findActiveActionByCharacterId(character.id);
    if (!action || action.endsAt.getTime() > now.getTime()) return false;

    if (action.actionType === "gathering") {
      const settlement = await this.settleGatheringAction(repo, character.id, now, {
        completeAction: true
      });
      return settlement.changed;
    }

    return this.settleCombatAction(repo, character, action, now);
  }

  private async settleGatheringAction(
    repo: GameRepository,
    characterId: string,
    now: Date,
    options: { completeAction: boolean; cancelAction?: boolean }
  ): Promise<GatheringSettlementResult> {
    const action = await repo.findActiveActionForUpdate(characterId);
    if (!action || action.actionType !== "gathering") {
      return { changed: false, settledCycles: 0, quantityGranted: 0, completed: false };
    }

    const payload = action.payload as GatheringActionPayload;
    const zone = getZoneByResourceId(payload.resourceId);
    if (!zone) throw new GameServiceError("VALIDATION_ERROR", "资源区域配置无效。");
    const resource = zone.resources.find((entry) => entry.id === payload.resourceId);
    if (!resource) throw new GameServiceError("VALIDATION_ERROR", "资源配置无效。");
    const map = await repo.findMapInstanceForUpdate(action.characterId, zone.id);
    if (!map) throw new GameServiceError("VALIDATION_ERROR", "Map state required");

    const remainingCharges = map.resourceCharges[resource.id] ?? resource.charges;
    const settlement = calculateGatheringSettlement({
      startedAtMs: action.startedAt.getTime(),
      nowMs: now.getTime(),
      cycleMs: payload.cycleMs,
      plannedCycles: payload.plannedCycles,
      settledCycles: payload.settledCycles,
      remainingCharges
    });
    const quantityGranted = payload.quantityPerCycle * settlement.newCyclesToSettle;

    if (settlement.newCyclesToSettle > 0) {
      await repo.grantCharacterItem({
        characterId: action.characterId,
        itemId: payload.itemId,
        quantity: quantityGranted,
        reason: "action.gathering.settle",
        metadata: { actionId: action.id, resourceId: payload.resourceId }
      });
      await repo.updateMapResourceCharges(map.id, {
        ...map.resourceCharges,
        [resource.id]: remainingCharges - settlement.newCyclesToSettle
      });
      await repo.updateActionPayload(action.id, {
        ...payload,
        settledCycles: payload.settledCycles + settlement.newCyclesToSettle
      });
      await repo.writeEvent({
        characterId: action.characterId,
        eventType: "action.gathering.settle",
        message: `你获得了${payload.itemName} x${quantityGranted}。`
      });
    }

    let completed = false;
    let actionChanged = false;
    if (options.completeAction && settlement.isComplete) {
      completed = await repo.markActionCompleted(action.id, now);
      actionChanged = completed;
      if (completed) {
        await repo.writeEvent({
          characterId: action.characterId,
          eventType: "action.gathering.complete",
          message: "采集行动完成。"
        });
      }
    } else if (options.cancelAction) {
      actionChanged = await repo.markActionCancelled(action.id, now);
    }

    return {
      changed: settlement.newCyclesToSettle > 0 || actionChanged,
      settledCycles: payload.settledCycles + settlement.newCyclesToSettle,
      quantityGranted,
      completed
    };
  }

  private async settleCombatEscapeCost(
    repo: GameRepository,
    character: CharacterRecord,
    action: CharacterActionRecord,
    now: Date
  ) {
    const payload = action.payload as CombatActionPayload;
    const playedMessages = visibleCombatLog(payload, action.startedAt, now);
    const damageTaken = playerDamageFromCombatLog(playedMessages, character.name);

    if (damageTaken > 0) {
      await repo.updateCharacterVitals({
        characterId: character.id,
        hp: Math.max(1, character.hp - damageTaken)
      });

      const equipment = await this.listEquippedEquipment(repo, character.id);
      const damagedEquipment = applyCombatDurabilityLoss(equipment);
      for (const item of damagedEquipment) {
        const previous = equipment.find((entry) => entry.id === item.id);
        if (!previous || previous.currentDurability === item.currentDurability) continue;
        await repo.updateEquipmentDurability({
          equipmentId: item.id,
          currentDurability: item.currentDurability,
          maxDurability: item.maxDurability
        });
      }
    }
  }

  private async settleCombatAction(
    repo: GameRepository,
    character: CharacterRecord,
    action: CharacterActionRecord,
    now: Date
  ): Promise<boolean> {
    const payload = action.payload as CombatActionPayload;
    const marked = await repo.markActionCompleted(action.id, now);
    if (!marked) return false;

    let nextHp = payload.playerRemainingHp;
    let nextXp = character.xp;
    let injuryUntil: Date | null | undefined;

    if (payload.outcome === "victory") {
      nextXp += payload.xp;
      await this.grantCombatLoot(repo, character, action, payload);
      await this.cooldownEncounterAfterVictory(repo, character, payload.encounterId, now);
      await repo.writeEvent({
        characterId: character.id,
        eventType: "action.combat.victory",
        message: `战斗胜利，获得 ${payload.xp} 经验。`
      });
    }

    const levelProgression = settleLevelProgression({
      currentLevel: character.level,
      nextXp
    });
    if (levelProgression.leveledUp) {
      await repo.writeSyncEvent({
        owner: { ownerType: "character", ownerId: character.id },
        eventType: "character.level_up",
        stateDirty: true,
        payload: {
          previousLevel: character.level,
          level: levelProgression.level,
          xp: nextXp
        },
        source: "game-service"
      });
      await repo.writeSyncEvent({
        owner: { ownerType: "character", ownerId: character.id },
        audience: "public",
        eventType: "world.broadcast",
        stateDirty: false,
        payload: {
          kind: "level_up",
          characterId: character.id,
          characterName: character.name,
          level: levelProgression.level
        },
        source: "game-service"
      });
    }

    if (payload.outcome === "injury") {
      nextHp = 1;
      injuryUntil = new Date(now.getTime() + 30 * 60_000);
      await repo.updateCharacterLocation({
        characterId: character.id,
        currentLocation: BLACKPINE_OUTPOST.id,
        position: null
      });
      await repo.writeEvent({
        characterId: character.id,
        eventType: "action.combat.injury",
        message: "你伤势过重，被巡逻队带回黑松哨站休养。"
      });
    }

    const equipment = await this.listEquippedEquipment(repo, character.id);
    const damagedEquipment = applyCombatDurabilityLoss(equipment);
    for (const item of damagedEquipment) {
      const previous = equipment.find((entry) => entry.id === item.id);
      if (!previous || previous.currentDurability === item.currentDurability) continue;
      await repo.updateEquipmentDurability({
        equipmentId: item.id,
        currentDurability: item.currentDurability,
        maxDurability: item.maxDurability
      });
    }

    await repo.updateCharacterVitals({
      characterId: character.id,
      hp: nextHp,
      level: levelProgression.level,
      xp: nextXp,
      ...(injuryUntil === undefined ? {} : { injuryUntil })
    });
    return true;
  }

  private async grantCombatLoot(
    repo: GameRepository,
    character: CharacterRecord,
    action: CharacterActionRecord,
    payload: CombatActionPayload
  ) {
    for (const item of payload.loot) {
      const definition = getItemById(item.itemId);
      if (!definition) {
        throw new GameServiceError("VALIDATION_ERROR", "掉落配置无效。");
      }

      const metadata = {
        actionId: action.id,
        encounterId: payload.encounterId,
        characterName: character.name
      };
      if (definition.category !== "equipment") {
        await repo.grantCharacterItem({
          characterId: character.id,
          itemId: item.itemId,
          quantity: item.quantity,
          reason: "action.combat.loot",
          metadata
        });
        continue;
      }

      const seedBase = `${payload.lootSeed ?? action.id}:${item.itemId}`;
      for (let index = 0; index < item.quantity; index += 1) {
        await repo.grantCharacterItemInstance({
          characterId: character.id,
          itemDefId: item.itemId,
          rarity: rollRarity(seedBase, index),
          seed: `${seedBase}:${index}`,
          reason: "action.combat.loot",
          metadata: { ...metadata, dropIndex: index }
        });
      }
    }
  }

  private async cooldownEncounterAfterVictory(
    repo: GameRepository,
    character: CharacterRecord,
    encounterId: string,
    now: Date
  ) {
    const zone = getZoneByEncounterId(encounterId);
    if (!zone) throw new GameServiceError("VALIDATION_ERROR", "遭遇区域配置无效。");
    const map = await repo.findMapInstance(character.id, zone.id);
    if (!map) throw new GameServiceError("VALIDATION_ERROR", "Map state required");

    await repo.updateMapEncounterCooldowns(map.id, {
      ...map.encounterCooldowns,
      [encounterId]: new Date(now.getTime() + ENCOUNTER_VICTORY_COOLDOWN_MS).toISOString()
    });
  }

  private async healExpiredInjury(
    repo: GameRepository,
    character: CharacterRecord,
    now: Date
  ): Promise<boolean> {
    if (!character.injuryUntil || character.injuryUntil.getTime() > now.getTime()) return false;

    await repo.updateCharacterVitals({
      characterId: character.id,
      hp: character.maxHp,
      injuryUntil: null
    });
    await repo.writeEvent({
      characterId: character.id,
      eventType: "character.injury.heal",
      message: "你的伤势已经恢复。"
    });
    return true;
  }

  private toCurrentActionDto(action: CharacterActionRecord, now: Date): CurrentActionDto {
    const base = {
      id: action.id,
      actionType: action.actionType,
      status: action.status,
      startedAt: action.startedAt.toISOString(),
      endsAt: action.endsAt.toISOString(),
      progressPct: progressPct(action.startedAt, action.endsAt, now)
    };

    if (action.actionType === "gathering") {
      const payload = action.payload as GatheringActionPayload;
      const settlement = calculateGatheringSettlement({
        startedAtMs: action.startedAt.getTime(),
        nowMs: now.getTime(),
        cycleMs: payload.cycleMs,
        plannedCycles: payload.plannedCycles,
        settledCycles: payload.settledCycles,
        remainingCharges: payload.plannedCycles
      });

      return {
        ...base,
        description: `正在采集${payload.itemName}`,
        cycleProgressPct: settlement.cycleProgressPct,
        completedCycles: settlement.completedCycles,
        settledCycles: payload.settledCycles,
        plannedCycles: payload.plannedCycles,
        expectedYield: [
          {
            itemId: payload.itemId,
            name: payload.itemName,
            quantity: payload.quantityPerCycle * payload.plannedCycles
          }
        ],
        combatLog: []
      };
    }

    const payload = action.payload as CombatActionPayload;
    const encounter = getEncounterById(payload.encounterId);
    return {
      ...base,
      description: `正在与${encounter?.name ?? "敌人"}战斗`,
      cycleProgressPct: null,
      completedCycles: null,
      settledCycles: null,
      plannedCycles: null,
      expectedYield: [],
      combatLog: visibleCombatLog(payload, action.startedAt, now)
    };
  }

  private async buildState(
    repo: GameRepository,
    accountId: string,
    now: Date
  ): Promise<GameStateDto> {
    const character = await repo.findCharacterByAccountId(accountId);
    if (!character) {
      return {
        character: null,
        locationTitle: BLACKPINE_OUTPOST.title,
        locationDescription: "你尚未创建角色。",
        map: null,
        inventory: [],
        equipment: [],
        backpackEquipment: [],
        market: null,
        npcTasks: [],
        currentAction: null,
        rumors: [],
        availableActions: ["create_character"],
        log: []
      };
    }

    const inventory = await repo.listInventory(character.id);
    const equipment = await this.listEquippedEquipment(repo, character.id);
    const backpackEquipment = await this.listBackpackEquipment(repo, character.id);
    const log = await repo.listRecentEvents(character.id);
    const inventoryDto = toInventoryDto(inventory);
    const equipmentDto = equipment.map(toEquipmentDto);
    const backpackEquipmentDto = backpackEquipment.map(toEquipmentDto);
    const activeAction = await repo.findActiveActionByCharacterId(character.id);
    const currentAction = activeAction ? this.toCurrentActionDto(activeAction, now) : null;

    const currentZone = character.position ? getZoneById(character.currentLocation) : null;

    if (!currentZone || !character.position) {
      const hasFood = inventory.some(
        (item) => item.quantity > 0 && getFoodItemById(item.itemId) !== null
      );
      const injuryActive =
        character.injuryUntil !== null && character.injuryUntil.getTime() > now.getTime();
      const recoveryBlocked = character.hunger <= 1 || injuryActive;
      const availableActions: GameStateDto["availableActions"] = currentAction
        ? ["cancel_action"]
        : recoveryBlocked
          ? ["open_market"]
          : ["enter_corrupt_forest", "enter_old_mine", "open_market"];
      if (!currentAction && equipmentDto.some((item) => item.repairQuote !== null)) {
        availableActions.push("repair_equipment");
      }
      if (!currentAction && character.hunger < 5 && hasFood) {
        availableActions.push("eat_food");
      }
      if (
        !currentAction &&
        character.currentLocation === BLACKPINE_OUTPOST.id &&
        character.hunger <= 1 &&
        !hasFood
      ) {
        const marketInventory = await repo.listMarketInventory(BLACKPINE_MARKET_ID);
        const cheapestFoodPriceCopper = marketInventory.reduce<number | null>(
          (cheapest, marketItem) => {
            if (marketItem.quantity < 1 || !getFoodItemById(marketItem.itemId)) return cheapest;
            const quote = calculateMarketQuote({
              direction: "buy",
              basePriceCopper: marketItem.baseSellPriceCopper,
              stockQuantity: marketItem.quantity,
              targetQuantity: marketItem.targetQuantity,
              quantity: 1
            });
            return cheapest === null ? quote.totalCopper : Math.min(cheapest, quote.totalCopper);
          },
          null
        );
        const reliefEligibility = calculateMunicipalReliefEligibility({
          inVillage: true,
          hunger: character.hunger,
          foodQuantity: 0,
          copperBalance: character.copperBalance,
          cheapestFoodPriceCopper,
          lastClaimedAt: character.lastReliefClaimedAt,
          now
        });
        if (reliefEligibility.eligible) availableActions.push("claim_relief");
      }

      return {
        character: toCharacterDto(character, now),
        locationTitle: BLACKPINE_OUTPOST.title,
        locationDescription: BLACKPINE_OUTPOST.description,
        map: null,
        inventory: inventoryDto,
        equipment: equipmentDto,
        backpackEquipment: backpackEquipmentDto,
        market: null,
        npcTasks: [],
        currentAction,
        rumors: [],
        availableActions,
        log: log.map((entry) => ({
          id: entry.id,
          message: entry.message,
          createdAt: entry.createdAt.toISOString()
        }))
      };
    }

    const map = await repo.findMapInstance(character.id, currentZone.id);
    const resourceCharges = map?.resourceCharges ?? initialResourceCharges(currentZone);
    const availableActions: GameStateDto["availableActions"] = currentAction
      ? ["cancel_action"]
      : ["move", "return_to_village"];

    if (!currentAction && findLiveResourceAt(currentZone, character.position, resourceCharges)) {
      availableActions.push("start_gathering");
    }

    const visibleZone = map ? withReadyEncounters(currentZone, map, now) : currentZone;

    if (!currentAction && findEncounterAt(visibleZone, character.position)) {
      availableActions.push("start_combat");
    }

    return {
      character: toCharacterDto(character, now),
      locationTitle: currentZone.title,
      locationDescription: currentZone.description,
      map: {
        zoneId: currentZone.id,
        width: currentZone.width,
        height: currentZone.height,
        cells: buildMapCells(visibleZone, character.position, resourceCharges)
      },
      inventory: inventoryDto,
      equipment: equipmentDto,
      backpackEquipment: backpackEquipmentDto,
      market: null,
      npcTasks: [],
      currentAction,
      rumors: [],
      availableActions,
      log: log.map((entry) => ({
        id: entry.id,
        message: entry.message,
        createdAt: entry.createdAt.toISOString()
      }))
    };
  }
}
