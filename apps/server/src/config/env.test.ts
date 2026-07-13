import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

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
});
