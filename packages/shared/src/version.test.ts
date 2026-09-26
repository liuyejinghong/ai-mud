import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("keeps v1.0.1 until release and exposes phase 0 compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("1.0.1");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 33,
      apiVersion: 50,
      engineVersion: 4,
      rulesetVersion: 19,
      contentVersion: 16,
      promptVersion: 8,
      economyVersion: 6,
      worldSeedVersion: 3
    });
  });
});
