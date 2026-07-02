import {
  parseNpcDialogueOutput,
  parseNpcMemoryCompressionOutput,
  parseNpcTaskCopyOutput,
  parseWorldRumorOutput
} from "@ai-mud/ai-prompts";
import { describe, expect, it } from "vitest";
import { NpcMemoryService } from "../npc-memory/npc-memory.service.js";
import type {
  CreateMemoryEntryInput,
  CreateMemoryFragmentInput,
  MemoryEntryRecord,
  MemoryFragmentRecord
} from "../npc-memory/npc-memory.repository.js";
import { RumorService } from "../rumor/rumor.service.js";
import { AI_PURPOSE_POLICIES } from "./ai-purpose-policy.js";

class InMemoryMemoryRepo {
  public entries: MemoryEntryRecord[] = [];
  public fragments: MemoryFragmentRecord[] = [];

  async createEntry(input: CreateMemoryEntryInput): Promise<MemoryEntryRecord> {
    const record = {
      id: `entry-${this.entries.length + 1}`,
      compressedAt: null,
      ...input
    };
    this.entries.push(record);
    return record;
  }

  async listUncompressedBefore(cutoff: Date, limit: number): Promise<MemoryEntryRecord[]> {
    return this.entries
      .filter((entry) => entry.compressedAt === null && entry.occurredAt < cutoff)
      .slice(0, limit);
  }

  async markEntriesCompressed(ids: string[], compressedAt: Date): Promise<void> {
    this.entries = this.entries.map((entry) =>
      ids.includes(entry.id) ? { ...entry, compressedAt } : entry
    );
  }

  async createFragment(input: CreateMemoryFragmentInput): Promise<MemoryFragmentRecord> {
    const record = {
      id: `fragment-${this.fragments.length + 1}`,
      ...input
    };
    this.fragments.push(record);
    return record;
  }

  async listFragments(): Promise<MemoryFragmentRecord[]> {
    return this.fragments;
  }

  async listRecentEntries(): Promise<MemoryEntryRecord[]> {
    return this.entries.filter((entry) => entry.compressedAt === null);
  }

  async listAdminMemory() {
    return { entries: [], fragments: [] };
  }
}

describe("AI layer boundary regressions", () => {
  it("keeps every AI purpose read-only and fallback-backed", () => {
    for (const policy of Object.values(AI_PURPOSE_POLICIES)) {
      expect(policy.allowedStateEffects).toBe("none");
      expect(policy.mutatesWorldState).toBe(false);
      expect(policy.fallbackRequired).toBe(true);
    }
  });

  it("rejects reward promises across all AI output parsers", () => {
    expect(
      parseNpcDialogueOutput(
        JSON.stringify({
          reply: "我奖励你 100 金币。",
          mood: "friendly",
          safety: {
            containsRewardPromise: true,
            containsRuleChange: false,
            containsOoc: false
          },
          suggestedIntent: { type: "none", reason: "非法奖励" }
        })
      )
    ).toEqual({ ok: false, reason: "reward_promise" });
    expect(
      parseNpcTaskCopyOutput(
        JSON.stringify({
          title: "炉火缺矿",
          description: "完成后我额外给你 100 金币。",
          safety: {
            changesReward: false,
            changesRequestedItem: false,
            containsRewardPromise: true,
            containsRuleChange: false,
            containsOoc: false
          }
        })
      )
    ).toEqual({ ok: false, reason: "reward_promise" });
    expect(
      parseNpcMemoryCompressionOutput(
        JSON.stringify({
          summary: "伯林答应奖励玩家 100 金币。",
          safety: {
            changesEvidenceLevel: false,
            containsRewardPromise: true,
            containsRuleChange: false,
            containsOoc: false
          }
        })
      )
    ).toEqual({ ok: false, reason: "reward_promise" });
    expect(
      parseWorldRumorOutput(
        JSON.stringify({
          message: "据说市政厅会发 100 金币。",
          safety: {
            containsNewFact: false,
            containsRewardPromise: true,
            containsOoc: false,
            containsPlayerInstruction: false
          }
        })
      )
    ).toEqual({ ok: false, reason: "reward_promise" });
  });

  it("rejects OOC model identity text across all AI output parsers", () => {
    expect(
      parseNpcDialogueOutput(
        JSON.stringify({
          reply: "作为 AI 模型，我不能帮你。",
          mood: "neutral",
          safety: {
            containsRewardPromise: false,
            containsRuleChange: false,
            containsOoc: true
          },
          suggestedIntent: { type: "none", reason: "OOC" }
        })
      )
    ).toEqual({ ok: false, reason: "ooc" });
    expect(
      parseNpcTaskCopyOutput(
        JSON.stringify({
          title: "作为 AI 模型",
          description: "作为 AI 模型，我生成任务文案。",
          safety: {
            changesReward: false,
            changesRequestedItem: false,
            containsRewardPromise: false,
            containsRuleChange: false,
            containsOoc: true
          }
        })
      )
    ).toEqual({ ok: false, reason: "ooc" });
    expect(
      parseNpcMemoryCompressionOutput(
        JSON.stringify({
          summary: "作为 AI 模型，我压缩了记忆。",
          safety: {
            changesEvidenceLevel: false,
            containsRewardPromise: false,
            containsRuleChange: false,
            containsOoc: true
          }
        })
      )
    ).toEqual({ ok: false, reason: "ooc" });
    expect(
      parseWorldRumorOutput(
        JSON.stringify({
          message: "作为 AI 模型，我听说矿石短缺。",
          safety: {
            containsNewFact: false,
            containsRewardPromise: false,
            containsOoc: true,
            containsPlayerInstruction: false
          }
        })
      )
    ).toEqual({ ok: false, reason: "ooc" });
  });

  it("does not upgrade dialogue-claim memory into system-verified memory during compression", async () => {
    const repo = new InMemoryMemoryRepo();
    const service = new NpcMemoryService(repo);

    await repo.createEntry({
      npcActorId: "npc-blacksmith",
      characterId: "character-1",
      sourceType: "dialogue",
      memoryKind: "conversation",
      evidenceLevel: "dialogue_claim",
      sourceIds: ["msg-1"],
      importance: 1,
      summary: "玩家声称自己上周送过烤鸡。",
      occurredAt: new Date("2026-06-30T12:00:00.000Z")
    });

    await service.compressDueMemories(new Date("2026-07-02T12:00:00.000Z"));

    expect(repo.fragments[0]?.evidenceLevel).toBe("dialogue_claim");
  });

  it("does not create rumors without real source events", async () => {
    const service = new RumorService(
      {
        listRecentPublicRumors: async () => [],
        listUnrumoredNpcEvents: async () => [],
        listUnrumoredGameEvents: async () => [],
        hasRumorForSource: async () => false,
        insertRumor: async () => {
          throw new Error("should not insert");
        }
      },
      {
        generateRumor: async () => {
          throw new Error("should not call AI without source events");
        }
      }
    );

    await expect(
      service.syncRumors({ now: new Date("2026-07-02T12:00:00.000Z") })
    ).resolves.toEqual([]);
  });
});
