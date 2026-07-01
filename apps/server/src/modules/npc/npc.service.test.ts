import { describe, expect, it } from "vitest";
import type { NpcDefinition } from "@ai-mud/content";
import { CORRUPT_FOREST, FIRST_NPCS } from "@ai-mud/content";
import { NpcService, type NpcRepositoryPort } from "./npc.service.js";

class InMemoryNpcRepository implements NpcRepositoryPort {
  actors: Array<{
    id: string;
    actorType: "npc";
    npcKey: string;
    name: string;
    profession: string;
    currentLocation: "blackpine_outpost" | "corrupt_forest";
    position: { x: number; y: number } | null;
    copperBalance: number;
    hunger: number;
    lastHungerSettledAt: Date;
    status: "active";
  }> = [];

  items = new Map<string, Array<{ itemId: string; quantity: number }>>();

  resources: Array<{
    zoneId: "corrupt_forest";
    resourceId: string;
    position: { x: number; y: number };
    charges: number;
  }> = [];

  treasury: { settlementId: "blackpine_outpost"; copperBalance: number } | null = null;
  actions: Array<{
    id: string;
    actorId: string;
    actionType: string;
    status: "active" | "completed" | "cancelled";
    startedAt: Date;
    endsAt: Date;
    payload: Record<string, unknown>;
  }> = [];
  transactions: Array<{
    actorId: string;
    actorType: "npc";
    actorName: string;
    transactionType: "buy" | "sell";
    itemId: string;
    quantity: number;
    unitPriceCopper: number;
    grossCopper: number;
    taxCopper: number;
    netCopper: number;
  }> = [];
  marketInventory = new Map<
    string,
    {
      id: string;
      settlementId: "blackpine_outpost";
      itemId: string;
      quantity: number;
      targetQuantity: number;
      baseBuyPriceCopper: number;
      baseSellPriceCopper: number;
    }
  >();

  async listNpcActors() {
    return this.actors;
  }

  async createNpcActor(npc: NpcDefinition, now: Date) {
    const actor = {
      id: `actor-${npc.key}`,
      actorType: "npc" as const,
      npcKey: npc.key,
      name: npc.name,
      profession: npc.profession,
      currentLocation: npc.homeLocation,
      position: npc.homePosition,
      copperBalance: npc.startingCopper,
      hunger: 5,
      lastHungerSettledAt: now,
      status: "active" as const
    };
    this.actors.push(actor);
    return actor;
  }

  async listWorldResourceNodes() {
    return this.resources;
  }

  async createWorldResourceNode(input: {
    zoneId: "corrupt_forest";
    resourceId: string;
    position: { x: number; y: number };
    charges: number;
  }) {
    this.resources.push(input);
  }

  async findMunicipalTreasury(settlementId: "blackpine_outpost") {
    return this.treasury?.settlementId === settlementId ? this.treasury : null;
  }

  async createMunicipalTreasury(input: {
    settlementId: "blackpine_outpost";
    copperBalance: number;
  }) {
    this.treasury = input;
  }

  async listNpcInventory(actorId: string) {
    return this.items.get(actorId) ?? [];
  }

  async setNpcInventoryItem(input: { actorId: string; itemId: string; quantity: number }) {
    const inventory = [...(this.items.get(input.actorId) ?? [])];
    const index = inventory.findIndex((item) => item.itemId === input.itemId);
    if (index >= 0) {
      inventory[index] = { itemId: input.itemId, quantity: input.quantity };
    } else {
      inventory.push({ itemId: input.itemId, quantity: input.quantity });
    }
    this.items.set(input.actorId, inventory);
  }

  async updateNpcActor(input: {
    actorId: string;
    currentLocation?: "blackpine_outpost" | "corrupt_forest";
    position?: { x: number; y: number } | null;
    copperBalance?: number;
    hunger?: number;
    lastHungerSettledAt?: Date;
  }) {
    const actor = this.actors.find((entry) => entry.id === input.actorId);
    if (!actor) throw new Error("actor not found");
    if (input.currentLocation !== undefined) actor.currentLocation = input.currentLocation;
    if ("position" in input) actor.position = input.position ?? null;
    if (input.copperBalance !== undefined) actor.copperBalance = input.copperBalance;
    if (input.hunger !== undefined) actor.hunger = input.hunger;
    if (input.lastHungerSettledAt !== undefined) {
      actor.lastHungerSettledAt = input.lastHungerSettledAt;
    }
  }

  async findActiveNpcAction(actorId: string) {
    return (
      this.actions.find((action) => action.actorId === actorId && action.status === "active") ??
      null
    );
  }

  async createNpcAction(input: {
    actorId: string;
    actionType: string;
    startedAt: Date;
    endsAt: Date;
    payload: Record<string, unknown>;
  }) {
    const action = {
      id: `action-${this.actions.length + 1}`,
      status: "active" as const,
      ...input
    };
    this.actions.push(action);
    return action;
  }

  async markNpcActionCompleted(actionId: string) {
    const action = this.actions.find((entry) => entry.id === actionId);
    if (!action) throw new Error("action not found");
    action.status = "completed";
  }

