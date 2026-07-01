import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("exposes the v0.2 product line and compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("0.2.0");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 2,
      engineVersion: 1,
      rulesetVersion: 2,
      contentVersion: 2,
      promptVersion: 1,
      economyVersion: 1,
      worldSeedVersion: 1
    });
  });
});
