import { describe, expect, it } from "vitest";
import { serializeResourceCharges } from "./game.repository.js";

describe("game repository helpers", () => {
  it("serializes resource charges for the map state json", () => {
    expect(serializeResourceCharges({ forest_berry_patch_01: 2 })).toEqual({
      forest_berry_patch_01: 2
    });
  });
});
