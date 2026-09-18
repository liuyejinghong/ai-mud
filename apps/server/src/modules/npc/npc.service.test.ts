import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GameLocationId } from "@ai-mud/shared";
import type { NpcDefinition } from "@ai-mud/content";
import { CORRUPT_FOREST, FIRST_NPCS, OLD_MINE, WORLD_ZONES } from "@ai-mud/content";
import type { CopperLedgerWriter } from "../ledger/ledger.service.js";
import { runNpcSimulationOnSnapshot } from "./npc.simulation-repository.js";
import {
  NpcService,
  type MapInstanceResourceRecord,
  type NpcActorRecord,
  type NpcRepositoryPort
} from "./npc.service.js";

class InMemoryNpcRepository implements NpcRepositoryPort {
  actors: NpcActorRecord[] = [];

  items = new Map<string, Array<{ itemId: string; quantity: number }>>();

  resources: Array<{
    zoneId: GameLocationId;
    resourceId: string;
    position: { x: number; y: number };
    charges: number;
    lastRefreshedAt: Date;
  }> = [];

  mapInstances: MapInstanceResourceRecord[] = [];

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
  events: Array<{
    id: string;
    actorId: string;
    message: string;
    createdAt: Date;
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

  failMarketDebit = false;

  failNpcCopperDebit = false;

  failNpcInventoryDebit = false;

  failTreasuryDebit = false;

  async listNpcActors() {
    return this.actors;
  }

  async findNpcActorForUpdate(actorId: string) {
    return this.actors.find((actor) => actor.id === actorId) ?? null;
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
    zoneId: GameLocationId;
    resourceId: string;
    position: { x: number; y: number };
    charges: number;
    lastRefreshedAt?: Date;
  }) {
    this.resources.push({
      ...input,
      lastRefreshedAt: input.lastRefreshedAt ?? new Date("2026-07-01T00:00:00.000Z")
    });
  }

  async listMapInstances() {
    return this.mapInstances;
  }

  async updateMapResourceCharges(input: {
    mapInstanceId: string;
    resourceCharges: Record<string, number>;
    resourcesRefreshedAt?: Date;
  }) {
    const map = this.mapInstances.find((entry) => entry.id === input.mapInstanceId);
    if (!map) throw new Error("map instance not found");
    map.resourceCharges = input.resourceCharges;
    if (input.resourcesRefreshedAt) map.resourcesRefreshedAt = input.resourcesRefreshedAt;
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

  async findNpcInventoryItemForUpdate(actorId: string, itemId: string) {
    return (this.items.get(actorId) ?? []).find((item) => item.itemId === itemId) ?? null;
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
    currentLocation?: GameLocationId;
    position?: { x: number; y: number } | null;
    hunger?: number;
    lastHungerSettledAt?: Date;
  }) {
    const actor = this.actors.find((entry) => entry.id === input.actorId);
    if (!actor) throw new Error("actor not found");
    if (input.currentLocation !== undefined) actor.currentLocation = input.currentLocation;
    if ("position" in input) actor.position = input.position ?? null;
    if (input.hunger !== undefined) actor.hunger = input.hunger;
    if (input.lastHungerSettledAt !== undefined) {
      actor.lastHungerSettledAt = input.lastHungerSettledAt;
    }
  }

  async decrementNpcInventoryIfAvailable(input: {
    actorId: string;
    itemId: string;
    quantity: number;
  }) {
    if (this.failNpcInventoryDebit) return false;
    const item = (this.items.get(input.actorId) ?? []).find(
      (entry) => entry.itemId === input.itemId
    );
    if (!item || item.quantity < input.quantity) return false;
    item.quantity -= input.quantity;
    return true;
  }

  async incrementNpcInventory(input: { actorId: string; itemId: string; quantity: number }) {
    const item = (this.items.get(input.actorId) ?? []).find(
      (entry) => entry.itemId === input.itemId
    );
    if (!item) throw new Error("inventory item not found");
    item.quantity += input.quantity;
  }

  async findActiveNpcAction(actorId: string) {
    return (
      this.actions.find((action) => action.actorId === actorId && action.status === "active") ??
      null
    );
  }

