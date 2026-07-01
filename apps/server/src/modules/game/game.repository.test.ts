import { describe, expect, it } from "vitest";
import {
  parseActionPayload,
  serializeEquipmentDurability,
  serializeHunger,
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

  it("serializes equipment durability with clamped integer values", () => {
    expect(serializeEquipmentDurability({ currentDurability: 150, maxDurability: 100 })).toEqual({
      currentDurability: 100,
      maxDurability: 100
    });
    expect(serializeEquipmentDurability({ currentDurability: -5, maxDurability: 100 })).toEqual({
      currentDurability: 0,
      maxDurability: 100
    });
  });

  it("serializes hunger with clamped integer values", () => {
    expect(serializeHunger(8)).toBe(5);
    expect(serializeHunger(-1)).toBe(0);
    expect(serializeHunger(2.8)).toBe(2);
  });
});
