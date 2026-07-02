import {
  BLACKPINE_OUTPOST,
  CORRUPT_FOREST,
  FIRST_ITEMS,
  getEncounterById,
  getItemById,
  getMonsterById
} from "@ai-mud/content";
import {
  addInventoryItem,
  applyCombatDurabilityLoss,
  buildMapCells,
  calculateDurabilityPct,
  calculateEffectiveStatRatio,
  calculateEquipmentRepairQuote,
  calculateHungerCombatMultiplier,
  calculateHungerStatus,
  calculateMarketQuote,
  calculateNextMealAt,
  calculateRepairQuote,
  calculateGatheringPlan,
  calculateGatheringSettlement,
  formatMoney,
  movePosition,
  settleHunger,
  simulateCombat
} from "@ai-mud/game-rules";
import {
  CHARACTER_CLASSES,
  type CharacterClassId,
  type CharacterDto,
  type CreateCharacterRequestDto,
  type CurrentActionDto,
  type Direction,
  type EatFoodRequestDto,
  type EquipmentItemDto,
  type RepairEquipmentRequestDto,
  type GameStateDto,
  type GridPositionDto,
  type InventoryItemDto,
  type MarketDto,
  type MarketTradeRequestDto,
  type NeedsDto,
  type RepairQuoteDto,
  type StartGatheringRequestDto
} from "@ai-mud/shared";
import type { Db } from "../../db/client.js";
import {
  GameRepository,
  type CharacterActionRecord,
  type CharacterRecord,
  type CombatActionPayload,
  type EquipmentRecord,
  type GatheringActionPayload
} from "./game.repository.js";

const BLACKPINE_MARKET_ID = "blackpine_outpost";
const STARTER_EQUIPMENT: Array<{
  slot: "weapon" | "chest";
  itemKey: string;
  name: string;
  itemLevel: number;
  attackBonus: number;
  defenseBonus: number;
  maxDurability: number;
  currentDurability: number;
}> = [
  {
    slot: "weapon",
    itemKey: "training_sword",
    name: "训练短剑",
    itemLevel: 5,
    attackBonus: 2,
    defenseBonus: 0,
    maxDurability: 100,
    currentDurability: 100
  },
  {
    slot: "chest",
    itemKey: "patched_leather_vest",
    name: "缝补皮甲",
    itemLevel: 5,
    attackBonus: 0,
    defenseBonus: 2,
    maxDurability: 100,
    currentDurability: 100
  }
];

export class GameServiceError extends Error {
  constructor(
    readonly code: "VALIDATION_ERROR",
    message: string
  ) {
    super(message);
  }
}

function classMaxHp(classId: CharacterClassId) {
  const characterClass = CHARACTER_CLASSES.find((entry) => entry.id === classId);
  if (!characterClass) throw new GameServiceError("VALIDATION_ERROR", "Unknown class");
  return characterClass.baseStats.vitality * 10;
}

function classAttack(classId: CharacterClassId) {
  const characterClass = CHARACTER_CLASSES.find((entry) => entry.id === classId);
  if (!characterClass) throw new GameServiceError("VALIDATION_ERROR", "Unknown class");
  return characterClass.baseStats.strength + Math.floor(characterClass.baseStats.agility / 2);
}

function classDefense(classId: CharacterClassId) {
  const characterClass = CHARACTER_CLASSES.find((entry) => entry.id === classId);
  if (!characterClass) throw new GameServiceError("VALIDATION_ERROR", "Unknown class");
  return Math.floor(characterClass.baseStats.vitality / 2) + 2;
}

function classAgility(classId: CharacterClassId) {
  const characterClass = CHARACTER_CLASSES.find((entry) => entry.id === classId);
  if (!characterClass) throw new GameServiceError("VALIDATION_ERROR", "Unknown class");
  return characterClass.baseStats.agility;
}

function initialResourceCharges() {
  return Object.fromEntries(
    CORRUPT_FOREST.resources.map((resource) => [resource.id, resource.charges])
  );
}

function findLiveResourceAt(position: GridPositionDto, resourceCharges: Record<string, number>) {
  return (
    CORRUPT_FOREST.resources.find(
      (resource) =>
        resource.position.x === position.x &&
        resource.position.y === position.y &&
        (resourceCharges[resource.id] ?? resource.charges) > 0
    ) ?? null
  );
}

function findEncounterAt(position: GridPositionDto) {
  return (
    CORRUPT_FOREST.encounters.find(
      (encounter) => encounter.position.x === position.x && encounter.position.y === position.y
    ) ?? null
  );
}

function directionLabel(direction: Direction) {
  return {
    north: "北",
    south: "南",
    west: "西",
    east: "东"
  }[direction];
}

function progressPct(startedAt: Date, endsAt: Date, now: Date) {
  const totalMs = Math.max(1, endsAt.getTime() - startedAt.getTime());
  const elapsedMs = Math.max(0, now.getTime() - startedAt.getTime());
  return Math.min(100, Math.round((elapsedMs / totalMs) * 100));
}

function toNeedsDto(character: CharacterRecord, now: Date): NeedsDto {
  return {
    hunger: {
      current: character.hunger,
      max: 5,
      status: calculateHungerStatus(character.hunger),
      nextMealAt: calculateNextMealAt(now).toISOString()
    }
  };
}

