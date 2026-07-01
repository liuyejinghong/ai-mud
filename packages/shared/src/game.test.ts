import { describe, expect, it } from "vitest";
import {
  CHARACTER_CLASSES,
  GAME_LOCATIONS,
  ITEM_IDS,
  isDirection,
  type CurrentActionDto,
  type GameStateDto,
  type MoneyDto
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

  it("exposes v0.4.0 economy compatibility", () => {
    expect(PRODUCT_VERSION).toBe("0.4.0");
    expect(WORLD_COMPATIBILITY.schemaVersion).toBe(4);
    expect(WORLD_COMPATIBILITY.engineVersion).toBe(1);
    expect(WORLD_COMPATIBILITY.rulesetVersion).toBe(4);
    expect(WORLD_COMPATIBILITY.contentVersion).toBe(4);
  });

  it("includes basic iron ore in the shared item catalog", () => {
    expect(ITEM_IDS).toContain("iron_ore");
  });

  it("describes formatted money values", () => {
    const money: MoneyDto = { gold: 1, silver: 23, copper: 45, totalCopper: 12345 };

    expect(money).toEqual({ gold: 1, silver: 23, copper: 45, totalCopper: 12345 });
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

  it("allows v0.4 action commands in game state", () => {
    const state: Pick<GameStateDto, "availableActions" | "currentAction" | "market"> = {
      availableActions: [
        "move",
        "start_gathering",
        "start_combat",
        "cancel_action",
        "return_to_village",
        "open_market"
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
    expect(state.market?.items[0]?.itemId).toBe("iron_ore");
    expect(state.currentAction).toBeNull();
  });
});
