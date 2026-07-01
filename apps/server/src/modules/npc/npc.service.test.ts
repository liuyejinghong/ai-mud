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
});
