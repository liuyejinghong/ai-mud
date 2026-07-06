import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("exposes the v0.10.4 asset ledger product line and compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("0.10.4");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 21,
      apiVersion: 34,
      engineVersion: 2,
      rulesetVersion: 14,
      contentVersion: 12,
      promptVersion: 8,
      economyVersion: 3,
      worldSeedVersion: 1
    });
  });
});
