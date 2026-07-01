import { CORRUPT_FOREST, FIRST_NPCS, type NpcDefinition } from "@ai-mud/content";
import type { GameLocationId, GridPositionDto, ItemId, NpcProfession } from "@ai-mud/shared";

const BLACKPINE_MARKET_ID = "blackpine_outpost" as const;
const INITIAL_TREASURY_COPPER = 10_000;

export interface NpcActorRecord {
  id: string;
  actorType: "npc";
  npcKey: string;
  name: string;
  profession: NpcProfession | string;
  currentLocation: GameLocationId;
  position: GridPositionDto | null;
  copperBalance: number;
  hunger: number;
  lastHungerSettledAt: Date;
  status: "active" | string;
}

export interface NpcInventoryRecord {
  itemId: ItemId | string;
  quantity: number;
}

export interface NpcRepositoryPort {
  listNpcActors(): Promise<NpcActorRecord[]>;
  createNpcActor(npc: NpcDefinition, now: Date): Promise<NpcActorRecord>;
  listWorldResourceNodes(): Promise<Array<{
    zoneId: typeof CORRUPT_FOREST.id;
    resourceId: string;
    position: GridPositionDto;
    charges: number;
  }>>;
  createWorldResourceNode(input: {
    zoneId: typeof CORRUPT_FOREST.id;
    resourceId: string;
    position: GridPositionDto;
    charges: number;
  }): Promise<void>;
  findMunicipalTreasury(settlementId: typeof BLACKPINE_MARKET_ID): Promise<{
    settlementId: typeof BLACKPINE_MARKET_ID;
    copperBalance: number;
  } | null>;
  createMunicipalTreasury(input: {
    settlementId: typeof BLACKPINE_MARKET_ID;
    copperBalance: number;
  }): Promise<void>;
  listNpcInventory(actorId: string): Promise<NpcInventoryRecord[]>;
  setNpcInventoryItem(input: {
    actorId: string;
    itemId: ItemId | string;
    quantity: number;
  }): Promise<void>;
}

export class NpcService {
  constructor(private readonly repo: NpcRepositoryPort) {}

  async ensureWorldSeeded(now: Date) {
    await this.ensureNpcActors(now);
    await this.ensureSharedResources();
    await this.ensureTreasury();
  }

  async addNpcInventoryItem(actorId: string, itemId: ItemId | string, quantityDelta: number) {
    const inventory = await this.repo.listNpcInventory(actorId);
    const existing = inventory.find((item) => item.itemId === itemId);
    const nextQuantity = (existing?.quantity ?? 0) + quantityDelta;

    if (nextQuantity < 0) {
      throw new Error("NPC inventory cannot go below zero");
    }

    await this.repo.setNpcInventoryItem({
      actorId,
      itemId,
      quantity: nextQuantity
    });
  }

  private async ensureNpcActors(now: Date) {
    const existing = await this.repo.listNpcActors();
    const existingKeys = new Set(existing.map((actor) => actor.npcKey));

    for (const npc of FIRST_NPCS) {
      if (existingKeys.has(npc.key)) continue;
      await this.repo.createNpcActor(npc, now);
    }
  }

  private async ensureSharedResources() {
    const existing = await this.repo.listWorldResourceNodes();
    const existingKeys = new Set(
      existing.map((resource) => `${resource.zoneId}:${resource.resourceId}`)
    );

    for (const resource of CORRUPT_FOREST.resources) {
      const key = `${CORRUPT_FOREST.id}:${resource.id}`;
      if (existingKeys.has(key)) continue;
      await this.repo.createWorldResourceNode({
        zoneId: CORRUPT_FOREST.id,
        resourceId: resource.id,
        position: resource.position,
        charges: resource.charges
      });
    }
  }

  private async ensureTreasury() {
    const treasury = await this.repo.findMunicipalTreasury(BLACKPINE_MARKET_ID);
    if (treasury) return;

    await this.repo.createMunicipalTreasury({
      settlementId: BLACKPINE_MARKET_ID,
      copperBalance: INITIAL_TREASURY_COPPER
    });
  }
}
