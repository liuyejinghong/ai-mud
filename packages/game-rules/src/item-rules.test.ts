import { getItemById } from "@ai-mud/content";
import { describe, expect, it } from "vitest";
import {
  aggregateEquipmentStats,
  canEquip,
  isValidDurability
} from "./equipment-rules.js";
import {
  addStackQuantity,
  removeStackQuantity,
  rollEquipment
} from "./item-rules.js";

describe("item rules", () => {
  it("keeps stack addition behavior reusable from inventory rules", () => {
    expect(addStackQuantity([{ itemId: "wild_berry", quantity: 2 }], "wild_berry", 3)).toEqual([
      { itemId: "wild_berry", quantity: 5 }
    ]);
    expect(addStackQuantity([], "iron_ore", 1)).toEqual([{ itemId: "iron_ore", quantity: 1 }]);
  });

  it("removes stack quantities without allowing negative inventory", () => {
    expect(
      removeStackQuantity([{ itemId: "iron_ore", quantity: 3 }], "iron_ore", 2)
    ).toEqual({
      ok: true,
      inventory: [{ itemId: "iron_ore", quantity: 1 }]
    });
    expect(removeStackQuantity([{ itemId: "iron_ore", quantity: 1 }], "iron_ore", 2)).toEqual({
      ok: false,
      reason: "insufficient_quantity"
    });
    expect(removeStackQuantity([{ itemId: "iron_ore", quantity: 1 }], "iron_ore", 0)).toEqual({
      ok: false,
      reason: "invalid_quantity"
    });
  });

  it("rolls equipment deterministically from seed, definition, and rarity", () => {
    const first = rollEquipment("same-seed", "training_sword", "rare");
    const second = rollEquipment("same-seed", "training_sword", "rare");

    expect(first).toEqual(second);
    expect(first?.itemDefId).toBe("training_sword");
    expect(first?.affixes).toHaveLength(2);
    expect(first?.currentDurability).toBe(first?.maxDurability);
  });

  it("refuses to roll non-equipment definitions", () => {
    expect(rollEquipment("seed", "wild_berry", "rare")).toBeNull();
    expect(rollEquipment("seed", "missing_item", "rare")).toBeNull();
  });

  it("validates equip slot and durability before a server write path persists it", () => {
    const definition = getItemById("training_sword");
    const rolled = rollEquipment("slot-test", "training_sword", "uncommon");

    expect(definition?.category).toBe("equipment");
    expect(canEquip({ item: definition?.category === "equipment" ? definition : null, targetSlot: "weapon" }))
      .toEqual({ ok: true });
    expect(canEquip({ item: rolled, targetSlot: "chest" })).toEqual({
      ok: false,
      reason: "slot_mismatch"
    });
    expect(isValidDurability({ currentDurability: 101, maxDurability: 100 })).toBe(false);
  });

  it("aggregates equipment base stats and affixes with durability fallback", () => {
    const sword = rollEquipment("aggregate-a", "training_sword", "rare")!;
    const brokenVest = {
      ...rollEquipment("aggregate-b", "patched_leather_vest", "uncommon")!,
      currentDurability: 0
    };
    const stats = aggregateEquipmentStats([sword, brokenVest]);

    expect(stats.attack).toBeGreaterThanOrEqual(2);
    expect(stats.defense).toBeGreaterThanOrEqual(0);
    expect(
      stats.attack +
        stats.defense +
        stats.agility +
        stats.maxHp +
        stats.gatherSpeedPct +
        stats.repairDiscountPct +
        stats.durabilityBonusPct +
        stats.injuryRecoveryPct
    ).toBeGreaterThan(0);
  });
});
