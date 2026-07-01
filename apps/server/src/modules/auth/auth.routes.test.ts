import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerAuthRoutes, type AuthRouteDependencies } from "./auth.routes.js";

function buildAuthRouteTestApp(deps: AuthRouteDependencies) {
  const app = Fastify();
  app.decorate("config", {
    NODE_ENV: "test",
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
    AI_PROVIDER: "template",
    DEEPSEEK_BASE_URL: "https://api.deepseek.com",
    DEEPSEEK_MODEL: "deepseek-v4-flash",
    AI_DIALOGUE_TIMEOUT_MS: 8_000,
    AI_DIALOGUE_MAX_OUTPUT_TOKENS: 400
  });
  void app.register(cookie, { secret: "test-secret-that-is-at-least-32-bytes" });
  void app.register(registerAuthRoutes, deps);
  return app;
}

const activeAccount = {
  id: "account-1",
  email: "player@example.com",
  passwordHash: "hash",
  role: "player" as const,
  status: "active" as const
};

describe("registerAuthRoutes", () => {
  it("registers with an activation code without opening a session", async () => {
    const registrations: unknown[] = [];
    const app = buildAuthRouteTestApp({
      findAccountByEmail: async () => null,
      registerWithActivationCode: async (input) => {
        registrations.push(input);
        return { account: activeAccount };
      },
      verifyPassword: async () => false,
      createSession: async () => {
        throw new Error("not used");
      },
      revokeSessionByToken: async () => undefined,
      findAccountBySessionToken: async () => null,
      createCsrfToken: () => "csrf-token"
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "player@example.com",
        password: "correct horse battery staple",
        activationCode: "INVITE-CODE"
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.json()).toEqual({
      user: {
        id: "account-1",
        email: "player@example.com",
        role: "player",
        status: "active"
      }
    });
    expect(registrations).toEqual([
      {
        email: "player@example.com",
        password: "correct horse battery staple",
        activationCode: "INVITE-CODE"
      }
    ]);
  });

  it("does not set a session cookie when audited registration fails", async () => {
    const app = buildAuthRouteTestApp({
      findAccountByEmail: async () => null,
      registerWithActivationCode: async () => {
        throw new Error("audit insert failed");
      },
      verifyPassword: async () => false,
      createSession: async () => {
        throw new Error("not used");
      },
      revokeSessionByToken: async () => undefined,
      findAccountBySessionToken: async () => null,
      createCsrfToken: () => "csrf-token"
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "player@example.com",
        password: "correct horse battery staple",
        activationCode: "INVITE-CODE"
      }
    });

    expect(response.statusCode).toBe(500);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.body).not.toContain("session-token");
  });

  it("sets a session cookie only after login succeeds", async () => {
    const app = buildAuthRouteTestApp({
      findAccountByEmail: async () => activeAccount,
      registerWithActivationCode: async () => {
        throw new Error("not used");
      },
      verifyPassword: async () => true,
      createSession: async () => "session-token",
      revokeSessionByToken: async () => undefined,
      findAccountBySessionToken: async () => null,
      createCsrfToken: () => "csrf-token"
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "player@example.com",
        password: "correct horse battery staple"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toContain("ai_mud_session=session-token");
    expect(response.json()).toEqual({
      user: {
        id: "account-1",
        email: "player@example.com",
        role: "player",
        status: "active"
      },
      csrfToken: "csrf-token"
    });
  });
});
