import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type { Db } from "./db/client.js";

const testEnv = {
  NODE_ENV: "test" as const,
  SERVER_HOST: "127.0.0.1",
  SERVER_PORT: 3000,
  DATABASE_URL: "postgres://example",
  SESSION_COOKIE_NAME: "ai_mud_session",
  SESSION_SECRET: "test-secret-that-is-at-least-32-bytes",
  WEB_ORIGINS: ["http://127.0.0.1:5173"],
  WORLD_TICK_ENABLED: false,
  WORLD_TICK_INTERVAL_MS: 60_000,
  WORLD_TICK_MAX_STEPS: 60
};

describe("buildApp", () => {
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
});
