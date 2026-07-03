import { describe, expect, it } from "vitest";
import {
  BLACKPINE_OUTPOST,
  ASH_WATCH,
  CORRUPT_FOREST,
  FIRST_ENCOUNTERS,
  FIRST_ITEMS,
  FIRST_MONSTERS,
  FIRST_NPCS,
  OLD_MINE,
  WORLD_ZONES,
  getEncounterById,
  getMonsterById,
  getNpcByKey,
  getResourceById,
  getZoneById,
  getZoneByResourceId
} from "./world.js";
import { getItemById } from "./items.js";

describe("first world content", () => {
  it("defines Blackpine Outpost and a 5x5 Corrupt Forest", () => {
    expect(BLACKPINE_OUTPOST.id).toBe("blackpine_outpost");
    expect(CORRUPT_FOREST.width).toBe(5);
    expect(CORRUPT_FOREST.height).toBe(5);
    expect(CORRUPT_FOREST.entry).toEqual({ x: 2, y: 4 });
  });

  it("registers every explorable zone through the world zone registry", () => {
    expect(WORLD_ZONES.map((zone) => zone.id)).toEqual([
      "corrupt_forest",
      "old_mine",
      "ash_watch"
    ]);
    expect(getZoneById("corrupt_forest")).toBe(CORRUPT_FOREST);
    expect(getZoneById("old_mine")).toBe(OLD_MINE);
    expect(getZoneById("ash_watch")).toBe(ASH_WATCH);
    expect(OLD_MINE.resources.map((resource) => resource.id)).toEqual([
      "old_mine_iron_vein_01",
      "old_mine_coppery_iron_vein_01"
    ]);
    expect(OLD_MINE.encounters.map((encounter) => encounter.id)).toEqual([
      "old_mine_rat_pack_01",
      "old_mine_raider_boss_01"
    ]);
    expect(ASH_WATCH.width).toBe(3);
  });

  it("defines fixed resources with timed gathering cycles", () => {
    expect(FIRST_ITEMS.map((item) => item.id)).toEqual([
      "wild_berry",
      "beast_meat",
      "rough_hide",
      "iron_ore"
    ]);
    expect(getResourceById("forest_berry_patch_01")?.cycleSeconds).toBe(30);
    expect(getZoneByResourceId("forest_berry_patch_01")?.id).toBe("corrupt_forest");
    expect(getZoneByResourceId("old_mine_iron_vein_01")?.id).toBe("old_mine");
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
    expect(FIRST_MONSTERS.map((monster) => monster.id)).toEqual([
      "corrupted_wolf",
      "mine_rat",
      "mine_raider_boss"
    ]);
    expect(getMonsterById("corrupted_wolf")?.lootTable).toEqual([
      { itemId: "beast_meat", quantity: 1, chance: 1 },
      { itemId: "rough_hide", quantity: 1, chance: 0.5 },
      { itemId: "wolfbone_shiv", quantity: 1, chance: 0.2 }
    ]);
    expect(getEncounterById("corrupt_wolf_pack_01")?.monsterIds).toEqual([
      "corrupted_wolf",
      "corrupted_wolf"
    ]);
    expect(FIRST_ENCOUNTERS[0]?.position).toEqual({ x: 3, y: 3 });
  });

  it("defines Old Mine encounters with stronger monsters and T2 equipment drops", () => {
    expect(getMonsterById("mine_rat")).toMatchObject({
      hp: 48,
      xp: 14
    });
    expect(getMonsterById("mine_raider_boss")).toMatchObject({
      hp: 90,
      xp: 30
    });
    expect(getEncounterById("old_mine_rat_pack_01")?.monsterIds).toEqual([
      "mine_rat",
      "mine_rat"
    ]);
    expect(getEncounterById("old_mine_raider_boss_01")?.monsterIds).toEqual([
      "mine_raider_boss"
    ]);
    expect(
      getMonsterById("mine_raider_boss")?.lootTable.filter(
        (drop) => getItemById(drop.itemId)?.category === "equipment"
      )
    ).toEqual([
      { itemId: "rusted_mine_cleaver", quantity: 1, chance: 0.35 },
      { itemId: "miner_guard_harness", quantity: 1, chance: 0.25 }
    ]);
  });

  it("gives the first encounter an equipment drop entry", () => {
    const equipmentDrops =
      getMonsterById("corrupted_wolf")?.lootTable.filter(
        (drop) => getItemById(drop.itemId)?.category === "equipment"
      ) ?? [];

    expect(equipmentDrops).toEqual([
      { itemId: "wolfbone_shiv", quantity: 1, chance: 0.2 }
    ]);
  });

  it("defines the first persistent Living NPCs", () => {
    expect(FIRST_NPCS.map((npc) => npc.key)).toEqual([
      "blackpine_farmer_mara",
      "blackpine_miner_torin",
      "blackpine_blacksmith_borin",
      "blackpine_officer_elian"
    ]);
    expect(getNpcByKey("blackpine_farmer_mara")).toMatchObject({
      name: "玛拉",
      profession: "farmer",
      workResourceId: "forest_berry_patch_01",
      producesItemId: "wild_berry"
    });
    expect(getNpcByKey("blackpine_miner_torin")).toMatchObject({
      name: "托林",
      profession: "miner",
      workResourceId: "abandoned_iron_vein_01",
      producesItemId: "iron_ore"
    });
    expect(getNpcByKey("blackpine_blacksmith_borin")).toMatchObject({
      name: "伯林",
      profession: "blacksmith",
      demandItemIds: ["iron_ore"]
    });
    expect(getNpcByKey("blackpine_officer_elian")).toMatchObject({
      name: "艾廉",
      profession: "municipal_officer",
      paysWages: true
    });
  });
});