  async updateWorldResourceNodeCharges(input: { resourceId: string; charges: number }) {
    const resource = this.resources.find((entry) => entry.resourceId === input.resourceId);
    if (!resource) throw new Error("resource not found");
    resource.charges = input.charges;
  }

  async updateMunicipalTreasury(input: {
    settlementId: "blackpine_outpost";
    copperBalance: number;
  }) {
    if (!this.treasury || this.treasury.settlementId !== input.settlementId) {
      throw new Error("treasury not found");
    }
    this.treasury.copperBalance = input.copperBalance;
  }

  async createNpcMarketTransaction(input: {
    actorId: string;
    actorType: "npc";
    actorName: string;
    transactionType: "buy" | "sell";
    itemId: string;
    quantity: number;
    unitPriceCopper: number;
    grossCopper: number;
    taxCopper: number;
    netCopper: number;
  }) {
    this.transactions.push(input);
  }

  async listMarketInventory(settlementId: "blackpine_outpost") {
    return [...this.marketInventory.values()].filter((item) => item.settlementId === settlementId);
  }

  async setMarketInventoryQuantity(input: { marketInventoryId: string; quantity: number }) {
    for (const item of this.marketInventory.values()) {
      if (item.id === input.marketInventoryId) {
        item.quantity = input.quantity;
        return;
      }
    }
    throw new Error("market item not found");
  }

  seedMarketItem(input: {
    itemId: string;
    quantity: number;
    targetQuantity: number;
    baseBuyPriceCopper: number;
    baseSellPriceCopper: number;
  }) {
    this.marketInventory.set(input.itemId, {
      id: `market-${input.itemId}`,
      settlementId: "blackpine_outpost",
      ...input
    });
  }
}

