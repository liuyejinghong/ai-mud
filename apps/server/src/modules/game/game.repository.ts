import type {
  ActionStatus,
  ActionType,
  EquipmentAffixDto,
  EquipmentSlot,
  GameLocationId,
  GridPositionDto,
  ItemId
} from "@ai-mud/shared";
import { and, asc, desc, eq, gt, or, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import {
  characterActions,
  characterEquipment,
  characterItems,
  characters,
  gameEvents,
  itemInstances,
  marketInventory,
  marketTransactions,
  mapInstances,
  municipalTreasury,
  syncEvents
} from "../../db/schema.js";
import { ItemRepository } from "../item/item.repository.js";
import type { ItemInstanceRecord, ItemLocationType, ItemRarity } from "../item/item.repository.js";
import { ItemService } from "../item/item.service.js";

type GameDb = Pick<Db, "delete" | "insert" | "select" | "update">;

export interface CharacterRecord {
  id: string;
  accountId: string;
  name: string;
  classId: "warrior" | "ranger" | "warlock";
  level: number;
  xp: number;
  hp: number;
  maxHp: number;
  copperBalance: number;
  hunger: number;
  lastHungerSettledAt: Date;
  currentLocation: GameLocationId;
  position: GridPositionDto | null;
  injuryUntil: Date | null;
}

export interface InventoryRecord {
  itemId: ItemId;
  quantity: number;
}

export interface EquipmentRecord {
  id: string;
  characterId: string;
  slot: EquipmentSlot;
  itemKey: string;
  name: string;
  rarity?: ItemRarity;
  itemLevel: number;
  attackBonus: number;
  defenseBonus: number;
  agilityBonus?: number;
  maxHpBonus?: number;
  affixes?: Array<{
    affixId: EquipmentAffixDto["affixId"];
    name: EquipmentAffixDto["name"];
    stat: EquipmentAffixDto["stat"];
    value: EquipmentAffixDto["value"];
  }>;
  maxDurability: number;
  currentDurability: number;
}

export interface MapInstanceRecord {
  id: string;
  characterId: string;
  zoneId: GameLocationId;
  resourceCharges: Record<string, number>;
  encounterCooldowns: Record<string, string>;
}

export interface GameEventRecord {
  id: string;
  message: string;
  createdAt: Date;
}

export interface MarketInventoryRecord {
  id: string;
  settlementId: string;
  itemId: ItemId;
  quantity: number;
  targetQuantity: number;
  baseBuyPriceCopper: number;
  baseSellPriceCopper: number;
}

export interface MarketTransactionInput {
  settlementId: string;
  characterId: string | null;
  actorType: "player" | "npc" | "municipal";
  actorId: string | null;
  actorName: string;
  transactionType: "buy" | "sell";
  itemId: ItemId;
  quantity: number;
  unitPriceCopper: number;
  grossCopper: number;
  taxCopper: number;
  netCopper: number;
}

export interface MarketTransactionRecord {
  id: string;
  settlementId: string;
  characterId: string | null;
  actorType: "player" | "npc" | "municipal";
  actorId: string | null;
  actorName: string;
  transactionType: "buy" | "sell";
  itemId: ItemId;
  quantity: number;
  unitPriceCopper: number;
  grossCopper: number;
  taxCopper: number;
  netCopper: number;
  createdAt: Date;
}

export interface SyncEventRecord {
  id: number;
  eventType: string;
  stateDirty: boolean;
  payload: Record<string, unknown>;
  source: string;
  createdAt: Date;
}

export interface WriteSyncEventInput {
  owner: { ownerType: "character"; ownerId: string | null };
  audience?: "character" | "public";
  eventType: string;
  stateDirty: boolean;
  payload: Record<string, unknown>;
  source: string;
}

export interface GatheringActionPayload {
  resourceId: string;
  itemId: ItemId;
  itemName: string;
  quantityPerCycle: number;
  cycleMs: number;
  plannedCycles: number;
  settledCycles: number;
}

export interface CombatTimelineEntry {
  atMs: number;
  message: string;
}

export interface CombatActionPayload {
  encounterId: string;
  combatLog: string[];
  combatTimeline: CombatTimelineEntry[];
  lootSeed?: string;
  expectedEndsAtMs: number;
  outcome: "victory" | "injury" | "stalemate";
  playerRemainingHp: number;
  xp: number;
  loot: Array<{ itemId: ItemId; quantity: number }>;
}

export type CharacterActionPayload = GatheringActionPayload | CombatActionPayload;

export interface CharacterActionRecord {
  id: string;
  characterId: string;
  actionType: ActionType;
  status: ActionStatus;
  startedAt: Date;
  endsAt: Date;
  payload: CharacterActionPayload;
}

export function serializeResourceCharges(charges: Record<string, number>) {
  return { ...charges };
}

export function serializeEncounterCooldowns(cooldowns: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(cooldowns).filter((entry): entry is [string, string] => {
      const [encounterId, expiresAt] = entry;
      return Boolean(encounterId) && !Number.isNaN(Date.parse(expiresAt));
    })
  );
}