function toCharacterDto(character: CharacterRecord, now: Date): CharacterDto {
  return {
    id: character.id,
    name: character.name,
    classId: character.classId,
    level: character.level,
    xp: character.xp,
    hp: character.hp,
    maxHp: character.maxHp,
    currentLocation: character.currentLocation,
    position: character.position,
    injuryUntil: character.injuryUntil?.toISOString() ?? null,
    money: formatMoney(character.copperBalance),
    needs: toNeedsDto(character, now)
  };
}

function toInventoryDto(items: Array<{ itemId: InventoryItemDto["itemId"]; quantity: number }>) {
  return items.map((item) => ({
    itemId: item.itemId,
    name: getItemById(item.itemId)?.name ?? item.itemId,
    quantity: item.quantity
  }));
}

function toEquipmentDto(equipment: EquipmentRecord): EquipmentItemDto {
  const quote = calculateEquipmentRepairQuote(equipment);
  return {
    id: equipment.id,
    slot: equipment.slot,
    itemKey: equipment.itemKey,
    name: equipment.name,
    itemLevel: equipment.itemLevel,
    attackBonus: equipment.attackBonus,
    defenseBonus: equipment.defenseBonus,
    maxDurability: equipment.maxDurability,
    currentDurability: equipment.currentDurability,
    durabilityPct: calculateDurabilityPct(equipment),
    effectiveStatRatio: calculateEffectiveStatRatio(equipment),
    repairQuote: quote
      ? { copperCost: formatMoney(quote.copperCost), ironOreCost: quote.ironOreCost }
      : null
  };
}

function equipmentAttackBonus(equipment: EquipmentRecord[]) {
  return equipment.reduce(
    (sum, item) => sum + Math.floor(item.attackBonus * calculateEffectiveStatRatio(item)),
    0
  );
}

function equipmentDefenseBonus(equipment: EquipmentRecord[]) {
  return equipment.reduce(
    (sum, item) => sum + Math.floor(item.defenseBonus * calculateEffectiveStatRatio(item)),
    0
  );
}

export class GameService {
  constructor(private readonly db: Db) {}

