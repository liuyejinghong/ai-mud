import { describe, expect, it } from "vitest";
import {
  CHARACTER_CLASSES,
  GAME_LOCATIONS,
  ITEM_IDS,
  isDirection,
  type CharacterDto,
  type CurrentActionDto,
  type EatFoodRequestDto,
  type EquipmentItemDto,
  type GameStateDto,
  type MoneyDto,
  type NeedsDto
} from "./game.js";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("game contract", () => {
  it("defines the first playable character classes and locations", () => {
    expect(CHARACTER_CLASSES.map((entry) => entry.id)).toEqual(["warrior", "ranger", "warlock"]);
    expect(GAME_LOCATIONS.blackpineOutpost).toBe("blackpine_outpost");
    expect(GAME_LOCATIONS.corruptForest).toBe("corrupt_forest");
  });

  it("guards movement directions", () => {
    expect(isDirection("north")).toBe(true);
    expect(isDirection("up")).toBe(false);
  });

  it("exposes v0.4.2 hunger compatibility", () => {
    expect(PRODUCT_VERSION).toBe("0.4.2");
    expect(WORLD_COMPATIBILITY.schemaVersion).toBe(6);
    expect(WORLD_COMPATIBILITY.engineVersion).toBe(1);
    expect(WORLD_COMPATIBILITY.rulesetVersion).toBe(6);
    expect(WORLD_COMPATIBILITY.contentVersion).toBe(6);
  });

  it("includes basic iron ore in the shared item catalog", () => {
    expect(ITEM_IDS).toContain("iron_ore");
  });

  it("describes formatted money values", () => {
    const money: MoneyDto = { gold: 1, silver: 23, copper: 45, totalCopper: 12345 };

    expect(money).toEqual({ gold: 1, silver: 23, copper: 45, totalCopper: 12345 });
  });

  it("describes player hunger needs", () => {
    const needs: NeedsDto = {
      hunger: {
        current: 5,
        max: 5,
        status: "fed",
        nextMealAt: "2026-07-01T10:00:00.000Z"
      }
    };
    const character: Pick<CharacterDto, "needs"> = { needs };

    expect(character.needs.hunger.current).toBe(5);
    expect(character.needs.hunger.status).toBe("fed");
  });

  it("describes current gathering action progress", () => {
    const action: CurrentActionDto = {
      id: "action-1",
      actionType: "gathering",
      status: "active",
      description: "正在采集野莓灌木",
      startedAt: "2026-07-01T00:00:00.000Z",
      endsAt: "2026-07-01T00:10:00.000Z",
      progressPct: 50,
      cycleProgressPct: 25,
      completedCycles: 5,
      settledCycles: 4,
      plannedCycles: 10,
      expectedYield: [{ itemId: "wild_berry", name: "野莓", quantity: 10 }],
      combatLog: []
    };

    expect(action.actionType).toBe("gathering");
    expect(action.completedCycles).toBe(5);
  });

  it("describes equipped items with durability and repair quotes", () => {
    const equipment: EquipmentItemDto = {
      id: "equipment-1",
      slot: "weapon",
      itemKey: "training_sword",
      name: "训练短剑",
      itemLevel: 5,
      attackBonus: 2,
      defenseBonus: 0,
      maxDurability: 100,
      currentDurability: 60,
      durabilityPct: 60,
      effectiveStatRatio: 1,
      repairQuote: {
        copperCost: { gold: 0, silver: 0, copper: 50, totalCopper: 50 },
        ironOreCost: 1
      }
    };

    expect(equipment.slot).toBe("weapon");
    expect(equipment.repairQuote?.ironOreCost).toBe(1);
  });

  it("allows v0.4.2 action commands in game state", () => {
    const state: Pick<GameStateDto, "availableActions" | "currentAction" | "market" | "equipment"> = {
      availableActions: [
        "move",
        "start_gathering",
        "start_combat",
        "cancel_action",
        "return_to_village",
        "open_market",
        "repair_equipment",
        "eat_food"
      ],
      equipment: [
        {
          id: "equipment-1",
          slot: "weapon",
          itemKey: "training_sword",
          name: "训练短剑",
          itemLevel: 5,
          attackBonus: 2,
          defenseBonus: 0,
          maxDurability: 100,
          currentDurability: 100,
          durabilityPct: 100,
          effectiveStatRatio: 1,
          repairQuote: null
        }
      ],
      currentAction: null,
      market: {
        settlementId: "blackpine_outpost",
        settlementName: "黑松哨站市政集市",
        items: [
          {
            itemId: "iron_ore",
            name: "基础铁矿石",
            category: "ore",
            itemLevel: 1,
            stockQuantity: 12,
            playerQuantity: 3,
            buyPrice: { gold: 0, silver: 0, copper: 30, totalCopper: 30 },
            sellPrice: { gold: 0, silver: 0, copper: 18, totalCopper: 18 },
            buyTax: { gold: 0, silver: 0, copper: 2, totalCopper: 2 },
            sellTax: { gold: 0, silver: 0, copper: 1, totalCopper: 1 }
          }
        ]
      }
    };

    expect(state.availableActions).toContain("start_gathering");
    expect(state.availableActions).toContain("open_market");
    expect(state.availableActions).toContain("repair_equipment");
    expect(state.availableActions).toContain("eat_food");
    expect(state.equipment[0]?.durabilityPct).toBe(100);
    expect(state.market?.items[0]?.itemId).toBe("iron_ore");
    expect(state.currentAction).toBeNull();
  });

  it("describes manual food consumption requests", () => {
    const request: EatFoodRequestDto = { itemId: "wild_berry" };

    expect(request.itemId).toBe("wild_berry");
  });
});
