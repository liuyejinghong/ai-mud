import type {
  GameStateDto,
  MarketDto,
  NpcDialogueResponseDto,
  NpcDialogueTargetDto
} from "@ai-mud/shared";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { GameServiceError } from "./game.service.js";
import { registerGameRoutes, type GameRouteDependencies } from "./game.routes.js";

const activeAccount = {
  id: "account-1",
  email: "player@example.com",
  role: "player" as const,
  status: "active" as const
};

const baseState: GameStateDto = {
  character: {
    id: "character-1",
    name: "Zichen",
    classId: "ranger",
    level: 1,
    xp: 0,
    hp: 100,
    maxHp: 100,
    currentLocation: "blackpine_outpost",
    position: null,
    injuryUntil: null,
    money: { gold: 0, silver: 12, copper: 35, totalCopper: 1235 },
    needs: {
      hunger: {
        current: 4,
        max: 5,
        status: "fed",
        nextMealAt: "2026-07-01T18:00:00.000Z"
      }
    }
  },
  locationTitle: "黑松哨站",
  locationDescription: "潮湿黑松围住木墙，哨塔上的火盆把灰雾照成暗红色。",
  map: null,
  inventory: [],
  equipment: [
    {
      id: "equipment-1",
      slot: "weapon",
      itemKey: "training_sword",
      name: "训练短剑",
      itemLevel: 5,
      attackBonus: 2,
      defenseBonus: 0,
      maxDurability: 100,
      currentDurability: 60,
      durabilityPct: 60,
      effectiveStatRatio: 1,
      repairQuote: {
        copperCost: { gold: 0, silver: 0, copper: 50, totalCopper: 50 },
        ironOreCost: 1
      }
    }
  ],
  market: null,
  npcTasks: [],
  currentAction: null,
  rumors: [],
  availableActions: ["enter_corrupt_forest", "open_market", "repair_equipment"],
  log: []
};

const marketState: MarketDto = {
  settlementId: "blackpine_outpost",
  settlementName: "黑松哨站市政集市",
  items: [
    {
      itemId: "iron_ore",
      name: "基础铁矿石",
      category: "ore",
      itemLevel: 1,
      stockQuantity: 12,
      playerQuantity: 1,
      buyPrice: { gold: 0, silver: 0, copper: 30, totalCopper: 30 },
      sellPrice: { gold: 0, silver: 0, copper: 18, totalCopper: 18 },
      buyTax: { gold: 0, silver: 0, copper: 2, totalCopper: 2 },
      sellTax: { gold: 0, silver: 0, copper: 1, totalCopper: 1 }
    }
  ]
};

const dialogueTarget: NpcDialogueTargetDto = {
  npcActorId: "npc-blacksmith",
  npcKey: "blackpine_blacksmith_borin",
  name: "伯林",
  profession: "blacksmith",
  currentLocation: "blackpine_outpost",
  statusLine: "正在盘点基础铁矿石库存。",
  hasTask: true,
  taskStatus: "open",
  taskTitle: "炉火缺矿"
};

const dialogueResponse: NpcDialogueResponseDto = {
  target: dialogueTarget,
  messages: [
    {
      id: "msg-1",
      npcActorId: "npc-blacksmith",
      speakerType: "npc",
      message: "炉火还没灭。带矿石来再说。",
      createdAt: "2026-07-01T12:00:00.000Z"
    }
  ],
  ai: {
    status: "fallback",
    provider: "template",
    model: "template",
    fallbackReason: "disabled"
  }
};

