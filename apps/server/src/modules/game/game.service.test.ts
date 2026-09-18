import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../db/client.js";
import { AssetMutationService, type AssetMutationPort } from "../ledger/asset-mutation.service.js";
import type { GameStateDto } from "@ai-mud/shared";
import { hashRequest } from "../ledger/asset-mutation.service.js";
import { LedgerService } from "../ledger/ledger.service.js";
import { LobbyRepository } from "../lobby/lobby.repository.js";
import {
  GameRepository,
  type CharacterActionRecord,
  type CharacterRecord,
  type CombatActionPayload,
  type EquipmentRecord,
  type GatheringActionPayload
} from "./game.repository.js";
import { GameService, GameServiceError } from "./game.service.js";

afterEach(() => {
  vi.restoreAllMocks();
});

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
    lastReliefClaimedAt: null,
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

function gatheringAction(payload: GatheringActionPayload): CharacterActionRecord {
  return {
    id: "gather-action-1",
    characterId: "character-1",
    actionType: "gathering",
    status: "active",
    startedAt: new Date("2026-07-02T08:00:00.000Z"),
    endsAt: new Date("2026-07-02T08:08:00.000Z"),
    payload
  };
}

interface GatheringSettlementResult {
  changed: boolean;
  settledCycles: number;
  quantityGranted: number;
  completed: boolean;
}

type GatheringSettlementService = {
  settleGatheringAction(
    repo: object,
    characterId: string,
    now: Date,
    options: { completeAction: boolean; cancelAction?: boolean }
  ): Promise<GatheringSettlementResult>;
};

function gatheringPayload(
  overrides: Partial<GatheringActionPayload> = {}
): GatheringActionPayload {
  return {
    resourceId: "old_mine_iron_vein_01",
    itemId: "iron_ore",
    itemName: "基础铁矿石",
    quantityPerCycle: 1,
    cycleMs: 60_000,
    plannedCycles: 8,
    settledCycles: 0,
    ...overrides
  };
}

function transactionDb() {
  return {
    transaction: vi.fn(async (operation: (tx: object) => Promise<unknown>) => operation({}))
  } as unknown as Db;
}

type VillageExitService = {
  requireCanLeaveVillage(character: CharacterRecord, now: Date): void;
};

function arrangeReadableSync(input: {
  character: CharacterRecord;
  activeAction?: CharacterActionRecord | null;
}) {
  let currentCharacter = input.character;
  let activeAction = input.activeAction ?? null;

  vi.spyOn(GameRepository.prototype, "findCharacterByAccountId").mockImplementation(
    async () => currentCharacter
  );
  vi.spyOn(GameRepository.prototype, "findCharacterByAccountIdForUpdate").mockImplementation(
    async () => currentCharacter
  );
  vi.spyOn(GameRepository.prototype, "findActiveActionByCharacterId").mockImplementation(
    async () => activeAction
  );
  vi.spyOn(GameRepository.prototype, "findActiveActionForUpdate").mockImplementation(
    async () => (activeAction?.actionType === "gathering" ? activeAction : null)
  );
  vi.spyOn(GameRepository.prototype, "listSyncEvents").mockResolvedValue([]);
  vi.spyOn(GameRepository.prototype, "listInventory").mockResolvedValue([]);
  vi.spyOn(GameRepository.prototype, "listItemInstances").mockResolvedValue([]);
  vi.spyOn(GameRepository.prototype, "listItemInstances").mockResolvedValue([]);
  vi.spyOn(GameRepository.prototype, "listRecentEvents").mockResolvedValue([]);
  vi.spyOn(GameRepository.prototype, "findMapInstance").mockResolvedValue(null);
  vi.spyOn(GameRepository.prototype, "writeEvent").mockResolvedValue();
  vi.spyOn(GameRepository.prototype, "updateCharacterNeeds").mockImplementation(async (update) => {
    currentCharacter = {
      ...currentCharacter,
      hunger: update.hunger,
      lastHungerSettledAt: update.lastHungerSettledAt
    };
  });
  vi.spyOn(GameRepository.prototype, "updateCharacterVitals").mockImplementation(async (update) => {
    currentCharacter = {
      ...currentCharacter,
      hp: update.hp,
      ...(update.level === undefined ? {} : { level: update.level }),
      ...(update.xp === undefined ? {} : { xp: update.xp }),
      ...(update.injuryUntil === undefined ? {} : { injuryUntil: update.injuryUntil })
    };
  });
  vi.spyOn(GameRepository.prototype, "markActionCompleted").mockImplementation(async () => {
    if (!activeAction) return false;
    activeAction = null;
    return true;
  });

  vi.spyOn(LobbyRepository.prototype, "listChatMessagesByIds").mockResolvedValue([]);
  vi.spyOn(LobbyRepository.prototype, "listSystemAnnouncementsByIds").mockResolvedValue([]);
  vi.spyOn(LobbyRepository.prototype, "listActivePresence").mockResolvedValue([]);
  vi.spyOn(LobbyRepository.prototype, "listLeaderboard").mockResolvedValue([]);
}

