import type {
  NpcMemoryEntryDto,
  NpcMemoryEvidenceLevel,
  NpcMemoryFragmentDto,
  NpcMemoryKind
} from "@ai-mud/shared";
import type {
  CreateMemoryEntryInput,
  CreateMemoryFragmentInput,
  MemoryEntryRecord,
  MemoryFragmentRecord
} from "./npc-memory.repository.js";

const RAW_MEMORY_RETENTION_MS = 24 * 60 * 60 * 1000;
const HIGH_IMPORTANCE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_DIALOGUE_MEMORY_LINES = 4;
const MAX_DIALOGUE_MEMORY_CHARS = 500;
const MAX_COMPRESSION_BATCH = 100;

export interface NpcMemoryRepositoryPort {
  createEntry(input: CreateMemoryEntryInput): Promise<MemoryEntryRecord>;
  listUncompressedBefore(cutoff: Date, limit: number): Promise<MemoryEntryRecord[]>;
  markEntriesCompressed(ids: string[], compressedAt: Date): Promise<void>;
  createFragment(input: CreateMemoryFragmentInput): Promise<MemoryFragmentRecord>;
  listFragments(input: {
    npcActorId: string;
    characterId: string | null;
    limit: number;
  }): Promise<MemoryFragmentRecord[]>;
  listRecentEntries(input: {
    npcActorId: string;
    characterId: string | null;
    limit: number;
  }): Promise<MemoryEntryRecord[]>;
  listAdminMemory(input: { limit: number }): Promise<{
    entries: NpcMemoryEntryDto[];
    fragments: NpcMemoryFragmentDto[];
  }>;
}

interface MemoryGroup {
  npcActorId: string;
  characterId: string | null;
  memoryKind: NpcMemoryKind;
  entries: MemoryEntryRecord[];
}

export class NpcMemoryService {
  constructor(private readonly repo: NpcMemoryRepositoryPort) {}

  async recordDialogueExchange(input: {
    npcActorId: string;
    characterId: string;
    playerName: string;
    playerMessage: string;
    npcReply: string;
    occurredAt: Date;
    sourceIds?: string[];
  }) {
    await this.repo.createEntry({
      npcActorId: input.npcActorId,
      characterId: input.characterId,
      sourceType: "dialogue",
      memoryKind: "conversation",
      evidenceLevel: "dialogue_claim",
      sourceIds: input.sourceIds ?? [],
      importance: estimateImportance(input.playerMessage, input.npcReply),
      summary: summarizeDialogue(input.playerName, input.playerMessage, input.npcReply),
      occurredAt: input.occurredAt
    });
  }

  async recordSystemMemory(input: {
    npcActorId: string;
    characterId: string | null;
    memoryKind: NpcMemoryKind;
    summary: string;
    importance: number;
    occurredAt: Date;
    sourceIds?: string[];
  }) {
    await this.repo.createEntry({
      npcActorId: input.npcActorId,
      characterId: input.characterId,
      sourceType: "system",
      memoryKind: input.memoryKind,
      evidenceLevel: "system_verified",
      sourceIds: input.sourceIds ?? [],
      importance: Math.max(1, Math.min(5, Math.floor(input.importance))),
      summary: truncate(input.summary, 220),
      occurredAt: input.occurredAt
    });
  }

