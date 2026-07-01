import type { GameStateDto } from "@ai-mud/shared";
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
    position: null
  },
  locationTitle: "黑松哨站",
  locationDescription: "潮湿黑松围住木墙，哨塔上的火盆把灰雾照成暗红色。",
  map: null,
  inventory: [],
  availableActions: ["enter_corrupt_forest"],
  log: []
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
    gather: async () => ({
      ...baseState,
      inventory: [{ itemId: "wild_berry", name: "野莓", quantity: 2 }]
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

  it("gathers from the current resource cell and returns updated inventory", async () => {
    const app = buildGameRouteTestApp();
    const response = await app.inject({
      method: "POST",
      url: "/game/gather",
      headers: { "x-csrf-token": "csrf" },
      payload: {}
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().inventory).toEqual([{ itemId: "wild_berry", name: "野莓", quantity: 2 }]);
  });

  it("rejects gathering on an empty cell", async () => {
    const app = buildGameRouteTestApp({
      gather: async () => {
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
});
