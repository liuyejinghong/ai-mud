import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("exposes the v0.7.1 critical debt repair product line and compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("0.7.1");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 13,
      apiVersion: 19,
      engineVersion: 1,
      rulesetVersion: 10,
      contentVersion: 7,
      promptVersion: 7,
      economyVersion: 2,
      worldSeedVersion: 1
    });
  });
});
