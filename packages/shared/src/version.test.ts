import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("exposes the v0.6.7 AI memory compression product line and compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("0.6.7");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 10,
      apiVersion: 16,
      engineVersion: 1,
      rulesetVersion: 10,
      contentVersion: 7,
      promptVersion: 5,
      economyVersion: 2,
      worldSeedVersion: 1
    });
  });
});
