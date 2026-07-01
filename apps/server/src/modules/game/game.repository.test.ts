import { describe, expect, it } from "vitest";
import {
  parseActionPayload,
  serializeEquipmentDurability,
  serializeHunger,
  serializeActionPayload,
  serializeMarketTransaction,
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

  it("serializes market transactions for economy visibility", () => {
    const createdAt = new Date("2026-07-01T12:00:00.000Z");

    expect(
      serializeMarketTransaction({
        id: "tx-1",
        settlementId: "blackpine_outpost",
        characterId: "character-1",
        actorType: "player",
        actorId: "character-1",
        actorName: "测试角色",
        transactionType: "sell",
        itemId: "wild_berry",
        quantity: 3,
        unitPriceCopper: 6,
        grossCopper: 18,
        taxCopper: 1,
        netCopper: 17,
        createdAt
      })
    ).toEqual({
      id: "tx-1",
      settlementId: "blackpine_outpost",
      characterId: "character-1",
      actorType: "player",
      actorId: "character-1",
      actorName: "测试角色",
      transactionType: "sell",
      itemId: "wild_berry",
      quantity: 3,
      unitPriceCopper: 6,
      grossCopper: 18,
      taxCopper: 1,
      netCopper: 17,
      createdAt
    });
  });
});
