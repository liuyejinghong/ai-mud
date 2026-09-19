import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("exposes the v0.12.0 base-operations release and compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("0.12.0");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 29,
      apiVersion: 42,
      engineVersion: 2,
      rulesetVersion: 17,
      contentVersion: 13,
      promptVersion: 8,
      economyVersion: 4,
      worldSeedVersion: 2
    });
  });
});
