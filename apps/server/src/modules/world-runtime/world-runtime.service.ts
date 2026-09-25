import type { WorldClock } from "./world-clock.js";
import type { WorldRuntimeRepositoryPort, WorldRuntimeTx } from "./world-runtime.repository.js";
import { WorldRuntimeRepository } from "./world-runtime.repository.js";

export const NPC_WORLD_RUNTIME_KEY = "npc_world";
export const WORLD_RUNTIME_TICK_MS = 60_000;

export function floorToTick(date: Date) {
  return new Date(Math.floor(date.getTime() / WORLD_RUNTIME_TICK_MS) * WORLD_RUNTIME_TICK_MS);
}

// Runs inside the per-tick transaction, after the runtime row lock is held.
// All-or-nothing with the step: a failure rolls the step back and the same tick
// is retried on the next run. Composition binds these closures to module
// persistence (since lane C of phase 0 only the opt-in legacy world uses them);
// they must not commit or open transactions.
export type WorldTickParticipant = (tx: WorldRuntimeTx, tickAt: Date) => Promise<void>;

// Runs after the step's transaction has committed and owns its own transactions
// (base settlement: one transaction per base). Its failure is reported through
// `isolated.onFailure` and never rolls back the world clock, other isolated
// participants, or later steps (phase 0 lane C4, review ARCH-domain-03).
export type WorldTickIsolatedParticipant = (tickAt: Date) => Promise<void>;

export interface WorldTickIsolatedFailure {
  tickAt: Date;
  error: unknown;
}

export interface WorldRuntimeServiceInput {
  repo: WorldRuntimeRepositoryPort;
  clock: WorldClock;
  maxStepsPerRun?: number;
  participants: readonly WorldTickParticipant[];
  isolated?: {
    participants: readonly WorldTickIsolatedParticipant[];
    onFailure(failure: WorldTickIsolatedFailure): void;
  };
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
      const committedTickAt = await this.input.repo.transaction(async (txRepo, tx) => {
        const locked = await txRepo.lockAndRead(NPC_WORLD_RUNTIME_KEY);
        const last = locked?.lastSettledAt ?? currentTick;
        const tickAt = new Date(last.getTime() + WORLD_RUNTIME_TICK_MS);
        if (tickAt.getTime() > currentTick.getTime()) return null; // caught up; commit no-op

        for (const participant of this.input.participants) {
          await participant(tx, tickAt);
        }
        await txRepo.saveProgress({
          key: NPC_WORLD_RUNTIME_KEY,
          lastSettledAt: tickAt,
          now: this.input.clock.now()
        });
        return tickAt;
      });
      if (!committedTickAt) break;
      settledSteps += 1;
      await this.runIsolatedParticipants(committedTickAt);
    }

    return settledSteps > 0
      ? { settledSteps, skipped: false }
      : { settledSteps: 0, skipped: true };
  }

  // Directive: keep these outside the step transaction. Folding base settlement
  // back into it re-creates the "one bad base freezes every base" failure mode
  // (review ARCH-domain-03, 2026-09-22 B002).
  private async runIsolatedParticipants(tickAt: Date): Promise<void> {
    const isolated = this.input.isolated;
    if (!isolated) return;
    for (const participant of isolated.participants) {
      try {
        await participant(tickAt);
      } catch (error) {
        isolated.onFailure({ tickAt, error });
      }
    }
  }
}

export interface PerBaseTickInput {
  // Due bases for this tick, read without locks in a deterministic order.
  listDueBaseIds(tickAt: Date): Promise<readonly string[]>;
  // Settles one base in its own transaction.
  settleBase(baseId: string, tickAt: Date): Promise<void>;
  onBaseFailure(failure: { baseId: string; tickAt: Date; error: unknown }): void;
}

// Phase 0 lane C4: every base settles in its own short transaction, so one
// base's failure (bad data, lock timeout, bug) is logged with its baseId and
// retried next tick while the other bases and the world clock keep moving.
export function createPerBaseTickParticipant(input: PerBaseTickInput): WorldTickIsolatedParticipant {
  return async (tickAt) => {
    const baseIds = await input.listDueBaseIds(tickAt);
    for (const baseId of baseIds) {
      try {
        await input.settleBase(baseId, tickAt);
      } catch (error) {
        input.onBaseFailure({ baseId, tickAt, error });
      }
    }
  };
}
