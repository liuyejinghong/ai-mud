import { describe, expect, it } from "vitest";
import type { WorldClock } from "./world-clock.js";
import type {
  WorldRuntimeProgress,
  WorldRuntimeRepositoryPort,
  WorldRuntimeTx
} from "./world-runtime.repository.js";
import { WorldRuntimeService } from "./world-runtime.service.js";

class InMemoryWorldRuntimeRepository implements WorldRuntimeRepositoryPort {
  progress: { key: string; lastSettledAt: Date } | null = null;
  savedProgress: string[] = [];

  async find() {
    return this.progress ? { key: this.progress.key, lastSettledAt: new Date(this.progress.lastSettledAt) } : null;
  }

  async ensureRow(key: string, initialLastSettledAt: Date) {
    if (!this.progress) {
      this.progress = { key, lastSettledAt: new Date(initialLastSettledAt) };
    }
  }

  async lockAndRead(key: string) {
    return this.progress ? { key, lastSettledAt: new Date(this.progress.lastSettledAt) } : null;
  }

  async saveProgress(input: { key: string; lastSettledAt: Date }) {
    this.progress = { key: input.key, lastSettledAt: new Date(input.lastSettledAt) };
    this.savedProgress.push(input.lastSettledAt.toISOString());
  }

  async transaction<T>(
    operation: (txRepo: WorldRuntimeRepositoryPort, tx: WorldRuntimeTx) => Promise<T>
  ): Promise<T> {
    return operation(this, this as unknown as WorldRuntimeTx);
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
});