function buildGameRouteTestApp(overrides: Partial<GameRouteDependencies> = {}) {
  const deps: GameRouteDependencies = {
    getCurrentAccount: async () => activeAccount,
    verifyGameMutation: async () => true,
    settleWorldIfDue: async () => undefined,
    getState: async () => baseState,
    syncGame: async (_accountId, cursor = 0) => ({
      stateVersion: cursor,
      state: cursor > 0 ? null : baseState,
      events: [],
      nextCursor: cursor
    }),
    createCharacter: async () => baseState,
    enterCorruptForest: async () => ({
      ...baseState,
      character: {
        ...baseState.character!,
        currentLocation: "corrupt_forest",
        position: { x: 2, y: 4 }
      },
      locationTitle: "腐林"
    }),
    move: async () => ({
      ...baseState,
      character: {
        ...baseState.character!,
        currentLocation: "corrupt_forest",
        position: { x: 2, y: 3 }
      },
      locationTitle: "腐林"
    }),
    startGathering: async () => baseState,
    startCombat: async () => baseState,
    cancelAction: async () => baseState,
    returnToVillage: async () => baseState,
    getMarket: async () => marketState,
    buyMarketItem: async () => baseState,
    sellMarketItem: async () => baseState,
    getRepairQuote: async () => ({
      copperCost: { gold: 0, silver: 1, copper: 50, totalCopper: 150 },
      ironOreCost: 1
    }),
    repairEquipment: async () => baseState,
    repairAllEquipment: async () => baseState,
    eatFood: async () => ({
      ...baseState,
      character: {
        ...baseState.character!,
        needs: {
          hunger: {
            ...baseState.character!.needs.hunger,
            current: 5
          }
        }
      },
      inventory: [{ itemId: "wild_berry", name: "野莓", quantity: 1 }]
    }),
    acceptNpcTask: async () => baseState,
    completeNpcTask: async () => baseState,
    listDialogueTargets: async () => [dialogueTarget],
    getNpcDialogue: async () => dialogueResponse,
    sendNpcDialogueMessage: async () => dialogueResponse,
    ...overrides
  };
  const app = Fastify();
  void app.register(registerGameRoutes, deps);
  return app;
}

