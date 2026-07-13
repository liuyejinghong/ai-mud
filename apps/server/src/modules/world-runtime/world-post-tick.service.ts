import type {
  NpcTaskCandidate,
  NpcTaskPresentation
} from "../npc-task/npc-task.service.js";

interface WorldPostTickTaskPort {
  detectCandidates(now: Date): Promise<NpcTaskCandidate[]>;
  presentCandidate(candidate: NpcTaskCandidate): Promise<NpcTaskPresentation>;
  commitCandidate(
    candidate: NpcTaskCandidate,
    presentation: NpcTaskPresentation,
    now: Date
  ): Promise<unknown>;
}

interface WorldPostTickRumorPort {
  syncRumors(input: { now: Date; batchLimit?: number }): Promise<unknown>;
}

export type WorldPostTickFailurePhase =
  | "task_detection"
  | "task_presentation"
  | "task_commit"
  | "rumor_sync";

export interface WorldPostTickFailure {
  phase: WorldPostTickFailurePhase;
  error: unknown;
  npcActorId?: string;
}

export class WorldPostTickService {
  constructor(
    private readonly options: {
      tasks: WorldPostTickTaskPort;
      rumors: WorldPostTickRumorPort;
      onFailure?: (failure: WorldPostTickFailure) => void;
    }
  ) {}

  async run(now: Date): Promise<void> {
    let candidates: NpcTaskCandidate[] = [];
    try {
      candidates = (await this.options.tasks.detectCandidates(now)).slice(0, 3);
    } catch (error) {
      this.reportFailure({ phase: "task_detection", error });
    }

    for (const candidate of candidates) {
      let presentation: NpcTaskPresentation;
      try {
        // Presentation may call an AI provider and must finish before commit opens a transaction.
        presentation = await this.options.tasks.presentCandidate(candidate);
      } catch (error) {
        this.reportFailure({
          phase: "task_presentation",
          error,
          npcActorId: candidate.npcActorId
        });
        continue;
      }

      try {
        await this.options.tasks.commitCandidate(candidate, presentation, now);
      } catch (error) {
        this.reportFailure({
          phase: "task_commit",
          error,
          npcActorId: candidate.npcActorId
        });
      }
    }

    try {
      await this.options.rumors.syncRumors({ now, batchLimit: 3 });
    } catch (error) {
      this.reportFailure({ phase: "rumor_sync", error });
    }
  }

  private reportFailure(failure: WorldPostTickFailure) {
    try {
      this.options.onFailure?.(failure);
    } catch {
      // Observability failures cannot stop the remaining post-tick work.
    }
  }
}
