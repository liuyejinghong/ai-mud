import { describe, expect, it } from "vitest";
import type { WorldClock } from "./world-clock.js";
import type {
  WorldRuntimeProgress,
  WorldRuntimeRepositoryPort,
  WorldRuntimeTx
} from "./world-runtime.repository.js";
import { createPerBaseTickParticipant, WorldRuntimeService } from "./world-runtime.service.js";

class InMemoryWorldRuntimeRepository implements WorldRuntimeRepositoryPort {
  progress: { key: string; lastSettledAt: Date; worldEpoch: number } | null = null;
  savedProgress: string[] = [];
  // Committed progress only: a failed transaction restores the snapshot taken at BEGIN.
  inTransaction = false;

  async find() {
    return this.progress
      ? {
          key: this.progress.key,
          lastSettledAt: new Date(this.progress.lastSettledAt),
          worldEpoch: this.progress.worldEpoch
        }
      : null;
  }

  async ensureRow(key: string, initialLastSettledAt: Date) {
    if (!this.progress) {
      this.progress = { key, lastSettledAt: new Date(initialLastSettledAt), worldEpoch: 1 };
    }
  }

  async lockAndRead(key: string) {
    return this.progress
      ? {
          key,
          lastSettledAt: new Date(this.progress.lastSettledAt),
          worldEpoch: this.progress.worldEpoch
        }
      : null;
  }

  async saveProgress(input: { key: string; lastSettledAt: Date }) {
    this.progress = {
      key: input.key,
      lastSettledAt: new Date(input.lastSettledAt),
      worldEpoch: this.progress?.worldEpoch ?? 1
    };
    this.savedProgress.push(input.lastSettledAt.toISOString());
  }

