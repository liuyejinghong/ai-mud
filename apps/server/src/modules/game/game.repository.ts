import type { ItemId, GameLocationId, GridPositionDto } from "@ai-mud/shared";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { characterItems, characters, gameEvents, mapInstances } from "../../db/schema.js";

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

export function serializeResourceCharges(charges: Record<string, number>) {
  return { ...charges };
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
      position: parsePosition(row.position)
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
      position: parsePosition(row.position)
    };
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
