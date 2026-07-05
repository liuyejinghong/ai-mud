import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("exposes the v0.10.3 world reset product line and compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("0.10.3");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 20,
      apiVersion: 33,
      engineVersion: 2,
      rulesetVersion: 14,
      contentVersion: 12,
      promptVersion: 8,
      economyVersion: 2,
      worldSeedVersion: 1
    });
  });
});
