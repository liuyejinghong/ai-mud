import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("exposes the v0.6.4 AI task copy product line and compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("0.6.4");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 10,
      apiVersion: 13,
      engineVersion: 1,
      rulesetVersion: 8,
      contentVersion: 7,
      promptVersion: 4,
      economyVersion: 2,
      worldSeedVersion: 1
    });
  });
});
