import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("exposes the v0.12.0 base-operations release and compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("1.0.0");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 31,
      apiVersion: 47,
      engineVersion: 2,
      rulesetVersion: 17,
      contentVersion: 14,
      promptVersion: 8,
      economyVersion: 5,
      worldSeedVersion: 2
    });
  });
});
