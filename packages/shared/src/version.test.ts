import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("exposes the v0.1 product line and compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("0.1.0");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 1,
      rulesetVersion: 1,
      contentVersion: 1,
      promptVersion: 1,
      economyVersion: 1,
      worldSeedVersion: 1
    });
  });
});
