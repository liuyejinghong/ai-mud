import { describe, expect, it } from "vitest";
import type { WorldRuntimeRecord, WorldRuntimeRepository } from "./world-runtime.repository.js";
import { WorldRuntimeService } from "./world-runtime.service.js";

class InMemoryWorldRuntimeRepository
  implements Pick<WorldRuntimeRepository, "acquireLease" | "find" | "releaseLease" | "saveProgress">
{
  record: WorldRuntimeRecord | null = null;

  async find() {
    return this.record;
  }

  async acquireLease(input: {
    key: string;
    ownerId: string;
    now: Date;
    leaseUntil: Date;
    initialLastSettledAt: Date;
  }) {
    if (this.record?.leaseUntil && this.record.leaseUntil.getTime() > input.now.getTime()) {
      return null;
    }

    this.record = {
      key: input.key,
      lastSettledAt: this.record?.lastSettledAt
        ? new Date(this.record.lastSettledAt)
        : new Date(input.initialLastSettledAt),
      leaseOwner: input.ownerId,
      leaseUntil: new Date(input.leaseUntil)
    };
    return this.record;
  }

  async saveProgress(input: {
    key: string;
    lastSettledAt: Date;
    leaseOwner: string;
    leaseUntil: Date;
  }) {
    this.record = {
      ...input,
      lastSettledAt: new Date(input.lastSettledAt),
      leaseUntil: new Date(input.leaseUntil)
    };
  }

  async releaseLease(input: { key: string; ownerId: string; lastSettledAt: Date }) {
    this.record = {
      key: input.key,
      lastSettledAt: new Date(input.lastSettledAt),
      leaseOwner: null,
      leaseUntil: null
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
    expect(repo.record?.leaseOwner).toBeNull();
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

  it("skips settlement while the same owner already has an active lease", async () => {
    const repo = new InMemoryWorldRuntimeRepository();
    repo.record = {
      key: "npc_world",
      lastSettledAt: new Date("2026-07-01T12:00:00.000Z"),
      leaseOwner: "test-owner",
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

  it("allows callers to save tick progress inside a custom settlement boundary", async () => {
    const repo = new InMemoryWorldRuntimeRepository();
    repo.record = {
      key: "npc_world",
      lastSettledAt: new Date("2026-07-01T12:00:00.000Z"),
      leaseOwner: null,
      leaseUntil: null
    };
    const settlementBoundaries: string[] = [];
    const service = new WorldRuntimeService({
      repo,
      ownerId: "test-owner",
      maxStepsPerRun: 1,
      settleNpcWorld: async () => {
        throw new Error("custom tick should be used");
      },
      settleTick: async (now, progress) => {
        settlementBoundaries.push(now.toISOString());
        await repo.saveProgress(progress);
      }
    });

    await expect(service.settleDue(new Date("2026-07-01T12:05:00.000Z"))).resolves.toEqual({
      settledSteps: 1,
      skipped: false
    });
    expect(settlementBoundaries).toEqual(["2026-07-01T12:01:00.000Z"]);
    expect(repo.record?.lastSettledAt?.toISOString()).toBe("2026-07-01T12:01:00.000Z");
    expect(repo.record?.leaseOwner).toBeNull();
  });

  it("does not advance the cursor when tick settlement fails", async () => {
    const repo = new InMemoryWorldRuntimeRepository();
    repo.record = {
      key: "npc_world",
      lastSettledAt: new Date("2026-07-01T12:00:00.000Z"),
      leaseOwner: null,
      leaseUntil: null
    };
    const service = new WorldRuntimeService({
      repo,
      ownerId: "test-owner",
      settleNpcWorld: async () => {
        throw new Error("settlement failed");
      }
    });

    await expect(service.settleDue(new Date("2026-07-01T12:05:00.000Z"))).rejects.toThrow(
      "settlement failed"
    );
    expect(repo.record?.lastSettledAt?.toISOString()).toBe("2026-07-01T12:00:00.000Z");
    expect(repo.record?.leaseOwner).toBe("test-owner");
  });
});
