import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("exposes the v0.11.0 modular-convergence release and compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("0.11.0");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 28,
      apiVersion: 41,
      engineVersion: 2,
      rulesetVersion: 17,
      contentVersion: 12,
      promptVersion: 8,
      economyVersion: 4,
      worldSeedVersion: 1
    });
  });
});
