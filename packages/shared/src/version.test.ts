import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("exposes the v0.4.1 durability product line and compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("0.4.1");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 5,
      engineVersion: 1,
      rulesetVersion: 5,
      contentVersion: 4,
      promptVersion: 1,
      economyVersion: 1,
      worldSeedVersion: 1
    });
  });
});
