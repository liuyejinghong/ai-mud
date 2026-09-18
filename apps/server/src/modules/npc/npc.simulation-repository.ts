import type { NpcDefinition } from "@ai-mud/content";
import type { GameLocationId, GridPositionDto, ItemId, NpcSimulationReportDto } from "@ai-mud/shared";
import { NpcService } from "./npc.service.js";
import type {
  NpcActionRecord,
  NpcActorRecord,
  NpcEventRecord,
  NpcInventoryRecord,
  NpcMarketInventoryRecord,
  NpcRepositoryPort
} from "./npc.service.js";

const BLACKPINE_MARKET_ID = "blackpine_outpost" as const;

function cloneDate(date: Date) {
  return new Date(date.getTime());
}

function cloneAction(action: NpcActionRecord): NpcActionRecord {
  return {
    ...action,
    startedAt: cloneDate(action.startedAt),
    endsAt: cloneDate(action.endsAt),
    payload: structuredClone(action.payload)
  };
}

export class NpcSimulationRepository implements NpcRepositoryPort {
  private actors: NpcActorRecord[] = [];
  private resources: Awaited<ReturnType<NpcRepositoryPort["listWorldResourceNodes"]>> = [];
  private mapInstances: Awaited<ReturnType<NpcRepositoryPort["listMapInstances"]>> = [];
  private treasury: Awaited<ReturnType<NpcRepositoryPort["findMunicipalTreasury"]>> = null;
  private inventory = new Map<string, NpcInventoryRecord[]>();
  private actions: NpcActionRecord[] = [];
  private events = new Map<string, NpcEventRecord[]>();
  private marketInventory: NpcMarketInventoryRecord[] = [];
  private marketTransactionCount = 0;

  static async fromLive(repo: NpcRepositoryPort) {
    const simulation = new NpcSimulationRepository();
    simulation.actors = (await repo.listNpcActors()).map((actor) => ({
      ...actor,
      position: actor.position ? { ...actor.position } : null,
      lastHungerSettledAt: cloneDate(actor.lastHungerSettledAt)
    }));
    simulation.resources = (await repo.listWorldResourceNodes()).map((resource) => ({
      ...resource,
      position: { ...resource.position },
      lastRefreshedAt: cloneDate(resource.lastRefreshedAt)
    }));
    simulation.mapInstances = (await repo.listMapInstances()).map((map) => ({
      ...map,
      resourceCharges: { ...map.resourceCharges },
      resourcesRefreshedAt: cloneDate(map.resourcesRefreshedAt)
    }));
    const treasury = await repo.findMunicipalTreasury(BLACKPINE_MARKET_ID);
    simulation.treasury = treasury ? { ...treasury } : null;
    simulation.actions = (await repo.listNpcActions()).map(cloneAction);
    simulation.marketInventory = (await repo.listMarketInventory(BLACKPINE_MARKET_ID)).map(
      (item) => ({ ...item })
    );
    simulation.marketTransactionCount = await repo.countNpcMarketTransactions();

    for (const actor of simulation.actors) {
      simulation.inventory.set(
        actor.id,
        (await repo.listNpcInventory(actor.id)).map((item) => ({ ...item }))
      );
      simulation.events.set(
        actor.id,
        (await repo.listNpcEvents(actor.id, 20)).map((event) => ({
          ...event,
          createdAt: cloneDate(event.createdAt)
        }))
      );
    }

    return simulation;
  }

  async listNpcActors() {
    return this.actors;
  }

  async findNpcActorForUpdate(actorId: string) {
    return this.actors.find((actor) => actor.id === actorId) ?? null;
  }

  async createNpcActor(npc: NpcDefinition, now: Date) {
    const actor: NpcActorRecord = {
      id: `simulation-actor-${npc.key}`,
      actorType: "npc",
      npcKey: npc.key,
      name: npc.name,
      profession: npc.profession,
      currentLocation: npc.homeLocation,
      position: npc.homePosition ? { ...npc.homePosition } : null,
      copperBalance: npc.startingCopper,
      hunger: 5,
      lastHungerSettledAt: cloneDate(now),
      status: "active"
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
    position: GridPositionDto;
    charges: number;
    lastRefreshedAt?: Date;
  }) {
    this.resources.push({
      zoneId: input.zoneId,
      resourceId: input.resourceId,
      position: { ...input.position },
      charges: input.charges,
      lastRefreshedAt: input.lastRefreshedAt ? cloneDate(input.lastRefreshedAt) : new Date()
    });
  }

