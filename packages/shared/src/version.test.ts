import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("exposes the v0.6.5 NPC resource request product line and compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("0.6.5");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 10,
      apiVersion: 14,
      engineVersion: 1,
      rulesetVersion: 9,
      contentVersion: 7,
      promptVersion: 4,
      economyVersion: 2,
      worldSeedVersion: 1
    });
  });
});
