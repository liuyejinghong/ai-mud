import { describe, expect, it } from "vitest";
import type {
  CreateItemInstanceInput,
  ItemInstanceRecord,
  ItemOwner,
  WriteLedgerInput,
  WriteSyncEventInput
} from "./item.repository.js";
import { ItemService, ItemServiceError } from "./item.service.js";

class FakeItemRepo {
  stacks = new Map<string, number>();
  instances = new Map<string, ItemInstanceRecord>();
  ledger: WriteLedgerInput[] = [];
  syncEvents: WriteSyncEventInput[] = [];
  transactionCalls = 0;
  nextInstance = 1;

  async transaction<T>(operation: (repo: FakeItemRepo) => Promise<T>) {
    this.transactionCalls += 1;
    return operation(this);
  }

  async grantStackable(input: { owner: ItemOwner; itemId: string; quantity: number }) {
    const key = this.stackKey(input.owner, input.itemId);
    this.stacks.set(key, (this.stacks.get(key) ?? 0) + input.quantity);
  }

  async consumeStackable(input: { owner: ItemOwner; itemId: string; quantity: number }) {
    const key = this.stackKey(input.owner, input.itemId);
    const current = this.stacks.get(key) ?? 0;
    if (current < input.quantity) return false;

    this.stacks.set(key, current - input.quantity);
    return true;
  }

  async createItemInstance(input: CreateItemInstanceInput) {
    const instance: ItemInstanceRecord = {
      id: `instance-${this.nextInstance++}`,
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
    };
    this.instances.set(instance.id, instance);
    return instance;
  }

  async findItemInstance(instanceId: string) {
    return this.instances.get(instanceId) ?? null;
  }

  async findEquippedInstanceBySlot(owner: ItemOwner, slot: string) {
    return (
      [...this.instances.values()].find(
        (instance) =>
          instance.ownerType === owner.ownerType &&
          instance.ownerId === owner.ownerId &&
          instance.locationType === "equipped" &&
          instance.slot === slot
      ) ?? null
    );
  }

  async moveItemInstance(input: {
    instanceId: string;
    fromOwner: ItemOwner;
    expectedLocationType: string;
    toOwner: ItemOwner;
    locationType: "inventory" | "equipped" | "market" | "destroyed";
    locationId?: string | null;
    slot?: string | null;
  }) {
    const instance = this.instances.get(input.instanceId);
    if (
      !instance ||
      instance.ownerType !== input.fromOwner.ownerType ||
      instance.ownerId !== input.fromOwner.ownerId ||
      instance.locationType !== input.expectedLocationType
    ) {
      return false;
    }

    this.instances.set(input.instanceId, {
      ...instance,
      ownerType: input.toOwner.ownerType,
      ownerId: input.toOwner.ownerId,
      locationType: input.locationType,
      locationId: input.locationId ?? null,
      slot: input.slot ?? null
    });
    return true;
  }

  async writeLedger(input: WriteLedgerInput) {
    this.ledger.push(input);
  }

  async writeSyncEvent(input: WriteSyncEventInput) {
    this.syncEvents.push(input);
  }

  private stackKey(owner: ItemOwner, itemId: string) {
    return `${owner.ownerType}:${owner.ownerId ?? "none"}:${itemId}`;
  }
}

const characterOwner: ItemOwner = { ownerType: "character", ownerId: "character-1" };
const npcOwner: ItemOwner = { ownerType: "npc", ownerId: "npc-1" };

