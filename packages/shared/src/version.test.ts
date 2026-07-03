import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("exposes the v0.8.2 zone registry product line and compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("0.8.2");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 17,
      apiVersion: 24,
      engineVersion: 2,
      rulesetVersion: 13,
      contentVersion: 11,
      promptVersion: 7,
      economyVersion: 2,
      worldSeedVersion: 1
    });
  });
});
