import { CORRUPT_FOREST, FIRST_MONSTERS } from "@ai-mud/content";
import { describe, expect, it } from "vitest";
import { addInventoryItem } from "./inventory-rules.js";
import {
  buildMapCells,
  applyCombatDurabilityLoss,
  calculateMarketQuote,
  calculateRepairQuote,
  calculateDurabilityPct,
  calculateEffectiveStatRatio,
  calculateEquipmentRepairQuote,
  calculateGatheringPlan,
  calculateGatheringSettlement,
  calculateHungerCombatMultiplier,
  calculateHungerStatus,
  countUnsettledMeals,
  calculateNpcWagePayment,
  chooseNpcMealIntent,
  chooseNpcWorkIntent,
  formatMoney,
  movePosition,
  nextNpcTravelStep,
  selectAutoEatFood,
  settleHunger,
  simulateCombat,
  validateNpcSimulationHealth
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

  it("formats copper into gold, silver, and copper", () => {
    expect(formatMoney(12345)).toEqual({ gold: 1, silver: 23, copper: 45, totalCopper: 12345 });
  });

  it("quotes market prices from stock pressure and tax", () => {
    const scarceBuy = calculateMarketQuote({
      direction: "buy",
      basePriceCopper: 20,
      stockQuantity: 5,
      targetQuantity: 20,
      quantity: 2
    });
    const surplusSell = calculateMarketQuote({
      direction: "sell",
      basePriceCopper: 10,
      stockQuantity: 100,
      targetQuantity: 20,
      quantity: 2
    });

    expect(scarceBuy.unitPriceCopper).toBeGreaterThan(20);
    expect(scarceBuy.taxCopper).toBeGreaterThan(0);
    expect(scarceBuy.totalCopper).toBe(scarceBuy.grossCopper + scarceBuy.taxCopper);
    expect(surplusSell.unitPriceCopper).toBeLessThanOrEqual(10);
    expect(surplusSell.totalCopper).toBe(surplusSell.grossCopper - surplusSell.taxCopper);
  });

  it("quotes repair with copper and basic iron ore", () => {
    const quote = calculateRepairQuote({ itemLevel: 12, durabilityLossPct: 0.5 });

    expect(quote.copperCost).toBeGreaterThan(0);
    expect(quote.ironOreCost).toBeGreaterThan(0);
  });

  it("calculates equipment durability percentage and zero-durability stat fallback", () => {
    expect(calculateDurabilityPct({ currentDurability: 100, maxDurability: 100 })).toBe(100);
    expect(calculateDurabilityPct({ currentDurability: 0, maxDurability: 100 })).toBe(0);
    expect(calculateEffectiveStatRatio({ currentDurability: 100, maxDurability: 100 })).toBe(1);
    expect(calculateEffectiveStatRatio({ currentDurability: 0, maxDurability: 100 })).toBe(0.2);
  });

  it("applies combat durability loss to weapon and chest equipment", () => {
    const next = applyCombatDurabilityLoss([
      { slot: "weapon", currentDurability: 10, maxDurability: 100 },
      { slot: "chest", currentDurability: 10, maxDurability: 100 }
    ]);

    expect(next).toEqual([
      { slot: "weapon", currentDurability: 8, maxDurability: 100 },
      { slot: "chest", currentDurability: 9, maxDurability: 100 }
    ]);
  });

  it("quotes equipment repair only when durability is missing", () => {
    expect(
      calculateEquipmentRepairQuote({
        itemLevel: 5,
        currentDurability: 100,
        maxDurability: 100
      })
    ).toBeNull();

    const quote = calculateEquipmentRepairQuote({
      itemLevel: 5,
      currentDurability: 60,
      maxDurability: 100
    });

    expect(quote?.copperCost).toBeGreaterThan(0);
    expect(quote?.ironOreCost).toBeGreaterThan(0);
  });

  it("calculates hunger status and combat penalties", () => {
    expect(calculateHungerStatus(5)).toBe("fed");
    expect(calculateHungerStatus(2)).toBe("hungry");
    expect(calculateHungerStatus(1)).toBe("starving");
    expect(calculateHungerStatus(0)).toBe("starving");
    expect(calculateHungerCombatMultiplier(5)).toBe(1);
    expect(calculateHungerCombatMultiplier(1)).toBe(0.8);
    expect(calculateHungerCombatMultiplier(0)).toBe(0.5);
  });

  it("counts unsettled meals with a cap", () => {
    expect(
      countUnsettledMeals(
        new Date("2026-07-01T07:00:00.000Z"),
        new Date("2026-07-01T19:00:00.000Z")
      )
    ).toBe(2);
    expect(
      countUnsettledMeals(
        new Date("2026-07-01T07:00:00.000Z"),
        new Date("2026-07-05T19:00:00.000Z")
      )
    ).toBe(6);
  });

  it("auto-eats lower item-level food before reducing hunger", () => {
    const selected = selectAutoEatFood(
      [
        { itemId: "beast_meat", quantity: 1 },
        { itemId: "wild_berry", quantity: 2 }
      ],
      [
        { itemId: "beast_meat", itemLevel: 2, satietyRestore: 1 },
        { itemId: "wild_berry", itemLevel: 1, satietyRestore: 1 }
      ]
    );

    expect(selected).toBe("wild_berry");

    const settlement = settleHunger({
      currentHunger: 3,
      lastSettledAt: new Date("2026-07-01T07:00:00.000Z"),
      now: new Date("2026-07-01T19:00:00.000Z"),
      inventory: [{ itemId: "wild_berry", quantity: 1 }],
      foods: [{ itemId: "wild_berry", itemLevel: 1, satietyRestore: 1 }]
    });

    expect(settlement.hunger).toBe(2);
    expect(settlement.consumed).toEqual([{ itemId: "wild_berry", quantity: 1 }]);
    expect(settlement.missedMeals).toBe(2);
    expect(settlement.injured).toBe(false);
  });

  it("moves an NPC only one grid step toward a target", () => {
    expect(nextNpcTravelStep({ current: { x: 2, y: 4 }, target: { x: 0, y: 1 } })).toEqual({
      x: 1,
      y: 4
    });
    expect(nextNpcTravelStep({ current: { x: 0, y: 1 }, target: { x: 0, y: 1 } })).toEqual({
      x: 0,
      y: 1
    });
  });

  it("chooses NPC work intent from profession and content resources", () => {
    expect(
      chooseNpcWorkIntent({
        profession: "farmer",
        workResourceId: "forest_berry_patch_01",
        producesItemId: "wild_berry"
      })
    ).toEqual({
      intent: "gather",
      resourceId: "forest_berry_patch_01",
      itemId: "wild_berry"
    });
    expect(
      chooseNpcWorkIntent({
        profession: "miner",
        workResourceId: "abandoned_iron_vein_01",
        producesItemId: "iron_ore"
      })
    ).toEqual({
      intent: "gather",
      resourceId: "abandoned_iron_vein_01",
      itemId: "iron_ore"
    });
    expect(
      chooseNpcWorkIntent({
        profession: "blacksmith",
        workResourceId: null,
        producesItemId: null
      })
    ).toEqual({ intent: "idle" });
  });

  it("prioritizes buying food for hungry NPCs before leaving town", () => {
    expect(
      chooseNpcMealIntent({
        hunger: 2,
        inventory: [],
        marketFoodStock: 4
      })
    ).toEqual({ intent: "buy_food" });
    expect(
      chooseNpcMealIntent({
        hunger: 2,
        inventory: [{ itemId: "wild_berry", quantity: 1 }],
        marketFoodStock: 0
      })
    ).toEqual({ intent: "eat_food", itemId: "wild_berry" });
    expect(
      chooseNpcMealIntent({
        hunger: 4,
        inventory: [],
        marketFoodStock: 0
      })
    ).toEqual({ intent: "none" });
  });

  it("caps NPC wage payments by municipal treasury balance", () => {
    expect(calculateNpcWagePayment({ requestedCopper: 30, treasuryCopper: 100 })).toEqual({
      paidCopper: 30,
      shortfallCopper: 0
    });
    expect(calculateNpcWagePayment({ requestedCopper: 30, treasuryCopper: 12 })).toEqual({
      paidCopper: 12,
      shortfallCopper: 18
    });
  });

  it("validates NPC simulation health against fake economy states", () => {
    expect(
      validateNpcSimulationHealth({
        balances: [100, 0],
        stockQuantities: [10, 0],
        resourceCharges: [5],
        activeActions: []
      })
    ).toEqual({ ok: true, issues: [] });
    expect(
      validateNpcSimulationHealth({
        balances: [100, -1],
        stockQuantities: [10, -2],
        resourceCharges: [-1],
        activeActions: [
          {
            id: "action-1",
            endsAtMs: 1_000,
            nowMs: 2_000
          }
        ]
      })
    ).toEqual({
      ok: false,
      issues: [
        "negative_balance",
        "negative_stock",
        "negative_resource_charge",
        "overdue_active_action:action-1"
      ]
    });
  });
});