  async listMapInstances() {
    return this.mapInstances;
  }

  async findMunicipalTreasury(settlementId: typeof BLACKPINE_MARKET_ID) {
    return this.treasury?.settlementId === settlementId ? this.treasury : null;
  }

  async findMunicipalTreasuryForUpdate(settlementId: typeof BLACKPINE_MARKET_ID) {
    return this.findMunicipalTreasury(settlementId);
  }

  async createMunicipalTreasury(input: {
    settlementId: typeof BLACKPINE_MARKET_ID;
    copperBalance: number;
  }) {
    this.treasury = { ...input };
  }

  async listNpcInventory(actorId: string) {
    return this.inventory.get(actorId) ?? [];
  }

  async findNpcInventoryItemForUpdate(actorId: string, itemId: ItemId | string) {
    return (this.inventory.get(actorId) ?? []).find((item) => item.itemId === itemId) ?? null;
  }

  async setNpcInventoryItem(input: { actorId: string; itemId: ItemId | string; quantity: number }) {
    const rows = [...(this.inventory.get(input.actorId) ?? [])];
    const index = rows.findIndex((item) => item.itemId === input.itemId);
    if (index >= 0) {
      rows[index] = { itemId: input.itemId, quantity: input.quantity };
    } else {
      rows.push({ itemId: input.itemId, quantity: input.quantity });
    }
    this.inventory.set(input.actorId, rows);
  }

  async updateNpcActor(input: {
    actorId: string;
    currentLocation?: GameLocationId;
    position?: GridPositionDto | null;
    copperBalance?: number;
    hunger?: number;
    lastHungerSettledAt?: Date;
  }) {
    const actor = this.actors.find((entry) => entry.id === input.actorId);
    if (!actor) throw new Error("NPC actor not found");
    if (input.currentLocation !== undefined) actor.currentLocation = input.currentLocation;
    if ("position" in input) actor.position = input.position ?? null;
    if (input.copperBalance !== undefined) actor.copperBalance = input.copperBalance;
    if (input.hunger !== undefined) actor.hunger = input.hunger;
    if (input.lastHungerSettledAt) actor.lastHungerSettledAt = cloneDate(input.lastHungerSettledAt);
  }

  async decrementNpcCopperIfAvailable(input: { actorId: string; amount: number }) {
    const actor = this.actors.find((entry) => entry.id === input.actorId);
    if (!actor || actor.copperBalance < input.amount) return false;
    actor.copperBalance -= input.amount;
    return true;
  }

  async incrementNpcCopper(input: { actorId: string; delta: number }) {
    const actor = this.actors.find((entry) => entry.id === input.actorId);
    if (!actor) throw new Error("NPC actor not found");
    actor.copperBalance += input.delta;
  }

  async decrementNpcInventoryIfAvailable(input: {
    actorId: string;
    itemId: ItemId | string;
    quantity: number;
  }) {
    const item = (this.inventory.get(input.actorId) ?? []).find(
      (entry) => entry.itemId === input.itemId
    );
    if (!item || item.quantity < input.quantity) return false;
    item.quantity -= input.quantity;
    return true;
  }

  async incrementNpcInventory(input: {
    actorId: string;
    itemId: ItemId | string;
    quantity: number;
  }) {
    const item = (this.inventory.get(input.actorId) ?? []).find(
      (entry) => entry.itemId === input.itemId
    );
    if (!item) throw new Error("NPC inventory item not found");
    item.quantity += input.quantity;
  }

  async findActiveNpcAction(actorId: string) {
    return this.actions.find((action) => action.actorId === actorId && action.status === "active") ?? null;
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
    const action: NpcActionRecord = {
      id: `simulation-action-${this.actions.length + 1}`,
      status: "active",
      ...input,
      startedAt: cloneDate(input.startedAt),
      endsAt: cloneDate(input.endsAt),
      payload: structuredClone(input.payload)
    };
    this.actions.push(action);
    return action;
  }

