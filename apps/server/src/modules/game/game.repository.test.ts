import { describe, expect, it } from "vitest";
import {
  parseActionPayload,
  serializeActionPayload,
  serializeResourceCharges,
  type GatheringActionPayload
} from "./game.repository.js";

describe("game repository helpers", () => {
  it("serializes resource charges for the map state json", () => {
    expect(serializeResourceCharges({ forest_berry_patch_01: 2 })).toEqual({
      forest_berry_patch_01: 2
    });
  });

  it("round-trips gathering action payloads", () => {
    const payload: GatheringActionPayload = {
      resourceId: "forest_berry_patch_01",
      itemId: "wild_berry",
      itemName: "野莓",
      quantityPerCycle: 2,
      cycleMs: 30000,
      plannedCycles: 20,
      settledCycles: 3
    };

    expect(parseActionPayload("gathering", serializeActionPayload(payload))).toEqual(payload);
  });
});
