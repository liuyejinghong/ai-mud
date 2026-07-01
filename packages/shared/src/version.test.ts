import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("exposes the v0.3 product line and compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("0.3.0");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 3,
      engineVersion: 1,
      rulesetVersion: 3,
      contentVersion: 3,
      promptVersion: 1,
      economyVersion: 1,
      worldSeedVersion: 1
    });
  });
});
