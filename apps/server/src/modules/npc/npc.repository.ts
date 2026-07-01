import type { NpcDefinition } from "@ai-mud/content";
import type { GameLocationId, GridPositionDto, ItemId } from "@ai-mud/shared";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import {
  municipalTreasury,
  npcItems,
  worldActors,
  worldResourceNodes
} from "../../db/schema.js";
import type { NpcActorRecord, NpcRepositoryPort } from "./npc.service.js";

type NpcDb = Pick<Db, "insert" | "select" | "update">;

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

function serializePosition(position: GridPositionDto | null) {
  return position ? { ...position } : null;
}

function toNpcActor(row: typeof worldActors.$inferSelect): NpcActorRecord {
  return {
    id: row.id,
    actorType: "npc",
    npcKey: row.npcKey ?? row.id,
    name: row.name,
    profession: row.profession,
    currentLocation: row.currentLocation,
    position: parsePosition(row.position),
    copperBalance: row.copperBalance,
    hunger: row.hunger,
    lastHungerSettledAt: row.lastHungerSettledAt,
    status: row.status
  };
}

export class NpcRepository implements NpcRepositoryPort {
  constructor(private readonly db: NpcDb) {}

  async listNpcActors(): Promise<NpcActorRecord[]> {
    const rows = await this.db
      .select()
      .from(worldActors)
      .where(eq(worldActors.actorType, "npc"));

    return rows.map(toNpcActor);
  }

  async createNpcActor(npc: NpcDefinition, now: Date): Promise<NpcActorRecord> {
    const [row] = await this.db
      .insert(worldActors)
      .values({
        actorType: "npc",
        npcKey: npc.key,
        name: npc.name,
        profession: npc.profession,
        currentLocation: npc.homeLocation,
        position: serializePosition(npc.homePosition),
        copperBalance: npc.startingCopper,
        hunger: 5,
        lastHungerSettledAt: now,
        status: "active",
        updatedAt: now
      })
      .returning();

    if (!row) throw new Error("Failed to create NPC actor");
    return toNpcActor(row);
  }

  async listWorldResourceNodes() {
    const rows = await this.db.select().from(worldResourceNodes);

    return rows.map((row) => ({
      zoneId: row.zoneId as "corrupt_forest",
      resourceId: row.resourceId,
      position: parsePosition(row.position) ?? { x: 0, y: 0 },
      charges: row.charges
    }));
  }

  async createWorldResourceNode(input: {
    zoneId: "corrupt_forest";
    resourceId: string;
    position: GridPositionDto;
    charges: number;
  }): Promise<void> {
    await this.db.insert(worldResourceNodes).values({
      zoneId: input.zoneId,
      resourceId: input.resourceId,
      position: input.position,
      charges: input.charges
    });
  }

  async findMunicipalTreasury(settlementId: "blackpine_outpost") {
    const [row] = await this.db
      .select()
      .from(municipalTreasury)
      .where(eq(municipalTreasury.settlementId, settlementId))
      .limit(1);

    return row
      ? {
          settlementId: "blackpine_outpost" as const,
          copperBalance: row.copperBalance
        }
      : null;
  }

  async createMunicipalTreasury(input: {
    settlementId: "blackpine_outpost";
    copperBalance: number;
  }): Promise<void> {
    await this.db.insert(municipalTreasury).values(input);
  }

  async listNpcInventory(actorId: string) {
    const rows = await this.db
      .select({
        itemId: npcItems.itemId,
        quantity: npcItems.quantity
      })
      .from(npcItems)
      .where(eq(npcItems.actorId, actorId));

    return rows.map((row) => ({
      itemId: row.itemId as ItemId,
      quantity: row.quantity
    }));
  }

  async setNpcInventoryItem(input: {
    actorId: string;
    itemId: string;
    quantity: number;
  }): Promise<void> {
    const [existing] = await this.db
      .select({ id: npcItems.id })
      .from(npcItems)
      .where(and(eq(npcItems.actorId, input.actorId), eq(npcItems.itemId, input.itemId)))
      .limit(1);

    if (existing) {
      await this.db
        .update(npcItems)
        .set({ quantity: input.quantity, updatedAt: new Date() })
        .where(eq(npcItems.id, existing.id));
      return;
    }

    await this.db.insert(npcItems).values(input);
  }
}
