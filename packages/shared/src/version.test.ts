import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("exposes the v0.8.1 loot slice product line and compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("0.8.1");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 16,
      apiVersion: 23,
      engineVersion: 2,
      rulesetVersion: 12,
      contentVersion: 10,
      promptVersion: 7,
      economyVersion: 2,
      worldSeedVersion: 1
    });
  });
});
