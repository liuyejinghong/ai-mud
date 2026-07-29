import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("exposes the v0.10.6 remediation release and compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("0.10.6");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 25,
      apiVersion: 39,
      engineVersion: 2,
      rulesetVersion: 16,
      contentVersion: 12,
      promptVersion: 8,
      economyVersion: 4,
      worldSeedVersion: 1
    });
  });
});
