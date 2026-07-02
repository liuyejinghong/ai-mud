import { getItemById } from "@ai-mud/content";
import {
  canEquip,
  isValidStackQuantity,
  rollEquipment,
  type EquipmentRarity
} from "@ai-mud/game-rules";
import type { EquipmentSlot, ItemId } from "@ai-mud/shared";
import {
  type CreateItemInstanceInput,
  type ItemInstanceRecord,
  type ItemOwner,
  type ItemLocationType,
  type ItemRarity,
  type WriteLedgerInput,
  type WriteSyncEventInput
} from "./item.repository.js";

export class ItemServiceError extends Error {
  constructor(
    readonly code: "VALIDATION_ERROR",
    message: string
  ) {
    super(message);
  }
}

interface ItemRepositoryLike {
  transaction<T>(operation: (repo: ItemRepositoryLike) => Promise<T>): Promise<T>;
  grantStackable(input: { owner: ItemOwner; itemId: ItemId; quantity: number }): Promise<void>;
  consumeStackable(input: { owner: ItemOwner; itemId: ItemId; quantity: number }): Promise<boolean>;
  createItemInstance(input: CreateItemInstanceInput): Promise<ItemInstanceRecord>;
  findItemInstance(instanceId: string): Promise<ItemInstanceRecord | null>;
  moveItemInstance(input: {
    instanceId: string;
    fromOwner: ItemOwner;
    expectedLocationType: ItemLocationType;
    toOwner: ItemOwner;
    locationType: ItemLocationType;
    locationId?: string | null;
    slot?: string | null;
  }): Promise<boolean>;
  writeLedger(input: WriteLedgerInput): Promise<void>;
  writeSyncEvent?(input: WriteSyncEventInput): Promise<void>;
}

export class ItemService {
  constructor(private readonly repo: ItemRepositoryLike) {}

  async grantStackable(input: {
    owner: ItemOwner;
    itemId: ItemId;
    quantity: number;
    reason: string;
    metadata?: Record<string, unknown>;
  }) {
    const item = getItemById(input.itemId);
    if (!item || item.category === "equipment") {
      throw new ItemServiceError("VALIDATION_ERROR", "这个物品不能堆叠发放。");
    }
    if (!isValidStackQuantity(input.quantity)) {
      throw new ItemServiceError("VALIDATION_ERROR", "物品数量无效。");
    }

    await this.repo.transaction(async (repo) => {
      await repo.grantStackable({
        owner: input.owner,
        itemId: input.itemId,
        quantity: input.quantity
      });
      await repo.writeLedger({
        operation: "grant",
        itemDefId: input.itemId,
        quantity: input.quantity,
        toOwner: input.owner,
        reason: input.reason,
        metadata: input.metadata
      });
      await this.writeOwnerSyncEvent(repo, input.owner, {
        eventType: "item.grant",
        stateDirty: true,
        payload: { itemId: input.itemId, quantity: input.quantity, reason: input.reason }
      });
    });
  }

  async grantInstance(input: {
    owner: ItemOwner;
    itemDefId: string;
    rarity: ItemRarity;
    seed: string;
    reason: string;
    metadata?: Record<string, unknown>;
  }): Promise<ItemInstanceRecord> {
    const equipment = rollEquipment(input.seed, input.itemDefId, input.rarity as EquipmentRarity);
    if (!equipment) {
      throw new ItemServiceError("VALIDATION_ERROR", "这个物品不能生成装备实例。");
    }

    return this.repo.transaction(async (repo) => {
      const instance = await repo.createItemInstance({
        itemDefId: equipment.itemDefId,
        ownerType: input.owner.ownerType,
        ownerId: input.owner.ownerId,
        locationType: "inventory",
        slot: equipment.slot,
        rarity: input.rarity,
        itemLevel: equipment.itemLevel,
        baseStats: equipment.baseStats,
        affixes: equipment.affixes,
        maxDurability: equipment.maxDurability,
        currentDurability: equipment.currentDurability
      });
      await repo.writeLedger({
        operation: "grant",
        itemDefId: input.itemDefId,
        itemInstanceId: instance.id,
        toOwner: input.owner,
        reason: input.reason,
        metadata: input.metadata
      });
      await this.writeOwnerSyncEvent(repo, input.owner, {
        eventType: "item.instance.grant",
        stateDirty: true,
        payload: {
          itemDefId: input.itemDefId,
          itemInstanceId: instance.id,
          rarity: input.rarity,
          reason: input.reason
        }
      });

      return instance;
    });
  }

