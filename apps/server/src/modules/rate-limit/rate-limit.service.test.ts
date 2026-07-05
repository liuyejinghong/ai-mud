import { describe, expect, it } from "vitest";
import { InMemoryRateLimitService } from "./rate-limit.service.js";

describe("InMemoryRateLimitService", () => {
  it("limits repeated hits inside one window and resets after the window", () => {
    const service = new InMemoryRateLimitService();
    const startedAt = new Date("2026-07-05T00:00:00.000Z");

    expect(
      service.check({ key: "login:a:b", limit: 2, windowMs: 60_000, now: startedAt })
    ).toEqual({ ok: true, retryAfterSeconds: 0 });
    expect(
      service.check({ key: "login:a:b", limit: 2, windowMs: 60_000, now: startedAt })
    ).toEqual({ ok: true, retryAfterSeconds: 0 });
    expect(
      service.check({ key: "login:a:b", limit: 2, windowMs: 60_000, now: startedAt })
    ).toEqual({ ok: false, retryAfterSeconds: 60 });
    expect(
      service.check({
        key: "login:a:b",
        limit: 2,
        windowMs: 60_000,
        now: new Date("2026-07-05T00:01:00.000Z")
      })
    ).toEqual({ ok: true, retryAfterSeconds: 0 });
  });
});