describe("GameService readable settlement sync", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns newly settled hunger state with a positive cursor and no sync event", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T08:01:00.000Z"));
    arrangeReadableSync({
      character: character({
        hunger: 5,
        lastHungerSettledAt: new Date("2026-07-02T07:59:00.000Z"),
        currentLocation: "blackpine_outpost",
        position: null
      })
    });

    const sync = await new GameService(transactionDb()).getSync("account-1", 41);

    expect(sync.events).toEqual([]);
    expect(sync.state?.character?.needs.hunger.current).toBe(4);
  });

  it("returns healed injury state with a positive cursor and no sync event", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T08:31:00.000Z"));
    arrangeReadableSync({
      character: character({
        hp: 1,
        injuryUntil: new Date("2026-07-02T08:30:00.000Z"),
        lastHungerSettledAt: new Date("2026-07-02T08:01:00.000Z"),
        currentLocation: "blackpine_outpost",
        position: null
      })
    });

    const sync = await new GameService(transactionDb()).getSync("account-1", 42);

    expect(sync.events).toEqual([]);
    expect(sync.state?.character).toMatchObject({ hp: 100, injuryUntil: null });
  });

  it("returns state after a due action ends with a positive cursor and no sync event", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T08:02:00.000Z"));
    arrangeReadableSync({
      character: character({ lastHungerSettledAt: new Date("2026-07-02T08:01:00.000Z") }),
      activeAction: combatAction({
        encounterId: "corrupt_wolf_pack_01",
        combatLog: [],
        combatTimeline: [],
        expectedEndsAtMs: new Date("2026-07-02T08:01:00.000Z").getTime(),
        outcome: "stalemate",
        playerRemainingHp: 73,
        xp: 0,
        loot: []
      })
    });

    const sync = await new GameService(transactionDb()).getSync("account-1", 43);

    expect(sync.events).toEqual([]);
    expect(sync.state?.currentAction).toBeNull();
    expect(sync.state?.character?.hp).toBe(73);
  });
});

describe("GameService village exit rules", () => {
  it("allows hunger one to leave because the weakened state is not a hard lock", () => {
    const service = new GameService({} as Db) as unknown as VillageExitService;

    expect(() =>
      service.requireCanLeaveVillage(
        character({ hunger: 1, currentLocation: "blackpine_outpost", position: null }),
        new Date("2026-07-13T06:00:00.000Z")
      )
    ).not.toThrow();
  });

  it("keeps hunger zero inside the village", () => {
    const service = new GameService({} as Db) as unknown as VillageExitService;

    expect(() =>
      service.requireCanLeaveVillage(
        character({ hunger: 0, currentLocation: "blackpine_outpost", position: null }),
        new Date("2026-07-13T06:00:00.000Z")
      )
    ).toThrow("你已经饿到虚弱，不能出城。");
  });
});

describe("GameService serialized action starts", () => {
  function arrangeLockedActionStart() {
    const calls: string[] = [];
    const lockedCharacter = character({
      currentLocation: "corrupt_forest",
      position: { x: 1, y: 3 },
      lastHungerSettledAt: new Date()
    });
    const lock = vi
      .spyOn(GameRepository.prototype, "findCharacterByAccountIdForUpdate")
      .mockImplementation(async () => {
        calls.push("lock");
        return lockedCharacter;
      });
    const unlockedRead = vi
      .spyOn(GameRepository.prototype, "findCharacterByAccountId")
      .mockResolvedValue(lockedCharacter);
    vi.spyOn(GameRepository.prototype, "listInventory").mockResolvedValue([]);
    const findActive = vi
      .spyOn(GameRepository.prototype, "findActiveActionByCharacterId")
      .mockImplementation(async () => {
        calls.push("active");
        return combatAction({
          encounterId: "corrupt_wolf_pack_01",
          combatLog: [],
          combatTimeline: [],
          expectedEndsAtMs: Date.now() + 1_000,
          outcome: "victory",
          playerRemainingHp: 80,
          xp: 0,
          loot: []
        });
      });
    return { calls, findActive, lock, unlockedRead };
  }

  it.each([
    ["gathering", (service: GameService) => service.startGathering("account-1", { plannedMinutes: 10 })],
    ["combat", (service: GameService) => service.startCombat("account-1")]
  ])("locks the character before checking an active %s start", async (_name, start) => {
    const service = new GameService(transactionDb());
    const { calls, findActive, lock, unlockedRead } = arrangeLockedActionStart();

    await expect(start(service)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(lock).toHaveBeenCalledWith("account-1");
    expect(findActive).toHaveBeenCalledWith("character-1");
    expect(calls).toEqual(["lock", "active"]);
    expect(unlockedRead).not.toHaveBeenCalled();
  });

  it("rejects the second logical action start after the first creates an active action", async () => {
    const service = new GameService(transactionDb());
    const lockedCharacter = character({
      currentLocation: "corrupt_forest",
      position: { x: 1, y: 3 },
      lastHungerSettledAt: new Date()
    });
    let activeAction: CharacterActionRecord | null = null;
    vi.spyOn(GameRepository.prototype, "findCharacterByAccountIdForUpdate").mockResolvedValue(
      lockedCharacter
    );
    vi.spyOn(GameRepository.prototype, "listInventory").mockResolvedValue([]);
    vi.spyOn(GameRepository.prototype, "findActiveActionByCharacterId").mockImplementation(
      async () => activeAction
    );
    vi.spyOn(GameRepository.prototype, "findMapInstance").mockResolvedValue({
      id: "map-1",
      characterId: "character-1",
      zoneId: "corrupt_forest",
      resourceCharges: { forest_berry_patch_01: 3 },
      encounterCooldowns: {}
    });
    vi.spyOn(GameRepository.prototype, "createAction").mockImplementation(async (input) => {
      activeAction = {
        id: "action-1",
        characterId: input.characterId,
        actionType: input.actionType,
        status: "active",
        startedAt: input.startedAt,
        endsAt: input.endsAt,
        payload: input.payload
      };
      return activeAction;
    });
    vi.spyOn(GameRepository.prototype, "writeEvent").mockResolvedValue();
    vi.spyOn(GameService.prototype as never, "buildState" as never).mockResolvedValue({} as never);

    await expect(
      service.startGathering("account-1", { plannedMinutes: 10 })
    ).resolves.toEqual({});
    await expect(service.startCombat("account-1")).rejects.toMatchObject({
      code: "VALIDATION_ERROR"
    });
  });

  it("translates the active-action partial unique conflict into validation", async () => {
    const service = new GameService(transactionDb());
    const lockedCharacter = character({
      currentLocation: "corrupt_forest",
      position: { x: 1, y: 3 },
      lastHungerSettledAt: new Date()
    });
    vi.spyOn(GameRepository.prototype, "findCharacterByAccountIdForUpdate").mockResolvedValue(
      lockedCharacter
    );
    vi.spyOn(GameRepository.prototype, "listInventory").mockResolvedValue([]);
    vi.spyOn(GameRepository.prototype, "findActiveActionByCharacterId").mockResolvedValue(null);
    vi.spyOn(GameRepository.prototype, "findMapInstance").mockResolvedValue({
      id: "map-1",
      characterId: "character-1",
      zoneId: "corrupt_forest",
      resourceCharges: { forest_berry_patch_01: 3 },
      encounterCooldowns: {}
    });
    vi.spyOn(GameRepository.prototype, "createAction").mockRejectedValue({
      code: "23505",
      constraint: "character_actions_one_active_per_character_idx"
    });

    await expect(
      service.startGathering("account-1", { plannedMinutes: 10 })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: "已有进行中的行动。" });
  });
});

