import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("exposes the v0.10.5 world health product line and compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("0.10.5");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 21,
      apiVersion: 35,
      engineVersion: 2,
      rulesetVersion: 14,
      contentVersion: 12,
      promptVersion: 8,
      economyVersion: 3,
      worldSeedVersion: 1
    });
  });
});
