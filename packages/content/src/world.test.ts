import { describe, expect, it } from "vitest";
import { BLACKPINE_OUTPOST, CORRUPT_FOREST, FIRST_ITEMS, getResourceById } from "./world.js";

describe("first world content", () => {
  it("defines Blackpine Outpost and a 5x5 Corrupt Forest", () => {
    expect(BLACKPINE_OUTPOST.id).toBe("blackpine_outpost");
    expect(CORRUPT_FOREST.width).toBe(5);
    expect(CORRUPT_FOREST.height).toBe(5);
    expect(CORRUPT_FOREST.entry).toEqual({ x: 2, y: 4 });
  });

  it("defines fixed resources and first inventory items", () => {
    expect(FIRST_ITEMS.map((item) => item.id)).toEqual(["wild_berry", "beast_meat", "rough_hide"]);
    expect(getResourceById("forest_berry_patch_01")?.gatherResult.itemId).toBe("wild_berry");
  });
});