describe("GameService action settlement", () => {
  it("settles completed gathering cycles from the character's locked action", async () => {
    const service = new GameService({} as Db) as unknown as GatheringSettlementService;
    const grants: Array<{ itemId: string; quantity: number }> = [];
    const payloadUpdates: GatheringActionPayload[] = [];
    const chargeUpdates: Array<Record<string, number>> = [];
    const events: string[] = [];
    const repo = {
      findActiveActionForUpdate: async () => gatheringAction(gatheringPayload()),
      findMapInstanceForUpdate: async () => ({
        id: "map-1",
        characterId: "character-1",
        zoneId: "old_mine",
        resourceCharges: { old_mine_iron_vein_01: 100 },
        encounterCooldowns: {}
      }),
      grantCharacterItem: async (input: { itemId: string; quantity: number }) => {
        grants.push(input);
      },
      updateMapResourceCharges: async (_mapId: string, input: Record<string, number>) => {
        chargeUpdates.push(input);
      },
      updateActionPayload: async (_actionId: string, input: GatheringActionPayload) => {
        payloadUpdates.push(input);
      },
      writeEvent: async (input: { message: string }) => {
        events.push(input.message);
      },
      markActionCompleted: async () => {
        throw new Error("partial gathering settlement must not complete the action");
      }
    };

    const result = await service.settleGatheringAction(
      repo,
      "character-1",
      new Date("2026-07-02T08:03:10.000Z"),
      { completeAction: false }
    );

    expect(result).toEqual({
      changed: true,
      settledCycles: 3,
      quantityGranted: 3,
      completed: false
    });
    expect(grants).toMatchObject([{ itemId: "iron_ore", quantity: 3 }]);
    expect(chargeUpdates).toEqual([{ old_mine_iron_vein_01: 97 }]);
    expect(payloadUpdates).toMatchObject([{ settledCycles: 3 }]);
    expect(events).toEqual(["你获得了基础铁矿石 x3。"]);
  });

  it("trusts the locked action instead of a caller's stale settled cycle count", async () => {
    const service = new GameService({} as Db) as unknown as GatheringSettlementService;
    const staleAction = gatheringAction(gatheringPayload({ settledCycles: 0 }));
    const grants: Array<{ itemId: string; quantity: number }> = [];
    const payloadUpdates: GatheringActionPayload[] = [];
    const chargeUpdates: Array<Record<string, number>> = [];
    const repo = {
      findActiveActionForUpdate: async () =>
        gatheringAction(gatheringPayload({ settledCycles: 3 })),
      findMapInstanceForUpdate: async () => ({
        id: "map-1",
        characterId: "character-1",
        zoneId: "old_mine",
        resourceCharges: { old_mine_iron_vein_01: 97 },
        encounterCooldowns: {}
      }),
      grantCharacterItem: async (input: { itemId: string; quantity: number }) => {
        grants.push(input);
      },
      updateMapResourceCharges: async (_mapId: string, input: Record<string, number>) => {
        chargeUpdates.push(input);
      },
      updateActionPayload: async (_actionId: string, input: GatheringActionPayload) => {
        payloadUpdates.push(input);
      },
      writeEvent: async () => {}
    };

    const result = await service.settleGatheringAction(
      repo,
      staleAction.characterId,
      new Date("2026-07-02T08:03:10.000Z"),
      { completeAction: false }
    );

    expect(result).toEqual({
      changed: false,
      settledCycles: 3,
      quantityGranted: 0,
      completed: false
    });
    expect(grants).toHaveLength(0);
    expect(payloadUpdates).toHaveLength(0);
    expect(chargeUpdates).toHaveLength(0);
  });

  it("grants each completed gathering cycle only once across repeated settlement", async () => {
    const service = new GameService({} as Db) as unknown as GatheringSettlementService;
    let lockedAction = gatheringAction(gatheringPayload());
    let resourceCharges = { old_mine_iron_vein_01: 100 };
    const grants: Array<{ itemId: string; quantity: number }> = [];
    const repo = {
      findActiveActionForUpdate: async () => lockedAction,
      findMapInstanceForUpdate: async () => ({
        id: "map-1",
        characterId: "character-1",
        zoneId: "old_mine",
        resourceCharges,
        encounterCooldowns: {}
      }),
      grantCharacterItem: async (input: { itemId: string; quantity: number }) => {
        grants.push(input);
      },
      updateMapResourceCharges: async (_mapId: string, input: Record<string, number>) => {
        resourceCharges = { old_mine_iron_vein_01: input.old_mine_iron_vein_01 ?? 0 };
      },
      updateActionPayload: async (_actionId: string, input: GatheringActionPayload) => {
        lockedAction = gatheringAction(input);
      },
      writeEvent: async () => {}
    };
    const now = new Date("2026-07-02T08:03:10.000Z");

    const first = await service.settleGatheringAction(repo, "character-1", now, {
      completeAction: false
    });
    const second = await service.settleGatheringAction(repo, "character-1", now, {
      completeAction: false
    });

    expect(first).toEqual({
      changed: true,
      settledCycles: 3,
      quantityGranted: 3,
      completed: false
    });
    expect(second).toEqual({
      changed: false,
      settledCycles: 3,
      quantityGranted: 0,
      completed: false
    });
    expect(grants).toMatchObject([{ itemId: "iron_ore", quantity: 3 }]);
    expect(resourceCharges).toEqual({ old_mine_iron_vein_01: 97 });
  });

  it("locks and settles gathering before conditionally marking it cancelled", async () => {
    const service = new GameService({} as Db) as unknown as GatheringSettlementService;
    const calls: string[] = [];
    const repo = {
      findActiveActionForUpdate: async () => {
        calls.push("lockAction");
        return gatheringAction(gatheringPayload());
      },
      findMapInstanceForUpdate: async () => {
        calls.push("lockMap");
        return {
          id: "map-1",
          characterId: "character-1",
          zoneId: "old_mine",
          resourceCharges: { old_mine_iron_vein_01: 100 },
          encounterCooldowns: {}
        };
      },
      grantCharacterItem: async () => {
        calls.push("grant");
      },
      updateMapResourceCharges: async () => {
        calls.push("updateCharges");
      },
      updateActionPayload: async () => {
        calls.push("updatePayload");
      },
      writeEvent: async () => {
        calls.push("writeSettlementEvent");
      },
      markActionCancelled: async () => {
        calls.push("markCancelled");
        return true;
      }
    };

    const result = await service.settleGatheringAction(
      repo,
      "character-1",
      new Date("2026-07-02T08:03:10.000Z"),
      { completeAction: false, cancelAction: true }
    );

    expect(result).toEqual({
      changed: true,
      settledCycles: 3,
      quantityGranted: 3,
      completed: false
    });
    expect(calls).toEqual([
      "lockAction",
      "lockMap",
      "grant",
      "updateCharges",
      "updatePayload",
      "writeSettlementEvent",
      "markCancelled"
    ]);
  });

  it("is a no-op when no active action remains after taking the lock", async () => {
    const service = new GameService({} as Db) as unknown as GatheringSettlementService;
    const calls: string[] = [];
    const repo = {
      findActiveActionForUpdate: async () => {
        calls.push("lockAction");
        return null;
      },
      findMapInstanceForUpdate: async () => {
        calls.push("lockMap");
      },
      grantCharacterItem: async () => {
        calls.push("grant");
      },
      updateMapResourceCharges: async () => {
        calls.push("updateCharges");
      },
      updateActionPayload: async () => {
        calls.push("updatePayload");
      },
      markActionCancelled: async () => {
        calls.push("markCancelled");
        return true;
      }
    };

    const result = await service.settleGatheringAction(
      repo,
      "character-1",
      new Date("2026-07-02T08:03:10.000Z"),
      { completeAction: false, cancelAction: true }
    );

    expect(result).toEqual({
      changed: false,
      settledCycles: 0,
      quantityGranted: 0,
      completed: false
    });
    expect(calls).toEqual(["lockAction"]);
  });

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
    const durabilityUpdates: Array<{ instanceId: string; currentDurability: number }> = [];
    const repo = {
      updateCharacterVitals: async (input: { hp: number; xp?: number }) => {
        calls.push("updateCharacterVitals");
        vitals.push(input);
      },
      listItemInstances: async () => {
        calls.push("listItemInstances");
        return [
          {
            id: "weapon-1",
            itemDefId: "training_sword",
            ownerType: "character" as const,
            ownerId: "character-1",
            locationType: "equipped" as const,
            slot: "weapon",
            rarity: "common",
            itemLevel: 5,
            baseStats: { attack: 2, defense: 0, agility: 0, maxHp: 0 },
            affixes: [],
            currentDurability: 10,
            maxDurability: 10
          }
        ];
      },
      updateEquipmentDurability: async (input: {
        instanceId: string;
        currentDurability: number;
      }) => {
        calls.push("updateEquipmentDurability");
        durabilityUpdates.push(input);
      },
      itemWriter: () => ({
        updateEquipmentDurability: async (input: {
          instanceId: string;
          currentDurability: number;
        }) => {
          calls.push("updateEquipmentDurability");
          durabilityUpdates.push(input);
        }
      })
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
      { instanceId: "weapon-1", currentDurability: 8, maxDurability: 10 }
    ]);
    expect(calls).toEqual([
      "updateCharacterVitals",
      "listItemInstances",
      "updateEquipmentDurability"
    ]);
  });
});