  async consume(input: {
    owner: ItemOwner;
    itemId: ItemId;
    quantity: number;
    reason: string;
    metadata?: Record<string, unknown>;
  }) {
    if (!isValidStackQuantity(input.quantity)) {
      throw new ItemServiceError("VALIDATION_ERROR", "物品数量无效。");
    }

    await this.repo.transaction(async (repo) => {
      const consumed = await repo.consumeStackable({
        owner: input.owner,
        itemId: input.itemId,
        quantity: input.quantity
      });
      if (!consumed) {
        throw new ItemServiceError("VALIDATION_ERROR", "物品数量不足。");
      }

      await repo.writeLedger({
        operation: "consume",
        itemDefId: input.itemId,
        quantity: input.quantity,
        fromOwner: input.owner,
        reason: input.reason,
        metadata: input.metadata
      });
      await this.writeOwnerSyncEvent(repo, input.owner, {
        eventType: "item.consume",
        stateDirty: true,
        payload: { itemId: input.itemId, quantity: input.quantity, reason: input.reason }
      });
    });
  }

  async transfer(input: {
    fromOwner: ItemOwner;
    toOwner: ItemOwner;
    itemId: ItemId;
    quantity: number;
    reason: string;
    metadata?: Record<string, unknown>;
  }) {
    if (!isValidStackQuantity(input.quantity)) {
      throw new ItemServiceError("VALIDATION_ERROR", "物品数量无效。");
    }

    await this.repo.transaction(async (repo) => {
      const debited = await repo.consumeStackable({
        owner: input.fromOwner,
        itemId: input.itemId,
        quantity: input.quantity
      });
      if (!debited) {
        throw new ItemServiceError("VALIDATION_ERROR", "物品数量不足。");
      }

      await repo.grantStackable({
        owner: input.toOwner,
        itemId: input.itemId,
        quantity: input.quantity
      });
      await repo.writeLedger({
        operation: "transfer",
        itemDefId: input.itemId,
        quantity: input.quantity,
        fromOwner: input.fromOwner,
        toOwner: input.toOwner,
        reason: input.reason,
        metadata: input.metadata
      });
      await this.writeOwnerSyncEvent(repo, input.fromOwner, {
        eventType: "item.transfer.out",
        stateDirty: true,
        payload: { itemId: input.itemId, quantity: input.quantity, reason: input.reason }
      });
      await this.writeOwnerSyncEvent(repo, input.toOwner, {
        eventType: "item.transfer.in",
        stateDirty: true,
        payload: { itemId: input.itemId, quantity: input.quantity, reason: input.reason }
      });
    });
  }

  async transferInstance(input: {
    instanceId: string;
    fromOwner: ItemOwner;
    toOwner: ItemOwner;
    reason: string;
    metadata?: Record<string, unknown>;
  }) {
    await this.repo.transaction(async (repo) => {
      const instance = await this.requireInstance(repo, input.instanceId);
      const moved = await repo.moveItemInstance({
        instanceId: input.instanceId,
        fromOwner: input.fromOwner,
        expectedLocationType: "inventory",
        toOwner: input.toOwner,
        locationType: "inventory"
      });
      if (!moved) {
        throw new ItemServiceError("VALIDATION_ERROR", "装备实例状态已变化。");
      }

      await repo.writeLedger({
        operation: "transfer",
        itemDefId: instance.itemDefId,
        itemInstanceId: input.instanceId,
        fromOwner: input.fromOwner,
        toOwner: input.toOwner,
        reason: input.reason,
        metadata: input.metadata
      });
      await this.writeOwnerSyncEvent(repo, input.fromOwner, {
        eventType: "item.instance.transfer.out",
        stateDirty: true,
        payload: { itemInstanceId: input.instanceId, itemDefId: instance.itemDefId, reason: input.reason }
      });
      await this.writeOwnerSyncEvent(repo, input.toOwner, {
        eventType: "item.instance.transfer.in",
        stateDirty: true,
        payload: { itemInstanceId: input.instanceId, itemDefId: instance.itemDefId, reason: input.reason }
      });
    });
  }

