import { describe, expect, it } from "vitest";
import { PRODUCT_VERSION, WORLD_COMPATIBILITY } from "./version.js";

describe("version constants", () => {
  it("keeps v1.0.4 until release and exposes phase 0 compatibility versions", () => {
    expect(PRODUCT_VERSION).toBe("1.0.4");
    expect(WORLD_COMPATIBILITY).toEqual({
      schemaVersion: 35,
      apiVersion: 53,
      engineVersion: 4,
      rulesetVersion: 21,
      contentVersion: 17,
      promptVersion: 8,
      economyVersion: 7,
      worldSeedVersion: 3
    });
  });
});