describe("GameService serialized player asset transfers", () => {
  const marketItem = {
    id: "market-1",
    settlementId: "blackpine_outpost",
    itemId: "iron_ore" as const,
    quantity: 10,
    targetQuantity: 20,
    baseBuyPriceCopper: 4,
    baseSellPriceCopper: 7
  };
  const FIXED_COMMAND_ID = "11111111-1111-4111-8111-111111111111";

  function rollbackDb(state: Record<string, number>) {
    return {
      transaction: vi.fn(async (operation: (tx: object) => Promise<unknown>) => {
        const snapshot = { ...state };
        try {
          return await operation({});
        } catch (error) {
          Object.assign(state, snapshot);
          throw error;
        }
      })
    } as unknown as Db;
  }

  function fakeAssets(
    state: Record<string, number>,
    calls: string[],
    opts: { stock?: boolean; copper?: boolean; treasury?: boolean } = {}
  ): AssetMutationPort {
    const stockOk = opts.stock ?? true;
    const copperOk = opts.copper ?? true;
    const treasuryOk = opts.treasury ?? true;
    return {
      debitCharacterCopperIfAvailable: async (_id: string, amount: number) => {
        calls.push("copper-debit");
        if (!copperOk) return false;
        state.copper = (state.copper ?? 0) - amount;
        return true;
      },
      creditCharacterCopper: async (_id: string, amount: number) => {
        calls.push("copper-credit");
        state.copper = (state.copper ?? 0) + amount;
      },
      debitNpcCopperIfAvailable: async () => {
        calls.push("npc-copper-debit");
        return true;
      },
      reserveNpcCopper: async () => {
        calls.push("npc-copper-reserve");
        return true;
      },
      creditNpcCopper: async () => {
        calls.push("npc-copper-credit");
      },
      creditTreasury: async () => {
        calls.push("treasury-credit");
      },
      debitTreasuryIfAvailable: async () => {
        calls.push("treasury-debit");
        return treasuryOk;
      },
      debitMarketStockIfAvailable: async () => {
        calls.push("stock-debit");
        if (!stockOk) return false;
        state.market = (state.market ?? 0) - 1;
        return true;
      },
      creditMarketStock: async () => {
        calls.push("stock-credit");
      },
      debitMarketStockAboveReserve: async () => {
        calls.push("stock-reserve-debit");
        return true;
      },
      findReceiptForUpdate: async () => null,
      claimReceipt: async () => true,
      saveReceiptResult: async () => {}
    };
  }

  function arrangeCommon(state: Record<string, number>) {
    vi.spyOn(GameRepository.prototype, "findCharacterByAccountId").mockImplementation(async () =>
      character({
        copperBalance: state.copper ?? 0,
        currentLocation: "blackpine_outpost",
        position: null,
        lastHungerSettledAt: new Date()
      })
    );
    const characterForUpdate = vi
      .spyOn(GameRepository.prototype, "findCharacterByIdForUpdate")
      .mockImplementation(async () =>
        character({
          copperBalance: state.copper ?? 0,
          currentLocation: "blackpine_outpost",
          position: null,
          lastHungerSettledAt: new Date()
        })
      );
    vi.spyOn(GameRepository.prototype, "listInventory").mockImplementation(async () => [
      { itemId: "iron_ore", quantity: state.ironOre ?? 0 }
    ]);
    vi.spyOn(GameRepository.prototype, "listMarketInventory").mockResolvedValue([marketItem]);
    vi.spyOn(GameRepository.prototype, "upsertMarketInventory").mockResolvedValue();
    vi.spyOn(GameRepository.prototype, "findCharacterInventoryItemForUpdate")
      .mockImplementation(async () => ({
        itemId: "iron_ore",
        quantity: state.ironOre ?? 0
      }));
    vi.spyOn(GameService.prototype as never, "buildState" as never).mockResolvedValue({} as never);
    return { characterForUpdate };
  }

  it("locks buy assets in market, character order before asset debits", async () => {
    const state = { market: 10, copper: 100 };
    const calls: string[] = [];
    const { characterForUpdate } = arrangeCommon(state);
    vi.spyOn(GameRepository.prototype, "findMarketInventoryItemForUpdate").mockImplementation(async () => {
      calls.push("market");
      return { ...marketItem, quantity: state.market };
    });
    characterForUpdate.mockImplementation(async () => {
      calls.push("character");
      return character({
        copperBalance: state.copper,
        currentLocation: "blackpine_outpost",
        position: null,
        lastHungerSettledAt: new Date()
      });
    });

    vi.spyOn(GameRepository.prototype, "findMunicipalTreasuryForUpdate").mockImplementation(async () => {
      calls.push("treasury-lock");
      return null;
    });

    const service = new GameService(rollbackDb(state), {
      assetMutations: () => fakeAssets(state, calls)
    });
    await expect(service.buyMarketItem("account-1", { itemId: "iron_ore", quantity: 1 }))
      .rejects.toBeInstanceOf(GameServiceError);

    expect(calls).toEqual([
      "market",
      "character",
      "stock-debit",
      "copper-debit",
      "treasury-lock"
    ]);
  });

  it("locks sell assets in market, inventory, character order before the treasury debit", async () => {
    const state = { market: 10, copper: 0, ironOre: 3 };
    const calls: string[] = [];
    const { characterForUpdate } = arrangeCommon(state);
    vi.spyOn(GameRepository.prototype, "findMarketInventoryItemForUpdate").mockImplementation(async () => {
      calls.push("market");
      return { ...marketItem, quantity: state.market };
    });
    vi.spyOn(GameRepository.prototype, "findCharacterInventoryItemForUpdate")
      .mockImplementation(async () => {
        calls.push("inventory");
        return { itemId: "iron_ore", quantity: state.ironOre };
      });
    characterForUpdate.mockImplementation(async () => {
      calls.push("character");
      return character({
        copperBalance: state.copper,
        currentLocation: "blackpine_outpost",
        position: null,
        lastHungerSettledAt: new Date()
      });
    });

    const service = new GameService(rollbackDb(state), {
      assetMutations: () => fakeAssets(state, calls, { treasury: false })
    });
    await expect(service.sellMarketItem("account-1", { itemId: "iron_ore", quantity: 1 }))
      .rejects.toBeInstanceOf(GameServiceError);

    expect(calls).toEqual(["market", "inventory", "character", "treasury-debit"]);
  });

  it("rolls back locked market stock when the buyer's conditional copper debit loses the race", async () => {
    const state = { market: 10, copper: 100 };
    arrangeCommon(state);
    vi.spyOn(GameRepository.prototype, "findMarketInventoryItemForUpdate")
      .mockResolvedValue({ ...marketItem, quantity: state.market });
    const grant = vi.spyOn(GameRepository.prototype, "grantCharacterItem").mockResolvedValue();
    const transaction = vi
      .spyOn(GameRepository.prototype, "createMarketTransaction")
      .mockResolvedValue();
    const event = vi.spyOn(GameRepository.prototype, "writeEvent").mockResolvedValue();
    const ledger = vi.spyOn(LedgerService.prototype, "recordCopperTransfer").mockResolvedValue();

    const service = new GameService(rollbackDb(state), {
      assetMutations: () => fakeAssets(state, [], { copper: false })
    });
    await expect(service.buyMarketItem("account-1", { itemId: "iron_ore", quantity: 1 }))
      .rejects.toBeInstanceOf(GameServiceError);

    expect(state).toEqual({ market: 10, copper: 100 });
    expect(grant).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(ledger).not.toHaveBeenCalled();
    expect(event).not.toHaveBeenCalled();
  });

  it("does not debit or grant when the locked market stock conditional update loses the race", async () => {
    const state = { market: 10, copper: 100 };
    arrangeCommon(state);
    vi.spyOn(GameRepository.prototype, "findMarketInventoryItemForUpdate")
      .mockResolvedValue({ ...marketItem, quantity: state.market });
    const grant = vi.spyOn(GameRepository.prototype, "grantCharacterItem").mockResolvedValue();
    const transaction = vi
      .spyOn(GameRepository.prototype, "createMarketTransaction")
      .mockResolvedValue();
    const event = vi.spyOn(GameRepository.prototype, "writeEvent").mockResolvedValue();
    const ledger = vi.spyOn(LedgerService.prototype, "recordCopperTransfer").mockResolvedValue();

    const service = new GameService(rollbackDb(state), {
      assetMutations: () => fakeAssets(state, [], { stock: false })
    });
    await expect(service.buyMarketItem("account-1", { itemId: "iron_ore", quantity: 1 }))
      .rejects.toBeInstanceOf(GameServiceError);

    expect(state).toEqual({ market: 10, copper: 100 });
    expect(grant).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(ledger).not.toHaveBeenCalled();
    expect(event).not.toHaveBeenCalled();
  });

  it("rolls back sold ore when the municipal treasury conditional debit loses the race", async () => {
    const state = { market: 10, copper: 0, ironOre: 3 };
    arrangeCommon(state);
    vi.spyOn(GameRepository.prototype, "findMarketInventoryItemForUpdate")
      .mockResolvedValue({ ...marketItem, quantity: state.market });
    const consume = vi.spyOn(GameRepository.prototype, "consumeCharacterItem");
    const transaction = vi
      .spyOn(GameRepository.prototype, "createMarketTransaction")
      .mockResolvedValue();
    const event = vi.spyOn(GameRepository.prototype, "writeEvent").mockResolvedValue();
    const ledger = vi.spyOn(LedgerService.prototype, "recordCopperTransfer").mockResolvedValue();

    const service = new GameService(rollbackDb(state), {
      assetMutations: () => fakeAssets(state, [], { treasury: false })
    });
    await expect(service.sellMarketItem("account-1", { itemId: "iron_ore", quantity: 2 }))
      .rejects.toBeInstanceOf(GameServiceError);

    expect(state).toEqual({ market: 10, copper: 0, ironOre: 3 });
    expect(consume).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(ledger).not.toHaveBeenCalled();
    expect(event).not.toHaveBeenCalled();
  });

  it("replays the stored result for a repeated market buy command without moving assets", async () => {
    const state = { market: 10, copper: 100 };
    arrangeCommon(state);
    vi.spyOn(GameRepository.prototype, "findMarketInventoryItemForUpdate")
      .mockResolvedValue({ ...marketItem, quantity: state.market });
    const stored = { replayed: true } as unknown as GameStateDto;
    const calls: string[] = [];
    const fake = fakeAssets(state, calls);
    vi.spyOn(fake, "findReceiptForUpdate").mockResolvedValue({
      actorScope: "character:character-1",
      commandKind: "market.buy",
      commandId: FIXED_COMMAND_ID,
      worldEpoch: 1,
      requestHash: hashRequest({ itemId: "iron_ore", quantity: 1 }),
      result: stored
    });

    const service = new GameService(rollbackDb(state), { assetMutations: () => fake });
    const result = await service.buyMarketItem("account-1", {
      itemId: "iron_ore",
      quantity: 1,
      commandId: FIXED_COMMAND_ID
    });

    expect(result).toBe(stored);
    expect(calls).toEqual([]);
  });

  it("conflicts when the same command id carries a different payload", async () => {
    const state = { market: 10, copper: 100 };
    arrangeCommon(state);
    vi.spyOn(GameRepository.prototype, "findMarketInventoryItemForUpdate")
      .mockResolvedValue({ ...marketItem, quantity: state.market });
    const calls: string[] = [];
    const fake = fakeAssets(state, calls);
    vi.spyOn(fake, "findReceiptForUpdate").mockResolvedValue({
      actorScope: "character:character-1",
      commandKind: "market.buy",
      commandId: FIXED_COMMAND_ID,
      worldEpoch: 1,
      requestHash: hashRequest({ itemId: "iron_ore", quantity: 5 }),
      result: {}
    });

    const service = new GameService(rollbackDb(state), { assetMutations: () => fake });
    await expect(
      service.buyMarketItem("account-1", {
        itemId: "iron_ore",
        quantity: 1,
        commandId: FIXED_COMMAND_ID
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(calls).toEqual([]);
  });

  it("does not use absolute market inventory writes in player buy or sell paths", () => {
    const source = readFileSync(new URL("./game.service.ts", import.meta.url), "utf8");
    const buyPath = source.slice(source.indexOf("async buyMarketItem"), source.indexOf("async sellMarketItem"));
    const sellPath = source.slice(source.indexOf("async sellMarketItem"), source.indexOf("async getRepairQuote"));

    expect(buyPath).not.toContain("setMarketInventoryQuantity");
    expect(sellPath).not.toContain("setMarketInventoryQuantity");
    expect(buyPath).toContain("debitMarketStockIfAvailable");
    expect(sellPath).toContain("creditMarketStock");
  });
});

describe("GameService municipal food relief", () => {
  const now = new Date("2026-07-13T12:00:00.000Z");
  const marketFood = {
    id: "market-berry",
    settlementId: "blackpine_outpost",
    itemId: "wild_berry" as const,
    quantity: 10,
    targetQuantity: 100,
    baseBuyPriceCopper: 5,
    baseSellPriceCopper: 8
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  function arrangeClaim(input: {
    claimant?: Partial<CharacterRecord>;
    inventory?: Array<{ itemId: string; quantity: number }>;
    market?: typeof marketFood[];
    cooldownClaimed?: boolean;
    marketDebited?: boolean;
  } = {}) {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const claimant = character({
      currentLocation: "blackpine_outpost",
      position: null,
      hunger: 1,
      copperBalance: 0,
      lastHungerSettledAt: now,
      lastReliefClaimedAt: null,
      ...input.claimant
    });
    const inventory = input.inventory ?? [];
    const market = input.market ?? [marketFood];

    vi.spyOn(GameRepository.prototype, "findCharacterByAccountIdForUpdate").mockResolvedValue(
      claimant
    );
    vi.spyOn(GameRepository.prototype, "findCharacterByAccountId").mockResolvedValue(claimant);
    vi.spyOn(GameRepository.prototype, "findActiveActionByCharacterId").mockResolvedValue(null);
    vi.spyOn(GameRepository.prototype, "listInventory").mockResolvedValue(inventory);
    vi.spyOn(GameRepository.prototype, "listMarketInventory").mockResolvedValue(market);
    vi.spyOn(GameRepository.prototype, "upsertMarketInventory").mockResolvedValue();
    vi.spyOn(GameRepository.prototype, "findMarketInventoryItemForUpdate").mockImplementation(
      async (_settlementId, itemId) => market.find((item) => item.itemId === itemId) ?? null
    );
    const claimCooldown = vi
      .spyOn(GameRepository.prototype, "claimMunicipalReliefCooldown")
      .mockResolvedValue(input.cooldownClaimed ?? true);
    const debitMarket = vi
      .spyOn(AssetMutationService.prototype, "debitMarketStockAboveReserve")
      .mockResolvedValue(input.marketDebited ?? true);
    const grant = vi
      .spyOn(GameRepository.prototype, "grantMunicipalReliefItem")
      .mockResolvedValue();
    const event = vi.spyOn(GameRepository.prototype, "writeEvent").mockResolvedValue();
    const copperLedger = vi
      .spyOn(LedgerService.prototype, "recordCopperTransfer")
      .mockResolvedValue();
    vi.spyOn(GameService.prototype as never, "buildState" as never).mockResolvedValue({} as never);

    return { claimCooldown, debitMarket, grant, event, copperLedger };
  }

  it("claims cooldown ownership before consuming one reserved market food", async () => {
    const spies = arrangeClaim();

    await new GameService(transactionDb()).claimMunicipalRelief("account-1");

    expect(spies.claimCooldown).toHaveBeenCalledWith({
      characterId: "character-1",
      claimedAt: now,
      cooldownCutoff: new Date("2026-07-12T12:00:00.000Z")
    });
    expect(spies.debitMarket).toHaveBeenCalledWith("market-berry", 1, 1);
    expect(spies.grant).toHaveBeenCalledWith({
      characterId: "character-1",
      itemId: "wild_berry",
      quantity: 1,
      source: "market",
      reason: "municipal_relief",
      metadata: expect.objectContaining({ settlementId: "blackpine_outpost" })
    });
    expect(spies.event).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: "character-1",
        eventType: "municipal.relief.claimed",
        metadata: expect.objectContaining({ source: "market", itemId: "wild_berry", quantity: 1 })
      })
    );
    expect(spies.copperLedger).not.toHaveBeenCalled();
  });

  it.each([
    ["outside the village", { currentLocation: "old_mine" as const, position: { x: 1, y: 1 } }, [], 0],
    ["not hungry", { hunger: 2 }, [], 0],
    ["carrying food", {}, [{ itemId: "wild_berry", quantity: 1 }], 0],
    ["able to buy food", { copperBalance: 100 }, [], 0],
    ["inside cooldown", { lastReliefClaimedAt: new Date("2026-07-13T11:00:00.000Z") }, [], 0]
  ])("rejects %s before claiming cooldown", async (_name, claimant, inventory, _unused) => {
    const spies = arrangeClaim({ claimant, inventory });

    await expect(
      new GameService(transactionDb()).claimMunicipalRelief("account-1")
    ).rejects.toBeInstanceOf(GameServiceError);

    expect(spies.claimCooldown).not.toHaveBeenCalled();
    expect(spies.grant).not.toHaveBeenCalled();
    expect(spies.event).not.toHaveBeenCalled();
  });

  it("rolls back without granting when another concurrent claim owns the cooldown", async () => {
    const spies = arrangeClaim({ cooldownClaimed: false });

    await expect(
      new GameService(transactionDb()).claimMunicipalRelief("account-1")
    ).rejects.toBeInstanceOf(GameServiceError);

    expect(spies.debitMarket).not.toHaveBeenCalled();
    expect(spies.grant).not.toHaveBeenCalled();
    expect(spies.event).not.toHaveBeenCalled();
  });

  it("uses one emergency wild berry only when no ordinary market food is above reserve", async () => {
    const spies = arrangeClaim({
      market: [{ ...marketFood, quantity: 1 }],
      marketDebited: false
    });

    await new GameService(transactionDb()).claimMunicipalRelief("account-1");

    expect(spies.grant).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: "character-1",
        itemId: "wild_berry",
        quantity: 1,
        source: "system"
      })
    );
    expect(spies.event).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "municipal.relief.claimed",
        metadata: expect.objectContaining({ source: "system" })
      })
    );
  });

  it.each([
    {
      name: "village fed healthy",
      claimant: { hunger: 5 },
      inventory: [],
      expected: ["enter_corrupt_forest", "enter_old_mine", "open_market"]
    },
    {
      name: "village hunger zero",
      claimant: { hunger: 0, copperBalance: 100 },
      inventory: [],
      expected: ["open_market"]
    },
    {
      name: "village injured",
      claimant: { hunger: 5, injuryUntil: new Date("2026-07-13T12:30:00.000Z") },
      inventory: [],
      expected: ["open_market"]
    },
    {
      name: "village eligible relief",
      claimant: { hunger: 0 },
      inventory: [],
      expected: ["open_market", "claim_relief"]
    },
    {
      name: "claimant carrying food",
      claimant: { hunger: 0 },
      inventory: [{ itemId: "wild_berry", quantity: 1 }],
      expected: ["open_market", "eat_food"]
    },
    {
      name: "claimant able to afford food",
      claimant: { hunger: 0, copperBalance: 100 },
      inventory: [],
      expected: ["open_market"]
    },
    {
      name: "village hunger one healthy",
      claimant: { hunger: 1, copperBalance: 100 },
      inventory: [],
      expected: ["enter_corrupt_forest", "enter_old_mine", "open_market"]
    }
  ])("publishes the exact village action matrix for a $name", async ({ claimant, inventory, expected }) => {
    const service = new GameService({} as Db);
    const state = await (service as unknown as {
      buildState(repo: object, accountId: string, now: Date): Promise<{ availableActions: string[] }>;
    }).buildState(
      {
        findCharacterByAccountId: async () =>
          character({
            currentLocation: "blackpine_outpost",
            position: null,
            lastHungerSettledAt: now,
            lastReliefClaimedAt: null,
            ...claimant
          }),
        listInventory: async () => inventory,
        listItemInstances: async () => [],
        listRecentEvents: async () => [],
        findActiveActionByCharacterId: async () => null,
        listMarketInventory: async () => [marketFood],
        upsertMarketInventory: async () => undefined
      },
      "account-1",
      now
    );

    expect(state.availableActions).toEqual(expected);
  });

  it.each([
    {
      name: "wild idle",
      activeAction: null,
      expected: ["move", "return_to_village"]
    },
    {
      name: "wild active gathering",
      activeAction: gatheringAction(gatheringPayload()),
      expected: ["cancel_action"]
    },
    {
      name: "wild active combat",
      activeAction: combatAction({
        encounterId: "old_mine_rat_pack_01",
        combatLog: [],
        combatTimeline: [],
        expectedEndsAtMs: now.getTime() + 60_000,
        outcome: "victory",
        playerRemainingHp: 80,
        xp: 0,
        loot: []
      }),
      expected: ["cancel_action"]
    }
  ])("publishes the exact action matrix for $name", async ({ activeAction, expected }) => {
    const service = new GameService({} as Db);
    const state = await (service as unknown as {
      buildState(repo: object, accountId: string, now: Date): Promise<{ availableActions: string[] }>;
    }).buildState(
      {
        findCharacterByAccountId: async () =>
          character({
            currentLocation: "old_mine",
            position: { x: 0, y: 0 },
            lastHungerSettledAt: now
          }),
        listInventory: async () => [],
        listItemInstances: async () => [],
        listRecentEvents: async () => [],
        findActiveActionByCharacterId: async () => activeAction,
        findMapInstance: async () => null
      },
      "account-1",
      now
    );

    expect(state.availableActions).toEqual(expected);
  });
});
