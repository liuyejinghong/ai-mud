import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("exposes the v0.9.3 offline report product line and compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("0.9.3");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 19,
      apiVersion: 29,
      engineVersion: 2,
      rulesetVersion: 14,
      contentVersion: 12,
      promptVersion: 8,
      economyVersion: 2,
      worldSeedVersion: 1
    });
  });
});
