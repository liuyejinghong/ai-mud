import { describe, expect, it } from "vitest";
import type { NpcTaskCandidate } from "../npc-task/npc-task.service.js";
import { WorldPostTickService } from "./world-post-tick.service.js";

function candidate(npcActorId: string): NpcTaskCandidate {
  return {
    npcActorId,
    needType: "ore_shortage",
    requestedItemId: "iron_ore",
    requestedQuantity: 3,
    rewardCopper: 36,
    templateTitle: "炉火缺矿",
    templateDescription: "伯林缺少基础铁矿石。",
    templateReason: "矿箱空了。",
    observedAt: new Date("2026-07-13T08:00:00.000Z")
  };
}

describe("WorldPostTickService", () => {
  it("presents and commits at most three detected tasks before syncing rumors", async () => {
    const calls: string[] = [];
    const candidates = [candidate("npc-1"), candidate("npc-2"), candidate("npc-3"), candidate("npc-4")];
    const service = new WorldPostTickService({
      tasks: {
        detectCandidates: async () => {
          calls.push("detect");
          return candidates;
        },
        presentCandidate: async (value) => {
          calls.push(`present:${value.npcActorId}`);
          return {
            title: value.templateTitle,
            description: value.templateDescription,
            proposalReason: value.templateReason,
            proposalSource: "template"
          };
        },
        commitCandidate: async (value) => {
          calls.push(`commit:${value.npcActorId}`);
          return null;
        }
      },
      rumors: {
        syncRumors: async ({ batchLimit }) => {
          calls.push(`rumors:${batchLimit}`);
          return [];
        }
      }
    });

    await service.run(new Date("2026-07-13T08:01:00.000Z"));

    expect(calls).toEqual([
      "detect",
      "present:npc-1",
      "commit:npc-1",
      "present:npc-2",
      "commit:npc-2",
      "present:npc-3",
      "commit:npc-3",
      "rumors:3"
    ]);
  });

  it("isolates individual presentation, commit, and rumor failures", async () => {
    const calls: string[] = [];
    const failures: string[] = [];
    const service = new WorldPostTickService({
      tasks: {
        detectCandidates: async () => [candidate("bad-ai"), candidate("bad-commit"), candidate("ok")],
        presentCandidate: async (value) => {
          calls.push(`present:${value.npcActorId}`);
          if (value.npcActorId === "bad-ai") throw new Error("provider failed");
          return {
            title: value.templateTitle,
            description: value.templateDescription,
            proposalReason: value.templateReason,
            proposalSource: "template"
          };
        },
        commitCandidate: async (value) => {
          calls.push(`commit:${value.npcActorId}`);
          if (value.npcActorId === "bad-commit") throw new Error("commit failed");
          return null;
        }
      },
      rumors: {
        syncRumors: async () => {
          calls.push("rumors");
          throw new Error("rumor failed");
        }
      },
      onFailure: (failure) => failures.push(failure.phase)
    });

    await expect(service.run(new Date("2026-07-13T08:01:00.000Z"))).resolves.toBeUndefined();
    expect(calls).toEqual([
      "present:bad-ai",
      "present:bad-commit",
      "commit:bad-commit",
      "present:ok",
      "commit:ok",
      "rumors"
    ]);
    expect(failures).toEqual(["task_presentation", "task_commit", "rumor_sync"]);
  });
});
