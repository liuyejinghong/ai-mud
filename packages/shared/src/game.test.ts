import { describe, expect, it } from "vitest";
import { CHARACTER_CLASSES, GAME_LOCATIONS, isDirection } from "./game.js";
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

  it("exposes v0.2.0 engine compatibility", () => {
    expect(PRODUCT_VERSION).toBe("0.2.0");
    expect(WORLD_COMPATIBILITY.engineVersion).toBe(1);
    expect(WORLD_COMPATIBILITY.rulesetVersion).toBe(2);
    expect(WORLD_COMPATIBILITY.contentVersion).toBe(2);
  });
});
