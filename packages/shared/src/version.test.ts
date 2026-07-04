import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("exposes the v0.9.2 world broadcast product line and compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("0.9.2");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 19,
      apiVersion: 28,
      engineVersion: 2,
      rulesetVersion: 14,
      contentVersion: 12,
      promptVersion: 7,
      economyVersion: 2,
      worldSeedVersion: 1
    });
  });
});