export function serializeEquipmentDurability(input: {
  currentDurability: number;
  maxDurability: number;
}) {
  const maxDurability = Math.max(1, Math.floor(input.maxDurability));
  return {
    currentDurability: Math.min(
      maxDurability,
      Math.max(0, Math.floor(input.currentDurability))
    ),
    maxDurability
  };
}

export function serializeHunger(value: number) {
  return Math.min(5, Math.max(0, Math.floor(value)));
}

export function serializeActionPayload(payload: CharacterActionPayload) {
  return { ...payload };
}

export function serializeMarketTransaction(
  row: typeof marketTransactions.$inferSelect
): MarketTransactionRecord {
  return {
    id: row.id,
    settlementId: row.settlementId,
    characterId: row.characterId,
    actorType:
      row.actorType === "npc" || row.actorType === "municipal" ? row.actorType : "player",
    actorId: row.actorId,
    actorName: row.actorName,
    transactionType: row.transactionType === "buy" ? "buy" : "sell",
    itemId: row.itemId as ItemId,
    quantity: row.quantity,
    unitPriceCopper: row.unitPriceCopper,
    grossCopper: row.grossCopper,
    taxCopper: row.taxCopper,
    netCopper: row.netCopper,
    createdAt: row.createdAt
  };
}

function parsePosition(value: unknown): GridPositionDto | null {
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { x?: unknown }).x === "number" &&
    typeof (value as { y?: unknown }).y === "number"
  ) {
    return { x: (value as { x: number }).x, y: (value as { y: number }).y };
  }

  return null;
}

function parseResourceCharges(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number"
    )
  );
}

function parseEncounterCooldowns(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && !Number.isNaN(Date.parse(entry[1]))
    )
  );
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function isItemQuantity(value: unknown): value is { itemId: ItemId; quantity: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { itemId?: unknown }).itemId === "string" &&
    typeof (value as { quantity?: unknown }).quantity === "number"
  );
}

function isCombatTimelineEntry(value: unknown): value is CombatTimelineEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { atMs?: unknown }).atMs === "number" &&
    typeof (value as { message?: unknown }).message === "string"
  );
}

