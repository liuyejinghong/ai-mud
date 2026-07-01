import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("exposes the v0.6.1 NPC memory product line and compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("0.6.1");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 9,
      apiVersion: 10,
      engineVersion: 1,
      rulesetVersion: 7,
      contentVersion: 7,
      promptVersion: 3,
      economyVersion: 2,
      worldSeedVersion: 1
    });
  });
});