  async transaction<T>(
    operation: (txRepo: WorldRuntimeRepositoryPort, tx: WorldRuntimeTx) => Promise<T>
  ): Promise<T> {
    const snapshot = this.progress ? { ...this.progress } : null;
    this.inTransaction = true;
    try {
      return await operation(this, this as unknown as WorldRuntimeTx);
    } catch (error) {
      this.progress = snapshot;
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }
}

function clockAt(at: Date): WorldClock {
  return { now: () => new Date(at) };
}

describe("WorldRuntimeService", () => {
  it("initializes the runtime row and waits a full interval before the first tick", async () => {
    const repo = new InMemoryWorldRuntimeRepository();
    const settled: string[] = [];
    const service = new WorldRuntimeService({
      repo,
      clock: clockAt(new Date("2026-07-01T12:34:56.000Z")),
      participants: [
        async (_tx, tickAt) => {
          settled.push(tickAt.toISOString());
        }
      ]
    });

    const result = await service.settleDue();

    expect(result).toEqual({ settledSteps: 0, skipped: true });
    expect(repo.progress?.lastSettledAt?.toISOString()).toBe("2026-07-01T12:34:00.000Z");
    expect(settled).toEqual([]);
  });

  it("settles one minute at a time up to the max step limit", async () => {
    const repo = new InMemoryWorldRuntimeRepository();
    await repo.ensureRow("npc_world", new Date("2026-07-01T12:00:00.000Z"));
    const settled: string[] = [];
    const service = new WorldRuntimeService({
      repo,
      clock: clockAt(new Date("2026-07-01T12:10:00.000Z")),
      maxStepsPerRun: 3,
      participants: [
        async (_tx, tickAt) => {
          settled.push(tickAt.toISOString());
        }
      ]
    });

    const result = await service.settleDue();

    expect(result).toEqual({ settledSteps: 3, skipped: false });
    expect(settled).toEqual([
      "2026-07-01T12:01:00.000Z",
      "2026-07-01T12:02:00.000Z",
      "2026-07-01T12:03:00.000Z"
    ]);
    expect(repo.progress?.lastSettledAt?.toISOString()).toBe("2026-07-01T12:03:00.000Z");
  });

  it("skips settlement when the world is already caught up", async () => {
    const repo = new InMemoryWorldRuntimeRepository();
    await repo.ensureRow("npc_world", new Date("2026-07-01T12:10:00.000Z"));
    const settled: string[] = [];
    const service = new WorldRuntimeService({
      repo,
      clock: clockAt(new Date("2026-07-01T12:10:30.000Z")),
      participants: [
        async () => {
          throw new Error("should not settle");
        }
      ]
    });

    await expect(service.settleDue()).resolves.toEqual({ settledSteps: 0, skipped: true });
    expect(settled).toEqual([]);
  });

  it("runs participants in order inside the same tick transaction", async () => {
    const repo = new InMemoryWorldRuntimeRepository();
    await repo.ensureRow("npc_world", new Date("2026-07-01T12:00:00.000Z"));
    const calls: string[] = [];
    const service = new WorldRuntimeService({
      repo,
      clock: clockAt(new Date("2026-07-01T12:02:00.000Z")),
      participants: [
        async (_tx, tickAt) => {
          calls.push(`npc@${tickAt.toISOString()}`);
        },
        async (_tx, tickAt) => {
          calls.push(`instances@${tickAt.toISOString()}`);
        }
      ]
    });

    const result = await service.settleDue();

    expect(result).toEqual({ settledSteps: 2, skipped: false });
    expect(calls).toEqual([
      "npc@2026-07-01T12:01:00.000Z",
      "instances@2026-07-01T12:01:00.000Z",
      "npc@2026-07-01T12:02:00.000Z",
      "instances@2026-07-01T12:02:00.000Z"
    ]);
  });

  it("does not advance progress when a participant fails, and retries the same tick next run", async () => {
    const repo = new InMemoryWorldRuntimeRepository();
    await repo.ensureRow("npc_world", new Date("2026-07-01T12:00:00.000Z"));
    let failFirstTick = true;
    const settled: string[] = [];
    const service = new WorldRuntimeService({
      repo,
      clock: clockAt(new Date("2026-07-01T12:02:00.000Z")),
      participants: [
        async (_tx, tickAt) => {
          if (failFirstTick && tickAt.toISOString() === "2026-07-01T12:01:00.000Z") {
            throw new Error("settlement failed");
          }
          settled.push(tickAt.toISOString());
        }
      ]
    });

    await expect(service.settleDue()).rejects.toThrow("settlement failed");
    expect(repo.progress?.lastSettledAt?.toISOString()).toBe("2026-07-01T12:00:00.000Z");

    failFirstTick = false;
    const retry = await service.settleDue();
    expect(retry).toEqual({ settledSteps: 2, skipped: false });
    expect(settled).toEqual([
      "2026-07-01T12:01:00.000Z",
      "2026-07-01T12:02:00.000Z"
    ]);
    expect(repo.progress?.lastSettledAt?.toISOString()).toBe("2026-07-01T12:02:00.000Z");
  });

  it("uses the injected clock when no explicit now is passed", async () => {
    const repo = new InMemoryWorldRuntimeRepository();
    await repo.ensureRow("npc_world", new Date("2026-07-01T12:00:00.000Z"));
    let observedNow: Date | null = null;
    const service = new WorldRuntimeService({
      repo,
      clock: {
        now: () => {
          observedNow = new Date("2026-07-01T12:01:00.000Z");
          return new Date(observedNow);
        }
      },
      participants: [async () => {}]
    });

    await service.settleDue();

    expect(observedNow).not.toBeNull();
    expect(repo.savedProgress).toEqual(["2026-07-01T12:01:00.000Z"]);
  });

  // 车道 C4（ARCH-domain-03）：基地结算不再是世界 tick 事务里的参与者。
  it("runs isolated participants after each step commits, outside the step transaction", async () => {
    const repo = new InMemoryWorldRuntimeRepository();
    await repo.ensureRow("npc_world", new Date("2026-07-01T12:00:00.000Z"));
    const observed: Array<{ tickAt: string; inTransaction: boolean; committedUpTo: string }> = [];
    const service = new WorldRuntimeService({
      repo,
      clock: clockAt(new Date("2026-07-01T12:02:00.000Z")),
      participants: [],
      isolated: {
        participants: [
          async (tickAt) => {
            observed.push({
              tickAt: tickAt.toISOString(),
              inTransaction: repo.inTransaction,
              committedUpTo: repo.progress?.lastSettledAt.toISOString() ?? "none"
            });
          }
        ],
        onFailure: () => {
          throw new Error("no isolated failure expected");
        }
      }
    });

    await expect(service.settleDue()).resolves.toEqual({ settledSteps: 2, skipped: false });
    expect(observed).toEqual([
      {
        tickAt: "2026-07-01T12:01:00.000Z",
        inTransaction: false,
        committedUpTo: "2026-07-01T12:01:00.000Z"
      },
      {
        tickAt: "2026-07-01T12:02:00.000Z",
        inTransaction: false,
        committedUpTo: "2026-07-01T12:02:00.000Z"
      }
    ]);
  });

  it("keeps advancing the world clock when an isolated participant fails, and reports the failure", async () => {
    const repo = new InMemoryWorldRuntimeRepository();
    await repo.ensureRow("npc_world", new Date("2026-07-01T12:00:00.000Z"));
    const failures: Array<{ tickAt: string; message: string }> = [];
    const settledByLaterParticipant: string[] = [];
    const service = new WorldRuntimeService({
      repo,
      clock: clockAt(new Date("2026-07-01T12:02:00.000Z")),
      participants: [],
      isolated: {
        participants: [
          async (tickAt) => {
            if (tickAt.toISOString() === "2026-07-01T12:01:00.000Z") throw new Error("boom in bases");
          },
          async (tickAt) => {
            settledByLaterParticipant.push(tickAt.toISOString());
          }
        ],
        onFailure: ({ tickAt, error }) => {
          failures.push({ tickAt: tickAt.toISOString(), message: (error as Error).message });
        }
      }
    });

    await expect(service.settleDue()).resolves.toEqual({ settledSteps: 2, skipped: false });
    expect(repo.progress?.lastSettledAt.toISOString()).toBe("2026-07-01T12:02:00.000Z");
    expect(failures).toEqual([{ tickAt: "2026-07-01T12:01:00.000Z", message: "boom in bases" }]);
    expect(settledByLaterParticipant).toEqual([
      "2026-07-01T12:01:00.000Z",
      "2026-07-01T12:02:00.000Z"
    ]);
  });

  it("does not run isolated participants for a step whose transaction rolled back", async () => {
    const repo = new InMemoryWorldRuntimeRepository();
    await repo.ensureRow("npc_world", new Date("2026-07-01T12:00:00.000Z"));
    const isolatedTicks: string[] = [];
    const service = new WorldRuntimeService({
      repo,
      clock: clockAt(new Date("2026-07-01T12:01:00.000Z")),
      participants: [
        async () => {
          throw new Error("legacy participant failed");
        }
      ],
      isolated: {
        participants: [
          async (tickAt) => {
            isolatedTicks.push(tickAt.toISOString());
          }
        ],
        onFailure: () => undefined
      }
    });

    await expect(service.settleDue()).rejects.toThrow("legacy participant failed");
    expect(repo.progress?.lastSettledAt.toISOString()).toBe("2026-07-01T12:00:00.000Z");
    expect(isolatedTicks).toEqual([]);
  });
});

describe("createPerBaseTickParticipant", () => {
  it("settles every due base in order and isolates a failing base", async () => {
    const settled: string[] = [];
    const failures: Array<{ baseId: string; tickAt: string; message: string }> = [];
    const participant = createPerBaseTickParticipant({
      listDueBaseIds: async () => ["base-a", "base-bad", "base-c"],
      settleBase: async (baseId, tickAt) => {
        if (baseId === "base-bad") throw new Error("boom in BAD");
        settled.push(`${baseId}@${tickAt.toISOString()}`);
      },
      onBaseFailure: ({ baseId, tickAt, error }) => {
        failures.push({ baseId, tickAt: tickAt.toISOString(), message: (error as Error).message });
      }
    });

    await participant(new Date("2026-07-01T12:01:00.000Z"));

    expect(settled).toEqual([
      "base-a@2026-07-01T12:01:00.000Z",
      "base-c@2026-07-01T12:01:00.000Z"
    ]);
    expect(failures).toEqual([
      { baseId: "base-bad", tickAt: "2026-07-01T12:01:00.000Z", message: "boom in BAD" }
    ]);
  });

  it("passes the tick time used for listing to every base", async () => {
    const listedAt: string[] = [];
    const participant = createPerBaseTickParticipant({
      listDueBaseIds: async (tickAt) => {
        listedAt.push(tickAt.toISOString());
        return [];
      },
      settleBase: async () => {
        throw new Error("no base is due");
      },
      onBaseFailure: () => {
        throw new Error("no base is due");
      }
    });

    await participant(new Date("2026-07-01T12:03:00.000Z"));

    expect(listedAt).toEqual(["2026-07-01T12:03:00.000Z"]);
  });
});
