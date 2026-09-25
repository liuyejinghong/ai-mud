import { describe, expect, it } from "vitest";
import { isLegacyWorldEnabled, loadEnv } from "./env.js";

const baseEnv = {
  DATABASE_URL: "postgres://example",
  SESSION_SECRET: "test-secret-that-is-at-least-32-bytes"
};

describe("loadEnv", () => {
  it("allows a short gathering cycle only in the test runtime", () => {
    expect(
      loadEnv({
        ...baseEnv,
        NODE_ENV: "test",
        TEST_GATHERING_CYCLE_MS: "200"
      }).TEST_GATHERING_CYCLE_MS
    ).toBe(200);
  });

  it("rejects test-only gathering timing in a player-facing runtime", () => {
    expect(() =>
      loadEnv({
        ...baseEnv,
        NODE_ENV: "development",
        TEST_GATHERING_CYCLE_MS: "200"
      })
    ).toThrow("TEST_GATHERING_CYCLE_MS");
  });

  // 车道 C1（ARCH-boundaries-02）：旧西幻世界默认关闭，只有显式 "true" 才开启。
  it("keeps the legacy world disabled unless LEGACY_WORLD_ENABLED is explicitly true", () => {
    expect(isLegacyWorldEnabled(loadEnv(baseEnv))).toBe(false);
    expect(isLegacyWorldEnabled(loadEnv({ ...baseEnv, LEGACY_WORLD_ENABLED: "false" }))).toBe(false);
    expect(isLegacyWorldEnabled(loadEnv({ ...baseEnv, LEGACY_WORLD_ENABLED: "1" }))).toBe(false);
    expect(isLegacyWorldEnabled(loadEnv({ ...baseEnv, LEGACY_WORLD_ENABLED: "true" }))).toBe(true);
  });

  // 车道 C5（ARCH-domain-08）：连接池与会话超时可配置并做 env 校验。
  it("parses database pool and session timeouts", () => {
    const env = loadEnv({
      ...baseEnv,
      DB_POOL_MAX: "20",
      DB_POOL_CONNECTION_TIMEOUT_MS: "5000",
      DB_STATEMENT_TIMEOUT_MS: "15000",
      DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: "45000"
    });

    expect(env.DB_POOL_MAX).toBe(20);
    expect(env.DB_POOL_CONNECTION_TIMEOUT_MS).toBe(5_000);
    expect(env.DB_STATEMENT_TIMEOUT_MS).toBe(15_000);
    expect(env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS).toBe(45_000);
  });

  it("leaves database timeouts unset so the client applies its bounded defaults", () => {
    const env = loadEnv(baseEnv);

    expect(env.DB_POOL_MAX).toBeUndefined();
    expect(env.DB_POOL_CONNECTION_TIMEOUT_MS).toBeUndefined();
    expect(env.DB_STATEMENT_TIMEOUT_MS).toBeUndefined();
    expect(env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS).toBeUndefined();
  });

  it.each([
    ["DB_POOL_CONNECTION_TIMEOUT_MS", "0"],
    ["DB_STATEMENT_TIMEOUT_MS", "-1"],
    ["DB_IDLE_IN_TRANSACTION_TIMEOUT_MS", "1.5"],
    ["DB_POOL_MAX", "0"],
    ["DB_STATEMENT_TIMEOUT_MS", "soon"]
  ])("rejects an unbounded or malformed %s=%s", (key, value) => {
    expect(() => loadEnv({ ...baseEnv, [key]: value })).toThrow(key);
  });
});
