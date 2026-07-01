import type { WorldRuntimeRepository } from "./world-runtime.repository.js";

export const NPC_WORLD_RUNTIME_KEY = "npc_world";
export const WORLD_RUNTIME_TICK_MS = 60_000;
const DEFAULT_LEASE_MS = 55_000;

function floorToTick(date: Date) {
  return new Date(Math.floor(date.getTime() / WORLD_RUNTIME_TICK_MS) * WORLD_RUNTIME_TICK_MS);
}

export interface WorldRuntimeServiceInput {
  repo: Pick<WorldRuntimeRepository, "acquireLease" | "find" | "releaseLease" | "saveProgress">;
  ownerId: string;
  maxStepsPerRun?: number;
  settleNpcWorld(now: Date): Promise<void>;
  settleTick?(now: Date, progress: WorldRuntimeProgress): Promise<void>;
}

export interface WorldRuntimeProgress {
  key: string;
  lastSettledAt: Date;
  leaseOwner: string;
  leaseUntil: Date;
}

export interface WorldRuntimeSettleResult {
  settledSteps: number;
  skipped: boolean;
}

export class WorldRuntimeService {
  constructor(private readonly input: WorldRuntimeServiceInput) {}

  async settleDue(now: Date = new Date()): Promise<WorldRuntimeSettleResult> {
    const currentTick = floorToTick(now);
    const existing = await this.input.repo.find(NPC_WORLD_RUNTIME_KEY);

    if (existing?.leaseUntil && existing.leaseUntil.getTime() > now.getTime()) {
      return { settledSteps: 0, skipped: true };
    }

    const leaseUntil = new Date(now.getTime() + DEFAULT_LEASE_MS);
    const leased = await this.input.repo.acquireLease({
      key: NPC_WORLD_RUNTIME_KEY,
      ownerId: this.input.ownerId,
      now,
      leaseUntil,
      initialLastSettledAt: currentTick
    });
    if (!leased) return { settledSteps: 0, skipped: true };

    const maxSteps = Math.max(1, Math.floor(this.input.maxStepsPerRun ?? 60));
    let cursor = leased.lastSettledAt ?? currentTick;
    let settledSteps = 0;

    while (
      cursor.getTime() + WORLD_RUNTIME_TICK_MS <= currentTick.getTime() &&
      settledSteps < maxSteps
    ) {
      cursor = new Date(cursor.getTime() + WORLD_RUNTIME_TICK_MS);
      const progress = {
        key: NPC_WORLD_RUNTIME_KEY,
        lastSettledAt: cursor,
        leaseOwner: this.input.ownerId,
        leaseUntil
      };
      if (this.input.settleTick) {
        await this.input.settleTick(cursor, progress);
      } else {
        await this.input.settleNpcWorld(cursor);
        await this.input.repo.saveProgress(progress);
      }
      settledSteps += 1;
    }

    await this.input.repo.releaseLease({
      key: NPC_WORLD_RUNTIME_KEY,
      lastSettledAt: cursor,
      ownerId: this.input.ownerId
    });

    return { settledSteps, skipped: false };
  }
}
