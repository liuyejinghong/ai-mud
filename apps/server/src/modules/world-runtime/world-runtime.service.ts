import type { WorldClock } from "./world-clock.js";
import type { WorldRuntimeRepositoryPort, WorldRuntimeTx } from "./world-runtime.repository.js";
import { WorldRuntimeRepository } from "./world-runtime.repository.js";

export const NPC_WORLD_RUNTIME_KEY = "npc_world";
export const WORLD_RUNTIME_TICK_MS = 60_000;

export function floorToTick(date: Date) {
  return new Date(Math.floor(date.getTime() / WORLD_RUNTIME_TICK_MS) * WORLD_RUNTIME_TICK_MS);
}

// Runs inside the per-tick transaction, after the runtime row lock is held.
// Composition binds these closures to module persistence (npc settlement,
// character-side instance refresh); they must not commit or open transactions.
export type WorldTickParticipant = (tx: WorldRuntimeTx, tickAt: Date) => Promise<void>;

export interface WorldRuntimeServiceInput {
  repo: WorldRuntimeRepositoryPort;
  clock: WorldClock;
  maxStepsPerRun?: number;
  participants: readonly WorldTickParticipant[];
}

export interface WorldRuntimeSettleResult {
  settledSteps: number;
  skipped: boolean;
}

export class WorldRuntimeService {
  constructor(private readonly input: WorldRuntimeServiceInput) {}

  async settleDue(now: Date = this.input.clock.now()): Promise<WorldRuntimeSettleResult> {
    const currentTick = floorToTick(now);
    await this.input.repo.ensureRow(NPC_WORLD_RUNTIME_KEY, currentTick);

    const known = await this.input.repo.find(NPC_WORLD_RUNTIME_KEY);
    const settledUpTo = known?.lastSettledAt ?? currentTick;
    if (settledUpTo.getTime() + WORLD_RUNTIME_TICK_MS > currentTick.getTime()) {
      return { settledSteps: 0, skipped: true };
    }

    const maxSteps = Math.max(1, Math.floor(this.input.maxStepsPerRun ?? 60));
    let settledSteps = 0;
    while (settledSteps < maxSteps) {
      let advanced = false;
      await this.input.repo.transaction(async (txRepo, tx) => {
        const locked = await txRepo.lockAndRead(NPC_WORLD_RUNTIME_KEY);
        const last = locked?.lastSettledAt ?? currentTick;
        const tickAt = new Date(last.getTime() + WORLD_RUNTIME_TICK_MS);
        if (tickAt.getTime() > currentTick.getTime()) return; // caught up; commit no-op

        for (const participant of this.input.participants) {
          await participant(tx, tickAt);
        }
        await txRepo.saveProgress({
          key: NPC_WORLD_RUNTIME_KEY,
          lastSettledAt: tickAt,
          now: this.input.clock.now()
        });
        advanced = true;
      });
      if (!advanced) break;
      settledSteps += 1;
    }

    return settledSteps > 0
      ? { settledSteps, skipped: false }
      : { settledSteps: 0, skipped: true };
  }
}
