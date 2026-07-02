import { FIRST_MONSTERS } from "@ai-mud/content";
import { describe, expect, it } from "vitest";
import {
  mergeRolledDrops,
  rollDropTable,
  rollEncounterLoot,
  rollRarity
} from "./loot-rules.js";

describe("loot rules", () => {
  it("rolls a drop table deterministically from seed and entries", () => {
    const entries = FIRST_MONSTERS[0]!.lootTable;
    const first = rollDropTable({ seed: "loot-seed", sourceId: "wolf", entries });
    const second = rollDropTable({ seed: "loot-seed", sourceId: "wolf", entries });

    expect(first).toEqual(second);
    expect(first.some((drop) => drop.itemId === "beast_meat")).toBe(true);
    expect(first.every((drop) => drop.sourceId === "wolf")).toBe(true);
  });

  it("merges encounter loot into stack quantities without adding currency", () => {
    const loot = rollEncounterLoot({
      seed: "encounter-seed",
      encounters: [
        { id: "wolf-a", lootTable: FIRST_MONSTERS[0]!.lootTable },
        { id: "wolf-b", lootTable: FIRST_MONSTERS[0]!.lootTable }
      ]
    });

    expect(loot.every((drop) => drop.itemId !== ("gold" as never))).toBe(true);
    expect(loot.find((drop) => drop.itemId === "beast_meat")?.quantity).toBe(2);
  });

  it("merges repeated item drops by item id", () => {
    expect(
      mergeRolledDrops([
        { itemId: "wild_berry", quantity: 1 },
        { itemId: "wild_berry", quantity: 2 },
        { itemId: "iron_ore", quantity: 1 }
      ])
    ).toEqual([
      { itemId: "wild_berry", quantity: 3 },
      { itemId: "iron_ore", quantity: 1 }
    ]);
  });

  it("keeps rarity distribution close to configured weights across many seeds", () => {
    const counts = { common: 0, uncommon: 0, rare: 0, epic: 0 };

    for (let i = 0; i < 5000; i += 1) {
      counts[rollRarity(`rarity-${i}`, i)] += 1;
    }

    expect(counts.common).toBeGreaterThan(3600);
    expect(counts.common).toBeLessThan(4400);
    expect(counts.uncommon).toBeGreaterThan(600);
    expect(counts.uncommon).toBeLessThan(1100);
    expect(counts.rare).toBeGreaterThan(100);
    expect(counts.rare).toBeLessThan(300);
    expect(counts.epic).toBeGreaterThan(5);
    expect(counts.epic).toBeLessThan(80);
  });
});
