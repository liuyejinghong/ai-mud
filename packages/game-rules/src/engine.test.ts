import { CORRUPT_FOREST, FIRST_MONSTERS } from "@ai-mud/content";
import { describe, expect, it } from "vitest";
import { addInventoryItem } from "./inventory-rules.js";
import {
  buildMapCells,
  calculateGatheringPlan,
  calculateGatheringSettlement,
  movePosition,
  simulateCombat
} from "./engine.js";

describe("v0.3 engine rules", () => {
  it("moves inside the Corrupt Forest boundaries", () => {
    expect(movePosition(CORRUPT_FOREST, { x: 2, y: 4 }, "north")).toEqual({
      ok: true,
      position: { x: 2, y: 3 }
    });
    expect(movePosition(CORRUPT_FOREST, { x: 0, y: 0 }, "west")).toEqual({
      ok: false,
      reason: "OUT_OF_BOUNDS"
    });
  });

  it("marks player, resource, encounter, and exit cells", () => {
    const cells = buildMapCells(CORRUPT_FOREST, { x: 2, y: 4 }, {
      forest_berry_patch_01: 3,
      fallen_carcass_01: 2,
      discarded_hide_01: 1
    });

    expect(cells.find((cell) => cell.x === 2 && cell.y === 4)?.markers).toContain("player");
    expect(cells.find((cell) => cell.x === 1 && cell.y === 3)?.markers).toContain("resource");
    expect(cells.find((cell) => cell.x === 3 && cell.y === 3)?.markers).toContain("encounter");
    expect(cells.find((cell) => cell.x === 2 && cell.y === 4)?.markers).toContain("exit");
  });

  it("calculates gathering cycles with class and agility modifiers", () => {
    const warriorPlan = calculateGatheringPlan({
      baseCycleSeconds: 60,
      classId: "warrior",
      agility: 8,
      plannedMinutes: 10,
      remainingCharges: 100
    });
    const rangerPlan = calculateGatheringPlan({
      baseCycleSeconds: 60,
      classId: "ranger",
      agility: 14,
      plannedMinutes: 10,
      remainingCharges: 100
    });

    expect(warriorPlan.cycleMs).toBe(60000);
    expect(rangerPlan.cycleMs).toBeLessThan(warriorPlan.cycleMs);
    expect(rangerPlan.plannedCycles).toBeGreaterThan(10);
  });

  it("settles completed gathering cycles only", () => {
    const settlement = calculateGatheringSettlement({
      startedAtMs: 0,
      nowMs: 185000,
      cycleMs: 60000,
      plannedCycles: 10,
      settledCycles: 1,
      remainingCharges: 100
    });

    expect(settlement.completedCycles).toBe(3);
    expect(settlement.newCyclesToSettle).toBe(2);
    expect(settlement.isComplete).toBe(false);
  });

  it("simulates ATB combat from stats and never drops currency", () => {
    const result = simulateCombat({
      seed: "wolf-test",
      player: {
        name: "Zichen",
        hp: 100,
        maxHp: 100,
        attack: 18,
        defense: 6,
        agility: 14
      },
      monsters: FIRST_MONSTERS
    });

    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.timeline.length).toBeGreaterThan(0);
    expect(result.outcome).toBe("victory");
    expect(result.loot.every((item) => item.itemId !== ("gold" as never))).toBe(true);
  });

  it("lets high agility attack more often than low agility", () => {
    const slow = simulateCombat({
      seed: "slow",
      player: { name: "Slow", hp: 100, maxHp: 100, attack: 12, defense: 4, agility: 6 },
      monsters: [FIRST_MONSTERS[0]!]
    });
    const fast = simulateCombat({
      seed: "fast",
      player: { name: "Fast", hp: 100, maxHp: 100, attack: 12, defense: 4, agility: 18 },
      monsters: [FIRST_MONSTERS[0]!]
    });

    expect(fast.playerAttackCount).toBeGreaterThanOrEqual(slow.playerAttackCount);
  });

  it("stacks inventory quantities", () => {
    expect(addInventoryItem([{ itemId: "wild_berry", quantity: 2 }], "wild_berry", 3)).toEqual([
      { itemId: "wild_berry", quantity: 5 }
    ]);
  });
});