  async equip(input: {
    owner: ItemOwner;
    instanceId: string;
    targetSlot: EquipmentSlot;
    reason: string;
    metadata?: Record<string, unknown>;
  }) {
    await this.repo.transaction(async (repo) => {
      const instance = await this.requireInstance(repo, input.instanceId);
      const result = canEquip({
        item: {
          itemDefId: instance.itemDefId,
          name: instance.itemDefId,
          rarity: instance.rarity,
          slot: instance.slot as EquipmentSlot,
          itemLevel: instance.itemLevel,
          baseStats: {},
          affixes: [],
          maxDurability: instance.maxDurability,
          currentDurability: instance.currentDurability
        },
        targetSlot: input.targetSlot
      });
      if (!result.ok) {
        throw new ItemServiceError("VALIDATION_ERROR", "装备不能穿戴到这个栏位。");
      }

      const moved = await repo.moveItemInstance({
        instanceId: input.instanceId,
        fromOwner: input.owner,
        expectedLocationType: "inventory",
        toOwner: input.owner,
        locationType: "equipped",
        slot: input.targetSlot
      });
      if (!moved) {
        throw new ItemServiceError("VALIDATION_ERROR", "装备实例状态已变化。");
      }

      await repo.writeLedger({
        operation: "equip",
        itemDefId: instance.itemDefId,
        itemInstanceId: input.instanceId,
        fromOwner: input.owner,
        toOwner: input.owner,
        reason: input.reason,
        metadata: input.metadata
      });
      await this.writeOwnerSyncEvent(repo, input.owner, {
        eventType: "item.instance.equip",
        stateDirty: true,
        payload: { itemInstanceId: input.instanceId, itemDefId: instance.itemDefId, slot: input.targetSlot }
      });
    });
  }

  async unequip(input: {
    owner: ItemOwner;
    instanceId: string;
    reason: string;
    metadata?: Record<string, unknown>;
  }) {
    await this.moveOwnedInstance({
      ...input,
      operation: "unequip",
      expectedLocationType: "equipped",
      locationType: "inventory",
      slot: null
    });
  }

  async destroy(input: {
    owner: ItemOwner;
    instanceId: string;
    reason: string;
    metadata?: Record<string, unknown>;
  }) {
    const instance = await this.repo.findItemInstance(input.instanceId);
    if (!instance) throw new ItemServiceError("VALIDATION_ERROR", "装备实例不存在。");

    await this.moveOwnedInstance({
      ...input,
      operation: "destroy",
      expectedLocationType: instance.locationType,
      locationType: "destroyed",
      slot: null
    });
  }

  private async moveOwnedInstance(input: {
    owner: ItemOwner;
    instanceId: string;
    operation: "unequip" | "destroy";
    expectedLocationType: "inventory" | "equipped" | "market" | "destroyed";
    locationType: "inventory" | "equipped" | "market" | "destroyed";
    slot: string | null;
    reason: string;
    metadata?: Record<string, unknown>;
  }) {
    await this.repo.transaction(async (repo) => {
      const instance = await this.requireInstance(repo, input.instanceId);
      const moved = await repo.moveItemInstance({
        instanceId: input.instanceId,
        fromOwner: input.owner,
        expectedLocationType: input.expectedLocationType,
        toOwner: input.owner,
        locationType: input.locationType,
        slot: input.slot
      });
      if (!moved) {
        throw new ItemServiceError("VALIDATION_ERROR", "装备实例状态已变化。");
      }

      await repo.writeLedger({
        operation: input.operation,
        itemDefId: instance.itemDefId,
        itemInstanceId: input.instanceId,
        fromOwner: input.owner,
        toOwner: input.owner,
        reason: input.reason,
        metadata: input.metadata
      });
      await this.writeOwnerSyncEvent(repo, input.owner, {
        eventType: `item.instance.${input.operation}`,
        stateDirty: true,
        payload: { itemInstanceId: input.instanceId, itemDefId: instance.itemDefId, reason: input.reason }
      });
    });
  }

  private async writeOwnerSyncEvent(
    repo: ItemRepositoryLike,
    owner: ItemOwner,
    input: Pick<WriteSyncEventInput, "eventType" | "stateDirty" | "payload">
  ) {
    await repo.writeSyncEvent?.({
      owner,
      eventType: input.eventType,
      stateDirty: input.stateDirty,
      payload: input.payload,
      source: "item-service"
    });
  }

  private async requireInstance(repo: ItemRepositoryLike, instanceId: string) {
    const instance = await repo.findItemInstance(instanceId);
    if (!instance) throw new ItemServiceError("VALIDATION_ERROR", "装备实例不存在。");
    return instance;
  }
}
