import type { WorldRuntimeRepository } from "./world-runtime.repository.js";

export const NPC_WORLD_RUNTIME_KEY = "npc_world";
export const WORLD_RUNTIME_TICK_MS = 60_000;
const DEFAULT_LEASE_MS = 55_000;

function floorToTick(date: Date) {
  return new Date(Math.floor(date.getTime() / WORLD_RUNTIME_TICK_MS) * WORLD_RUNTIME_TICK_MS);
}

export interface WorldRuntimeServiceInput {
  repo: Pick<WorldRuntimeRepository, "find" | "upsert">;
  ownerId: string;
  maxStepsPerRun?: number;
  settleNpcWorld(now: Date): Promise<void>;
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

    if (!existing) {
      await this.input.repo.upsert({
        key: NPC_WORLD_RUNTIME_KEY,
        lastSettledAt: currentTick,
        leaseOwner: null,
        leaseUntil: null
      });
      return { settledSteps: 0, skipped: false };
    }

    if (
      existing.leaseUntil &&
      existing.leaseUntil.getTime() > now.getTime() &&
      existing.leaseOwner !== this.input.ownerId
    ) {
      return { settledSteps: 0, skipped: true };
    }

    const maxSteps = Math.max(1, Math.floor(this.input.maxStepsPerRun ?? 60));
    let cursor = existing.lastSettledAt ?? currentTick;
    let settledSteps = 0;

    await this.input.repo.upsert({
      ...existing,
      leaseOwner: this.input.ownerId,
      leaseUntil: new Date(now.getTime() + DEFAULT_LEASE_MS)
    });

    while (
      cursor.getTime() + WORLD_RUNTIME_TICK_MS <= currentTick.getTime() &&
      settledSteps < maxSteps
    ) {
      cursor = new Date(cursor.getTime() + WORLD_RUNTIME_TICK_MS);
      await this.input.settleNpcWorld(cursor);
      settledSteps += 1;
      await this.input.repo.upsert({
        key: NPC_WORLD_RUNTIME_KEY,
        lastSettledAt: cursor,
        leaseOwner: this.input.ownerId,
        leaseUntil: new Date(now.getTime() + DEFAULT_LEASE_MS)
      });
    }

    await this.input.repo.upsert({
      key: NPC_WORLD_RUNTIME_KEY,
      lastSettledAt: cursor,
      leaseOwner: null,
      leaseUntil: null
    });

    return { settledSteps, skipped: false };
  }
}
