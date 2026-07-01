import type { GameStateDto, MarketDto } from "@ai-mud/shared";
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
  currentAction: null,
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

function buildGameRouteTestApp(overrides: Partial<GameRouteDependencies> = {}) {
  const deps: GameRouteDependencies = {
    getCurrentAccount: async () => activeAccount,
    verifyGameMutation: async () => true,
    getState: async () => baseState,
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
    ...overrides
  };
  const app = Fastify();
  void app.register(registerGameRoutes, deps);
  return app;
}

describe("registerGameRoutes", () => {
  it("requires an authenticated session for game state", async () => {
    const app = buildGameRouteTestApp({ getCurrentAccount: async () => null });
    const response = await app.inject({ method: "GET", url: "/game/state" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Not signed in" }
    });
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
