import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("exposes the v0.6.3 dialogue task bridge product line and compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("0.6.3");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 10,
      apiVersion: 12,
      engineVersion: 1,
      rulesetVersion: 8,
      contentVersion: 7,
      promptVersion: 3,
      economyVersion: 2,
      worldSeedVersion: 1
    });
  });
});