  async markNpcActionCompleted(actionId: string) {
    const action = this.actions.find((entry) => entry.id === actionId);
    if (!action) throw new Error("NPC action not found");
    action.status = "completed";
  }

  async listNpcEvents(actorId: string, limit: number) {
    return (this.events.get(actorId) ?? []).slice(0, limit);
  }

  async createNpcEvent(input: {
    actorId: string;
    eventType: string;
    message: string;
    metadata: Record<string, unknown>;
    createdAt: Date;
  }) {
    const rows = this.events.get(input.actorId) ?? [];
    rows.unshift({
      id: `simulation-event-${rows.length + 1}`,
      actorId: input.actorId,
      message: input.message,
      createdAt: cloneDate(input.createdAt)
    });
    this.events.set(input.actorId, rows);
  }

  async updateWorldResourceNodeCharges(input: {
    resourceId: string;
    charges: number;
    lastRefreshedAt?: Date;
  }) {
    const resource = this.resources.find((entry) => entry.resourceId === input.resourceId);
    if (!resource) throw new Error("World resource node not found");
    resource.charges = input.charges;
    if (input.lastRefreshedAt) resource.lastRefreshedAt = cloneDate(input.lastRefreshedAt);
  }

  async updateMunicipalTreasury(input: {
    settlementId: typeof BLACKPINE_MARKET_ID;
    copperBalance: number;
  }) {
    this.treasury = { ...input };
  }

  async decrementMunicipalTreasuryIfAvailable(input: {
    settlementId: typeof BLACKPINE_MARKET_ID;
    amount: number;
  }) {
    if (!this.treasury || this.treasury.settlementId !== input.settlementId) return false;
    if (this.treasury.copperBalance < input.amount) return false;
    this.treasury.copperBalance -= input.amount;
    return true;
  }

  async incrementMunicipalTreasury(input: {
    settlementId: typeof BLACKPINE_MARKET_ID;
    delta: number;
  }) {
    if (!this.treasury || this.treasury.settlementId !== input.settlementId) {
      throw new Error("Municipal treasury not found");
    }
    this.treasury.copperBalance += input.delta;
  }

  async listMarketInventory(settlementId: typeof BLACKPINE_MARKET_ID) {
    return this.marketInventory.filter((item) => item.settlementId === settlementId);
  }

  async findMarketInventoryItemForUpdate(
    settlementId: typeof BLACKPINE_MARKET_ID,
    itemId: ItemId | string
  ) {
    return (
      this.marketInventory.find(
        (item) => item.settlementId === settlementId && item.itemId === itemId
      ) ?? null
    );
  }

  async setMarketInventoryQuantity(input: { marketInventoryId: string; quantity: number }) {
    const item = this.marketInventory.find((entry) => entry.id === input.marketInventoryId);
    if (!item) throw new Error("Market item not found");
    item.quantity = input.quantity;
  }

  async decrementMarketInventoryIfAvailable(input: {
    marketInventoryId: string;
    quantity: number;
  }) {
    const item = this.marketInventory.find((entry) => entry.id === input.marketInventoryId);
    if (!item || item.quantity < input.quantity) return false;
    item.quantity -= input.quantity;
    return true;
  }

  async incrementMarketInventory(input: { marketInventoryId: string; quantity: number }) {
    const item = this.marketInventory.find((entry) => entry.id === input.marketInventoryId);
    if (!item) throw new Error("Market item not found");
    item.quantity += input.quantity;
  }

  async createNpcMarketTransaction() {
    this.marketTransactionCount += 1;
  }

  async countNpcMarketTransactions() {
    return this.marketTransactionCount;
  }
}

// Simulation orchestration entry: clones the live world into an in-memory
// snapshot and runs the settlement loop there. Lives beside the snapshot
// repository so the production NpcService never imports simulation fixtures.
export async function runNpcSimulationOnSnapshot(
  liveRepo: NpcRepositoryPort,
  days: number,
  startAt: Date
): Promise<NpcSimulationReportDto> {
  const simulationRepo = await NpcSimulationRepository.fromLive(liveRepo);
  return new NpcService(simulationRepo).runNpcSimulationInPlace(days, startAt);
}
