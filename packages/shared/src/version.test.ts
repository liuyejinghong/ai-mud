import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("exposes the v0.4.3 economy visibility product line and compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("0.4.3");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 6,
      apiVersion: 7,
      engineVersion: 1,
      rulesetVersion: 6,
      contentVersion: 6,
      promptVersion: 1,
      economyVersion: 1,
      worldSeedVersion: 1
    });
  });
});
