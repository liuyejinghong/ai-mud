import {
  CORRUPT_FOREST,
  FIRST_NPCS,
  FIRST_ITEMS,
  getNpcByKey,
  getResourceById,
  type NpcDefinition
} from "@ai-mud/content";
import {
  calculateNpcWagePayment,
  calculateMarketQuote,
  chooseNpcMealIntent,
  chooseNpcWorkIntent,
  nextNpcTravelStep
} from "@ai-mud/game-rules";
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

export interface NpcMarketInventoryRecord {
  id: string;
  settlementId: typeof BLACKPINE_MARKET_ID;
  itemId: ItemId | string;
  quantity: number;
  targetQuantity: number;
  baseBuyPriceCopper: number;
  baseSellPriceCopper: number;
}

export interface NpcActionRecord {
  id: string;
  actorId: string;
  actionType: string;
  status: "active" | "completed" | "cancelled";
  startedAt: Date;
  endsAt: Date;
  payload: Record<string, unknown>;
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
  updateNpcActor(input: {
    actorId: string;
    currentLocation?: GameLocationId;
    position?: GridPositionDto | null;
    copperBalance?: number;
    hunger?: number;
    lastHungerSettledAt?: Date;
  }): Promise<void>;
  findActiveNpcAction(actorId: string): Promise<NpcActionRecord | null>;
  createNpcAction(input: {
    actorId: string;
    actionType: string;
    startedAt: Date;
    endsAt: Date;
    payload: Record<string, unknown>;
  }): Promise<NpcActionRecord>;
  markNpcActionCompleted(actionId: string, completedAt?: Date): Promise<void>;
  updateWorldResourceNodeCharges(input: {
    resourceId: string;
    charges: number;
  }): Promise<void>;
  updateMunicipalTreasury(input: {
    settlementId: typeof BLACKPINE_MARKET_ID;
    copperBalance: number;
  }): Promise<void>;
  listMarketInventory(settlementId: typeof BLACKPINE_MARKET_ID): Promise<NpcMarketInventoryRecord[]>;
  setMarketInventoryQuantity(input: {
    marketInventoryId: string;
    quantity: number;
  }): Promise<void>;
  createNpcMarketTransaction(input: {
    actorId: string;
    actorType: "npc";
    actorName: string;
    transactionType: "buy" | "sell";
    itemId: ItemId | string;
    quantity: number;
    unitPriceCopper: number;
    grossCopper: number;
    taxCopper: number;
    netCopper: number;
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

  async settleNpcWorld(now: Date) {
    await this.ensureWorldSeeded(now);
    const actors = await this.repo.listNpcActors();

    for (const actor of actors) {
      const action = await this.repo.findActiveNpcAction(actor.id);
      if (action) {
        if (action.endsAt.getTime() <= now.getTime()) {
          await this.settleNpcAction(actor, action, now);
        }
        continue;
      }

      const handledNeeds = await this.handleNpcNeeds(actor);
      if (handledNeeds) continue;

      const soldInventory = await this.sellNpcSurplusToMarket(actor);
      if (soldInventory) continue;

      const returningToMarket = await this.returnNpcInventoryToMarket(actor, now);
      if (returningToMarket) continue;

      await this.createNextNpcAction(actor, now);
    }
  }

  async payNpcWage(actorId: string, requestedCopper: number) {
    const actors = await this.repo.listNpcActors();
    const actor = actors.find((entry) => entry.id === actorId);
    if (!actor) throw new Error("NPC actor not found");

    const treasury = await this.repo.findMunicipalTreasury(BLACKPINE_MARKET_ID);
    if (!treasury) throw new Error("Municipal treasury required");

    const payment = calculateNpcWagePayment({
      requestedCopper,
      treasuryCopper: treasury.copperBalance
    });

    await this.repo.updateMunicipalTreasury({
      settlementId: BLACKPINE_MARKET_ID,
      copperBalance: treasury.copperBalance - payment.paidCopper
    });
    await this.repo.updateNpcActor({
      actorId,
      copperBalance: actor.copperBalance + payment.paidCopper
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

  private async createNextNpcAction(actor: NpcActorRecord, now: Date) {
    const npc = getNpcByKey(actor.npcKey);
    if (!npc) return;

    const intent = chooseNpcWorkIntent({
      profession: npc.profession,
      workResourceId: npc.workResourceId,
      producesItemId: npc.producesItemId
    });
    if (intent.intent !== "gather") return;

    const resource = getResourceById(intent.resourceId);
    if (!resource) return;

    if (actor.currentLocation !== CORRUPT_FOREST.id || !actor.position) {
      await this.repo.createNpcAction({
        actorId: actor.id,
        actionType: "travel",
        startedAt: now,
        endsAt: new Date(now.getTime() + 2 * 60_000),
        payload: {
          toLocation: CORRUPT_FOREST.id,
          toPosition: CORRUPT_FOREST.entry
        }
      });
      return;
    }

    if (actor.position.x !== resource.position.x || actor.position.y !== resource.position.y) {
      await this.repo.createNpcAction({
        actorId: actor.id,
        actionType: "travel",
        startedAt: now,
        endsAt: new Date(now.getTime() + 2 * 60_000),
        payload: {
          toLocation: CORRUPT_FOREST.id,
          toPosition: nextNpcTravelStep({
            current: actor.position,
            target: resource.position
          })
        }
      });
      return;
    }

    await this.repo.createNpcAction({
      actorId: actor.id,
      actionType: "gathering",
      startedAt: now,
      endsAt: new Date(now.getTime() + resource.cycleSeconds * 1000),
      payload: {
        resourceId: resource.id,
        itemId: resource.gatherResult.itemId,
        quantity: resource.gatherResult.quantity
      }
    });
  }

  private async handleNpcNeeds(actor: NpcActorRecord) {
    const inventory = await this.repo.listNpcInventory(actor.id);
    const foodInventory = inventory.filter((item) => this.isFoodItem(item.itemId));
    const marketInventory = await this.repo.listMarketInventory(BLACKPINE_MARKET_ID);
    const marketFood = this.findAvailableMarketFood(marketInventory);
    const intent = chooseNpcMealIntent({
      hunger: actor.hunger,
      inventory: foodInventory.map((item) => ({
        itemId: item.itemId as ItemId,
        quantity: item.quantity
      })),
      marketFoodStock: marketFood?.quantity ?? 0
    });

    if (intent.intent === "none") return false;

    if (intent.intent === "eat_food") {
      const item = FIRST_ITEMS.find((entry) => entry.id === intent.itemId);
      await this.addNpcInventoryItem(actor.id, intent.itemId, -1);
      await this.repo.updateNpcActor({
        actorId: actor.id,
        hunger: Math.min(5, actor.hunger + (item?.satietyRestore ?? 1))
      });
      return true;
    }

    if (intent.intent === "buy_food" && marketFood) {
      const quote = calculateMarketQuote({
        direction: "buy",
        basePriceCopper: marketFood.baseSellPriceCopper,
        stockQuantity: marketFood.quantity,
        targetQuantity: marketFood.targetQuantity,
        quantity: 1
      });
      if (actor.copperBalance < quote.totalCopper) return true;

      const item = FIRST_ITEMS.find((entry) => entry.id === marketFood.itemId);
      await this.repo.updateNpcActor({
        actorId: actor.id,
        copperBalance: actor.copperBalance - quote.totalCopper,
        hunger: Math.min(5, actor.hunger + (item?.satietyRestore ?? 1))
      });
      await this.repo.setMarketInventoryQuantity({
        marketInventoryId: marketFood.id,
        quantity: marketFood.quantity - 1
      });
      await this.repo.createNpcMarketTransaction({
        actorId: actor.id,
        actorType: "npc",
        actorName: actor.name,
        transactionType: "buy",
        itemId: marketFood.itemId,
        quantity: 1,
        unitPriceCopper: quote.unitPriceCopper,
        grossCopper: quote.grossCopper,
        taxCopper: quote.taxCopper,
        netCopper: quote.totalCopper
      });
      return true;
    }

    return true;
  }

  private async sellNpcSurplusToMarket(actor: NpcActorRecord) {
    if (actor.currentLocation !== BLACKPINE_MARKET_ID) return false;

    const inventory = await this.repo.listNpcInventory(actor.id);
    const item = inventory.find((entry) => entry.quantity > 0);
    if (!item) return false;

    const marketInventory = await this.repo.listMarketInventory(BLACKPINE_MARKET_ID);
    const marketItem = marketInventory.find((entry) => entry.itemId === item.itemId);
    if (!marketItem) return false;

    const quote = calculateMarketQuote({
      direction: "sell",
      basePriceCopper: marketItem.baseBuyPriceCopper,
      stockQuantity: marketItem.quantity,
      targetQuantity: marketItem.targetQuantity,
      quantity: item.quantity
    });

    await this.addNpcInventoryItem(actor.id, item.itemId, -item.quantity);
    await this.repo.updateNpcActor({
      actorId: actor.id,
      copperBalance: actor.copperBalance + quote.totalCopper
    });
    await this.repo.setMarketInventoryQuantity({
      marketInventoryId: marketItem.id,
      quantity: marketItem.quantity + item.quantity
    });
    await this.repo.createNpcMarketTransaction({
      actorId: actor.id,
      actorType: "npc",
      actorName: actor.name,
      transactionType: "sell",
      itemId: item.itemId,
      quantity: item.quantity,
      unitPriceCopper: quote.unitPriceCopper,
      grossCopper: quote.grossCopper,
      taxCopper: quote.taxCopper,
      netCopper: quote.totalCopper
    });
    return true;
  }

  private async returnNpcInventoryToMarket(actor: NpcActorRecord, now: Date) {
    if (actor.currentLocation === BLACKPINE_MARKET_ID) return false;

    const inventory = await this.repo.listNpcInventory(actor.id);
    if (!inventory.some((item) => item.quantity > 0)) return false;

    if (!actor.position) {
      await this.repo.createNpcAction({
        actorId: actor.id,
        actionType: "travel",
        startedAt: now,
        endsAt: new Date(now.getTime() + 2 * 60_000),
        payload: {
          toLocation: BLACKPINE_MARKET_ID,
          toPosition: null
        }
      });
      return true;
    }

    const atForestExit =
      actor.position.x === CORRUPT_FOREST.entry.x && actor.position.y === CORRUPT_FOREST.entry.y;
    await this.repo.createNpcAction({
      actorId: actor.id,
      actionType: "travel",
      startedAt: now,
      endsAt: new Date(now.getTime() + 2 * 60_000),
      payload: atForestExit
        ? {
            toLocation: BLACKPINE_MARKET_ID,
            toPosition: null
          }
        : {
            toLocation: CORRUPT_FOREST.id,
            toPosition: nextNpcTravelStep({
              current: actor.position,
              target: CORRUPT_FOREST.entry
            })
          }
    });
    return true;
  }

  private isFoodItem(itemId: ItemId | string) {
    return FIRST_ITEMS.some((item) => item.id === itemId && item.category === "food");
  }

  private findAvailableMarketFood(marketInventory: NpcMarketInventoryRecord[]) {
    return marketInventory
      .filter((item) => item.quantity > 0 && this.isFoodItem(item.itemId))
      .sort((left, right) => {
        const leftItem = FIRST_ITEMS.find((item) => item.id === left.itemId);
        const rightItem = FIRST_ITEMS.find((item) => item.id === right.itemId);
        return (leftItem?.itemLevel ?? 99) - (rightItem?.itemLevel ?? 99);
      })[0] ?? null;
  }

  private async settleNpcAction(actor: NpcActorRecord, action: NpcActionRecord, now: Date) {
    if (action.actionType === "travel") {
      const toLocation = action.payload.toLocation;
      const toPosition = action.payload.toPosition;
      await this.repo.updateNpcActor({
        actorId: actor.id,
        currentLocation: toLocation === "corrupt_forest" ? "corrupt_forest" : "blackpine_outpost",
        position:
          typeof toPosition === "object" && toPosition !== null
            ? (toPosition as GridPositionDto)
            : null
      });
      await this.repo.markNpcActionCompleted(action.id, now);
      return;
    }

    if (action.actionType === "gathering") {
      const resourceId = String(action.payload.resourceId);
      const itemId = String(action.payload.itemId) as ItemId;
      const quantity = Math.max(1, Number(action.payload.quantity ?? 1));
      const resourceNodes = await this.repo.listWorldResourceNodes();
      const resourceNode = resourceNodes.find((resource) => resource.resourceId === resourceId);
      if (!resourceNode || resourceNode.charges <= 0) {
        await this.repo.markNpcActionCompleted(action.id, now);
        return;
      }

      await this.addNpcInventoryItem(actor.id, itemId, quantity);
      await this.repo.updateWorldResourceNodeCharges({
        resourceId,
        charges: resourceNode.charges - 1
      });
      await this.repo.markNpcActionCompleted(action.id, now);
    }
  }
}