  async getState(accountId: string): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const now = new Date();
      await this.settleDueAction(repo, accountId, now);
      await this.healExpiredInjury(repo, accountId, now);
      const character = await repo.findCharacterByAccountId(accountId);
      if (character) await this.settleHungerForCharacter(repo, character, now);
      return this.buildState(repo, accountId, now);
    });
  }

  async createCharacter(
    accountId: string,
    input: CreateCharacterRequestDto
  ): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const existing = await repo.findCharacterByAccountId(accountId);
      if (existing) {
        throw new GameServiceError("VALIDATION_ERROR", "Character already exists");
      }

      const maxHp = classMaxHp(input.classId);
      const character = await repo.createCharacter({
        accountId,
        name: input.name.trim(),
        classId: input.classId,
        hp: maxHp,
        maxHp
      });
      for (const item of STARTER_EQUIPMENT) {
        await repo.createEquipment({ characterId: character.id, ...item });
      }
      await repo.writeEvent({
        characterId: character.id,
        eventType: "character.create",
        message: `${character.name} 抵达黑松哨站。`
      });

      return this.buildState(repo, accountId, new Date());
    });
  }

  async enterCorruptForest(accountId: string): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const now = new Date();
      const character = await this.requireSettledCharacter(repo, accountId, now);
      await this.requireNoActiveAction(repo, character.id);
      this.requireCanLeaveVillage(character);
      const existingMap = await repo.findMapInstance(character.id, CORRUPT_FOREST.id);

      if (!existingMap) {
        await repo.createMapInstance({
          characterId: character.id,
          zoneId: CORRUPT_FOREST.id,
          resourceCharges: initialResourceCharges()
        });
      }

      await repo.updateCharacterLocation({
        characterId: character.id,
        currentLocation: CORRUPT_FOREST.id,
        position: CORRUPT_FOREST.entry
      });
      await repo.writeEvent({
        characterId: character.id,
        eventType: "zone.enter",
        message: "你穿过南侧木门，踏入腐林。"
      });

      return this.buildState(repo, accountId, now);
    });
  }

  async move(accountId: string, direction: Direction): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const character = await this.requireReadyCharacterInForest(repo, accountId, new Date());
      await this.requireNoActiveAction(repo, character.id);
      const result = movePosition(CORRUPT_FOREST, character.position, direction);

      if (!result.ok) {
        throw new GameServiceError("VALIDATION_ERROR", "边界被倒伏的黑木挡住。");
      }

      await repo.updateCharacterLocation({
        characterId: character.id,
        currentLocation: CORRUPT_FOREST.id,
        position: result.position
      });
      await repo.writeEvent({
        characterId: character.id,
        eventType: "character.move",
        message: `你向${directionLabel(direction)}移动，树影遮住了回路。`,
        metadata: { direction, position: result.position }
      });

      return this.buildState(repo, accountId, new Date());
    });
  }

  async startGathering(
    accountId: string,
    input: StartGatheringRequestDto
  ): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const now = new Date();
      const character = await this.requireReadyCharacterInForest(repo, accountId, now);
      await this.requireNoActiveAction(repo, character.id);
      const map = await this.requireCorruptForestMap(repo, character);
      const resource = findLiveResourceAt(character.position, map.resourceCharges);

      if (!resource) {
        throw new GameServiceError("VALIDATION_ERROR", "这里没有可采集的资源。");
      }

      const plan = calculateGatheringPlan({
        baseCycleSeconds: resource.cycleSeconds,
        classId: character.classId,
        agility: classAgility(character.classId),
        plannedMinutes: input.plannedMinutes,
        remainingCharges: map.resourceCharges[resource.id] ?? resource.charges
      });
      const item = getItemById(resource.gatherResult.itemId);

      await repo.createAction({
        characterId: character.id,
        actionType: "gathering",
        startedAt: now,
        endsAt: new Date(now.getTime() + plan.cycleMs * plan.plannedCycles),
        payload: {
          resourceId: resource.id,
          itemId: resource.gatherResult.itemId,
          itemName: item?.name ?? resource.gatherResult.itemId,
          quantityPerCycle: resource.gatherResult.quantity,
          cycleMs: plan.cycleMs,
          plannedCycles: plan.plannedCycles,
          settledCycles: 0
        }
      });
      await repo.writeEvent({
        characterId: character.id,
        eventType: "action.gathering.start",
        message: `你开始采集${resource.name}。`
      });

      return this.buildState(repo, accountId, now);
    });
  }

  async startCombat(accountId: string): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const now = new Date();
      const character = await this.requireReadyCharacterInForest(repo, accountId, now);
      await this.requireNoActiveAction(repo, character.id);
      const encounter = findEncounterAt(character.position);

      if (!encounter) {
        throw new GameServiceError("VALIDATION_ERROR", "这里没有可攻击的敌人。");
      }

      const monsters = encounter.monsterIds.map((monsterId) => getMonsterById(monsterId));
      if (monsters.some((monster) => !monster)) {
        throw new GameServiceError("VALIDATION_ERROR", "遭遇配置无效。");
      }

      const result = simulateCombat({
        seed: `${character.id}:${encounter.id}:${now.toISOString()}`,
        player: {
          name: character.name,
          hp: character.hp,
          maxHp: character.maxHp,
          attack:
            Math.floor(
              (classAttack(character.classId) +
                equipmentAttackBonus(await repo.listEquipment(character.id))) *
                calculateHungerCombatMultiplier(character.hunger)
            ),
          defense:
            Math.floor(
              (classDefense(character.classId) +
                equipmentDefenseBonus(await repo.listEquipment(character.id))) *
                calculateHungerCombatMultiplier(character.hunger)
            ),
          agility: classAgility(character.classId)
        },
        monsters: monsters.map((monster) => monster!)
      });

      if (result.outcome === "stalemate") {
        throw new GameServiceError("VALIDATION_ERROR", "这场战斗短时间内无法结束。");
      }

      await repo.createAction({
        characterId: character.id,
        actionType: "combat",
        startedAt: now,
        endsAt: new Date(now.getTime() + result.durationMs),
        payload: {
          encounterId: encounter.id,
          combatLog: result.timeline.map((entry) => entry.message),
          expectedEndsAtMs: now.getTime() + result.durationMs,
          outcome: result.outcome,
          playerRemainingHp: result.playerRemainingHp,
          xp: result.xp,
          loot: result.loot
        }
      });
      await repo.writeEvent({
        characterId: character.id,
        eventType: "action.combat.start",
        message: `你开始与${encounter.name}战斗。`
      });

      return this.buildState(repo, accountId, now);
    });
  }

  async cancelAction(accountId: string): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const now = new Date();
      const character = await this.requireSettledCharacter(repo, accountId, now);
      const action = await repo.findActiveActionByCharacterId(character.id);
      if (!action) {
        throw new GameServiceError("VALIDATION_ERROR", "当前没有进行中的行动。");
      }

      if (action.actionType === "gathering") {
        await this.settleGatheringAction(repo, action, now, { completeAction: false });
        await repo.writeEvent({
          characterId: character.id,
          eventType: "action.gathering.cancel",
          message: "你停止采集，带走了已经完成周期的收获。"
        });
      } else {
        await repo.writeEvent({
          characterId: character.id,
          eventType: "action.combat.escape",
          message: "你撤离了战斗，敌人没有离开原地追击。"
        });
      }

      await repo.markActionCancelled(action.id, now);
      return this.buildState(repo, accountId, now);
    });
  }

  async returnToVillage(accountId: string): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const character = await this.requireSettledCharacter(repo, accountId, new Date());
      await this.requireNoActiveAction(repo, character.id);

      await repo.updateCharacterLocation({
        characterId: character.id,
        currentLocation: BLACKPINE_OUTPOST.id,
        position: null
      });
      await repo.writeEvent({
        characterId: character.id,
        eventType: "zone.return",
        message: "你返回黑松哨站。"
      });

      return this.buildState(repo, accountId, new Date());
    });
  }

  async gather(accountId: string): Promise<GameStateDto> {
    return this.startGathering(accountId, { plannedMinutes: 10 });
  }

  async getMarket(accountId: string): Promise<MarketDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const character = await this.requireSettledCharacter(repo, accountId, new Date());
      return this.buildMarketDto(repo, character);
    });
  }

  async buyMarketItem(
    accountId: string,
    input: MarketTradeRequestDto
  ): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const character = await this.requireSettledCharacter(repo, accountId, new Date());
      const quantity = this.requireTradeQuantity(input.quantity);
      const market = await this.requireMarketInventoryItem(repo, input.itemId);
      const item = getItemById(input.itemId);
      if (!item) throw new GameServiceError("VALIDATION_ERROR", "Unknown item");
      if (market.quantity < quantity) {
        throw new GameServiceError("VALIDATION_ERROR", "市政集市库存不足。");
      }

      const quote = calculateMarketQuote({
        direction: "buy",
        basePriceCopper: market.baseSellPriceCopper,
        stockQuantity: market.quantity,
        targetQuantity: market.targetQuantity,
        quantity
      });
      if (character.copperBalance < quote.totalCopper) {
        throw new GameServiceError("VALIDATION_ERROR", "铜币不足。");
      }

      const inventory = await repo.listInventory(character.id);
      const nextInventory = addInventoryItem(inventory, input.itemId, quantity);
      const changedStack = nextInventory.find((entry) => entry.itemId === input.itemId);
      if (!changedStack) throw new Error("Failed to calculate purchased inventory stack");

      await repo.updateCharacterCopper({
        characterId: character.id,
        copperBalance: character.copperBalance - quote.totalCopper
      });
      await repo.setInventoryItem({
        characterId: character.id,
        itemId: input.itemId,
        quantity: changedStack.quantity
      });
      await repo.setMarketInventoryQuantity({
        marketInventoryId: market.id,
        quantity: market.quantity - quantity
      });
      await repo.createMarketTransaction({
        settlementId: BLACKPINE_MARKET_ID,
        characterId: character.id,
        actorType: "player",
        actorId: character.id,
        actorName: character.name,
        transactionType: "buy",
        itemId: input.itemId,
        quantity,
        unitPriceCopper: quote.unitPriceCopper,
        grossCopper: quote.grossCopper,
        taxCopper: quote.taxCopper,
        netCopper: quote.totalCopper
      });
      await repo.writeEvent({
        characterId: character.id,
        eventType: "market.buy",
        message: `你在市政集市购买了${item.name} x${quantity}。`
      });

      return this.buildState(repo, accountId, new Date());
    });
  }

  async sellMarketItem(
    accountId: string,
    input: MarketTradeRequestDto
  ): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const character = await this.requireSettledCharacter(repo, accountId, new Date());
      const quantity = this.requireTradeQuantity(input.quantity);
      const market = await this.requireMarketInventoryItem(repo, input.itemId);
      const item = getItemById(input.itemId);
      if (!item) throw new GameServiceError("VALIDATION_ERROR", "Unknown item");

      const inventory = await repo.listInventory(character.id);
      const existingStack = inventory.find((entry) => entry.itemId === input.itemId);
      if (!existingStack || existingStack.quantity < quantity) {
        throw new GameServiceError("VALIDATION_ERROR", "背包物品不足。");
      }

      const quote = calculateMarketQuote({
        direction: "sell",
        basePriceCopper: market.baseBuyPriceCopper,
        stockQuantity: market.quantity,
        targetQuantity: market.targetQuantity,
        quantity
      });

      await repo.updateCharacterCopper({
        characterId: character.id,
        copperBalance: character.copperBalance + quote.totalCopper
      });
      await repo.decrementInventoryItem({
        characterId: character.id,
        itemId: input.itemId,
        quantity
      });
      await repo.setMarketInventoryQuantity({
        marketInventoryId: market.id,
        quantity: market.quantity + quantity
      });
      await repo.createMarketTransaction({
        settlementId: BLACKPINE_MARKET_ID,
        characterId: character.id,
        actorType: "player",
        actorId: character.id,
        actorName: character.name,
        transactionType: "sell",
        itemId: input.itemId,
        quantity,
        unitPriceCopper: quote.unitPriceCopper,
        grossCopper: quote.grossCopper,
        taxCopper: quote.taxCopper,
        netCopper: quote.totalCopper
      });
      await repo.writeEvent({
        characterId: character.id,
        eventType: "market.sell",
        message: `你向市政集市出售了${item.name} x${quantity}。`
      });

      return this.buildState(repo, accountId, new Date());
    });
  }

  async getRepairQuote(
    accountId: string,
    input: RepairEquipmentRequestDto
  ): Promise<RepairQuoteDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const character = await this.requireRepairContext(repo, accountId);
      const equipment = await this.requireEquipment(repo, character.id, input.equipmentId);
      const quote = calculateEquipmentRepairQuote(equipment);
      if (!quote) {
        throw new GameServiceError("VALIDATION_ERROR", "装备不需要修理。");
      }
      return {
        copperCost: formatMoney(quote.copperCost),
        ironOreCost: quote.ironOreCost
      };
    });
  }

  async repairEquipment(
    accountId: string,
    input: RepairEquipmentRequestDto
  ): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const character = await this.requireRepairContext(repo, accountId);
      const equipment = await this.requireEquipment(repo, character.id, input.equipmentId);
      await this.repairEquipmentRecords(repo, character, [equipment]);
      return this.buildState(repo, accountId, new Date());
    });
  }

  async repairAllEquipment(accountId: string): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const character = await this.requireRepairContext(repo, accountId);
      const equipment = await repo.listEquipment(character.id);
      await this.repairEquipmentRecords(
        repo,
        character,
        equipment.filter((item) => calculateEquipmentRepairQuote(item) !== null)
      );
      return this.buildState(repo, accountId, new Date());
    });
  }

  async eatFood(accountId: string, input: EatFoodRequestDto): Promise<GameStateDto> {
    return this.db.transaction(async (tx) => {
      const repo = new GameRepository(tx);
      const now = new Date();
      const character = await this.requireSettledCharacter(repo, accountId, now);
      await this.requireNoActiveAction(repo, character.id);

      if (character.hunger >= 5) {
        throw new GameServiceError("VALIDATION_ERROR", "你现在不饿。");
      }

      const item = getItemById(input.itemId);
      if (!item || item.category !== "food" || !item.satietyRestore) {
        throw new GameServiceError("VALIDATION_ERROR", "这个物品不能食用。");
      }

      const inventory = await repo.listInventory(character.id);
      const stack = inventory.find((entry) => entry.itemId === input.itemId);
      if (!stack || stack.quantity < 1) {
        throw new GameServiceError("VALIDATION_ERROR", "背包里没有这种食物。");
      }

      await repo.decrementInventoryItem({
        characterId: character.id,
        itemId: input.itemId,
        quantity: 1
      });
      await repo.updateCharacterNeeds({
        characterId: character.id,
        hunger: Math.min(5, character.hunger + item.satietyRestore),
        lastHungerSettledAt: now
      });
      await repo.writeEvent({
        characterId: character.id,
        eventType: "character.eat",
        message: `你吃下${item.name}，恢复了一些饱腹感。`
      });

      return this.buildState(repo, accountId, now);
    });
  }

  private requireTradeQuantity(quantity: number) {
    const normalized = Math.floor(quantity);
    if (!Number.isFinite(normalized) || normalized < 1) {
      throw new GameServiceError("VALIDATION_ERROR", "交易数量无效。");
    }
    return normalized;
  }

  private async ensureMarketInventory(repo: GameRepository) {
    const existing = await repo.listMarketInventory(BLACKPINE_MARKET_ID);
    const existingItemIds = new Set(existing.map((entry) => entry.itemId));

    for (const item of FIRST_ITEMS) {
      if (existingItemIds.has(item.id)) continue;
      await repo.upsertMarketInventory({
        settlementId: BLACKPINE_MARKET_ID,
        itemId: item.id,
        quantity: Math.floor(item.targetMarketQuantity / 2),
        targetQuantity: item.targetMarketQuantity,
        baseBuyPriceCopper: item.baseBuyPriceCopper,
        baseSellPriceCopper: item.baseSellPriceCopper
      });
    }
  }

  private async requireMarketInventoryItem(repo: GameRepository, itemId: MarketTradeRequestDto["itemId"]) {
    await this.ensureMarketInventory(repo);
    const marketInventory = await repo.listMarketInventory(BLACKPINE_MARKET_ID);
    const item = marketInventory.find((entry) => entry.itemId === itemId);
    if (!item) {
      throw new GameServiceError("VALIDATION_ERROR", "市政集市没有这种物品。");
    }
    return item;
  }

  private async buildMarketDto(
    repo: GameRepository,
    character: CharacterRecord
  ): Promise<MarketDto> {
    await this.ensureMarketInventory(repo);
    const marketInventory = await repo.listMarketInventory(BLACKPINE_MARKET_ID);
    const inventory = await repo.listInventory(character.id);

    return {
      settlementId: BLACKPINE_MARKET_ID,
      settlementName: "黑松哨站市政集市",
      items: marketInventory
        .map((marketItem) => {
          const item = getItemById(marketItem.itemId);
          if (!item) return null;
          const buyQuote = calculateMarketQuote({
            direction: "buy",
            basePriceCopper: marketItem.baseSellPriceCopper,
            stockQuantity: marketItem.quantity,
            targetQuantity: marketItem.targetQuantity,
            quantity: 1
          });
          const sellQuote = calculateMarketQuote({
            direction: "sell",
            basePriceCopper: marketItem.baseBuyPriceCopper,
            stockQuantity: marketItem.quantity,
            targetQuantity: marketItem.targetQuantity,
            quantity: 1
          });

          return {
            itemId: item.id,
            name: item.name,
            category: item.category,
            itemLevel: item.itemLevel,
            stockQuantity: marketItem.quantity,
            playerQuantity:
              inventory.find((inventoryItem) => inventoryItem.itemId === item.id)?.quantity ?? 0,
            buyPrice: formatMoney(buyQuote.unitPriceCopper),
            sellPrice: formatMoney(sellQuote.unitPriceCopper),
            buyTax: formatMoney(buyQuote.taxCopper),
            sellTax: formatMoney(sellQuote.taxCopper)
          };
        })
        .filter((item): item is MarketDto["items"][number] => item !== null)
    };
  }

  private async requireCharacter(repo: GameRepository, accountId: string) {
    const character = await repo.findCharacterByAccountId(accountId);
    if (!character) {
      throw new GameServiceError("VALIDATION_ERROR", "Character required");
    }
    return character;
  }

  private async requireSettledCharacter(repo: GameRepository, accountId: string, now: Date) {
    const character = await this.requireCharacter(repo, accountId);
    return this.settleHungerForCharacter(repo, character, now);
  }

  private foodDefinitions() {
    return FIRST_ITEMS.filter((item) => item.category === "food" && item.satietyRestore).map(
      (item) => ({
        itemId: item.id,
        itemLevel: item.itemLevel,
        satietyRestore: item.satietyRestore ?? 0
      })
    );
  }

  private async settleHungerForCharacter(
    repo: GameRepository,
    character: CharacterRecord,
    now: Date
  ): Promise<CharacterRecord> {
    const settlement = settleHunger({
      currentHunger: character.hunger,
      lastSettledAt: character.lastHungerSettledAt,
      now,
      inventory: await repo.listInventory(character.id),
      foods: this.foodDefinitions()
    });

    if (settlement.missedMeals === 0) return character;

    for (const consumed of settlement.consumed) {
      await repo.decrementInventoryItem({
        characterId: character.id,
        itemId: consumed.itemId,
        quantity: consumed.quantity
      });
    }

    await repo.updateCharacterNeeds({
      characterId: character.id,
      hunger: settlement.hunger,
      lastHungerSettledAt: now
    });

    if (settlement.consumed.length > 0) {
      await repo.writeEvent({
        characterId: character.id,
        eventType: "character.hunger.auto_eat",
        message: "到了饭点，你自动吃掉了背包里的普通食物。"
      });
    }

    if (settlement.injured) {
      const injuryUntil = new Date(now.getTime() + 30 * 60_000);
      await repo.updateCharacterLocation({
        characterId: character.id,
        currentLocation: BLACKPINE_OUTPOST.id,
        position: null
      });
      await repo.updateCharacterVitals({
        characterId: character.id,
        hp: 1,
        injuryUntil
      });
      await repo.writeEvent({
        characterId: character.id,
        eventType: "character.hunger.injury",
        message: "你因为饥饿倒下，被送回黑松哨站休养。"
      });
      return {
        ...character,
        hp: 1,
        hunger: settlement.hunger,
        lastHungerSettledAt: now,
        currentLocation: BLACKPINE_OUTPOST.id,
        position: null,
        injuryUntil
      };
    }

    if (settlement.hunger <= 2) {
      await repo.writeEvent({
        characterId: character.id,
        eventType: "character.hunger.warning",
        message: "你感到饥饿，继续外出前最好准备食物。"
      });
    }

    return {
      ...character,
      hunger: settlement.hunger,
      lastHungerSettledAt: now
    };
  }

  private requireCanLeaveVillage(character: CharacterRecord) {
    if (character.hunger <= 0) {
      throw new GameServiceError("VALIDATION_ERROR", "你已经饿到虚弱，不能出城。");
    }
  }

  private async requireRepairContext(repo: GameRepository, accountId: string) {
    const character = await this.requireSettledCharacter(repo, accountId, new Date());
    if (character.currentLocation !== BLACKPINE_OUTPOST.id) {
      throw new GameServiceError("VALIDATION_ERROR", "必须在黑松哨站修理装备。");
    }
    await this.requireNoActiveAction(repo, character.id);
    return character;
  }

  private async requireEquipment(
    repo: GameRepository,
    characterId: string,
    equipmentId: string
  ) {
    const equipment = await repo.findEquipmentById(characterId, equipmentId);
    if (!equipment) {
      throw new GameServiceError("VALIDATION_ERROR", "装备不存在。");
    }
    return equipment;
  }

  private async repairEquipmentRecords(
    repo: GameRepository,
    character: CharacterRecord,
    equipment: EquipmentRecord[]
  ) {
    if (equipment.length === 0) {
      throw new GameServiceError("VALIDATION_ERROR", "没有需要修理的装备。");
    }

    const quotes = equipment.map((item) => ({
      item,
      quote: calculateEquipmentRepairQuote(item)
    }));
    const totalCopper = quotes.reduce((sum, entry) => sum + (entry.quote?.copperCost ?? 0), 0);
    const totalIronOre = quotes.reduce((sum, entry) => sum + (entry.quote?.ironOreCost ?? 0), 0);

    if (character.copperBalance < totalCopper) {
      throw new GameServiceError("VALIDATION_ERROR", "铜币不足。");
    }

    const inventory = await repo.listInventory(character.id);
    const ironOre = inventory.find((item) => item.itemId === "iron_ore")?.quantity ?? 0;
    if (ironOre < totalIronOre) {
      throw new GameServiceError("VALIDATION_ERROR", "基础铁矿石不足。");
    }

    await repo.updateCharacterCopper({
      characterId: character.id,
      copperBalance: character.copperBalance - totalCopper
    });
    await repo.decrementInventoryItem({
      characterId: character.id,
      itemId: "iron_ore",
      quantity: totalIronOre
    });
    for (const entry of quotes) {
      await repo.updateEquipmentDurability({
        equipmentId: entry.item.id,
        currentDurability: entry.item.maxDurability,
        maxDurability: entry.item.maxDurability
      });
    }
    await repo.writeEvent({
      characterId: character.id,
      eventType: "equipment.repair",
      message: `你修理了 ${equipment.length} 件装备，消耗 ${totalCopper} 铜和基础铁矿石 x${totalIronOre}。`,
      metadata: { equipmentIds: equipment.map((item) => item.id), totalCopper, totalIronOre }
    });
  }

  private async requireReadyCharacterInForest(
    repo: GameRepository,
    accountId: string,
    now: Date
  ) {
    const character = await this.requireSettledCharacter(repo, accountId, now);
    if (character.injuryUntil && character.injuryUntil.getTime() > now.getTime()) {
      throw new GameServiceError("VALIDATION_ERROR", "你正在养伤，暂时不能出城。");
    }
    if (character.hunger <= 0) {
      throw new GameServiceError("VALIDATION_ERROR", "你已经饿到虚弱，不能出城。");
    }
    if (character.currentLocation !== CORRUPT_FOREST.id || !character.position) {
      throw new GameServiceError("VALIDATION_ERROR", "Character is not exploring");
    }
    return character as CharacterRecord & { position: GridPositionDto };
  }

  private async requireCorruptForestMap(
    repo: GameRepository,
    character: CharacterRecord
  ) {
    const map = await repo.findMapInstance(character.id, CORRUPT_FOREST.id);
    if (!map) {
      throw new GameServiceError("VALIDATION_ERROR", "Map state required");
    }
    return map;
  }

  private async requireNoActiveAction(repo: GameRepository, characterId: string) {
    const action = await repo.findActiveActionByCharacterId(characterId);
    if (action) {
      throw new GameServiceError("VALIDATION_ERROR", "已有进行中的行动。");
    }
  }

  private async settleDueAction(repo: GameRepository, accountId: string, now: Date) {
    const character = await repo.findCharacterByAccountId(accountId);
    if (!character) return;

    const action = await repo.findActiveActionByCharacterId(character.id);
    if (!action || action.endsAt.getTime() > now.getTime()) return;

    if (action.actionType === "gathering") {
      await this.settleGatheringAction(repo, action, now, { completeAction: true });
      return;
    }

    await this.settleCombatAction(repo, character, action, now);
  }

  private async settleGatheringAction(
    repo: GameRepository,
    action: CharacterActionRecord,
    now: Date,
    options: { completeAction: boolean }
  ) {
    const payload = action.payload as GatheringActionPayload;
    const resource = CORRUPT_FOREST.resources.find((entry) => entry.id === payload.resourceId);
    if (!resource) throw new GameServiceError("VALIDATION_ERROR", "资源配置无效。");
    const map = await repo.findMapInstance(action.characterId, CORRUPT_FOREST.id);
    if (!map) throw new GameServiceError("VALIDATION_ERROR", "Map state required");

    const remainingCharges = map.resourceCharges[resource.id] ?? resource.charges;
    const settlement = calculateGatheringSettlement({
      startedAtMs: action.startedAt.getTime(),
      nowMs: now.getTime(),
      cycleMs: payload.cycleMs,
      plannedCycles: payload.plannedCycles,
      settledCycles: payload.settledCycles,
      remainingCharges
    });

    if (settlement.newCyclesToSettle > 0) {
      const inventory = await repo.listInventory(action.characterId);
      const nextInventory = addInventoryItem(
        inventory,
        payload.itemId,
        payload.quantityPerCycle * settlement.newCyclesToSettle
      );
      const changedStack = nextInventory.find((item) => item.itemId === payload.itemId);
      if (!changedStack) throw new Error("Failed to calculate gathered inventory stack");

      await repo.setInventoryItem({
        characterId: action.characterId,
        itemId: changedStack.itemId,
        quantity: changedStack.quantity
      });
      await repo.updateMapResourceCharges(map.id, {
        ...map.resourceCharges,
        [resource.id]: remainingCharges - settlement.newCyclesToSettle
      });
      await repo.updateActionPayload(action.id, {
        ...payload,
        settledCycles: payload.settledCycles + settlement.newCyclesToSettle
      });
      await repo.writeEvent({
        characterId: action.characterId,
        eventType: "action.gathering.settle",
        message: `你获得了${payload.itemName} x${payload.quantityPerCycle * settlement.newCyclesToSettle}。`
      });
    }

    if (options.completeAction && settlement.isComplete) {
      await repo.markActionCompleted(action.id, now);
      await repo.writeEvent({
        characterId: action.characterId,
        eventType: "action.gathering.complete",
        message: "采集行动完成。"
      });
    }
  }

  private async settleCombatAction(
    repo: GameRepository,
    character: CharacterRecord,
    action: CharacterActionRecord,
    now: Date
  ) {
    const payload = action.payload as CombatActionPayload;
    let nextHp = payload.playerRemainingHp;
    let nextXp = character.xp;
    let injuryUntil: Date | null | undefined;

    if (payload.outcome === "victory") {
      nextXp += payload.xp;
      const inventory = await repo.listInventory(character.id);
      let nextInventory = inventory;
      for (const item of payload.loot) {
        nextInventory = addInventoryItem(nextInventory, item.itemId, item.quantity);
      }
      for (const item of nextInventory) {
        await repo.setInventoryItem({
          characterId: character.id,
          itemId: item.itemId,
          quantity: item.quantity
        });
      }
      await repo.writeEvent({
        characterId: character.id,
        eventType: "action.combat.victory",
        message: `战斗胜利，获得 ${payload.xp} 经验。`
      });
    }

    if (payload.outcome === "injury") {
      nextHp = 1;
      injuryUntil = new Date(now.getTime() + 30 * 60_000);
      await repo.updateCharacterLocation({
        characterId: character.id,
        currentLocation: BLACKPINE_OUTPOST.id,
        position: null
      });
      await repo.writeEvent({
        characterId: character.id,
        eventType: "action.combat.injury",
        message: "你伤势过重，被巡逻队带回黑松哨站休养。"
      });
    }

    const equipment = await repo.listEquipment(character.id);
    const damagedEquipment = applyCombatDurabilityLoss(equipment);
    for (const item of damagedEquipment) {
      const previous = equipment.find((entry) => entry.id === item.id);
      if (!previous || previous.currentDurability === item.currentDurability) continue;
      await repo.updateEquipmentDurability({
        equipmentId: item.id,
        currentDurability: item.currentDurability,
        maxDurability: item.maxDurability
      });
    }

    await repo.updateCharacterVitals({
      characterId: character.id,
      hp: nextHp,
      xp: nextXp,
      ...(injuryUntil === undefined ? {} : { injuryUntil })
    });
    await repo.markActionCompleted(action.id, now);
  }

  private async healExpiredInjury(repo: GameRepository, accountId: string, now: Date) {
    const character = await repo.findCharacterByAccountId(accountId);
    if (!character?.injuryUntil || character.injuryUntil.getTime() > now.getTime()) return;

    await repo.updateCharacterVitals({
      characterId: character.id,
      hp: character.maxHp,
      injuryUntil: null
    });
    await repo.writeEvent({
      characterId: character.id,
      eventType: "character.injury.heal",
      message: "你的伤势已经恢复。"
    });
  }

  private toCurrentActionDto(action: CharacterActionRecord, now: Date): CurrentActionDto {
    const base = {
      id: action.id,
      actionType: action.actionType,
      status: action.status,
      startedAt: action.startedAt.toISOString(),
      endsAt: action.endsAt.toISOString(),
      progressPct: progressPct(action.startedAt, action.endsAt, now)
    };

    if (action.actionType === "gathering") {
      const payload = action.payload as GatheringActionPayload;
      const settlement = calculateGatheringSettlement({
        startedAtMs: action.startedAt.getTime(),
        nowMs: now.getTime(),
        cycleMs: payload.cycleMs,
        plannedCycles: payload.plannedCycles,
        settledCycles: payload.settledCycles,
        remainingCharges: payload.plannedCycles
      });

      return {
        ...base,
        description: `正在采集${payload.itemName}`,
        cycleProgressPct: settlement.cycleProgressPct,
        completedCycles: settlement.completedCycles,
        settledCycles: payload.settledCycles,
        plannedCycles: payload.plannedCycles,
        expectedYield: [
          {
            itemId: payload.itemId,
            name: payload.itemName,
            quantity: payload.quantityPerCycle * payload.plannedCycles
          }
        ],
        combatLog: []
      };
    }

    const payload = action.payload as CombatActionPayload;
    const encounter = getEncounterById(payload.encounterId);
    return {
      ...base,
      description: `正在与${encounter?.name ?? "敌人"}战斗`,
      cycleProgressPct: null,
      completedCycles: null,
      settledCycles: null,
      plannedCycles: null,
      expectedYield: [],
      combatLog: payload.combatLog
    };
  }

  private async buildState(
    repo: GameRepository,
    accountId: string,
    now: Date
  ): Promise<GameStateDto> {
    const character = await repo.findCharacterByAccountId(accountId);
    if (!character) {
      return {
        character: null,
        locationTitle: BLACKPINE_OUTPOST.title,
        locationDescription: "你尚未创建角色。",
        map: null,
        inventory: [],
        equipment: [],
        market: null,
        npcTasks: [],
        currentAction: null,
        availableActions: ["create_character"],
        log: []
      };
    }

    const inventory = await repo.listInventory(character.id);
    const equipment = await repo.listEquipment(character.id);
    const log = await repo.listRecentEvents(character.id);
    const inventoryDto = toInventoryDto(inventory);
    const equipmentDto = equipment.map(toEquipmentDto);
    const activeAction = await repo.findActiveActionByCharacterId(character.id);
    const currentAction = activeAction ? this.toCurrentActionDto(activeAction, now) : null;

    if (character.currentLocation !== CORRUPT_FOREST.id || !character.position) {
      const availableActions: GameStateDto["availableActions"] = currentAction
        ? ["cancel_action"]
        : ["enter_corrupt_forest", "open_market"];
      if (!currentAction && equipmentDto.some((item) => item.repairQuote !== null)) {
        availableActions.push("repair_equipment");
      }
      if (
        !currentAction &&
        character.hunger < 5 &&
        inventory.some((item) => getItemById(item.itemId)?.category === "food")
      ) {
        availableActions.push("eat_food");
      }

      return {
        character: toCharacterDto(character, now),
        locationTitle: BLACKPINE_OUTPOST.title,
        locationDescription: BLACKPINE_OUTPOST.description,
        map: null,
        inventory: inventoryDto,
        equipment: equipmentDto,
        market: null,
        npcTasks: [],
        currentAction,
        availableActions,
        log: log.map((entry) => ({
          id: entry.id,
          message: entry.message,
          createdAt: entry.createdAt.toISOString()
        }))
      };
    }

    const map = await repo.findMapInstance(character.id, CORRUPT_FOREST.id);
    const resourceCharges = map?.resourceCharges ?? initialResourceCharges();
    const availableActions: GameStateDto["availableActions"] = currentAction
      ? ["cancel_action"]
      : ["move", "return_to_village"];

    if (!currentAction && findLiveResourceAt(character.position, resourceCharges)) {
      availableActions.push("start_gathering");
    }

    if (!currentAction && findEncounterAt(character.position)) {
      availableActions.push("start_combat");
    }

    return {
      character: toCharacterDto(character, now),
      locationTitle: CORRUPT_FOREST.title,
      locationDescription: CORRUPT_FOREST.description,
      map: {
        zoneId: CORRUPT_FOREST.id,
        width: CORRUPT_FOREST.width,
        height: CORRUPT_FOREST.height,
        cells: buildMapCells(CORRUPT_FOREST, character.position, resourceCharges)
      },
      inventory: inventoryDto,
      equipment: equipmentDto,
      market: null,
      npcTasks: [],
      currentAction,
      availableActions,
      log: log.map((entry) => ({
        id: entry.id,
        message: entry.message,
        createdAt: entry.createdAt.toISOString()
      }))
    };
  }
}
