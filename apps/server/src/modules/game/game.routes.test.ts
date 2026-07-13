import type {
  ChatMessageDto,
  GameStateDto,
  GameSyncResponseDto,
  MarketDto,
  NpcDialogueResponseDto,
  NpcDialogueTargetDto
} from "@ai-mud/shared";
import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GameServiceError } from "./game.service.js";
import {
  createGameStateEnricher,
  enrichGameSyncResponse,
  registerGameRoutes,
  type GameRouteDependencies
} from "./game.routes.js";

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
      rarity: "common",
      itemLevel: 5,
      attackBonus: 2,
      defenseBonus: 0,
      agilityBonus: 0,
      maxHpBonus: 0,
      affixes: [],
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
  backpackEquipment: [],
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

const lobbyChatMessage: ChatMessageDto = {
  id: "chat-1",
  characterId: "character-1",
  characterName: "Zichen",
  channel: "lobby",
  body: "黑松哨站有人吗？",
  createdAt: "2026-07-02T00:00:00.000Z"
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
      chat: [],
      presence: [],
      leaderboards: { level: [], wealth: [] },
      nextCursor: cursor
    }),
    sendLobbyChat: async () => lobbyChatMessage,
    heartbeatPresence: async () => undefined,
    createCharacter: async () => baseState,
    enterZone: async () => ({
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
    equipEquipment: async () => baseState,
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
  it("keeps production game route enrichment free of world generation calls", () => {
    const source = readFileSync(new URL("./game.routes.ts", import.meta.url), "utf8");

    expect(source).not.toContain("syncOpenTasks(");
    expect(source).not.toContain("syncRumors(");
    expect(source).toContain('from "./game.composition.js"');
    expect(source).not.toContain("function createAiOrchestrator(");
  });

  it("purely enriches sync state with persisted visible tasks and rumors", async () => {
    let taskGeneratorCalls = 0;
    let rumorGeneratorCalls = 0;
    const openTask = {
      id: "task-open",
      npcActorId: "npc-blacksmith",
      npcName: "伯林",
      needType: "ore_shortage" as const,
      status: "open" as const,
      title: "炉火缺矿",
      description: "伯林缺少基础铁矿石。",
      proposalSource: "template" as const,
      proposalReason: "矿箱空了。",
      requestedItem: { itemId: "iron_ore" as const, name: "基础铁矿石", quantity: 3 },
      rewardCopper: { gold: 0, silver: 0, copper: 36, totalCopper: 36 },
      acceptedByCharacterId: null,
      expiresAt: "2026-07-14T08:00:00.000Z",
      createdAt: "2026-07-13T08:00:00.000Z",
      acceptedAt: null,
      completedAt: null
    };
    const acceptedTask = {
      ...openTask,
      id: "task-accepted",
      status: "accepted" as const,
      acceptedByCharacterId: "character-1",
      acceptedAt: "2026-07-13T08:05:00.000Z"
    };
    const taskReads = {
      listTasksForAccount: async () => [openTask, acceptedTask],
      syncOpenTasks: async () => {
        taskGeneratorCalls += 1;
      }
    };
    const rumorReads = {
      listRecentPublicRumors: async () => [
        {
          id: "rumor-1",
          message: "矿炉边的铁矿石快见底了。",
          sourceType: "npc_event" as const,
          sourceId: "event-1",
          settlementId: "blackpine_outpost",
          audience: "public" as const,
          tags: ["npc.task"],
          generatedBy: "template" as const,
          createdAt: "2026-07-13T08:00:00.000Z",
          expiresAt: null
        }
      ],
      syncRumors: async () => {
        rumorGeneratorCalls += 1;
      }
    };
    const enrich = createGameStateEnricher({
      tasks: taskReads,
      rumors: rumorReads,
      listNpcActors: async () => [
        { id: "npc-blacksmith", currentLocation: "blackpine_outpost" as const }
      ],
      now: () => new Date("2026-07-13T08:10:00.000Z")
    });
    const mineState: GameStateDto = {
      ...baseState,
      character: { ...baseState.character!, currentLocation: "old_mine" },
      availableActions: [...baseState.availableActions, "view_npc_tasks"]
    };

    const response = await enrichGameSyncResponse(
      "account-1",
      {
        stateVersion: 3,
        state: mineState,
        events: [],
        chat: [],
        presence: [],
        leaderboards: { level: [], wealth: [] },
        nextCursor: 3
      },
      enrich
    );

    expect(response.state?.npcTasks).toEqual([
      expect.objectContaining({
        id: "task-accepted",
        status: "accepted",
        npcLocation: "blackpine_outpost"
      })
    ]);
    expect(response.state?.rumors).toHaveLength(1);
    expect(response.state?.availableActions).toContain("view_npc_tasks");
    expect(taskGeneratorCalls).toBe(0);
    expect(rumorGeneratorCalls).toBe(0);
  });

  it("hides remote open tasks and removes invalid task actions", async () => {
    const enrich = createGameStateEnricher({
      tasks: {
        listTasksForAccount: async () => [
          {
            id: "task-open",
            npcActorId: "npc-blacksmith",
            npcName: "伯林",
            needType: "ore_shortage",
            status: "open",
            title: "炉火缺矿",
            description: "伯林缺少基础铁矿石。",
            proposalSource: "template",
            proposalReason: "矿箱空了。",
            requestedItem: { itemId: "iron_ore", name: "基础铁矿石", quantity: 3 },
            rewardCopper: { gold: 0, silver: 0, copper: 36, totalCopper: 36 },
            acceptedByCharacterId: null,
            expiresAt: "2026-07-14T08:00:00.000Z",
            createdAt: "2026-07-13T08:00:00.000Z",
            acceptedAt: null,
            completedAt: null
          }
        ]
      },
      rumors: { listRecentPublicRumors: async () => [] },
      listNpcActors: async () => [
        { id: "npc-blacksmith", currentLocation: "blackpine_outpost" as const }
      ]
    });
    const mineState: GameStateDto = {
      ...baseState,
      character: { ...baseState.character!, currentLocation: "old_mine" },
      availableActions: [...baseState.availableActions, "view_npc_tasks"]
    };

    const enriched = await enrich("account-1", mineState);

    expect(enriched.npcTasks).toEqual([]);
    expect(enriched.availableActions).not.toContain("view_npc_tasks");
  });

  it("shows an open task when its NPC is at the player's current location", async () => {
    const enrich = createGameStateEnricher({
      tasks: {
        listTasksForAccount: async () => [
          {
            id: "task-open",
            npcActorId: "npc-miner",
            npcName: "洛恩",
            needType: "ore_shortage",
            status: "open",
            title: "矿道缺粮",
            description: "洛恩需要补给。",
            proposalSource: "template",
            proposalReason: "补给箱空了。",
            requestedItem: { itemId: "iron_ore", name: "基础铁矿石", quantity: 3 },
            rewardCopper: { gold: 0, silver: 0, copper: 36, totalCopper: 36 },
            acceptedByCharacterId: null,
            expiresAt: "2026-07-14T08:00:00.000Z",
            createdAt: "2026-07-13T08:00:00.000Z",
            acceptedAt: null,
            completedAt: null
          }
        ]
      },
      rumors: { listRecentPublicRumors: async () => [] },
      listNpcActors: async () => [{ id: "npc-miner", currentLocation: "old_mine" as const }]
    });
    const mineState: GameStateDto = {
      ...baseState,
      character: { ...baseState.character!, currentLocation: "old_mine" }
    };

    const enriched = await enrich("account-1", mineState);

    expect(enriched.npcTasks).toEqual([
      expect.objectContaining({ id: "task-open", npcLocation: "old_mine" })
    ]);
    expect(enriched.availableActions).toContain("view_npc_tasks");
  });

  it("does not read tasks or rumors when sync state is null", async () => {
    const reads: string[] = [];
    const enrich = createGameStateEnricher({
      tasks: {
        listTasksForAccount: async () => {
          reads.push("tasks");
          return [];
        }
      },
      rumors: {
        listRecentPublicRumors: async () => {
          reads.push("rumors");
          return [];
        }
      },
      listNpcActors: async () => {
        reads.push("actors");
        return [];
      }
    });
    const sync: GameSyncResponseDto = {
      stateVersion: 3,
      state: null,
      events: [],
      chat: [],
      presence: [],
      leaderboards: { level: [], wealth: [] },
      nextCursor: 3
    };

    await expect(enrichGameSyncResponse("account-1", sync, enrich)).resolves.toBe(sync);
    expect(reads).toEqual([]);
  });

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
      syncGame: async (_accountId, cursor): Promise<GameSyncResponseDto> => ({
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
        chat: [lobbyChatMessage],
        presence: [
          {
            accountId: "account-1",
            characterId: "character-1",
            characterName: "Zichen",
            currentLocation: "blackpine_outpost",
            lastSeenAt: "2026-07-02T00:00:00.000Z"
          }
        ],
        leaderboards: {
          level: [
            {
              rank: 1,
              characterId: "character-1",
              characterName: "Zichen",
              level: 9,
              xp: 1802,
              wealthCopper: 4409
            }
          ],
          wealth: []
        },
        nextCursor: cursor ?? 9
      })
    });

    const response = await app.inject({ method: "GET", url: "/game/sync?cursor=8" });

    expect(response.statusCode).toBe(200);
    expect(response.json().state).toBeNull();
    expect(response.json().events[0].eventType).toBe("ui.toast");
    expect(response.json().chat[0].body).toBe("黑松哨站有人吗？");
    expect(response.json().presence[0].characterName).toBe("Zichen");
    expect(response.json().leaderboards.level[0].rank).toBe(1);
    expect(response.json().nextCursor).toBe(8);
  });

  it("sends lobby chat through an authenticated game mutation", async () => {
    const calls: unknown[] = [];
    const app = buildGameRouteTestApp({
      sendLobbyChat: async (accountId, body) => {
        calls.push({ accountId, body });
        return lobbyChatMessage;
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/game/chat",
      headers: { "x-csrf-token": "csrf" },
      payload: { body: " 黑松哨站有人吗？ " }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().body).toBe("黑松哨站有人吗？");
    expect(calls).toEqual([{ accountId: "account-1", body: "黑松哨站有人吗？" }]);
  });

  it("rejects lobby chat without a mutation token", async () => {
    const app = buildGameRouteTestApp({
      verifyGameMutation: async () => false
    });

    const response = await app.inject({
      method: "POST",
      url: "/game/chat",
      payload: { body: "hello" }
    });

    expect(response.statusCode).toBe(403);
  });

  it("records lobby presence through a heartbeat mutation", async () => {
    const calls: string[] = [];
    const app = buildGameRouteTestApp({
      heartbeatPresence: async (accountId) => {
        calls.push(accountId);
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/game/presence/heartbeat",
      headers: { "x-csrf-token": "csrf" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(calls).toEqual(["account-1"]);
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
    const calls: unknown[] = [];
    const app = buildGameRouteTestApp({
      enterZone: async (accountId, zoneId) => {
        calls.push({ accountId, zoneId });
        return {
          ...baseState,
          character: {
            ...baseState.character!,
            currentLocation: zoneId,
            position: { x: 2, y: 4 }
          }
        };
      }
    });
    const response = await app.inject({
      method: "POST",
      url: "/game/enter-zone",
      headers: { "x-csrf-token": "csrf" },
      payload: { zoneId: "corrupt_forest" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().character.position).toEqual({ x: 2, y: 4 });
    expect(calls).toEqual([{ accountId: "account-1", zoneId: "corrupt_forest" }]);
  });

  it("passes registered non-forest zones through the generic zone endpoint", async () => {
    const calls: unknown[] = [];
    const app = buildGameRouteTestApp({
      enterZone: async (accountId, zoneId) => {
        calls.push({ accountId, zoneId });
        return {
          ...baseState,
          character: {
            ...baseState.character!,
            currentLocation: zoneId,
            position: { x: 2, y: 4 }
          },
          locationTitle: "旧矿坑"
        };
      }
    });
    const response = await app.inject({
      method: "POST",
      url: "/game/enter-zone",
      headers: { "x-csrf-token": "csrf" },
      payload: { zoneId: "old_mine" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().locationTitle).toBe("旧矿坑");
    expect(calls).toEqual([{ accountId: "account-1", zoneId: "old_mine" }]);
  });

  it("rejects unknown zone ids before calling the game service", async () => {
    const calls: unknown[] = [];
    const app = buildGameRouteTestApp({
      enterZone: async (accountId, zoneId) => {
        calls.push({ accountId, zoneId });
        return baseState;
      }
    });
    const response = await app.inject({
      method: "POST",
      url: "/game/enter-zone",
      headers: { "x-csrf-token": "csrf" },
      payload: { zoneId: "missing_zone" }
    });

    expect(response.statusCode).toBe(400);
    expect(calls).toEqual([]);
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

  it("equips a backpack equipment instance through a CSRF-protected mutation", async () => {
    const calls: unknown[] = [];
    const app = buildGameRouteTestApp({
      equipEquipment: async (accountId, input) => {
        calls.push({ accountId, input });
        return {
          ...baseState,
          equipment: [
            {
              ...baseState.equipment[0]!,
              id: input.instanceId,
              itemKey: "wolfbone_shiv",
              name: "狼骨短刃",
              rarity: "rare",
              attackBonus: 4,
              agilityBonus: 1,
              affixes: [{ affixId: "sharp", name: "锋利", stat: "attack", value: 1 }]
            }
          ],
          backpackEquipment: []
        };
      }
    });
    const response = await app.inject({
      method: "POST",
      url: "/game/equipment/equip",
      headers: { "x-csrf-token": "csrf" },
      payload: { instanceId: "instance-1" }
    });

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([{ accountId: "account-1", input: { instanceId: "instance-1" } }]);
    expect(response.json().equipment[0].name).toBe("狼骨短刃");
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
