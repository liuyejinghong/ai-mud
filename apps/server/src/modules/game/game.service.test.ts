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
  it("only exposes the played combat log prefix for active combat", () => {
    const service = new GameService({} as Db);
    const startedAt = new Date("2026-07-02T08:00:00.000Z");
    const dto = (service as unknown as {
      toCurrentActionDto(action: CharacterActionRecord, now: Date): { combatLog: string[] };
    }).toCurrentActionDto(
      {
        ...combatAction({
          encounterId: "corrupt_wolf_pack_01",
          combatLog: ["旧日志不应直接透出"],
          combatTimeline: [
            { atMs: 1_000, message: "Zichen 攻击腐化野狼，造成 16 点伤害。" },
            { atMs: 5_000, message: "腐化野狼 撕咬Zichen，造成 7 点伤害。" }
          ],
          expectedEndsAtMs: startedAt.getTime() + 10_000,
          outcome: "victory",
          playerRemainingHp: 73,
          xp: 12,
          loot: []
        }),
        startedAt,
        endsAt: new Date(startedAt.getTime() + 10_000)
      },
      new Date(startedAt.getTime() + 2_000)
    );

    expect(dto.combatLog).toEqual(["Zichen 攻击腐化野狼，造成 16 点伤害。"]);
  });

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
      listItemInstances: async () => {
        calls.push("listItemInstances");
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
      encounterId: "corrupt_wolf_pack_01",
      combatLog: ["Zichen 攻击腐化野狼，造成 16 点伤害。"],
      combatTimeline: [{ atMs: 1_000, message: "Zichen 攻击腐化野狼，造成 16 点伤害。" }],
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

  it("grants combat equipment loot as item instances instead of stack quantities", async () => {
    const service = new GameService({} as Db);
    const stackGrants: Array<{ itemId: string; quantity: number }> = [];
    const instanceGrants: Array<{ itemDefId: string; seed: string; reason: string }> = [];
    const cooldowns: Array<Record<string, string>> = [];
    const repo = {
      markActionCompleted: async () => true,
      grantCharacterItem: async (input: { itemId: string; quantity: number }) => {
        stackGrants.push(input);
      },
      grantCharacterItemInstance: async (input: {
        itemDefId: string;
        seed: string;
        reason: string;
      }) => {
        instanceGrants.push(input);
      },
      writeEvent: async () => {},
      listEquipment: async () => [],
      listItemInstances: async () => [],
      updateEquipmentDurability: async () => {},
      updateCharacterVitals: async () => {},
      updateCharacterLocation: async () => {},
      findMapInstance: async () => ({
        id: "map-1",
        characterId: "character-1",
        zoneId: "corrupt_forest",
        resourceCharges: {},
        encounterCooldowns: {}
      }),
      updateMapEncounterCooldowns: async (_mapId: string, input: Record<string, string>) => {
        cooldowns.push(input);
      }
    };
    const payload: CombatActionPayload = {
      encounterId: "corrupt_wolf_pack_01",
      combatLog: ["Zichen 攻击腐化野狼，造成 16 点伤害。"],
      combatTimeline: [{ atMs: 1_000, message: "Zichen 攻击腐化野狼，造成 16 点伤害。" }],
      expectedEndsAtMs: new Date("2026-07-02T08:01:00.000Z").getTime(),
      outcome: "victory",
      playerRemainingHp: 64,
      xp: 12,
      loot: [
        { itemId: "rough_hide", quantity: 2 },
        { itemId: "training_sword", quantity: 1 }
      ]
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

    expect(stackGrants).toMatchObject([{ itemId: "rough_hide", quantity: 2 }]);
    expect(instanceGrants).toMatchObject([
      {
        itemDefId: "training_sword",
        seed: "action-1:training_sword:0",
        reason: "action.combat.loot"
      }
    ]);
    expect(cooldowns[0]?.corrupt_wolf_pack_01).toBe("2026-07-02T08:11:00.000Z");
  });

  it("levels up from combat xp and writes a sync feedback event", async () => {
    const service = new GameService({} as Db);
    const vitals: Array<{ level?: number; xp?: number }> = [];
    const syncEvents: Array<{
      audience?: "character" | "public";
      eventType: string;
      payload: Record<string, unknown>;
    }> = [];
    const cooldowns: Array<Record<string, string>> = [];
    const repo = {
      markActionCompleted: async () => true,
      writeEvent: async () => {},
      writeSyncEvent: async (input: { eventType: string; payload: Record<string, unknown> }) => {
        syncEvents.push(input);
      },
      listEquipment: async () => [],
      listItemInstances: async () => [],
      updateEquipmentDurability: async () => {},
      updateCharacterVitals: async (input: { level?: number; xp?: number }) => {
        vitals.push(input);
      },
      updateCharacterLocation: async () => {},
      findMapInstance: async () => ({
        id: "map-1",
        characterId: "character-1",
        zoneId: "corrupt_forest",
        resourceCharges: {},
        encounterCooldowns: {}
      }),
      updateMapEncounterCooldowns: async (_mapId: string, input: Record<string, string>) => {
        cooldowns.push(input);
      }
    };
    const payload: CombatActionPayload = {
      encounterId: "corrupt_wolf_pack_01",
      combatLog: [],
      combatTimeline: [],
      expectedEndsAtMs: new Date("2026-07-02T08:01:00.000Z").getTime(),
      outcome: "victory",
      playerRemainingHp: 64,
      xp: 48,
      loot: []
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
      character({ level: 1, xp: 0 }),
      combatAction(payload),
      new Date("2026-07-02T08:01:00.000Z")
    );

    expect(vitals).toMatchObject([{ level: 2, xp: 48 }]);
    expect(syncEvents).toMatchObject([
      {
        eventType: "character.level_up",
        owner: { ownerType: "character", ownerId: "character-1" },
        stateDirty: true,
        payload: { previousLevel: 1, level: 2, xp: 48 }
      },
      {
        audience: "public",
        eventType: "world.broadcast",
        owner: { ownerType: "character", ownerId: "character-1" },
        stateDirty: false,
        payload: {
          kind: "level_up",
          characterId: "character-1",
          characterName: "Zichen",
          level: 2
        }
      }
    ]);
    expect(cooldowns[0]?.corrupt_wolf_pack_01).toBe("2026-07-02T08:11:00.000Z");
  });

  it("hides cooled down encounters from map state and combat actions", async () => {
    const service = new GameService({} as Db);
    const repo = {
      findCharacterByAccountId: async () =>
        character({
          currentLocation: "old_mine",
          position: { x: 2, y: 2 }
        }),
      listInventory: async () => [],
      listEquipment: async () => [],
      listItemInstances: async () => [],
      listRecentEvents: async () => [],
      findActiveActionByCharacterId: async () => null,
      findMapInstance: async () => ({
        id: "map-1",
        characterId: "character-1",
        zoneId: "old_mine",
        resourceCharges: {},
        encounterCooldowns: {
          old_mine_rat_pack_01: "2026-07-02T08:10:00.000Z"
        }
      })
    };

    const state = await (service as unknown as {
      buildState(repo: object, accountId: string, now: Date): Promise<{
        availableActions: string[];
        map: { cells: Array<{ x: number; y: number; markers: string[] }> } | null;
      }>;
    }).buildState(repo, "account-1", new Date("2026-07-02T08:05:00.000Z"));

    expect(state.availableActions).not.toContain("start_combat");
    expect(state.map?.cells.find((cell) => cell.x === 2 && cell.y === 2)?.markers).not.toContain(
      "encounter"
    );
  });

  it("applies played combat damage and durability loss when escaping", async () => {
    const service = new GameService({} as Db);
    const calls: string[] = [];
    const vitals: Array<{ hp: number; xp?: number }> = [];
    const durabilityUpdates: Array<{ equipmentId: string; currentDurability: number }> = [];
    const repo = {
      updateCharacterVitals: async (input: { hp: number; xp?: number }) => {
        calls.push("updateCharacterVitals");
        vitals.push(input);
      },
      listEquipment: async () => {
        calls.push("listEquipment");
        return [
          {
            id: "weapon-1",
            slot: "weapon" as const,
            itemKey: "training_sword",
            name: "训练短剑",
            itemLevel: 5,
            attackBonus: 2,
            defenseBonus: 0,
            currentDurability: 10,
            maxDurability: 10
          }
        ];
      },
      listItemInstances: async () => {
        calls.push("listItemInstances");
        return [];
      },
      updateEquipmentDurability: async (input: {
        equipmentId: string;
        currentDurability: number;
      }) => {
        calls.push("updateEquipmentDurability");
        durabilityUpdates.push(input);
      }
    };
    const startedAt = new Date("2026-07-02T08:00:00.000Z");
    const payload: CombatActionPayload = {
      encounterId: "corrupt_wolf_pack_01",
      combatLog: [],
      combatTimeline: [
        { atMs: 1_000, message: "Zichen 攻击腐化野狼，造成 16 点伤害。" },
        { atMs: 2_000, message: "腐化野狼 撕咬Zichen，造成 7 点伤害。" },
        { atMs: 8_000, message: "腐化野狼 撕咬Zichen，造成 99 点伤害。" }
      ],
      expectedEndsAtMs: startedAt.getTime() + 10_000,
      outcome: "injury",
      playerRemainingHp: 0,
      xp: 0,
      loot: []
    };

    await (service as unknown as {
      settleCombatEscapeCost(
        repo: object,
        character: CharacterRecord,
        action: CharacterActionRecord,
        now: Date
      ): Promise<void>;
    }).settleCombatEscapeCost(
      repo,
      character({ hp: 80, xp: 4 }),
      { ...combatAction(payload), startedAt, endsAt: new Date(startedAt.getTime() + 10_000) },
      new Date(startedAt.getTime() + 2_500)
    );

    expect(vitals).toEqual([{ characterId: "character-1", hp: 73 }]);
    expect(durabilityUpdates).toEqual([
      { equipmentId: "weapon-1", currentDurability: 8, maxDurability: 10 }
    ]);
    expect(calls).toEqual([
      "updateCharacterVitals",
      "listEquipment",
      "listItemInstances",
      "updateEquipmentDurability"
    ]);
  });
});