  async listNpcActions() {
    return this.actions;
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

  async listNpcEvents(actorId: string, limit: number) {
    return this.events.filter((event) => event.actorId === actorId).slice(0, limit);
  }

  async createNpcEvent(input: {
    actorId: string;
    eventType: string;
    message: string;
    metadata: Record<string, unknown>;
    createdAt: Date;
  }) {
    this.events.push({
      id: `event-${this.events.length + 1}`,
      actorId: input.actorId,
      message: input.message,
      createdAt: input.createdAt
    });
  }

  async updateWorldResourceNodeCharges(input: {
    resourceId: string;
    charges: number;
    lastRefreshedAt?: Date;
  }) {
    const resource = this.resources.find((entry) => entry.resourceId === input.resourceId);
    if (!resource) throw new Error("resource not found");
    resource.charges = input.charges;
    if (input.lastRefreshedAt) resource.lastRefreshedAt = input.lastRefreshedAt;
  }

  async findMunicipalTreasuryForUpdate(settlementId: "blackpine_outpost") {
    return this.findMunicipalTreasury(settlementId);
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

  async countNpcMarketTransactions() {
    return this.transactions.length;
  }

  async listMarketInventory(settlementId: "blackpine_outpost") {
    return [...this.marketInventory.values()].filter((item) => item.settlementId === settlementId);
  }

  async findMarketInventoryItemForUpdate(settlementId: "blackpine_outpost", itemId: string) {
    const item = this.marketInventory.get(itemId);
    return item?.settlementId === settlementId ? item : null;
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

class FakeAssets {
  assetCalls = 0;

  constructor(private readonly repo: InMemoryNpcRepository) {}

  private marketItem(marketInventoryId: string) {
    return [...this.repo.marketInventory.values()].find(
      (entry) => entry.id === marketInventoryId
    );
  }

  async debitNpcCopperIfAvailable(actorId: string, amount: number) {
    this.assetCalls += 1;
    if (this.repo.failNpcCopperDebit) return false;
    const actor = this.repo.actors.find((entry) => entry.id === actorId);
    if (!actor || actor.copperBalance < amount) return false;
    actor.copperBalance -= amount;
    return true;
  }

  async creditNpcCopper(actorId: string, amount: number) {
    this.assetCalls += 1;
    const actor = this.repo.actors.find((entry) => entry.id === actorId);
    if (!actor) throw new Error("actor not found");
    actor.copperBalance += amount;
  }

  async creditTreasury(settlementId: string, amount: number) {
    this.assetCalls += 1;
    if (!this.repo.treasury || this.repo.treasury.settlementId !== settlementId) {
      throw new Error("treasury not found");
    }
    this.repo.treasury.copperBalance += amount;
  }

  async debitTreasuryIfAvailable(settlementId: string, amount: number) {
    this.assetCalls += 1;
    if (this.repo.failTreasuryDebit) return false;
    if (!this.repo.treasury || this.repo.treasury.settlementId !== settlementId) return false;
    if (this.repo.treasury.copperBalance < amount) return false;
    this.repo.treasury.copperBalance -= amount;
    return true;
  }

  async debitMarketStockIfAvailable(marketInventoryId: string, quantity: number) {
    this.assetCalls += 1;
    if (this.repo.failMarketDebit) return false;
    const item = this.marketItem(marketInventoryId);
    if (!item || item.quantity < quantity) return false;
    item.quantity -= quantity;
    return true;
  }

  async debitMarketStockAboveReserve(
    marketInventoryId: string,
    quantity: number,
    reserveQuantity: number
  ) {
    this.assetCalls += 1;
    if (this.repo.failMarketDebit) return false;
    const item = this.marketItem(marketInventoryId);
    if (!item || item.quantity - quantity < reserveQuantity) return false;
    item.quantity -= quantity;
    return true;
  }

  async creditMarketStock(marketInventoryId: string, quantity: number) {
    this.assetCalls += 1;
    const item = this.marketItem(marketInventoryId);
    if (!item) throw new Error("market item not found");
    item.quantity += quantity;
  }

  async debitCharacterCopperIfAvailable(): Promise<boolean> {
    throw new Error("not used in NPC tests");
  }

  async creditCharacterCopper(): Promise<void> {
    throw new Error("not used in NPC tests");
  }

  async reserveNpcCopper(): Promise<boolean> {
    throw new Error("not used in NPC tests");
  }

  async findReceiptForUpdate(): Promise<null> {
    throw new Error("not used in NPC tests");
  }

  async claimReceipt(): Promise<boolean> {
    throw new Error("not used in NPC tests");
  }

  async saveReceiptResult(): Promise<void> {
    throw new Error("not used in NPC tests");
  }
}

describe("NpcService", () => {
  function recordingLedger(entries: unknown[]): CopperLedgerWriter {
    return {
      async recordCopperTransfer(input) {
        entries.push(input);
      }
    };
  }

  function serviceWithAssets(repo: InMemoryNpcRepository, ledger?: CopperLedgerWriter) {
    const assets = new FakeAssets(repo);
    const service = ledger
      ? new NpcService(repo, ledger, assets)
      : new NpcService(repo, undefined, assets);
    return { service, assets };
  }

  it("seeds persistent NPC actors, shared resources, and municipal treasury", async () => {
    const repo = new InMemoryNpcRepository();
    const service = new NpcService(repo);

    await service.ensureWorldSeeded(new Date("2026-07-01T00:00:00.000Z"));

    expect(repo.actors.map((actor) => actor.npcKey)).toEqual(FIRST_NPCS.map((npc) => npc.key));
    expect(repo.actors.every((actor) => actor.actorType === "npc")).toBe(true);
    expect(repo.resources.map((resource) => `${resource.zoneId}:${resource.resourceId}`)).toEqual(
      WORLD_ZONES.flatMap((zone) =>
        zone.resources.map((resource) => `${zone.id}:${resource.id}`)
      )
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
    expect(repo.resources).toHaveLength(
      WORLD_ZONES.reduce((sum, zone) => sum + zone.resources.length, 0)
    );
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

  it("returns NPCs with gathered inventory toward the village market before more work", async () => {
    const repo = new InMemoryNpcRepository();
    const service = new NpcService(repo);
    const now = new Date("2026-07-01T07:00:00.000Z");

    await service.ensureWorldSeeded(now);
    const farmer = repo.actors.find((actor) => actor.npcKey === "blackpine_farmer_mara")!;
    farmer.currentLocation = "corrupt_forest";
    farmer.position = { x: 1, y: 3 };
    await service.addNpcInventoryItem(farmer.id, "wild_berry", 2);

    await service.settleNpcWorld(now);

    expect(await repo.findActiveNpcAction(farmer.id)).toMatchObject({
      actionType: "travel",
      payload: {
        toLocation: "corrupt_forest",
        toPosition: { x: 2, y: 3 }
      }
    });

    await service.settleNpcWorld(new Date("2026-07-01T07:02:01.000Z"));
    await service.settleNpcWorld(new Date("2026-07-01T07:04:02.000Z"));
    await service.settleNpcWorld(new Date("2026-07-01T07:06:03.000Z"));
    await service.settleNpcWorld(new Date("2026-07-01T07:08:04.000Z"));
    await service.settleNpcWorld(new Date("2026-07-01T07:10:05.000Z"));

    expect(farmer.currentLocation).toBe("blackpine_outpost");
    expect(farmer.position).toBeNull();
  });

  it("pays wages from municipal treasury instead of minting coins", async () => {
    const repo = new InMemoryNpcRepository();
    const { service, assets } = serviceWithAssets(repo);
    const now = new Date("2026-07-01T06:00:00.000Z");

    await service.ensureWorldSeeded(now);
    const farmer = repo.actors.find((actor) => actor.npcKey === "blackpine_farmer_mara")!;
    const previousCopper = farmer.copperBalance;

    const payment = await service.payNpcWage(farmer.id, 25);

    expect(payment).toEqual({ paidCopper: 25, shortfallCopper: 0 });
    expect(farmer.copperBalance).toBe(previousCopper + 25);
    expect(repo.treasury?.copperBalance).toBe(9_975);
    expect(assets.assetCalls).toBe(2);
  });

  it("pays partial wages when the municipal treasury cannot cover the request", async () => {
    const repo = new InMemoryNpcRepository();
    const { service } = serviceWithAssets(repo);
    const now = new Date("2026-07-01T06:00:00.000Z");

    await service.ensureWorldSeeded(now);
    const farmer = repo.actors.find((actor) => actor.npcKey === "blackpine_farmer_mara")!;
    repo.treasury!.copperBalance = 10;
    const previousCopper = farmer.copperBalance;

    const payment = await service.payNpcWage(farmer.id, 25);

    expect(payment).toEqual({ paidCopper: 10, shortfallCopper: 15 });
    expect(farmer.copperBalance).toBe(previousCopper + 10);
    expect(repo.treasury?.copperBalance).toBe(0);
  });

  it("settles NPC hunger decay during world ticks", async () => {
    const repo = new InMemoryNpcRepository();
    const service = new NpcService(repo);
    const seededAt = new Date("2026-07-01T07:00:00.000Z");

    await service.ensureWorldSeeded(seededAt);
    const farmer = repo.actors.find((actor) => actor.npcKey === "blackpine_farmer_mara")!;

    await service.settleNpcWorld(new Date("2026-07-01T09:00:00.000Z"));

    expect(farmer.hunger).toBe(4);
    expect(farmer.lastHungerSettledAt.toISOString()).toBe("2026-07-01T09:00:00.000Z");
  });

  it("restores shared world resource charges from the world tick", async () => {
    const repo = new InMemoryNpcRepository();
    const service = new NpcService(repo);
    const seededAt = new Date("2026-07-01T00:00:00.000Z");
    const refreshedAt = new Date("2026-07-02T00:01:00.000Z");

    await service.ensureWorldSeeded(seededAt);
    const sharedNode = repo.resources.find(
      (resource) => resource.resourceId === "forest_berry_patch_01"
    )!;
    sharedNode.charges = 0;
    sharedNode.lastRefreshedAt = seededAt;

    await service.settleNpcWorld(refreshedAt);

    expect(sharedNode.charges).toBe(3);
    expect(sharedNode.lastRefreshedAt).toBe(refreshedAt);
    // Personal-instance charges are no longer refreshed by the npc world tick:
    // that write belongs to the character side (see GameRepository
    // refreshDueInstanceResources), triggered as a separate tick participant.
    expect(repo.mapInstances).toEqual([]);
  });

  it("pays scheduled NPC wages from the municipal treasury on the daily tick", async () => {
    const repo = new InMemoryNpcRepository();
    const { service, assets } = serviceWithAssets(repo);
    const tickAt = new Date("2026-07-01T00:00:00.000Z");

    await service.ensureWorldSeeded(tickAt);
    const farmer = repo.actors.find((actor) => actor.npcKey === "blackpine_farmer_mara")!;
    const miner = repo.actors.find((actor) => actor.npcKey === "blackpine_miner_torin")!;
    const blacksmith = repo.actors.find(
      (actor) => actor.npcKey === "blackpine_blacksmith_borin"
    )!;
    const officer = repo.actors.find(
      (actor) => actor.npcKey === "blackpine_officer_elian"
    )!;

    await service.settleNpcWorld(tickAt);

    expect(farmer.copperBalance).toBe(65);
    expect(miner.copperBalance).toBe(65);
    expect(blacksmith.copperBalance).toBe(155);
    expect(officer.copperBalance).toBe(120);
    expect(repo.treasury?.copperBalance).toBe(9_870);
    expect(assets.assetCalls).toBeGreaterThan(0);
  });

  it("sells gathered NPC inventory into the municipal market with an actor ledger", async () => {
    const repo = new InMemoryNpcRepository();
    const { service, assets } = serviceWithAssets(repo);
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
      { itemId: "wild_berry", quantity: 1 }
    ]);
    expect(repo.marketInventory.get("wild_berry")?.quantity).toBe(11);
    expect(farmer.copperBalance).toBe(5);
    expect(repo.treasury?.copperBalance).toBe(9_995);
    expect(assets.assetCalls).toBe(3);
    expect(repo.transactions).toEqual([
      expect.objectContaining({
        actorId: farmer.id,
        actorType: "npc",
        actorName: farmer.name,
        transactionType: "sell",
        itemId: "wild_berry",
        quantity: 1,
        unitPriceCopper: 6,
        grossCopper: 6,
        taxCopper: 1,
        netCopper: 5
      })
    ]);
  });

  it("leaves no NPC sell residue when the inventory conditional debit loses the race", async () => {
    const repo = new InMemoryNpcRepository();
    const now = new Date("2026-07-01T08:00:00.000Z");
    await new NpcService(repo).ensureWorldSeeded(now);
    repo.seedMarketItem({
      itemId: "wild_berry",
      quantity: 10,
      targetQuantity: 20,
      baseBuyPriceCopper: 3,
      baseSellPriceCopper: 5
    });
    const farmer = repo.actors.find((actor) => actor.npcKey === "blackpine_farmer_mara")!;
    farmer.copperBalance = 0;
    await new NpcService(repo).addNpcInventoryItem(farmer.id, "wild_berry", 2);
    repo.failNpcInventoryDebit = true;
    const ledgerEntries: unknown[] = [];

    await new NpcService(repo, recordingLedger(ledgerEntries), new FakeAssets(repo)).settleNpcWorld(now);

    expect(await repo.listNpcInventory(farmer.id)).toEqual([
      { itemId: "wild_berry", quantity: 2 }
    ]);
    expect(repo.marketInventory.get("wild_berry")?.quantity).toBe(10);
    expect(farmer.copperBalance).toBe(0);
    expect(repo.treasury?.copperBalance).toBe(10_000);
    expect(repo.transactions).toEqual([]);
    expect(ledgerEntries).toEqual([]);
  });

  it("restores the NPC item when the treasury conditional debit loses the sell race", async () => {
    const repo = new InMemoryNpcRepository();
    const now = new Date("2026-07-01T08:00:00.000Z");
    await new NpcService(repo).ensureWorldSeeded(now);
    repo.seedMarketItem({
      itemId: "wild_berry",
      quantity: 10,
      targetQuantity: 20,
      baseBuyPriceCopper: 3,
      baseSellPriceCopper: 5
    });
    const farmer = repo.actors.find((actor) => actor.npcKey === "blackpine_farmer_mara")!;
    farmer.copperBalance = 0;
    await new NpcService(repo).addNpcInventoryItem(farmer.id, "wild_berry", 2);
    repo.failTreasuryDebit = true;
    const ledgerEntries: unknown[] = [];

    await new NpcService(repo, recordingLedger(ledgerEntries), new FakeAssets(repo)).settleNpcWorld(now);

    expect(await repo.listNpcInventory(farmer.id)).toEqual([
      { itemId: "wild_berry", quantity: 2 }
    ]);
    expect(repo.marketInventory.get("wild_berry")?.quantity).toBe(10);
    expect(farmer.copperBalance).toBe(0);
    expect(repo.treasury?.copperBalance).toBe(10_000);
    expect(repo.transactions).toEqual([]);
    expect(ledgerEntries).toEqual([]);
  });

  it("reserves blacksmith iron ore and consumes it for daily forge upkeep", async () => {
    const repo = new InMemoryNpcRepository();
    const { service } = serviceWithAssets(repo);
    const tickAt = new Date("2026-07-01T00:00:00.000Z");

    await service.ensureWorldSeeded(tickAt);
    repo.seedMarketItem({
      itemId: "iron_ore",
      quantity: 10,
      targetQuantity: 20,
      baseBuyPriceCopper: 10,
      baseSellPriceCopper: 18
    });
    const blacksmith = repo.actors.find(
      (actor) => actor.npcKey === "blackpine_blacksmith_borin"
    )!;
    await service.addNpcInventoryItem(blacksmith.id, "iron_ore", 3);

    await service.settleNpcWorld(tickAt);

    expect(await repo.listNpcInventory(blacksmith.id)).toEqual([
      { itemId: "iron_ore", quantity: 2 }
    ]);
    expect(repo.marketInventory.get("iron_ore")?.quantity).toBe(10);
    expect(repo.transactions).not.toContainEqual(
      expect.objectContaining({ actorId: blacksmith.id, itemId: "iron_ore" })
    );
    expect(repo.events).toContainEqual(
      expect.objectContaining({
        actorId: blacksmith.id,
        message: "伯林消耗 1 份基础铁矿石修炉。"
      })
    );
  });

  it("lets hungry NPCs buy and eat market food before working", async () => {
    const repo = new InMemoryNpcRepository();
    const { service, assets } = serviceWithAssets(repo);
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
    expect(repo.treasury?.copperBalance).toBe(10_016);
    expect(repo.marketInventory.get("wild_berry")?.quantity).toBe(2);
    expect(assets.assetCalls).toBe(3);
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

  it("leaves no NPC buy residue when the market stock conditional debit loses the race", async () => {
    const repo = new InMemoryNpcRepository();
    const now = new Date("2026-07-01T08:00:00.000Z");
    await new NpcService(repo).ensureWorldSeeded(now);
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
    repo.failMarketDebit = true;
    const ledgerEntries: unknown[] = [];

    await new NpcService(repo, recordingLedger(ledgerEntries), new FakeAssets(repo)).settleNpcWorld(now);

    expect(miner.hunger).toBe(1);
    expect(miner.copperBalance).toBe(100);
    expect(repo.treasury?.copperBalance).toBe(10_000);
    expect(repo.marketInventory.get("wild_berry")?.quantity).toBe(3);
    expect(repo.transactions).toEqual([]);
    expect(ledgerEntries).toEqual([]);
  });

  it("restores market stock when the NPC copper conditional debit loses the buy race", async () => {
    const repo = new InMemoryNpcRepository();
    const now = new Date("2026-07-01T08:00:00.000Z");
    await new NpcService(repo).ensureWorldSeeded(now);
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
    repo.failNpcCopperDebit = true;
    const ledgerEntries: unknown[] = [];

    await new NpcService(repo, recordingLedger(ledgerEntries), new FakeAssets(repo)).settleNpcWorld(now);

    expect(miner.hunger).toBe(1);
    expect(miner.copperBalance).toBe(100);
    expect(repo.treasury?.copperBalance).toBe(10_000);
    expect(repo.marketInventory.get("wild_berry")?.quantity).toBe(3);
    expect(repo.transactions).toEqual([]);
    expect(ledgerEntries).toEqual([]);
  });

  it("keeps NPC market paths free of absolute shared-asset writes", () => {
    const source = readFileSync(new URL("./npc.service.ts", import.meta.url), "utf8");
    const needsPath = source.slice(
      source.indexOf("private async handleNpcNeeds"),
      source.indexOf("private async sellNpcSurplusToMarket")
    );
    const sellPath = source.slice(
      source.indexOf("private async sellNpcSurplusToMarket"),
      source.indexOf("private async returnNpcInventoryToMarket")
    );

    expect(needsPath).not.toContain("setMarketInventoryQuantity");
    expect(needsPath).not.toContain("updateMunicipalTreasury");
    expect(needsPath).not.toContain("repo.decrementMarketInventoryIfAvailable");
    expect(needsPath).not.toContain("repo.decrementNpcCopperIfAvailable");
    expect(needsPath).not.toContain("repo.incrementMarketInventory");
    expect(needsPath).not.toContain("repo.incrementMunicipalTreasury");
    expect(sellPath).not.toContain("setMarketInventoryQuantity");
    expect(sellPath).not.toContain("updateMunicipalTreasury");
    expect(sellPath).not.toContain("repo.decrementMunicipalTreasuryIfAvailable");
    expect(sellPath).not.toContain("repo.incrementMarketInventory");
    expect(sellPath).not.toContain("repo.incrementNpcCopper");
  });

  it("routes NPC copper, treasury, and market stock writes through AssetMutationPort", () => {
    const source = readFileSync(new URL("./npc.service.ts", import.meta.url), "utf8");
    const needsPath = source.slice(
      source.indexOf("private async handleNpcNeeds"),
      source.indexOf("private async sellNpcSurplusToMarket")
    );
    const sellPath = source.slice(
      source.indexOf("private async sellNpcSurplusToMarket"),
      source.indexOf("private async returnNpcInventoryToMarket")
    );
    const wagePath = source.slice(
      source.indexOf("async payNpcWage"),
      source.indexOf("async listNpcSummaries")
    );

    expect(needsPath).toContain("debitMarketStockIfAvailable");
    expect(needsPath).toContain("debitNpcCopperIfAvailable");
    expect(needsPath).toContain("creditMarketStock");
    expect(needsPath).toContain("creditTreasury");
    expect(sellPath).toContain("debitTreasuryIfAvailable");
    expect(sellPath).toContain("creditMarketStock");
    expect(sellPath).toContain("creditNpcCopper");
    expect(wagePath).toContain("debitTreasuryIfAvailable");
    expect(wagePath).toContain("creditNpcCopper");
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

  it("lists NPC summaries with wallet, inventory, action, and events", async () => {
    const repo = new InMemoryNpcRepository();
    const service = new NpcService(repo);
    const now = new Date("2026-07-01T09:00:00.000Z");

    await service.ensureWorldSeeded(now);
    const farmer = repo.actors.find((actor) => actor.npcKey === "blackpine_farmer_mara")!;
    farmer.currentLocation = "corrupt_forest";
    farmer.position = { x: 1, y: 3 };
    farmer.copperBalance = 125;
    await service.addNpcInventoryItem(farmer.id, "wild_berry", 2);
    await repo.createNpcAction({
      actorId: farmer.id,
      actionType: "gathering",
      startedAt: now,
      endsAt: new Date("2026-07-01T09:00:30.000Z"),
      payload: { resourceId: "forest_berry_patch_01" }
    });
    repo.events.push({
      id: "event-1",
      actorId: farmer.id,
      message: "玛拉开始采集野莓。",
      createdAt: now
    });

    await expect(service.listNpcSummaries(now)).resolves.toEqual([
      expect.objectContaining({
        id: farmer.id,
        actorType: "npc",
        npcKey: "blackpine_farmer_mara",
        name: "玛拉",
        currentLocation: "corrupt_forest",
        position: { x: 1, y: 3 },
        money: { gold: 0, silver: 1, copper: 25, totalCopper: 125 },
        currentAction: {
          actionType: "gathering",
          description: "正在采集"
        },
        inventory: [{ itemId: "wild_berry", name: "野莓", quantity: 2 }],
        recentEvents: [
          {
            id: "event-1",
            message: "玛拉开始采集野莓。",
            createdAt: "2026-07-01T09:00:00.000Z"
          }
        ]
      }),
      expect.any(Object),
      expect.any(Object),
      expect.any(Object)
    ]);
  });

  it("runs a bounded NPC simulation report against real settlement state", async () => {
    const repo = new InMemoryNpcRepository();
    const { service } = serviceWithAssets(repo);
    const startAt = new Date("2026-07-01T00:00:00.000Z");

    const report = await service.runNpcSimulationInPlace(1, startAt);

    expect(report).toMatchObject({
      startedAt: "2026-07-01T00:00:00.000Z",
      endedAt: "2026-07-02T00:00:00.000Z",
      days: 1,
      settlementId: "blackpine_outpost",
      npcCount: 4,
      health: { ok: true, issues: [] }
    });
    expect(report.actionCount).toBeGreaterThan(0);
    expect(report.metrics.completedActionCount).toBeGreaterThan(0);
    expect(report.metrics.starvingNpcCount).toBe(0);
    expect(report.metrics.idleRate).toBeGreaterThanOrEqual(0);
    expect(report.metrics.idleRate).toBeLessThanOrEqual(1);
    expect(report.metrics.resourceStartCharges).toBeGreaterThanOrEqual(0);
    expect(report.metrics.resourceEndCharges).toBeGreaterThanOrEqual(0);
    expect(report.metrics.hungerDistribution.fed).toBeGreaterThanOrEqual(0);
    expect(report.resourceSnapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          zoneId: "corrupt_forest",
          resourceId: "forest_berry_patch_01",
          name: "野莓灌木"
        })
      ])
    );
  });

  it("includes daily maintenance when a simulation starts between UTC hour boundaries", async () => {
    const repo = new InMemoryNpcRepository();
    const { service } = serviceWithAssets(repo);
    const startAt = new Date("2026-07-01T06:37:20.000Z");

    await service.ensureWorldSeeded(startAt);
    repo.seedMarketItem({
      itemId: "wild_berry",
      quantity: 50,
      targetQuantity: 100,
      baseBuyPriceCopper: 5,
      baseSellPriceCopper: 8
    });

    const report = await service.runNpcSimulationInPlace(1, startAt);

    expect(report.metrics.starvingNpcCount).toBe(0);
    expect(report.metrics.idleRate).toBeLessThan(0.3);
  });

  it("runs simulation reports without mutating the live NPC world", async () => {
    const repo = new InMemoryNpcRepository();
    const service = new NpcService(repo);
    const startAt = new Date("2026-07-01T00:00:00.000Z");

    await service.ensureWorldSeeded(startAt);
    repo.seedMarketItem({
      itemId: "wild_berry",
      quantity: 5,
      targetQuantity: 20,
      baseBuyPriceCopper: 3,
      baseSellPriceCopper: 5
    });
    const before = {
      actors: structuredClone(repo.actors),
      actions: structuredClone(repo.actions),
      resources: structuredClone(repo.resources),
      items: structuredClone([...repo.items.entries()]),
      treasury: structuredClone(repo.treasury),
      transactions: structuredClone(repo.transactions)
    };

    const report = await runNpcSimulationOnSnapshot(repo, 1, startAt);

    expect(report.days).toBe(1);
    expect(report.metrics.completedActionCount).toBeGreaterThan(0);
    expect(report.metrics.marketTransactionsPerDay).toBeGreaterThanOrEqual(0);
    expect(report.metrics.taskTriggerRate).toBeGreaterThan(0);
    expect(report.actionCount).toBeGreaterThan(0);
    expect(repo.actors).toEqual(before.actors);
    expect(repo.actions).toEqual(before.actions);
    expect(repo.resources).toEqual(before.resources);
    expect([...repo.items.entries()]).toEqual(before.items);
    expect(repo.treasury).toEqual(before.treasury);
    expect(repo.transactions).toEqual(before.transactions);
  });

  it("runs the v0.8.2 seven day economy regression without degrading world activity", async () => {
    const repo = new InMemoryNpcRepository();
    const service = new NpcService(repo);
    const startAt = new Date("2026-07-01T00:00:00.000Z");

    await service.ensureWorldSeeded(startAt);
    repo.seedMarketItem({
      itemId: "wild_berry",
      quantity: 160,
      targetQuantity: 100,
      baseBuyPriceCopper: 5,
      baseSellPriceCopper: 8
    });
    repo.seedMarketItem({
      itemId: "beast_meat",
      quantity: 90,
      targetQuantity: 60,
      baseBuyPriceCopper: 12,
      baseSellPriceCopper: 20
    });
    repo.seedMarketItem({
      itemId: "iron_ore",
      quantity: 20,
      targetQuantity: 80,
      baseBuyPriceCopper: 18,
      baseSellPriceCopper: 30
    });
    const blacksmith = repo.actors.find(
      (actor) => actor.npcKey === "blackpine_blacksmith_borin"
    )!;
    await service.addNpcInventoryItem(blacksmith.id, "iron_ore", 7);
    // Personal-instance refresh is no longer part of the npc simulation:
    // it runs as a character-side tick participant (ARCH-02 / DEBT-022).

    const report = await runNpcSimulationOnSnapshot(repo, 7, startAt);

    expect(report).toMatchObject({
      days: 7,
      health: { ok: true, issues: [] },
      npcCount: FIRST_NPCS.length
    });
    expect(report.actionCount).toBeGreaterThan(20);
    expect(report.marketTransactionCount).toBeGreaterThan(0);
    expect(report.metrics.completedActionCount).toBeGreaterThan(20);
    expect(report.metrics.starvingNpcCount).toBe(0);
    expect(report.metrics.minNpcHunger).toBeGreaterThan(0);
    expect(report.metrics.marketStockQuantity).toBeGreaterThan(0);
    expect(report.metrics.idleRate).toBeLessThan(0.3);
    expect(report.metrics.resourceStartCharges).toBeGreaterThan(0);
    expect(report.metrics.resourceEndCharges).toBeGreaterThanOrEqual(0);
    expect(report.metrics.marketTransactionsPerDay).toBeGreaterThan(0);
    expect(report.metrics.taskTriggerRate).toBeGreaterThan(0);
    expect(report.metrics.hungerDistribution.starving).toBe(0);
    expect(
      report.metrics.hungerDistribution.starving +
        report.metrics.hungerDistribution.hungry +
        report.metrics.hungerDistribution.fed
    ).toBe(FIRST_NPCS.length);
    expect(report.resourceSnapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          zoneId: OLD_MINE.id,
          resourceId: "old_mine_iron_vein_01",
          remainingCharges: 80
        })
      ])
    );
  });
});
