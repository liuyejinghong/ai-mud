import { describe, expect, it } from "vitest";
import {
  BLACKPINE_OUTPOST,
  CORRUPT_FOREST,
  FIRST_ENCOUNTERS,
  FIRST_ITEMS,
  FIRST_MONSTERS,
  getEncounterById,
  getItemById,
  getMonsterById,
  getResourceById
} from "./world.js";

describe("first world content", () => {
  it("defines Blackpine Outpost and a 5x5 Corrupt Forest", () => {
    expect(BLACKPINE_OUTPOST.id).toBe("blackpine_outpost");
    expect(CORRUPT_FOREST.width).toBe(5);
    expect(CORRUPT_FOREST.height).toBe(5);
    expect(CORRUPT_FOREST.entry).toEqual({ x: 2, y: 4 });
  });

  it("defines fixed resources with timed gathering cycles", () => {
    expect(FIRST_ITEMS.map((item) => item.id)).toEqual([
      "wild_berry",
      "beast_meat",
      "rough_hide",
      "iron_ore"
    ]);
    expect(getResourceById("forest_berry_patch_01")?.cycleSeconds).toBe(30);
    expect(getResourceById("fallen_carcass_01")?.cycleSeconds).toBe(45);
    expect(getResourceById("discarded_hide_01")?.cycleSeconds).toBe(60);
    expect(getResourceById("abandoned_iron_vein_01")?.cycleSeconds).toBe(60);
    expect(getItemById("wild_berry")?.name).toBe("野莓");
    expect(getItemById("wild_berry")).toMatchObject({
      category: "food",
      itemLevel: 1,
      satietyRestore: 1
    });
    expect(getItemById("beast_meat")).toMatchObject({
      category: "food",
      itemLevel: 1,
      satietyRestore: 1
    });
    expect(getItemById("iron_ore")).toMatchObject({
      name: "基础铁矿石",
      category: "ore",
      itemLevel: 1,
      baseBuyPriceCopper: 18,
      baseSellPriceCopper: 30,
      targetMarketQuantity: 80
    });
    expect(
      CORRUPT_FOREST.resources.some((resource) => resource.gatherResult.itemId === "iron_ore")
    ).toBe(true);
  });

  it("defines the first non-currency wolf encounter", () => {
    expect(FIRST_MONSTERS.map((monster) => monster.id)).toEqual(["corrupted_wolf"]);
    expect(getMonsterById("corrupted_wolf")?.lootTable).toEqual([
      { itemId: "beast_meat", quantity: 1, chance: 1 },
      { itemId: "rough_hide", quantity: 1, chance: 0.5 }
    ]);
    expect(getEncounterById("corrupt_wolf_pack_01")?.monsterIds).toEqual([
      "corrupted_wolf",
      "corrupted_wolf"
    ]);
    expect(FIRST_ENCOUNTERS[0]?.position).toEqual({ x: 3, y: 3 });
  });
});
