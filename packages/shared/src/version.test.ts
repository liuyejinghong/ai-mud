import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("exposes the v0.6.0 AI dialogue product line and compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("0.6.0");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 8,
      apiVersion: 9,
      engineVersion: 1,
      rulesetVersion: 7,
      contentVersion: 7,
      promptVersion: 2,
      economyVersion: 2,
      worldSeedVersion: 1
    });
  });
});