  async compressDueMemories(now: Date) {
    const cutoff = new Date(now.getTime() - RAW_MEMORY_RETENTION_MS);
    const entries = await this.repo.listUncompressedBefore(cutoff, MAX_COMPRESSION_BATCH);
    const compressible = entries.filter((entry) => shouldCompressEntry(entry, now));

    for (const group of groupByNpcCharacterKind(compressible)) {
      const orderedEntries = [...group.entries].sort(
        (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime()
      );
      const summary = compressSummaries(orderedEntries.map((entry) => entry.summary));

      await this.repo.createFragment({
        npcActorId: group.npcActorId,
        characterId: group.characterId,
        memoryKind: group.memoryKind,
        evidenceLevel: weakestEvidenceLevel(orderedEntries.map((entry) => entry.evidenceLevel)),
        importance: Math.max(...orderedEntries.map((entry) => entry.importance)),
        summary,
        firstOccurredAt: orderedEntries[0]!.occurredAt,
        lastOccurredAt: orderedEntries.at(-1)!.occurredAt,
        sourceEntryIds: orderedEntries.map((entry) => entry.id),
        compressionLevel: 1
      });
      await this.repo.markEntriesCompressed(
        orderedEntries.map((entry) => entry.id),
        now
      );
    }
  }

  async getDialogueMemoryContext(input: {
    npcActorId: string;
    characterId: string;
    now?: Date;
  }) {
    await this.compressDueMemories(input.now ?? new Date());

    const [fragments, recentEntries] = await Promise.all([
      this.repo.listFragments({
        npcActorId: input.npcActorId,
        characterId: input.characterId,
        limit: 3
      }),
      this.repo.listRecentEntries({
        npcActorId: input.npcActorId,
        characterId: input.characterId,
        limit: 3
      })
    ]);

    return limitMemoryContext([
      ...fragments.map((entry) => `记忆碎片：${entry.summary}`),
      ...recentEntries.map((entry) => `近期记忆：${entry.summary}`)
    ]);
  }

  async listAdminMemory(input: { limit: number }) {
    return this.repo.listAdminMemory(input);
  }
}

function shouldCompressEntry(entry: MemoryEntryRecord, now: Date) {
  if (entry.importance >= 4) {
    return entry.occurredAt.getTime() <= now.getTime() - HIGH_IMPORTANCE_RETENTION_MS;
  }

  return true;
}

function groupByNpcCharacterKind(entries: MemoryEntryRecord[]): MemoryGroup[] {
  const groups = new Map<string, MemoryGroup>();

  for (const entry of entries) {
    const key = `${entry.npcActorId}:${entry.characterId ?? "world"}:${entry.memoryKind}`;
    const existing = groups.get(key);
    if (existing) {
      existing.entries.push(entry);
      continue;
    }

    groups.set(key, {
      npcActorId: entry.npcActorId,
      characterId: entry.characterId,
      memoryKind: entry.memoryKind,
      entries: [entry]
    });
  }

  return [...groups.values()];
}

function estimateImportance(playerMessage: string, npcReply: string) {
  const text = `${playerMessage} ${npcReply}`;
  if (/(救命|救了|送给|帮你|任务|欠你|恩情)/.test(text)) return 4;
  return 1;
}

function summarizeDialogue(playerName: string, playerMessage: string, npcReply: string) {
  return `${playerName} 说：“${truncate(playerMessage, 60)}”；NPC 回应：“${truncate(npcReply, 60)}”。`;
}

function compressSummaries(summaries: string[]) {
  const compressed = summaries
    .slice(0, 5)
    .map((summary) => summary.replace(/NPC 回应：.*/, "").trim())
    .join("；");

  return truncate(compressed, 220);
}

function weakestEvidenceLevel(levels: NpcMemoryEvidenceLevel[]): NpcMemoryEvidenceLevel {
  return levels.every((level) => level === "system_verified") ? "system_verified" : "dialogue_claim";
}

function limitMemoryContext(lines: string[]) {
  const limitedLines = lines.slice(0, MAX_DIALOGUE_MEMORY_LINES);
  let output = "";

  for (const line of limitedLines) {
    const next = output ? `${output}\n${line}` : line;
    if ([...next].length > MAX_DIALOGUE_MEMORY_CHARS) {
      return truncate(next, MAX_DIALOGUE_MEMORY_CHARS);
    }
    output = next;
  }

  return output;
}

function truncate(value: string, max: number) {
  return [...value].slice(0, max).join("");
}
