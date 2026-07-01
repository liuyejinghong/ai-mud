import { describe, expect, it } from "vitest";
import { NpcMemoryService } from "./npc-memory.service.js";
import type {
  CreateMemoryEntryInput,
  CreateMemoryFragmentInput,
  MemoryEntryRecord,
  MemoryFragmentRecord
} from "./npc-memory.repository.js";

function buildService() {
  const entries: MemoryEntryRecord[] = [];
  const fragments: MemoryFragmentRecord[] = [];

  const service = new NpcMemoryService({
    createEntry: async (input: CreateMemoryEntryInput) => {
      const record: MemoryEntryRecord = {
        id: `mem-${entries.length + 1}`,
        npcActorId: input.npcActorId,
        characterId: input.characterId,
        sourceType: input.sourceType,
        memoryKind: input.memoryKind,
        evidenceLevel: input.evidenceLevel,
        sourceIds: input.sourceIds,
        importance: input.importance,
        summary: input.summary,
        occurredAt: input.occurredAt,
        compressedAt: null
      };
      entries.push(record);
      return record;
    },
    listUncompressedBefore: async (cutoff: Date, limit: number) =>
      entries
        .filter((entry) => !entry.compressedAt && entry.occurredAt.getTime() < cutoff.getTime())
        .slice(0, limit),
    markEntriesCompressed: async (ids: string[], compressedAt: Date) => {
      for (const entry of entries) {
        if (ids.includes(entry.id)) entry.compressedAt = compressedAt;
      }
    },
    createFragment: async (input: CreateMemoryFragmentInput) => {
      const record: MemoryFragmentRecord = {
        id: `frag-${fragments.length + 1}`,
        npcActorId: input.npcActorId,
        characterId: input.characterId,
        memoryKind: input.memoryKind,
        evidenceLevel: input.evidenceLevel,
        importance: input.importance,
        summary: input.summary,
        firstOccurredAt: input.firstOccurredAt,
        lastOccurredAt: input.lastOccurredAt,
        sourceEntryIds: input.sourceEntryIds,
        compressionLevel: input.compressionLevel
      };
      fragments.push(record);
      return record;
    },
    listFragments: async ({ npcActorId, characterId, limit }) =>
      fragments
        .filter((fragment) => fragment.npcActorId === npcActorId && fragment.characterId === characterId)
        .slice(-limit)
        .reverse(),
    listRecentEntries: async ({ npcActorId, characterId, limit }) =>
      entries
        .filter(
          (entry) =>
            entry.npcActorId === npcActorId &&
            entry.characterId === characterId &&
            !entry.compressedAt
        )
        .slice(-limit)
        .reverse(),
    listAdminMemory: async ({ limit }) => ({
      entries: entries.slice(-limit).map((entry) => ({
        id: entry.id,
        npcActorId: entry.npcActorId,
        characterId: entry.characterId,
        sourceType: entry.sourceType,
        memoryKind: entry.memoryKind,
        evidenceLevel: entry.evidenceLevel,
        sourceIds: entry.sourceIds,
        importance: entry.importance,
        summary: entry.summary,
        occurredAt: entry.occurredAt.toISOString(),
        compressedAt: entry.compressedAt?.toISOString() ?? null
      })),
      fragments: fragments.slice(-limit).map((fragment) => ({
        id: fragment.id,
        npcActorId: fragment.npcActorId,
        characterId: fragment.characterId,
        memoryKind: fragment.memoryKind,
        evidenceLevel: fragment.evidenceLevel,
        importance: fragment.importance,
        summary: fragment.summary,
        firstOccurredAt: fragment.firstOccurredAt.toISOString(),
        lastOccurredAt: fragment.lastOccurredAt.toISOString(),
        sourceEntryIds: fragment.sourceEntryIds,
        compressionLevel: fragment.compressionLevel
      }))
    })
  });

  return { service, entries, fragments };
}

