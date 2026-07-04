import type { ItemId } from "@ai-mud/shared";
import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import {
  characterItems,
  itemInstances,
  itemLedger,
  npcItems,
  syncEvents
} from "../../db/schema.js";

type ItemDb = Pick<Db, "insert" | "select" | "update"> & { transaction?: Db["transaction"] };

export type ItemOwnerType = "character" | "npc" | "market" | "system";
export type ItemLocationType = "inventory" | "equipped" | "market" | "destroyed";
export type ItemLedgerOperation = "grant" | "consume" | "transfer" | "equip" | "unequip" | "destroy";
export type ItemRarity = "common" | "uncommon" | "rare" | "epic";

export interface ItemOwner {
  ownerType: ItemOwnerType;
  ownerId: string | null;
}

export interface ItemInstanceRecord {
  id: string;
  itemDefId: string;
  ownerType: ItemOwnerType;
  ownerId: string | null;
  locationType: ItemLocationType;
  locationId: string | null;
  slot: string | null;
  rarity: ItemRarity;
  itemLevel: number;
  baseStats: unknown;
  affixes: unknown;
  maxDurability: number;
  currentDurability: number;
}

export interface CreateItemInstanceInput extends ItemOwner {
  itemDefId: string;
  locationType: ItemLocationType;
  locationId?: string | null;
  slot?: string | null;
  rarity: ItemRarity;
  itemLevel: number;
  baseStats: unknown;
  affixes: unknown;
  maxDurability: number;
  currentDurability: number;
}

export interface WriteLedgerInput {
  operation: ItemLedgerOperation;
  itemDefId: string;
  quantity?: number | null;
  itemInstanceId?: string | null;
  fromOwner?: ItemOwner | null;
  toOwner?: ItemOwner | null;
  reason: string;
  metadata?: Record<string, unknown> | undefined;
}

export interface WriteSyncEventInput {
  owner: ItemOwner;
  audience?: "character" | "public";
  eventType: string;
  stateDirty: boolean;
  payload: Record<string, unknown>;
  source: string;
}

function toItemInstance(row: typeof itemInstances.$inferSelect): ItemInstanceRecord {
  return {
    id: row.id,
    itemDefId: row.itemDefId,
    ownerType: row.ownerType as ItemOwnerType,
    ownerId: row.ownerId,
    locationType: row.locationType as ItemLocationType,
    locationId: row.locationId,
    slot: row.slot,
    rarity: row.rarity as ItemRarity,
    itemLevel: row.itemLevel,
    baseStats: row.baseStats,
    affixes: row.affixes,
    maxDurability: row.maxDurability,
    currentDurability: row.currentDurability
  };
}

export class ItemRepository {
  constructor(
    private readonly db: ItemDb,
    private readonly ownsTransaction = true
  ) {}

  async transaction<T>(operation: (repo: ItemRepository) => Promise<T>): Promise<T> {
    if (!this.ownsTransaction || !this.db.transaction) return operation(this);
    return this.db.transaction(async (tx) => operation(new ItemRepository(tx, false)));
  }

  async grantStackable(input: { owner: ItemOwner; itemId: ItemId; quantity: number }) {
    if (input.owner.ownerType === "character" && input.owner.ownerId) {
      await this.db
        .insert(characterItems)
        .values({
          characterId: input.owner.ownerId,
          itemId: input.itemId,
          quantity: input.quantity
        })
        .onConflictDoUpdate({
          target: [characterItems.characterId, characterItems.itemId],
          set: {
            quantity: sql`${characterItems.quantity} + ${input.quantity}`,
            updatedAt: new Date()
          }
        });
      return;
    }

    if (input.owner.ownerType === "npc" && input.owner.ownerId) {
      await this.db
        .insert(npcItems)
        .values({
          actorId: input.owner.ownerId,
          itemId: input.itemId,
          quantity: input.quantity
        })
        .onConflictDoUpdate({
          target: [npcItems.actorId, npcItems.itemId],
          set: {
            quantity: sql`${npcItems.quantity} + ${input.quantity}`,
            updatedAt: new Date()
          }
        });
      return;
    }

    throw new Error(`Unsupported stackable owner: ${input.owner.ownerType}`);
  }

