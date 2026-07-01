import type { ActionStatus, ActionType, GameLocationId, GridPositionDto, ItemId } from "@ai-mud/shared";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import {
  characterActions,
  characterItems,
  characters,
  gameEvents,
  mapInstances
} from "../../db/schema.js";

type GameDb = Pick<Db, "insert" | "select" | "update">;

export interface CharacterRecord {
  id: string;
  accountId: string;
  name: string;
  classId: "warrior" | "ranger" | "warlock";
  level: number;
  xp: number;
  hp: number;
  maxHp: number;
  currentLocation: GameLocationId;
  position: GridPositionDto | null;
  injuryUntil: Date | null;
}

export interface InventoryRecord {
  itemId: ItemId;
  quantity: number;
}

export interface MapInstanceRecord {
  id: string;
  characterId: string;
  zoneId: GameLocationId;
  resourceCharges: Record<string, number>;
}

export interface GameEventRecord {
  id: string;
  message: string;
  createdAt: Date;
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

export interface CombatActionPayload {
  encounterId: string;
  combatLog: string[];
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

export function serializeActionPayload(payload: CharacterActionPayload) {
  return { ...payload };
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

function isItemQuantity(value: unknown): value is { itemId: ItemId; quantity: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { itemId?: unknown }).itemId === "string" &&
    typeof (value as { quantity?: unknown }).quantity === "number"
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
      return {
        encounterId: payload.encounterId,
        combatLog: payload.combatLog,
        expectedEndsAtMs: payload.expectedEndsAtMs,
        outcome: payload.outcome,
        playerRemainingHp: payload.playerRemainingHp,
        xp: payload.xp,
        loot: payload.loot
      };
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
      currentLocation: row.currentLocation,
      position: parsePosition(row.position),
      injuryUntil: row.injuryUntil
    };
  }

  async updateCharacterVitals(input: {
    characterId: string;
    hp: number;
    xp?: number;
    injuryUntil?: Date | null;
  }): Promise<void> {
    await this.db
      .update(characters)
      .set({
        hp: input.hp,
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

  async setInventoryItem(input: {
    characterId: string;
    itemId: ItemId;
    quantity: number;
  }): Promise<void> {
    const [existing] = await this.db
      .select({ id: characterItems.id })
      .from(characterItems)
      .where(
        and(
          eq(characterItems.characterId, input.characterId),
          eq(characterItems.itemId, input.itemId)
        )
      )
      .limit(1);

    if (existing) {
      await this.db
        .update(characterItems)
        .set({ quantity: input.quantity, updatedAt: new Date() })
        .where(eq(characterItems.id, existing.id));
      return;
    }

    await this.db.insert(characterItems).values(input);
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
      resourceCharges: parseResourceCharges(row.resourceCharges)
    };
  }

  async createMapInstance(input: {
    characterId: string;
    zoneId: GameLocationId;
    resourceCharges: Record<string, number>;
  }): Promise<MapInstanceRecord> {
    const [row] = await this.db
      .insert(mapInstances)
      .values({
        characterId: input.characterId,
        zoneId: input.zoneId,
        resourceCharges: serializeResourceCharges(input.resourceCharges)
      })
      .returning();

    if (!row) throw new Error("Failed to create map instance");

    return {
      id: row.id,
      characterId: row.characterId,
      zoneId: row.zoneId,
      resourceCharges: parseResourceCharges(row.resourceCharges)
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

  async markActionCompleted(actionId: string, completedAt: Date): Promise<void> {
    await this.db
      .update(characterActions)
      .set({ status: "completed", completedAt, updatedAt: completedAt })
      .where(eq(characterActions.id, actionId));
  }

  async markActionCancelled(actionId: string, cancelledAt: Date): Promise<void> {
    await this.db
      .update(characterActions)
      .set({ status: "cancelled", cancelledAt, updatedAt: cancelledAt })
      .where(eq(characterActions.id, actionId));
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