describe("NpcService", () => {
  it("seeds persistent NPC actors, shared resources, and municipal treasury", async () => {
    const repo = new InMemoryNpcRepository();
    const service = new NpcService(repo);

    await service.ensureWorldSeeded(new Date("2026-07-01T00:00:00.000Z"));

    expect(repo.actors.map((actor) => actor.npcKey)).toEqual(FIRST_NPCS.map((npc) => npc.key));
    expect(repo.actors.every((actor) => actor.actorType === "npc")).toBe(true);
    expect(repo.resources.map((resource) => resource.resourceId)).toEqual(
      CORRUPT_FOREST.resources.map((resource) => resource.id)
    );
    expect(repo.treasury).toEqual({
      settlementId: "blackpine_outpost",
      copperBalance: 10_000
    });
  });

  it("does not duplicate world seed data on repeated seeding", async () => {
    const repo = new InMemoryNpcRepository();
    const service = new NpcService(repo);

    await service.ensureWorldSeeded(new Date("2026-07-01T00:00:00.000Z"));
    await service.ensureWorldSeeded(new Date("2026-07-01T01:00:00.000Z"));

    expect(repo.actors).toHaveLength(FIRST_NPCS.length);
    expect(repo.resources).toHaveLength(CORRUPT_FOREST.resources.length);
  });

  it("rejects NPC inventory decrements below zero", async () => {
    const repo = new InMemoryNpcRepository();
    const service = new NpcService(repo);
    const now = new Date("2026-07-01T00:00:00.000Z");

    await service.ensureWorldSeeded(now);
    const actorId = repo.actors[0]!.id;
    await service.addNpcInventoryItem(actorId, "wild_berry", 2);

    await expect(service.addNpcInventoryItem(actorId, "wild_berry", -3)).rejects.toThrow(
      "NPC inventory cannot go below zero"
    );
    await expect(repo.listNpcInventory(actorId)).resolves.toEqual([
      { itemId: "wild_berry", quantity: 2 }
    ]);
  });

  it("creates travel actions before moving NPCs across the map", async () => {
    const repo = new InMemoryNpcRepository();
    const service = new NpcService(repo);
    const startedAt = new Date("2026-07-01T06:00:00.000Z");

    await service.ensureWorldSeeded(startedAt);
    await service.settleNpcWorld(startedAt);

    const farmer = repo.actors.find((actor) => actor.npcKey === "blackpine_farmer_mara")!;
    expect(farmer.currentLocation).toBe("blackpine_outpost");
    expect(farmer.position).toBeNull();
    expect(await repo.findActiveNpcAction(farmer.id)).toMatchObject({
      actorId: farmer.id,
      actionType: "travel",
      payload: {
        toLocation: "corrupt_forest",
        toPosition: { x: 2, y: 4 }
      }
    });

    await service.settleNpcWorld(new Date("2026-07-01T06:02:01.000Z"));

    expect(farmer.currentLocation).toBe("corrupt_forest");
    expect(farmer.position).toEqual({ x: 2, y: 4 });
    expect(await repo.findActiveNpcAction(farmer.id)).toBeNull();
  });

  it("settles gathering into NPC inventory and shared resource charges", async () => {
    const repo = new InMemoryNpcRepository();
    const service = new NpcService(repo);
    const now = new Date("2026-07-01T06:00:00.000Z");

    await service.ensureWorldSeeded(now);
    const farmer = repo.actors.find((actor) => actor.npcKey === "blackpine_farmer_mara")!;
    farmer.currentLocation = "corrupt_forest";
    farmer.position = { x: 1, y: 3 };

    await service.settleNpcWorld(now);
    expect(await repo.findActiveNpcAction(farmer.id)).toMatchObject({
      actionType: "gathering"
    });

    await service.settleNpcWorld(new Date("2026-07-01T06:00:31.000Z"));

    expect(await repo.listNpcInventory(farmer.id)).toEqual([
      { itemId: "wild_berry", quantity: 2 }
    ]);
    expect(
      repo.resources.find((resource) => resource.resourceId === "forest_berry_patch_01")?.charges
    ).toBe(2);
  });

  it("pays wages from municipal treasury instead of minting coins", async () => {
    const repo = new InMemoryNpcRepository();
    const service = new NpcService(repo);
    const now = new Date("2026-07-01T06:00:00.000Z");

    await service.ensureWorldSeeded(now);
    const farmer = repo.actors.find((actor) => actor.npcKey === "blackpine_farmer_mara")!;
    const previousCopper = farmer.copperBalance;

    await service.payNpcWage(farmer.id, 25);

    expect(farmer.copperBalance).toBe(previousCopper + 25);
    expect(repo.treasury?.copperBalance).toBe(9_975);
  });

  it("sells gathered NPC inventory into the municipal market with an actor ledger", async () => {
    const repo = new InMemoryNpcRepository();
    const service = new NpcService(repo);
    const now = new Date("2026-07-01T08:00:00.000Z");

    await service.ensureWorldSeeded(now);
    repo.seedMarketItem({
      itemId: "wild_berry",
      quantity: 10,
      targetQuantity: 20,
      baseBuyPriceCopper: 3,
      baseSellPriceCopper: 5
    });
    const farmer = repo.actors.find((actor) => actor.npcKey === "blackpine_farmer_mara")!;
    farmer.currentLocation = "blackpine_outpost";
    farmer.position = null;
    farmer.copperBalance = 0;
    await service.addNpcInventoryItem(farmer.id, "wild_berry", 2);

    await service.settleNpcWorld(now);

    expect(await repo.listNpcInventory(farmer.id)).toEqual([
      { itemId: "wild_berry", quantity: 0 }
    ]);
    expect(repo.marketInventory.get("wild_berry")?.quantity).toBe(12);
    expect(farmer.copperBalance).toBe(11);
    expect(repo.transactions).toEqual([
      expect.objectContaining({
        actorId: farmer.id,
        actorType: "npc",
        actorName: farmer.name,
        transactionType: "sell",
        itemId: "wild_berry",
        quantity: 2,
        unitPriceCopper: 6,
        grossCopper: 12,
        taxCopper: 1,
        netCopper: 11
      })
    ]);
  });

  it("lets hungry NPCs buy and eat market food before working", async () => {
    const repo = new InMemoryNpcRepository();
    const service = new NpcService(repo);
    const now = new Date("2026-07-01T08:00:00.000Z");

    await service.ensureWorldSeeded(now);
    repo.seedMarketItem({
      itemId: "wild_berry",
      quantity: 3,
      targetQuantity: 20,
      baseBuyPriceCopper: 3,
      baseSellPriceCopper: 5
    });
    const miner = repo.actors.find((actor) => actor.npcKey === "blackpine_miner_torin")!;
    miner.hunger = 1;
    miner.copperBalance = 100;

    await service.settleNpcWorld(now);

    expect(miner.hunger).toBe(2);
    expect(miner.copperBalance).toBe(84);
    expect(repo.marketInventory.get("wild_berry")?.quantity).toBe(2);
    expect(await repo.findActiveNpcAction(miner.id)).toBeNull();
    expect(repo.transactions).toContainEqual(
      expect.objectContaining({
        actorId: miner.id,
        transactionType: "buy",
        itemId: "wild_berry",
        quantity: 1,
        unitPriceCopper: 15,
        grossCopper: 15,
        taxCopper: 1,
        netCopper: 16
      })
    );
  });

  it("keeps hungry NPCs in town when food is unavailable", async () => {
    const repo = new InMemoryNpcRepository();
    const service = new NpcService(repo);
    const now = new Date("2026-07-01T08:00:00.000Z");

    await service.ensureWorldSeeded(now);
    const miner = repo.actors.find((actor) => actor.npcKey === "blackpine_miner_torin")!;
    miner.hunger = 1;
    miner.copperBalance = 100;

    await service.settleNpcWorld(now);

    expect(miner.hunger).toBe(1);
    expect(miner.currentLocation).toBe("blackpine_outpost");
    expect(await repo.findActiveNpcAction(miner.id)).toBeNull();
    expect(await repo.listNpcInventory(miner.id)).toEqual([]);
    expect(repo.transactions).toEqual([]);
  });
});