describe("NpcMemoryService", () => {
  it("records a short factual dialogue memory", async () => {
    const { service, entries } = buildService();

    await service.recordDialogueExchange({
      npcActorId: "npc-blacksmith",
      characterId: "char-1",
      playerName: "阿岚",
      playerMessage: "我正在找基础铁矿石，回头可以带给你。",
      npcReply: "炉火还没灭。你若有矿石，就拿来让我看看。",
      occurredAt: new Date("2026-07-02T08:00:00.000Z")
    });

    expect(entries).toEqual([
      expect.objectContaining({
        npcActorId: "npc-blacksmith",
        characterId: "char-1",
        sourceType: "dialogue",
        memoryKind: "conversation",
        evidenceLevel: "dialogue_claim",
        importance: 1
      })
    ]);
    expect(entries[0]?.summary).toContain("阿岚");
    expect(entries[0]?.summary).toContain("基础铁矿石");
  });

  it("compresses old uncompressed entries into one fragment per npc and character", async () => {
    const { service, entries, fragments } = buildService();
    const old = new Date("2026-07-01T08:00:00.000Z");

    for (const message of ["询问铁矿石", "询问修理短剑", "说会去旧矿脉"]) {
      await service.recordDialogueExchange({
        npcActorId: "npc-blacksmith",
        characterId: "char-1",
        playerName: "阿岚",
        playerMessage: message,
        npcReply: "伯林记下了这件事。",
        occurredAt: old
      });
    }

    await service.compressDueMemories(new Date("2026-07-03T09:00:00.000Z"));

    expect(fragments).toHaveLength(1);
    expect(fragments[0]).toMatchObject({
      npcActorId: "npc-blacksmith",
      characterId: "char-1",
      memoryKind: "conversation",
      compressionLevel: 1
    });
    expect(fragments[0]!.summary.length).toBeLessThan(
      entries.map((entry) => entry.summary).join("；").length
    );
    expect(entries.every((entry) => entry.compressedAt)).toBe(true);
  });

  it("retrieves relevant fragments before raw entries for dialogue context", async () => {
    const { service, fragments } = buildService();
    fragments.push({
      id: "frag-1",
      npcActorId: "npc-blacksmith",
      characterId: "char-1",
      memoryKind: "conversation",
      evidenceLevel: "dialogue_claim",
      importance: 2,
      summary: "阿岚上周送过烤鸡，但伯林只记得有人送过食物。",
      firstOccurredAt: new Date("2026-06-25T08:00:00.000Z"),
      lastOccurredAt: new Date("2026-06-25T08:00:00.000Z"),
      sourceEntryIds: ["mem-old"],
      compressionLevel: 2
    });
    await service.recordDialogueExchange({
      npcActorId: "npc-blacksmith",
      characterId: "char-1",
      playerName: "阿岚",
      playerMessage: "上周的烤鸡是我送的。",
      npcReply: "伯林眯起眼，像是想起了什么。",
      occurredAt: new Date("2026-07-02T08:00:00.000Z")
    });

    const context = await service.getDialogueMemoryContext({
      npcActorId: "npc-blacksmith",
      characterId: "char-1"
    });

    expect(context.split("\n")[0]).toContain("记忆碎片");
    expect(context).toContain("阿岚上周送过烤鸡");
    expect(context).toContain("近期记忆");
    expect([...context].length).toBeLessThanOrEqual(500);
  });

  it("keeps high-importance raw memories uncompressed until they age past the threshold", async () => {
    const { service, entries, fragments } = buildService();

    await service.recordDialogueExchange({
      npcActorId: "npc-blacksmith",
      characterId: "char-1",
      playerName: "阿岚",
      playerMessage: "我救了你一命，也送给你烤鸡。",
      npcReply: "这份恩情我会记住。",
      occurredAt: new Date("2026-07-01T08:00:00.000Z")
    });

    await service.compressDueMemories(new Date("2026-07-03T09:00:00.000Z"));
    expect(fragments).toHaveLength(0);
    expect(entries[0]?.compressedAt).toBeNull();

    await service.compressDueMemories(new Date("2026-07-09T09:00:00.000Z"));
    expect(fragments).toHaveLength(1);
    expect(entries[0]?.compressedAt).toEqual(new Date("2026-07-09T09:00:00.000Z"));
  });
});