  async consumeStackable(input: { owner: ItemOwner; itemId: ItemId; quantity: number }) {
    if (input.owner.ownerType === "character" && input.owner.ownerId) {
      const rows = await this.db
        .update(characterItems)
        .set({
          quantity: sql`${characterItems.quantity} - ${input.quantity}`,
          updatedAt: new Date()
        })
        .where(
          and(
            eq(characterItems.characterId, input.owner.ownerId),
            eq(characterItems.itemId, input.itemId),
            gte(characterItems.quantity, input.quantity)
          )
        )
        .returning({ id: characterItems.id });
      return rows.length > 0;
    }

    if (input.owner.ownerType === "npc" && input.owner.ownerId) {
      const rows = await this.db
        .update(npcItems)
        .set({
          quantity: sql`${npcItems.quantity} - ${input.quantity}`,
          updatedAt: new Date()
        })
        .where(
          and(
            eq(npcItems.actorId, input.owner.ownerId),
            eq(npcItems.itemId, input.itemId),
            gte(npcItems.quantity, input.quantity)
          )
        )
        .returning({ id: npcItems.id });
      return rows.length > 0;
    }

    return false;
  }

  async createItemInstance(input: CreateItemInstanceInput): Promise<ItemInstanceRecord> {
    const [row] = await this.db
      .insert(itemInstances)
      .values({
        itemDefId: input.itemDefId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        locationType: input.locationType,
        locationId: input.locationId ?? null,
        slot: input.slot ?? null,
        rarity: input.rarity,
        itemLevel: input.itemLevel,
        baseStats: input.baseStats,
        affixes: input.affixes,
        maxDurability: input.maxDurability,
        currentDurability: input.currentDurability
      })
      .returning();

    if (!row) throw new Error("Failed to create item instance");
    return toItemInstance(row);
  }

  async findItemInstance(instanceId: string): Promise<ItemInstanceRecord | null> {
    const [row] = await this.db
      .select()
      .from(itemInstances)
      .where(eq(itemInstances.id, instanceId))
      .limit(1);

    return row ? toItemInstance(row) : null;
  }

  async findEquippedInstanceBySlot(
    owner: ItemOwner,
    slot: string
  ): Promise<ItemInstanceRecord | null> {
    if (!owner.ownerId) return null;

    const [row] = await this.db
      .select()
      .from(itemInstances)
      .where(
        and(
          eq(itemInstances.ownerType, owner.ownerType),
          eq(itemInstances.ownerId, owner.ownerId),
          eq(itemInstances.locationType, "equipped"),
          eq(itemInstances.slot, slot)
        )
      )
      .limit(1);

    return row ? toItemInstance(row) : null;
  }

  async moveItemInstance(input: {
    instanceId: string;
    fromOwner: ItemOwner;
    expectedLocationType: ItemLocationType;
    toOwner: ItemOwner;
    locationType: ItemLocationType;
    locationId?: string | null;
    slot?: string | null;
  }) {
    const rows = await this.db
      .update(itemInstances)
      .set({
        ownerType: input.toOwner.ownerType,
        ownerId: input.toOwner.ownerId,
        locationType: input.locationType,
        locationId: input.locationId ?? null,
        slot: input.slot ?? null,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(itemInstances.id, input.instanceId),
          eq(itemInstances.ownerType, input.fromOwner.ownerType),
          input.fromOwner.ownerId === null
            ? sql`${itemInstances.ownerId} IS NULL`
            : eq(itemInstances.ownerId, input.fromOwner.ownerId),
          eq(itemInstances.locationType, input.expectedLocationType)
        )
      )
      .returning({ id: itemInstances.id });

    return rows.length > 0;
  }

  async writeLedger(input: WriteLedgerInput) {
    await this.db.insert(itemLedger).values({
      operation: input.operation,
      itemDefId: input.itemDefId,
      quantity: input.quantity ?? null,
      itemInstanceId: input.itemInstanceId ?? null,
      fromOwnerType: input.fromOwner?.ownerType ?? null,
      fromOwnerId: input.fromOwner?.ownerId ?? null,
      toOwnerType: input.toOwner?.ownerType ?? null,
      toOwnerId: input.toOwner?.ownerId ?? null,
      reason: input.reason,
      metadata: input.metadata ?? {}
    });
  }

  async writeSyncEvent(input: WriteSyncEventInput) {
    const audience = input.audience ?? "character";
    if (audience === "character" && (input.owner.ownerType !== "character" || !input.owner.ownerId)) {
      return;
    }

    await this.db.insert(syncEvents).values({
      audience,
      characterId: audience === "character" ? input.owner.ownerId : null,
      eventType: input.eventType,
      stateDirty: input.stateDirty,
      payload: input.payload,
      source: input.source
    });
  }
}
