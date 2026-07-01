import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("exposes the v0.5.0 Living NPC product line and compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("0.5.0");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 7,
      apiVersion: 8,
      engineVersion: 1,
      rulesetVersion: 7,
      contentVersion: 7,
      promptVersion: 1,
      economyVersion: 2,
      worldSeedVersion: 1
    });
  });
});
