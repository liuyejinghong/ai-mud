import { describe, expect, it } from "vitest";
import { AFFIX_POOLS, EQUIPMENT_SLOTS, ITEM_DEFINITIONS, getItemById } from "./items.js";

const itemIds = ITEM_DEFINITIONS.map((item) => item.id);

describe("item registry", () => {
  it("keeps every item id unique and queryable", () => {
    expect(new Set(itemIds).size).toBe(itemIds.length);
    expect(getItemById("wild_berry")?.name).toBe("野莓");
    expect(getItemById("training_sword")).toMatchObject({
      category: "equipment",
      slot: "weapon",
      name: "训练短剑"
    });
    expect(getItemById("missing_item")).toBeNull();
  });

  it("covers food, material, ore, and equipment categories", () => {
    expect(new Set(ITEM_DEFINITIONS.map((item) => item.category))).toEqual(
      new Set(["food", "material", "ore", "equipment"])
    );
  });

  it("migrates starter equipment with existing combat values", () => {
    expect(getItemById("training_sword")).toMatchObject({
      itemLevel: 5,
      baseStats: { attack: 2, defense: 0 },
      maxDurability: 100,
      affixable: true
    });
    expect(getItemById("patched_leather_vest")).toMatchObject({
      itemLevel: 5,
      baseStats: { attack: 0, defense: 2 },
      maxDurability: 100,
      affixable: true
    });
  });

  it("defines complete and valid equipment fields", () => {
    const equipment = ITEM_DEFINITIONS.filter((item) => item.category === "equipment");

    expect(equipment.length).toBeGreaterThanOrEqual(2);
    for (const item of equipment) {
      expect(EQUIPMENT_SLOTS).toContain(item.slot);
      expect(item.itemLevel).toBeGreaterThanOrEqual(1);
      expect(item.maxDurability).toBeGreaterThan(0);
      expect(typeof item.affixable).toBe("boolean");
      expect(Object.values(item.baseStats).some((value) => value > 0)).toBe(true);
      for (const value of Object.values(item.baseStats)) {
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("defines base affix pools with valid slot references and numeric ranges", () => {
    expect(AFFIX_POOLS.map((affix) => affix.stat)).toEqual(
      expect.arrayContaining([
        "attack",
        "defense",
        "agility",
        "maxHp",
        "gatherSpeedPct",
        "repairDiscountPct"
      ])
    );

    for (const affix of AFFIX_POOLS) {
      expect(affix.applicableSlots.length).toBeGreaterThan(0);
      for (const slot of affix.applicableSlots) {
        expect(EQUIPMENT_SLOTS).toContain(slot);
      }
      for (const tier of affix.tiers) {
        expect(tier.minItemLevel).toBeGreaterThanOrEqual(1);
        expect(tier.valueMin).toBeLessThanOrEqual(tier.valueMax);
        expect(tier.valueMax).toBeGreaterThan(0);
      }
    }
  });
});