describe("ItemService", () => {
  it("grants stackable items through a transaction and ledger entry", async () => {
    const repo = new FakeItemRepo();
    const service = new ItemService(repo);

    await service.grantStackable({
      owner: characterOwner,
      itemId: "iron_ore",
      quantity: 3,
      reason: "test.grant"
    });

    expect(repo.stacks.get("character:character-1:iron_ore")).toBe(3);
    expect(repo.ledger).toMatchObject([
      {
        operation: "grant",
        itemDefId: "iron_ore",
        quantity: 3,
        toOwner: characterOwner,
        reason: "test.grant"
      }
    ]);
    expect(repo.syncEvents).toMatchObject([
      {
        owner: characterOwner,
        eventType: "item.grant",
        stateDirty: true,
        payload: { itemId: "iron_ore", quantity: 3, reason: "test.grant" },
        source: "item-service"
      }
    ]);
    expect(repo.transactionCalls).toBe(1);
  });

  it("grants equipment instances with deterministic rolled fields", async () => {
    const repo = new FakeItemRepo();
    const service = new ItemService(repo);

    const instance = await service.grantInstance({
      owner: characterOwner,
      itemDefId: "training_sword",
      rarity: "rare",
      seed: "instance-seed",
      reason: "test.instance"
    });

    expect(instance.itemDefId).toBe("training_sword");
    expect(instance.locationType).toBe("inventory");
    expect(instance.slot).toBe("weapon");
    expect(instance.currentDurability).toBe(instance.maxDurability);
    expect(repo.ledger[0]).toMatchObject({
      operation: "grant",
      itemInstanceId: instance.id,
      toOwner: characterOwner
    });
  });

  it("rejects a second consume when the conditional debit no longer matches", async () => {
    const repo = new FakeItemRepo();
    const service = new ItemService(repo);
    repo.stacks.set("character:character-1:iron_ore", 2);

    await service.consume({
      owner: characterOwner,
      itemId: "iron_ore",
      quantity: 2,
      reason: "test.consume"
    });

    await expect(
      service.consume({
        owner: characterOwner,
        itemId: "iron_ore",
        quantity: 2,
        reason: "test.consume"
      })
    ).rejects.toBeInstanceOf(ItemServiceError);
    expect(repo.stacks.get("character:character-1:iron_ore")).toBe(0);
    expect(repo.ledger.filter((entry) => entry.operation === "consume")).toHaveLength(1);
  });

  it("rejects a second transfer without crediting the target again", async () => {
    const repo = new FakeItemRepo();
    const service = new ItemService(repo);
    repo.stacks.set("npc:npc-1:wild_berry", 1);

    await service.transfer({
      fromOwner: npcOwner,
      toOwner: characterOwner,
      itemId: "wild_berry",
      quantity: 1,
      reason: "test.transfer"
    });

    await expect(
      service.transfer({
        fromOwner: npcOwner,
        toOwner: characterOwner,
        itemId: "wild_berry",
        quantity: 1,
        reason: "test.transfer"
      })
    ).rejects.toBeInstanceOf(ItemServiceError);
    expect(repo.stacks.get("character:character-1:wild_berry")).toBe(1);
    expect(repo.ledger.filter((entry) => entry.operation === "transfer")).toHaveLength(1);
    expect(repo.syncEvents.map((entry) => entry.eventType)).toEqual([
      "item.transfer.out",
      "item.transfer.in"
    ]);
  });

  it("rejects a second equip after the instance has already moved", async () => {
    const repo = new FakeItemRepo();
    const service = new ItemService(repo);
    const instance = await service.grantInstance({
      owner: characterOwner,
      itemDefId: "training_sword",
      rarity: "uncommon",
      seed: "equip-seed",
      reason: "test.instance"
    });

    await service.equip({
      owner: characterOwner,
      instanceId: instance.id,
      targetSlot: "weapon",
      reason: "test.equip"
    });

    await expect(
      service.equip({
        owner: characterOwner,
        instanceId: instance.id,
        targetSlot: "weapon",
        reason: "test.equip"
      })
    ).rejects.toBeInstanceOf(ItemServiceError);
    expect(repo.instances.get(instance.id)?.locationType).toBe("equipped");
    expect(repo.ledger.filter((entry) => entry.operation === "equip")).toHaveLength(1);
  });

  it("replaces an equipped instance in the same slot inside one transaction", async () => {
    const repo = new FakeItemRepo();
    const service = new ItemService(repo);
    const oldInstance = await service.grantInstance({
      owner: characterOwner,
      itemDefId: "training_sword",
      rarity: "common",
      seed: "old-equip-seed",
      reason: "test.instance"
    });
    const newInstance = await service.grantInstance({
      owner: characterOwner,
      itemDefId: "wolfbone_shiv",
      rarity: "rare",
      seed: "new-equip-seed",
      reason: "test.instance"
    });

    await service.equip({
      owner: characterOwner,
      instanceId: oldInstance.id,
      targetSlot: "weapon",
      reason: "test.equip"
    });
    await service.equip({
      owner: characterOwner,
      instanceId: newInstance.id,
      targetSlot: "weapon",
      reason: "test.equip"
    });

    expect(repo.instances.get(oldInstance.id)?.locationType).toBe("inventory");
    expect(repo.instances.get(newInstance.id)?.locationType).toBe("equipped");
    expect(repo.ledger.map((entry) => entry.operation)).toEqual([
      "grant",
      "grant",
      "equip",
      "unequip",
      "equip"
    ]);
  });
});
