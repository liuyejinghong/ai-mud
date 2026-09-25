import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("exposes the v1.0.1 review-remediation release and compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("1.0.1");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 31,
      apiVersion: 48,
      engineVersion: 2,
      rulesetVersion: 17,
      contentVersion: 15,
      promptVersion: 8,
      economyVersion: 5,
      worldSeedVersion: 2
    });
  });
});
