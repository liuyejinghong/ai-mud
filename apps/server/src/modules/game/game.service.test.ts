import { describe, expect, it } from "vitest";
import type { Db } from "../../db/client.js";
import { GameService } from "./game.service.js";
import type { CharacterActionRecord, CharacterRecord, CombatActionPayload } from "./game.repository.js";

function character(overrides: Partial<CharacterRecord> = {}): CharacterRecord {
  return {
    id: "character-1",
    accountId: "account-1",
    name: "Zichen",
    classId: "ranger",
    level: 1,
    xp: 0,
    hp: 80,
    maxHp: 100,
    copperBalance: 0,
    hunger: 5,
    lastHungerSettledAt: new Date("2026-07-02T08:00:00.000Z"),
    currentLocation: "corrupt_forest",
    position: { x: 2, y: 3 },
    injuryUntil: null,
    ...overrides
  };
}

function combatAction(payload: CombatActionPayload): CharacterActionRecord {
  return {
    id: "action-1",
    characterId: "character-1",
    actionType: "combat",
    status: "active",
    startedAt: new Date("2026-07-02T08:00:00.000Z"),
    endsAt: new Date("2026-07-02T08:01:00.000Z"),
    payload
  };
}

describe("GameService action settlement", () => {
  it("does not grant combat rewards when the completion mark loses the race", async () => {
    const service = new GameService({} as Db);
    const calls: string[] = [];
    const repo = {
      markActionCompleted: async () => {
        calls.push("mark");
        return false;
      },
      listInventory: async () => {
        calls.push("listInventory");
        return [];
      },
      setInventoryItem: async () => {
        calls.push("setInventoryItem");
      },
      writeEvent: async () => {
        calls.push("writeEvent");
      },
      listEquipment: async () => {
        calls.push("listEquipment");
        return [];
      },
      updateEquipmentDurability: async () => {
        calls.push("updateEquipmentDurability");
      },
      updateCharacterVitals: async () => {
        calls.push("updateCharacterVitals");
      },
      updateCharacterLocation: async () => {
        calls.push("updateCharacterLocation");
      }
    };
    const payload: CombatActionPayload = {
      encounterId: "forest_wolf_pack",
      combatLog: ["Zichen 攻击腐化野狼，造成 16 点伤害。"],
      expectedEndsAtMs: new Date("2026-07-02T08:01:00.000Z").getTime(),
      outcome: "victory",
      playerRemainingHp: 64,
      xp: 12,
      loot: [{ itemId: "rough_hide", quantity: 1 }]
    };

    await (service as unknown as {
      settleCombatAction(
        repo: object,
        character: CharacterRecord,
        action: CharacterActionRecord,
        now: Date
      ): Promise<void>;
    }).settleCombatAction(
      repo,
      character(),
      combatAction(payload),
      new Date("2026-07-02T08:01:00.000Z")
    );

    expect(calls).toEqual(["mark"]);
  });
});