export function parseActionPayload(
  actionType: ActionType,
  value: unknown
): CharacterActionPayload {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Invalid ${actionType} action payload`);
  }

  const payload = value as Record<string, unknown>;

  if (actionType === "gathering") {
    if (
      typeof payload.resourceId === "string" &&
      typeof payload.itemId === "string" &&
      typeof payload.itemName === "string" &&
      typeof payload.quantityPerCycle === "number" &&
      typeof payload.cycleMs === "number" &&
      typeof payload.plannedCycles === "number" &&
      typeof payload.settledCycles === "number"
    ) {
      return {
        resourceId: payload.resourceId,
        itemId: payload.itemId as ItemId,
        itemName: payload.itemName,
        quantityPerCycle: payload.quantityPerCycle,
        cycleMs: payload.cycleMs,
        plannedCycles: payload.plannedCycles,
        settledCycles: payload.settledCycles
      };
    }
  }

  if (actionType === "combat") {
    if (
      typeof payload.encounterId === "string" &&
      Array.isArray(payload.combatLog) &&
      payload.combatLog.every((entry) => typeof entry === "string") &&
      typeof payload.expectedEndsAtMs === "number" &&
      (payload.outcome === "victory" ||
        payload.outcome === "injury" ||
        payload.outcome === "stalemate") &&
      typeof payload.playerRemainingHp === "number" &&
      typeof payload.xp === "number" &&
      Array.isArray(payload.loot) &&
      payload.loot.every(isItemQuantity)
    ) {
      const combatTimeline = Array.isArray(payload.combatTimeline)
        ? payload.combatTimeline.filter(isCombatTimelineEntry)
        : payload.combatLog.map((message) => ({
            atMs: Number.MAX_SAFE_INTEGER,
            message
          }));
      const normalized: CombatActionPayload = {
        encounterId: payload.encounterId,
        combatLog: payload.combatLog,
        combatTimeline,
        expectedEndsAtMs: payload.expectedEndsAtMs,
        outcome: payload.outcome as CombatActionPayload["outcome"],
        playerRemainingHp: payload.playerRemainingHp,
        xp: payload.xp,
        loot: payload.loot
      };
      return typeof payload.lootSeed === "string"
        ? { ...normalized, lootSeed: payload.lootSeed }
        : normalized;
    }
  }

  throw new Error(`Invalid ${actionType} action payload`);
}

function mapCharacterActionRow(row: typeof characterActions.$inferSelect): CharacterActionRecord {
  return {
    id: row.id,
    characterId: row.characterId,
    actionType: row.actionType,
    status: row.status,
    startedAt: row.startedAt,
    endsAt: row.endsAt,
    payload: parseActionPayload(row.actionType, row.payload)
  };
}

export class GameRepository {
  constructor(private readonly db: GameDb) {}

  async findCharacterByAccountId(accountId: string): Promise<CharacterRecord | null> {
    const [row] = await this.db
      .select()
      .from(characters)
      .where(eq(characters.accountId, accountId))
      .limit(1);

    if (!row) return null;

    return {
      id: row.id,
      accountId: row.accountId,
      name: row.name,
      classId: row.classId,
      level: row.level,
      xp: row.xp,
      hp: row.hp,
      maxHp: row.maxHp,
      copperBalance: row.copperBalance,
      hunger: serializeHunger(row.hunger),
      lastHungerSettledAt: row.lastHungerSettledAt,
      currentLocation: row.currentLocation,
      position: parsePosition(row.position),
      injuryUntil: row.injuryUntil
    };
  }

  async createCharacter(input: {
    accountId: string;
    name: string;
    classId: CharacterRecord["classId"];
    hp: number;
    maxHp: number;
  }): Promise<CharacterRecord> {
    const [row] = await this.db
      .insert(characters)
      .values({
        accountId: input.accountId,
        name: input.name,
        classId: input.classId,
        hp: input.hp,
        maxHp: input.maxHp
      })
      .returning();

    if (!row) throw new Error("Failed to create character");

    return {
      id: row.id,
      accountId: row.accountId,
      name: row.name,
      classId: row.classId,
      level: row.level,
      xp: row.xp,
      hp: row.hp,
      maxHp: row.maxHp,
      copperBalance: row.copperBalance,
      hunger: serializeHunger(row.hunger),
      lastHungerSettledAt: row.lastHungerSettledAt,
      currentLocation: row.currentLocation,
      position: parsePosition(row.position),
      injuryUntil: row.injuryUntil
    };
  }

  async updateCharacterCopper(input: {
    characterId: string;
    copperBalance: number;
  }): Promise<void> {
    await this.db
      .update(characters)
      .set({ copperBalance: input.copperBalance })
      .where(eq(characters.id, input.characterId));
  }

  async incrementCharacterCopper(input: { characterId: string; delta: number }): Promise<void> {
    await this.db
      .update(characters)
      .set({ copperBalance: sql`${characters.copperBalance} + ${input.delta}` })
      .where(eq(characters.id, input.characterId));
  }

  async updateCharacterNeeds(input: {
    characterId: string;
    hunger: number;
    lastHungerSettledAt: Date;
  }): Promise<void> {
    await this.db
      .update(characters)
      .set({
        hunger: serializeHunger(input.hunger),
        lastHungerSettledAt: input.lastHungerSettledAt
      })
      .where(eq(characters.id, input.characterId));
  }

  async updateCharacterVitals(input: {
    characterId: string;
    hp: number;
    level?: number;
    xp?: number;
    injuryUntil?: Date | null;
  }): Promise<void> {
    await this.db
      .update(characters)
      .set({
        hp: input.hp,
        ...(input.level === undefined ? {} : { level: input.level }),
        ...(input.xp === undefined ? {} : { xp: input.xp }),
        ...(input.injuryUntil === undefined ? {} : { injuryUntil: input.injuryUntil })
      })
      .where(eq(characters.id, input.characterId));
  }

  async updateCharacterLocation(input: {
    characterId: string;
    currentLocation: GameLocationId;
    position: GridPositionDto | null;
  }): Promise<void> {
    await this.db
      .update(characters)
      .set({
        currentLocation: input.currentLocation,
        position: input.position
      })
      .where(eq(characters.id, input.characterId));
  }

  async listInventory(characterId: string): Promise<InventoryRecord[]> {
    const rows = await this.db
      .select({
        itemId: characterItems.itemId,
        quantity: characterItems.quantity
      })
      .from(characterItems)
      .where(eq(characterItems.characterId, characterId));

    return rows.map((row) => ({
      itemId: row.itemId as ItemId,
      quantity: row.quantity
    }));
  }

  async grantCharacterItem(input: {
    characterId: string;
    itemId: ItemId;
    quantity: number;
    reason: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await new ItemService(new ItemRepository(this.db, false)).grantStackable({
      owner: { ownerType: "character", ownerId: input.characterId },
      itemId: input.itemId,
      quantity: input.quantity,
      reason: input.reason,
      ...(input.metadata ? { metadata: input.metadata } : {})
    });
  }

  async grantCharacterItemInstance(input: {
    characterId: string;
    itemDefId: string;
    rarity: ItemRarity;
    seed: string;
    reason: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await new ItemService(new ItemRepository(this.db, false)).grantInstance({
      owner: { ownerType: "character", ownerId: input.characterId },
      itemDefId: input.itemDefId,
      rarity: input.rarity,
      seed: input.seed,
      reason: input.reason,
      ...(input.metadata ? { metadata: input.metadata } : {})
    });
  }

  async consumeCharacterItem(input: {
    characterId: string;
    itemId: ItemId;
    quantity: number;
    reason: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await new ItemService(new ItemRepository(this.db, false)).consume({
      owner: { ownerType: "character", ownerId: input.characterId },
      itemId: input.itemId,
      quantity: input.quantity,
      reason: input.reason,
      ...(input.metadata ? { metadata: input.metadata } : {})
    });
  }

  async listEquipment(characterId: string): Promise<EquipmentRecord[]> {
    const rows = await this.db
      .select()
      .from(characterEquipment)
      .where(eq(characterEquipment.characterId, characterId));

    return rows.map((row) => ({
      id: row.id,
      characterId: row.characterId,
      slot: row.slot as EquipmentSlot,
      itemKey: row.itemKey,
      name: row.name,
      itemLevel: row.itemLevel,
      attackBonus: row.attackBonus,
      defenseBonus: row.defenseBonus,
      maxDurability: row.maxDurability,
      currentDurability: row.currentDurability
    }));
  }

  async listItemInstances(input: {
    characterId: string;
    locationType: ItemLocationType;
  }): Promise<ItemInstanceRecord[]> {
    const rows = await this.db
      .select()
      .from(itemInstances)
      .where(
        and(
          eq(itemInstances.ownerType, "character"),
          eq(itemInstances.ownerId, input.characterId),
          eq(itemInstances.locationType, input.locationType)
        )
      )
      .orderBy(asc(itemInstances.createdAt));

    return rows.map((row) => ({
      id: row.id,
      itemDefId: row.itemDefId,
      ownerType: row.ownerType as ItemInstanceRecord["ownerType"],
      ownerId: row.ownerId,
      locationType: row.locationType as ItemInstanceRecord["locationType"],
      locationId: row.locationId,
      slot: row.slot,
      rarity: row.rarity as ItemInstanceRecord["rarity"],
      itemLevel: row.itemLevel,
      baseStats: row.baseStats,
      affixes: row.affixes,
      maxDurability: row.maxDurability,
      currentDurability: row.currentDurability
    }));
  }

  async findEquipmentById(
    characterId: string,
    equipmentId: string
  ): Promise<EquipmentRecord | null> {
    const equipment = await this.listEquipment(characterId);
    return equipment.find((item) => item.id === equipmentId) ?? null;
  }

  async createEquipment(input: {
    characterId: string;
    slot: EquipmentSlot;
    itemKey: string;
    name: string;
    itemLevel: number;
    attackBonus: number;
    defenseBonus: number;
    maxDurability: number;
    currentDurability: number;
  }): Promise<void> {
    const durability = serializeEquipmentDurability(input);
    await this.db.insert(characterEquipment).values({
      characterId: input.characterId,
      slot: input.slot,
      itemKey: input.itemKey,
      name: input.name,
      itemLevel: input.itemLevel,
      attackBonus: input.attackBonus,
      defenseBonus: input.defenseBonus,
      maxDurability: durability.maxDurability,
      currentDurability: durability.currentDurability
    });
  }

  async updateEquipmentDurability(input: {
    equipmentId: string;
    currentDurability: number;
    maxDurability: number;
  }): Promise<void> {
    const durability = serializeEquipmentDurability(input);
    const legacyRows = await this.db
      .update(characterEquipment)
      .set({
        currentDurability: durability.currentDurability,
        maxDurability: durability.maxDurability,
        updatedAt: new Date()
      })
      .where(eq(characterEquipment.id, input.equipmentId))
      .returning({ id: characterEquipment.id });
    if (legacyRows.length > 0) return;

    await this.db
      .update(itemInstances)
      .set({
        currentDurability: durability.currentDurability,
        maxDurability: durability.maxDurability,
        updatedAt: new Date()
      })
      .where(eq(itemInstances.id, input.equipmentId));
  }

  async deleteLegacyEquipmentBySlot(input: {
    characterId: string;
    slot: EquipmentSlot;
  }): Promise<boolean> {
    const rows = await this.db
      .delete(characterEquipment)
      .where(
        and(eq(characterEquipment.characterId, input.characterId), eq(characterEquipment.slot, input.slot))
      )
      .returning({ id: characterEquipment.id });
    return rows.length > 0;
  }

  async listMarketInventory(settlementId: string): Promise<MarketInventoryRecord[]> {
    const rows = await this.db
      .select()
      .from(marketInventory)
      .where(eq(marketInventory.settlementId, settlementId));

    return rows.map((row) => ({
      id: row.id,
      settlementId: row.settlementId,
      itemId: row.itemId as ItemId,
      quantity: row.quantity,
      targetQuantity: row.targetQuantity,
      baseBuyPriceCopper: row.baseBuyPriceCopper,
      baseSellPriceCopper: row.baseSellPriceCopper
    }));
  }

  async upsertMarketInventory(input: {
    settlementId: string;
    itemId: ItemId;
    quantity: number;
    targetQuantity: number;
    baseBuyPriceCopper: number;
    baseSellPriceCopper: number;
  }): Promise<void> {
    const [existing] = await this.db
      .select({ id: marketInventory.id })
      .from(marketInventory)
      .where(
        and(
          eq(marketInventory.settlementId, input.settlementId),
          eq(marketInventory.itemId, input.itemId)
        )
      )
      .limit(1);

    if (existing) {
      await this.db
        .update(marketInventory)
        .set({
          quantity: input.quantity,
          targetQuantity: input.targetQuantity,
          baseBuyPriceCopper: input.baseBuyPriceCopper,
          baseSellPriceCopper: input.baseSellPriceCopper,
          updatedAt: new Date()
        })
        .where(eq(marketInventory.id, existing.id));
      return;
    }

    await this.db.insert(marketInventory).values(input);
  }

  async setMarketInventoryQuantity(input: {
    marketInventoryId: string;
    quantity: number;
  }): Promise<void> {
    await this.db
      .update(marketInventory)
      .set({ quantity: input.quantity, updatedAt: new Date() })
      .where(eq(marketInventory.id, input.marketInventoryId));
  }

  async findMunicipalTreasury(settlementId: string): Promise<{ copperBalance: number } | null> {
    const [row] = await this.db
      .select({ copperBalance: municipalTreasury.copperBalance })
      .from(municipalTreasury)
      .where(eq(municipalTreasury.settlementId, settlementId))
      .limit(1);
    return row ?? null;
  }

  async incrementMunicipalTreasury(input: {
    settlementId: string;
    delta: number;
  }): Promise<void> {
    await this.db
      .update(municipalTreasury)
      .set({
        copperBalance: sql`${municipalTreasury.copperBalance} + ${input.delta}`,
        updatedAt: new Date()
      })
      .where(eq(municipalTreasury.settlementId, input.settlementId));
  }

  async createMarketTransaction(input: MarketTransactionInput): Promise<void> {
    await this.db.insert(marketTransactions).values(input);
  }

  async listMarketTransactions(input: {
    settlementId: string;
    limit: number;
  }): Promise<MarketTransactionRecord[]> {
    const limit = Math.min(100, Math.max(1, Math.floor(input.limit)));
    const rows = await this.db
      .select()
      .from(marketTransactions)
      .where(eq(marketTransactions.settlementId, input.settlementId))
      .orderBy(desc(marketTransactions.createdAt))
      .limit(limit);

    return rows.map(serializeMarketTransaction);
  }

  async listAllMarketTransactions(settlementId: string): Promise<MarketTransactionRecord[]> {
    const rows = await this.db
      .select()
      .from(marketTransactions)
      .where(eq(marketTransactions.settlementId, settlementId));

    return rows.map(serializeMarketTransaction);
  }

  async listSyncEvents(input: {
    accountId: string;
    characterId: string | null;
    cursor: number;
    limit: number;
  }): Promise<SyncEventRecord[]> {
    const audiencePredicate = input.characterId
      ? or(
          eq(syncEvents.accountId, input.accountId),
          eq(syncEvents.characterId, input.characterId),
          eq(syncEvents.audience, "public")
        )
      : or(eq(syncEvents.accountId, input.accountId), eq(syncEvents.audience, "public"));
    const rows = await this.db
      .select()
      .from(syncEvents)
      .where(and(gt(syncEvents.id, input.cursor), audiencePredicate))
      .orderBy(asc(syncEvents.id))
      .limit(input.limit);

    return rows.map((row) => ({
      id: row.id,
      eventType: row.eventType,
      stateDirty: row.stateDirty,
      payload: parseJsonObject(row.payload),
      source: row.source,
      createdAt: row.createdAt
    }));
  }

  async writeSyncEvent(input: WriteSyncEventInput): Promise<void> {
    const audience = input.audience ?? "character";
    if (audience === "character" && !input.owner.ownerId) return;

    await this.db.insert(syncEvents).values({
      audience,
      characterId: audience === "character" ? input.owner.ownerId : null,
      eventType: input.eventType,
      stateDirty: input.stateDirty,
      payload: input.payload,
      source: input.source
    });
  }

  async findMapInstance(
    characterId: string,
    zoneId: GameLocationId
  ): Promise<MapInstanceRecord | null> {
    const [row] = await this.db
      .select()
      .from(mapInstances)
      .where(and(eq(mapInstances.characterId, characterId), eq(mapInstances.zoneId, zoneId)))
      .limit(1);

    if (!row) return null;

    return {
      id: row.id,
      characterId: row.characterId,
      zoneId: row.zoneId,
      resourceCharges: parseResourceCharges(row.resourceCharges),
      encounterCooldowns: parseEncounterCooldowns(row.encounterCooldowns)
    };
  }

  async createMapInstance(input: {
    characterId: string;
    zoneId: GameLocationId;
    resourceCharges: Record<string, number>;
    encounterCooldowns?: Record<string, string>;
  }): Promise<MapInstanceRecord> {
    const [row] = await this.db
      .insert(mapInstances)
      .values({
        characterId: input.characterId,
        zoneId: input.zoneId,
        resourceCharges: serializeResourceCharges(input.resourceCharges),
        encounterCooldowns: serializeEncounterCooldowns(input.encounterCooldowns ?? {})
      })
      .returning();

    if (!row) throw new Error("Failed to create map instance");

    return {
      id: row.id,
      characterId: row.characterId,
      zoneId: row.zoneId,
      resourceCharges: parseResourceCharges(row.resourceCharges),
      encounterCooldowns: parseEncounterCooldowns(row.encounterCooldowns)
    };
  }

  async updateMapResourceCharges(
    mapInstanceId: string,
    resourceCharges: Record<string, number>
  ): Promise<void> {
    await this.db
      .update(mapInstances)
      .set({ resourceCharges: serializeResourceCharges(resourceCharges), updatedAt: new Date() })
      .where(eq(mapInstances.id, mapInstanceId));
  }

  async updateMapEncounterCooldowns(
    mapInstanceId: string,
    encounterCooldowns: Record<string, string>
  ): Promise<void> {
    await this.db
      .update(mapInstances)
      .set({
        encounterCooldowns: serializeEncounterCooldowns(encounterCooldowns),
        updatedAt: new Date()
      })
      .where(eq(mapInstances.id, mapInstanceId));
  }

  async createAction(input: {
    characterId: string;
    actionType: ActionType;
    startedAt: Date;
    endsAt: Date;
    payload: CharacterActionPayload;
  }): Promise<CharacterActionRecord> {
    const [row] = await this.db
      .insert(characterActions)
      .values({
        characterId: input.characterId,
        actionType: input.actionType,
        startedAt: input.startedAt,
        endsAt: input.endsAt,
        payload: serializeActionPayload(input.payload)
      })
      .returning();

    if (!row) throw new Error("Failed to create character action");

    return mapCharacterActionRow(row);
  }

  async findActiveActionByCharacterId(characterId: string): Promise<CharacterActionRecord | null> {
    const [row] = await this.db
      .select()
      .from(characterActions)
      .where(and(eq(characterActions.characterId, characterId), eq(characterActions.status, "active")))
      .limit(1);

    return row ? mapCharacterActionRow(row) : null;
  }

  async updateActionPayload(actionId: string, payload: CharacterActionPayload): Promise<void> {
    await this.db
      .update(characterActions)
      .set({ payload: serializeActionPayload(payload), updatedAt: new Date() })
      .where(eq(characterActions.id, actionId));
  }

  async markActionCompleted(actionId: string, completedAt: Date): Promise<boolean> {
    const rows = await this.db
      .update(characterActions)
      .set({ status: "completed", completedAt, updatedAt: completedAt })
      .where(and(eq(characterActions.id, actionId), eq(characterActions.status, "active")))
      .returning({ id: characterActions.id });
    return rows.length > 0;
  }

  async markActionCancelled(actionId: string, cancelledAt: Date): Promise<boolean> {
    const rows = await this.db
      .update(characterActions)
      .set({ status: "cancelled", cancelledAt, updatedAt: cancelledAt })
      .where(and(eq(characterActions.id, actionId), eq(characterActions.status, "active")))
      .returning({ id: characterActions.id });
    return rows.length > 0;
  }

  async writeEvent(input: {
    characterId: string;
    eventType: string;
    message: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.insert(gameEvents).values({
      characterId: input.characterId,
      eventType: input.eventType,
      message: input.message,
      metadata: input.metadata ?? {}
    });
  }

  async listRecentEvents(characterId: string): Promise<GameEventRecord[]> {
    return this.db
      .select({
        id: gameEvents.id,
        message: gameEvents.message,
        createdAt: gameEvents.createdAt
      })
      .from(gameEvents)
      .where(eq(gameEvents.characterId, characterId))
      .orderBy(desc(gameEvents.createdAt))
      .limit(12);
  }
}