describe("registerGameRoutes", () => {
  it("requires an authenticated session for game state", async () => {
    const settleCalls: string[] = [];
    const app = buildGameRouteTestApp({
      getCurrentAccount: async () => null,
      settleWorldIfDue: async () => {
        settleCalls.push("settled");
      }
    });
    const response = await app.inject({ method: "GET", url: "/game/state" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Not signed in" }
    });
    expect(settleCalls).toEqual([]);
  });

  it("settles the NPC world before returning game state", async () => {
    const calls: string[] = [];
    const app = buildGameRouteTestApp({
      settleWorldIfDue: async () => {
        calls.push("settled");
      },
      getState: async () => {
        calls.push("state");
        return baseState;
      }
    });

    const response = await app.inject({ method: "GET", url: "/game/state" });

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual(["settled", "state"]);
  });

  it("returns initial sync state without settling the world", async () => {
    const calls: string[] = [];
    const app = buildGameRouteTestApp({
      settleWorldIfDue: async () => {
        calls.push("settled");
      },
      syncGame: async (accountId, cursor) => {
        calls.push(`sync:${accountId}:${cursor ?? 0}`);
        return {
          stateVersion: 0,
          state: baseState,
          events: [],
          nextCursor: 0
        };
      }
    });

    const response = await app.inject({ method: "GET", url: "/game/sync" });

    expect(response.statusCode).toBe(200);
    expect(response.json().state.locationTitle).toBe("黑松哨站");
    expect(calls).toEqual(["sync:account-1:0"]);
  });

  it("passes sync cursors through without forcing full state", async () => {
    const app = buildGameRouteTestApp({
      syncGame: async (_accountId, cursor) => ({
        stateVersion: 9,
        state: null,
        events: [
          {
            id: 9,
            eventType: "ui.toast",
            stateDirty: false,
            payload: { message: "ok" },
            source: "server",
            createdAt: "2026-07-02T00:00:00.000Z"
          }
        ],
        nextCursor: cursor ?? 9
      })
    });

    const response = await app.inject({ method: "GET", url: "/game/sync?cursor=8" });

    expect(response.statusCode).toBe(200);
    expect(response.json().state).toBeNull();
    expect(response.json().events[0].eventType).toBe("ui.toast");
    expect(response.json().nextCursor).toBe(8);
  });

  it("creates one character and returns Blackpine Outpost state", async () => {
    const calls: unknown[] = [];
    const app = buildGameRouteTestApp({
      createCharacter: async (accountId, input) => {
        calls.push({ accountId, input });
        return baseState;
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/game/characters",
      headers: { "x-csrf-token": "csrf" },
      payload: { name: "Zichen", classId: "ranger" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().locationTitle).toBe("黑松哨站");
    expect(response.json().character.needs.hunger.current).toBe(4);
    expect(calls).toEqual([
      { accountId: "account-1", input: { name: "Zichen", classId: "ranger" } }
    ]);
  });

  it("enters Corrupt Forest at the configured entry position", async () => {
    const app = buildGameRouteTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/game/enter-zone",
      headers: { "x-csrf-token": "csrf" },
      payload: { zoneId: "corrupt_forest" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().character.position).toEqual({ x: 2, y: 4 });
  });

  it("moves north by delegating to MapRules", async () => {
    const calls: unknown[] = [];
    const app = buildGameRouteTestApp({
      move: async (accountId, direction) => {
        calls.push({ accountId, direction });
        return {
          ...baseState,
          character: {
            ...baseState.character!,
            currentLocation: "corrupt_forest",
            position: { x: 2, y: 3 }
          }
        };
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/game/move",
      headers: { "x-csrf-token": "csrf" },
      payload: { direction: "north" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().character.position).toEqual({ x: 2, y: 3 });
    expect(calls).toEqual([{ accountId: "account-1", direction: "north" }]);
  });

  it("rejects movement beyond the zone boundary", async () => {
    const app = buildGameRouteTestApp({
      move: async () => {
        throw new GameServiceError("VALIDATION_ERROR", "边界被倒伏的黑木挡住。");
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/game/move",
      headers: { "x-csrf-token": "csrf" },
      payload: { direction: "west" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: "VALIDATION_ERROR", message: "边界被倒伏的黑木挡住。" }
    });
  });

  it("starts timed gathering with a planned duration", async () => {
    const calls: unknown[] = [];
    const app = buildGameRouteTestApp({
      startGathering: async (accountId, input) => {
        calls.push({ accountId, input });
        return {
          ...baseState,
          currentAction: {
            id: "action-1",
            actionType: "gathering",
            status: "active",
            description: "正在采集野莓灌木",
            startedAt: "2026-07-01T00:00:00.000Z",
            endsAt: "2026-07-01T00:10:00.000Z",
            progressPct: 0,
            cycleProgressPct: 0,
            completedCycles: 0,
            settledCycles: 0,
            plannedCycles: 20,
            expectedYield: [{ itemId: "wild_berry", name: "野莓", quantity: 40 }],
            combatLog: []
          }
        };
      }
    });
    const response = await app.inject({
      method: "POST",
      url: "/game/gather",
      headers: { "x-csrf-token": "csrf" },
      payload: { plannedMinutes: 10 }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().currentAction.actionType).toBe("gathering");
    expect(calls).toEqual([{ accountId: "account-1", input: { plannedMinutes: 10 } }]);
  });

  it("rejects gathering on an empty cell", async () => {
    const app = buildGameRouteTestApp({
      startGathering: async () => {
        throw new GameServiceError("VALIDATION_ERROR", "这里没有可采集的资源。");
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/game/gather",
      headers: { "x-csrf-token": "csrf" },
      payload: {}
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: "VALIDATION_ERROR", message: "这里没有可采集的资源。" }
    });
  });

  it("starts combat", async () => {
    const app = buildGameRouteTestApp({
      startCombat: async () => ({
        ...baseState,
        currentAction: {
          id: "action-1",
          actionType: "combat",
          status: "active",
          description: "正在与腐化野狼群战斗",
          startedAt: "2026-07-01T00:00:00.000Z",
          endsAt: "2026-07-01T00:02:00.000Z",
          progressPct: 0,
          cycleProgressPct: null,
          completedCycles: null,
          settledCycles: null,
          plannedCycles: null,
          expectedYield: [],
          combatLog: ["Zichen 攻击腐化野狼，造成 16 点伤害。"]
        }
      })
    });

    const response = await app.inject({
      method: "POST",
      url: "/game/combat/start",
      headers: { "x-csrf-token": "csrf" },
      payload: {}
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().currentAction.actionType).toBe("combat");
  });

  it("cancels the active action", async () => {
    const app = buildGameRouteTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/game/action/cancel",
      headers: { "x-csrf-token": "csrf" },
      payload: {}
    });

    expect(response.statusCode).toBe(200);
  });

  it("returns to the village", async () => {
    const app = buildGameRouteTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/game/return-village",
      headers: { "x-csrf-token": "csrf" },
      payload: {}
    });

    expect(response.statusCode).toBe(200);
  });

  it("returns the municipal market", async () => {
    const app = buildGameRouteTestApp();
    const response = await app.inject({ method: "GET", url: "/game/market" });

    expect(response.statusCode).toBe(200);
    expect(response.json().items[0].itemId).toBe("iron_ore");
  });

  it("settles world before listing dialogue NPC targets", async () => {
    const calls: string[] = [];
    const app = buildGameRouteTestApp({
      settleWorldIfDue: async () => {
        calls.push("settled");
      },
      listDialogueTargets: async () => {
        calls.push("targets");
        return [dialogueTarget];
      }
    });

    const response = await app.inject({ method: "GET", url: "/game/npcs/dialogue-targets" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([expect.objectContaining({ npcActorId: "npc-blacksmith" })]);
    expect(calls).toEqual(["settled", "targets"]);
  });

  it("returns one NPC dialogue thread", async () => {
    const calls: unknown[] = [];
    const app = buildGameRouteTestApp({
      getNpcDialogue: async (accountId, npcActorId) => {
        calls.push({ accountId, npcActorId });
        return dialogueResponse;
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/game/npcs/npc-blacksmith/dialogue"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().messages[0].message).toContain("炉火");
    expect(calls).toEqual([{ accountId: "account-1", npcActorId: "npc-blacksmith" }]);
  });

  it("sends one NPC dialogue message through a CSRF-protected mutation", async () => {
    const calls: unknown[] = [];
    const app = buildGameRouteTestApp({
      sendNpcDialogueMessage: async (accountId, npcActorId, message) => {
        calls.push({ accountId, npcActorId, message });
        return {
          ...dialogueResponse,
          messages: [
            {
              id: "msg-player",
              npcActorId,
              speakerType: "player",
              message,
              createdAt: "2026-07-01T12:00:00.000Z"
            },
            ...dialogueResponse.messages
          ]
        };
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/game/npcs/npc-blacksmith/dialogue",
      headers: { "x-csrf-token": "csrf" },
      payload: { message: "最近缺什么？" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().messages[0].speakerType).toBe("player");
    expect(calls).toEqual([
      { accountId: "account-1", npcActorId: "npc-blacksmith", message: "最近缺什么？" }
    ]);
  });

  it("accepts an NPC task through a CSRF-protected mutation", async () => {
    const calls: unknown[] = [];
    const app = buildGameRouteTestApp({
      acceptNpcTask: async (accountId, taskId) => {
        calls.push({ accountId, taskId });
        return {
          ...baseState,
          npcTasks: [
            {
              id: taskId,
              npcActorId: "npc-blacksmith",
              npcName: "伯林",
              needType: "ore_shortage",
              status: "accepted",
              title: "炉火缺矿",
              description: "伯林缺少基础铁矿石。",
              proposalSource: "template",
              proposalReason: "基础铁矿石不足，修理炉火和补强装备都会被拖慢。",
              requestedItem: { itemId: "iron_ore", name: "基础铁矿石", quantity: 3 },
              rewardCopper: { gold: 0, silver: 0, copper: 36, totalCopper: 36 },
              acceptedByCharacterId: "character-1",
              expiresAt: "2026-07-03T08:00:00.000Z",
              createdAt: "2026-07-02T08:00:00.000Z",
              acceptedAt: "2026-07-02T08:05:00.000Z",
              completedAt: null
            }
          ]
        };
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/game/npc-tasks/task-1/accept",
      headers: { "x-csrf-token": "csrf" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().npcTasks[0].status).toBe("accepted");
    expect(calls).toEqual([{ accountId: "account-1", taskId: "task-1" }]);
  });

  it("completes an NPC task through a CSRF-protected mutation", async () => {
    const calls: unknown[] = [];
    const app = buildGameRouteTestApp({
      completeNpcTask: async (accountId, taskId) => {
        calls.push({ accountId, taskId });
        return {
          ...baseState,
          npcTasks: [],
          character: {
            ...baseState.character!,
            money: { gold: 0, silver: 12, copper: 71, totalCopper: 1271 }
          }
        };
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/game/npc-tasks/task-1/complete",
      headers: { "x-csrf-token": "csrf" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().npcTasks).toEqual([]);
    expect(calls).toEqual([{ accountId: "account-1", taskId: "task-1" }]);
  });

  it("buys a market item through a CSRF-protected mutation", async () => {
    const calls: unknown[] = [];
    const app = buildGameRouteTestApp({
      buyMarketItem: async (accountId, input) => {
        calls.push({ accountId, input });
        return baseState;
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/game/market/buy",
      headers: { "x-csrf-token": "csrf" },
      payload: { itemId: "iron_ore", quantity: 1 }
    });

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([
      { accountId: "account-1", input: { itemId: "iron_ore", quantity: 1 } }
    ]);
  });

  it("sells a market item through a CSRF-protected mutation", async () => {
    const calls: unknown[] = [];
    const app = buildGameRouteTestApp({
      sellMarketItem: async (accountId, input) => {
        calls.push({ accountId, input });
        return baseState;
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/game/market/sell",
      headers: { "x-csrf-token": "csrf" },
      payload: { itemId: "iron_ore", quantity: 1 }
    });

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([
      { accountId: "account-1", input: { itemId: "iron_ore", quantity: 1 } }
    ]);
  });

  it("returns a repair quote", async () => {
    const calls: unknown[] = [];
    const app = buildGameRouteTestApp({
      getRepairQuote: async (accountId, input) => {
        calls.push({ accountId, input });
        return {
          copperCost: { gold: 0, silver: 1, copper: 50, totalCopper: 150 },
          ironOreCost: 1
        };
      }
    });
    const response = await app.inject({
      method: "POST",
      url: "/game/repair/quote",
      headers: { "x-csrf-token": "csrf" },
      payload: { equipmentId: "equipment-1" }
    });

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([
      { accountId: "account-1", input: { equipmentId: "equipment-1" } }
    ]);
    expect(response.json()).toEqual({
      copperCost: { gold: 0, silver: 1, copper: 50, totalCopper: 150 },
      ironOreCost: 1
    });
  });

  it("repairs one equipment item through a CSRF-protected mutation", async () => {
    const calls: unknown[] = [];
    const app = buildGameRouteTestApp({
      repairEquipment: async (accountId, input) => {
        calls.push({ accountId, input });
        return {
          ...baseState,
          equipment: [
            {
              ...baseState.equipment[0]!,
              currentDurability: 100,
              durabilityPct: 100,
              repairQuote: null
            }
          ]
        };
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/game/repair",
      headers: { "x-csrf-token": "csrf" },
      payload: { equipmentId: "equipment-1" }
    });

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([
      { accountId: "account-1", input: { equipmentId: "equipment-1" } }
    ]);
    expect(response.json().equipment[0].currentDurability).toBe(100);
  });

  it("repairs all damaged equipment through a CSRF-protected mutation", async () => {
    const calls: unknown[] = [];
    const app = buildGameRouteTestApp({
      repairAllEquipment: async (accountId) => {
        calls.push({ accountId });
        return {
          ...baseState,
          equipment: [
            {
              ...baseState.equipment[0]!,
              currentDurability: 100,
              durabilityPct: 100,
              repairQuote: null
            }
          ]
        };
      }
    });
    const response = await app.inject({
      method: "POST",
      url: "/game/repair/all",
      headers: { "x-csrf-token": "csrf" },
      payload: {}
    });

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([{ accountId: "account-1" }]);
  });

  it("eats a food item through a CSRF-protected mutation", async () => {
    const calls: unknown[] = [];
    const app = buildGameRouteTestApp({
      eatFood: async (accountId, input) => {
        calls.push({ accountId, input });
        return {
          ...baseState,
          character: {
            ...baseState.character!,
            needs: {
              hunger: {
                ...baseState.character!.needs.hunger,
                current: 5
              }
            }
          }
        };
      }
    });
    const response = await app.inject({
      method: "POST",
      url: "/game/eat",
      headers: { "x-csrf-token": "csrf" },
      payload: { itemId: "wild_berry" }
    });

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([
      { accountId: "account-1", input: { itemId: "wild_berry" } }
    ]);
    expect(response.json().character.needs.hunger.current).toBe(5);
  });

  it("surfaces repair validation errors", async () => {
    const app = buildGameRouteTestApp({
      repairEquipment: async () => {
        throw new GameServiceError("VALIDATION_ERROR", "必须在黑松哨站修理装备。");
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/game/repair",
      headers: { "x-csrf-token": "csrf" },
      payload: { equipmentId: "equipment-1" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: "VALIDATION_ERROR", message: "必须在黑松哨站修理装备。" }
    });
  });
});
