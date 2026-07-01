import { describe, expect, it } from "vitest";
import type { WorldRuntimeRecord, WorldRuntimeRepository } from "./world-runtime.repository.js";
import { WorldRuntimeService } from "./world-runtime.service.js";

class InMemoryWorldRuntimeRepository implements Pick<WorldRuntimeRepository, "find" | "upsert"> {
  record: WorldRuntimeRecord | null = null;

  async find() {
    return this.record;
  }

  async upsert(input: WorldRuntimeRecord) {
    this.record = {
      ...input,
      lastSettledAt: input.lastSettledAt ? new Date(input.lastSettledAt) : null,
      leaseUntil: input.leaseUntil ? new Date(input.leaseUntil) : null
    };
  }
}

describe("WorldRuntimeService", () => {
  it("initializes runtime state without backfilling old history", async () => {
    const repo = new InMemoryWorldRuntimeRepository();
    const settledAt: string[] = [];
    const service = new WorldRuntimeService({
      repo,
      ownerId: "test-owner",
      settleNpcWorld: async (now) => {
        settledAt.push(now.toISOString());
      }
    });

    const result = await service.settleDue(new Date("2026-07-01T12:34:56.000Z"));

    expect(result).toEqual({ settledSteps: 0, skipped: false });
    expect(repo.record?.lastSettledAt?.toISOString()).toBe("2026-07-01T12:34:00.000Z");
    expect(settledAt).toEqual([]);
  });

  it("settles one minute at a time up to the max step limit", async () => {
    const repo = new InMemoryWorldRuntimeRepository();
    repo.record = {
      key: "npc_world",
      lastSettledAt: new Date("2026-07-01T12:00:00.000Z"),
      leaseOwner: null,
      leaseUntil: null
    };
    const settledAt: string[] = [];
    const service = new WorldRuntimeService({
      repo,
      ownerId: "test-owner",
      maxStepsPerRun: 3,
      settleNpcWorld: async (now) => {
        settledAt.push(now.toISOString());
      }
    });

    const result = await service.settleDue(new Date("2026-07-01T12:10:00.000Z"));

    expect(result).toEqual({ settledSteps: 3, skipped: false });
    expect(settledAt).toEqual([
      "2026-07-01T12:01:00.000Z",
      "2026-07-01T12:02:00.000Z",
      "2026-07-01T12:03:00.000Z"
    ]);
    expect(repo.record?.lastSettledAt?.toISOString()).toBe("2026-07-01T12:03:00.000Z");
  });

  it("skips settlement while another owner lease is active", async () => {
    const repo = new InMemoryWorldRuntimeRepository();
    repo.record = {
      key: "npc_world",
      lastSettledAt: new Date("2026-07-01T12:00:00.000Z"),
      leaseOwner: "other-owner",
      leaseUntil: new Date("2026-07-01T12:01:00.000Z")
    };
    const service = new WorldRuntimeService({
      repo,
      ownerId: "test-owner",
      settleNpcWorld: async () => {
        throw new Error("should not settle");
      }
    });

    await expect(service.settleDue(new Date("2026-07-01T12:00:30.000Z"))).resolves.toEqual({
      settledSteps: 0,
      skipped: true
    });
  });
});
