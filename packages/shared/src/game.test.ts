import { describe, expect, it } from "vitest";
import {
  CHARACTER_CLASSES,
  GAME_LOCATIONS,
  isDirection,
  type CurrentActionDto,
  type GameStateDto
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

  it("exposes v0.3.0 engine compatibility", () => {
    expect(PRODUCT_VERSION).toBe("0.3.0");
    expect(WORLD_COMPATIBILITY.schemaVersion).toBe(3);
    expect(WORLD_COMPATIBILITY.engineVersion).toBe(1);
    expect(WORLD_COMPATIBILITY.rulesetVersion).toBe(3);
    expect(WORLD_COMPATIBILITY.contentVersion).toBe(3);
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

  it("allows v0.3 action commands in game state", () => {
    const state: Pick<GameStateDto, "availableActions" | "currentAction"> = {
      availableActions: [
        "move",
        "start_gathering",
        "start_combat",
        "cancel_action",
        "return_to_village"
      ],
      currentAction: null
    };

    expect(state.availableActions).toContain("start_gathering");
    expect(state.currentAction).toBeNull();
  });
});
