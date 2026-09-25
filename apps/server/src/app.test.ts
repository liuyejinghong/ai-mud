import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildApp, createWorldRuntimeScheduler } from "./app.js";
import type { Db } from "./db/client.js";

const testEnv = {
  NODE_ENV: "test" as const,
  PLAYTEST_REGISTRATION_ENABLED: false,
  SERVER_HOST: "127.0.0.1",
  SERVER_PORT: 3000,
  DATABASE_URL: "postgres://example",
  SESSION_COOKIE_NAME: "ai_mud_session",
  SESSION_SECRET: "test-secret-that-is-at-least-32-bytes",
  WEB_ORIGINS: ["http://127.0.0.1:5173"],
  WORLD_TICK_ENABLED: false,
  WORLD_TICK_INTERVAL_MS: 60_000,
  WORLD_TICK_MAX_STEPS: 60,
  AI_NPC_DIALOGUE_ENABLED: false,
  AI_PROVIDER: "template" as const,
  DEEPSEEK_BASE_URL: "https://api.deepseek.com",
  DEEPSEEK_MODEL: "deepseek-v4-flash",
  AI_DIALOGUE_TIMEOUT_MS: 8_000,
  AI_DIALOGUE_MAX_OUTPUT_TOKENS: 400,
  TYPE_SAFE_DECISION_MODE: "off" as const,
  TYPE_SAFE_MODEL: "jev-latest",
  TYPE_SAFE_BASE_URL: "https://openrouter.ai/api/v1",
  AI_DAILY_TOKEN_BUDGET: null
};

describe("buildApp", () => {
  it("builds world production through the shared composition boundary", () => {
    const source = readFileSync(new URL("./app.ts", import.meta.url), "utf8");

    expect(source).toContain('from "./modules/game/game.composition.js"');
    expect(source).not.toContain('createNpcTaskService } from "./modules/game/game.routes.js"');
  });

  it("allows credentialed cors only for configured web origins", async () => {
    const app = await buildApp({ env: testEnv, db: {} as Db });

    const allowed = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "http://127.0.0.1:5173" }
    });
    const blocked = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://evil.example" }
    });

    expect(allowed.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
    expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("returns generic API errors for unhandled exceptions", async () => {
    const app = await buildApp({ env: testEnv, db: {} as Db });
    app.get("/boom", async () => {
      throw new Error("database password leaked");
    });

    const response = await app.inject({
      method: "GET",
      url: "/boom"
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" }
    });
    expect(response.body).not.toContain("database password leaked");
  });
});

// 车道 C1/C2/C3（ARCH-boundaries-01/02）：旧西幻世界默认不再注册 /game 与旧世界管理接口。
describe("buildApp legacy world switch", () => {
  const legacyOnlyRoutes = [
    ["GET", "/game/state"],
    ["POST", "/game/characters"],
    ["POST", "/admin/world-reset"],
    ["GET", "/admin/economy"],
    ["GET", "/admin/npc-memory"],
    ["POST", "/admin/npcs/settle"],
    ["POST", "/admin/npcs/simulate"]
  ] as const;

  const alwaysOnRoutes = [
    ["GET", "/base/snapshot"],
    ["POST", "/base/heartbeat"],
    ["GET", "/auth/me"],
    ["GET", "/admin/activation-codes"],
    ["GET", "/admin/accounts"],
    ["GET", "/admin/world-runtime"],
    ["GET", "/admin/npcs"],
    ["GET", "/admin/asset-ledger/health"],
    ["GET", "/admin/ai-layer/status"]
  ] as const;

  it.each(legacyOnlyRoutes)("does not register legacy route %s %s by default", async (method, url) => {
    const app = await buildApp({ env: testEnv, db: {} as Db });

    const response = await app.inject({ method, url, ...(method === "POST" ? { payload: {} } : {}) });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it.each(alwaysOnRoutes)("keeps %s %s registered with the legacy world disabled", async (method, url) => {
    const app = await buildApp({ env: testEnv, db: {} as Db });

    const response = await app.inject({ method, url, ...(method === "POST" ? { payload: {} } : {}) });

    expect(response.statusCode).not.toBe(404);
    await app.close();
  });

  it.each(legacyOnlyRoutes)("registers legacy route %s %s when LEGACY_WORLD_ENABLED=true", async (method, url) => {
    const app = await buildApp({ env: { ...testEnv, LEGACY_WORLD_ENABLED: true }, db: {} as Db });

    const response = await app.inject({ method, url, ...(method === "POST" ? { payload: {} } : {}) });

    expect(response.statusCode).not.toBe(404);
    await app.close();
  });
});

describe("createWorldRuntimeScheduler", () => {
  it("starts post-tick work after a successful settled step without awaiting it", async () => {
    const calls: string[] = [];
    let finishPostTick!: () => void;
    const postTickPending = new Promise<void>((resolve) => {
      finishPostTick = resolve;
    });
    const scheduler = createWorldRuntimeScheduler({
      settleDue: async () => ({ settledSteps: 1, skipped: false }),
        getWorldEpoch: async () => 1,
      runPostTick: async () => {
        calls.push("post-tick");
        await postTickPending;
      },
      onPostTickError: () => undefined
    });

    await expect(scheduler.settleDue(new Date("2026-07-13T08:01:00.000Z"))).resolves.toEqual({
      settledSteps: 1,
      skipped: false
    });
    expect(calls).toEqual(["post-tick"]);
    finishPostTick();
  });

  it("does not run post-tick work for lease skips or zero settled steps", async () => {
    const postTickCalls: Date[] = [];
    const results = [
      { settledSteps: 0, skipped: true },
      { settledSteps: 0, skipped: false }
    ];
    const scheduler = createWorldRuntimeScheduler({
      settleDue: async () => results.shift()!,
        getWorldEpoch: async () => 1,
      runPostTick: async (now) => {
        postTickCalls.push(now);
      },
      onPostTickError: () => undefined
    });

    await scheduler.settleDue(new Date("2026-07-13T08:01:00.000Z"));
    await scheduler.settleDue(new Date("2026-07-13T08:02:00.000Z"));

    expect(postTickCalls).toEqual([]);
  });

  it("keeps post-tick work behind an independent in-flight guard", async () => {
    let finishPostTick!: () => void;
    const pending = new Promise<void>((resolve) => {
      finishPostTick = resolve;
    });
    let postTickCalls = 0;
    const scheduler = createWorldRuntimeScheduler({
      settleDue: async () => ({ settledSteps: 1, skipped: false }),
        getWorldEpoch: async () => 1,
      runPostTick: async () => {
        postTickCalls += 1;
        await pending;
      },
      onPostTickError: () => undefined
    });

    await scheduler.settleDue(new Date("2026-07-13T08:01:00.000Z"));
    await scheduler.settleDue(new Date("2026-07-13T08:02:00.000Z"));

    expect(postTickCalls).toBe(1);
    finishPostTick();
  });

  it("keeps post-tick failures out of the settlement result", async () => {
    const errors: unknown[] = [];
    const scheduler = createWorldRuntimeScheduler({
      settleDue: async () => ({ settledSteps: 2, skipped: false }),
        getWorldEpoch: async () => 1,
      runPostTick: async () => {
        throw new Error("AI failed");
      },
      onPostTickError: (error) => errors.push(error)
    });

    await expect(scheduler.settleDue()).resolves.toEqual({ settledSteps: 2, skipped: false });
    await Promise.resolve();
    expect(errors).toHaveLength(1);
  });
});
