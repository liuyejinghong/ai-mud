import type {
  NpcMemoryEntryDto,
  NpcMemoryEvidenceLevel,
  NpcMemoryFragmentDto,
  NpcMemoryKind,
  NpcMemorySourceType
} from "@ai-mud/shared";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { npcMemoryEntries, npcMemoryFragments } from "../../db/schema.js";

type MemoryDb = Pick<Db, "insert" | "select" | "update">;

export interface MemoryEntryRecord {
  id: string;
  npcActorId: string;
  characterId: string | null;
  sourceType: NpcMemorySourceType;
  memoryKind: NpcMemoryKind;
  evidenceLevel: NpcMemoryEvidenceLevel;
  sourceIds: string[];
  importance: number;
  summary: string;
  occurredAt: Date;
  compressedAt: Date | null;
}

export interface MemoryFragmentRecord {
  id: string;
  npcActorId: string;
  characterId: string | null;
  memoryKind: NpcMemoryKind;
  evidenceLevel: NpcMemoryEvidenceLevel;
  importance: number;
  summary: string;
  firstOccurredAt: Date;
  lastOccurredAt: Date;
  sourceEntryIds: string[];
  compressionLevel: number;
}

export interface CreateMemoryEntryInput {
  npcActorId: string;
  characterId: string | null;
  sourceType: NpcMemorySourceType;
  memoryKind: NpcMemoryKind;
  evidenceLevel: NpcMemoryEvidenceLevel;
  sourceIds: string[];
  importance: number;
  summary: string;
  occurredAt: Date;
}

export interface CreateMemoryFragmentInput {
  npcActorId: string;
  characterId: string | null;
  memoryKind: NpcMemoryKind;
  evidenceLevel: NpcMemoryEvidenceLevel;
  importance: number;
  summary: string;
  firstOccurredAt: Date;
  lastOccurredAt: Date;
  sourceEntryIds: string[];
  compressionLevel: number;
}

function parseSourceEntryIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function toMemoryEntry(row: typeof npcMemoryEntries.$inferSelect): MemoryEntryRecord {
  return {
    id: row.id,
    npcActorId: row.npcActorId,
    characterId: row.characterId,
    sourceType: row.sourceType as NpcMemorySourceType,
    memoryKind: row.memoryKind as NpcMemoryKind,
    evidenceLevel: row.evidenceLevel as NpcMemoryEvidenceLevel,
    sourceIds: parseSourceEntryIds(row.sourceIds),
    importance: row.importance,
    summary: row.summary,
    occurredAt: row.occurredAt,
    compressedAt: row.compressedAt
  };
}

function toMemoryFragment(row: typeof npcMemoryFragments.$inferSelect): MemoryFragmentRecord {
  return {
    id: row.id,
    npcActorId: row.npcActorId,
    characterId: row.characterId,
    memoryKind: row.memoryKind as NpcMemoryKind,
    evidenceLevel: row.evidenceLevel as NpcMemoryEvidenceLevel,
    importance: row.importance,
    summary: row.summary,
    firstOccurredAt: row.firstOccurredAt,
    lastOccurredAt: row.lastOccurredAt,
    sourceEntryIds: parseSourceEntryIds(row.sourceEntryIds),
    compressionLevel: row.compressionLevel
  };
}

function toEntryDto(record: MemoryEntryRecord): NpcMemoryEntryDto {
  return {
    id: record.id,
    npcActorId: record.npcActorId,
    characterId: record.characterId,
    sourceType: record.sourceType,
    memoryKind: record.memoryKind,
    evidenceLevel: record.evidenceLevel,
    sourceIds: record.sourceIds,
    importance: record.importance,
    summary: record.summary,
    occurredAt: record.occurredAt.toISOString(),
    compressedAt: record.compressedAt?.toISOString() ?? null
  };
}

function toFragmentDto(record: MemoryFragmentRecord): NpcMemoryFragmentDto {
  return {
    id: record.id,
    npcActorId: record.npcActorId,
    characterId: record.characterId,
    memoryKind: record.memoryKind,
    evidenceLevel: record.evidenceLevel,
    importance: record.importance,
    summary: record.summary,
    firstOccurredAt: record.firstOccurredAt.toISOString(),
    lastOccurredAt: record.lastOccurredAt.toISOString(),
    sourceEntryIds: record.sourceEntryIds,
    compressionLevel: record.compressionLevel
  };
}

function characterWhere(
  characterId: string | null,
  column: typeof npcMemoryEntries.characterId | typeof npcMemoryFragments.characterId
) {
  return characterId ? eq(column, characterId) : isNull(column);
}

export class NpcMemoryRepository {
  constructor(private readonly db: MemoryDb) {}

  async createEntry(input: CreateMemoryEntryInput): Promise<MemoryEntryRecord> {
    const [row] = await this.db
      .insert(npcMemoryEntries)
      .values({
        npcActorId: input.npcActorId,
        characterId: input.characterId,
        sourceType: input.sourceType,
        memoryKind: input.memoryKind,
        evidenceLevel: input.evidenceLevel,
        sourceIds: input.sourceIds,
        importance: input.importance,
        summary: input.summary,
        occurredAt: input.occurredAt
      })
      .returning();

    if (!row) throw new Error("Failed to create NPC memory entry");
    return toMemoryEntry(row);
  }

  async listUncompressedBefore(cutoff: Date, limit: number): Promise<MemoryEntryRecord[]> {
    const rows = await this.db
      .select()
      .from(npcMemoryEntries)
      .where(and(isNull(npcMemoryEntries.compressedAt), lt(npcMemoryEntries.occurredAt, cutoff)))
      .orderBy(npcMemoryEntries.occurredAt)
      .limit(limit);

    return rows.map(toMemoryEntry);
  }

  async markEntriesCompressed(ids: string[], compressedAt: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .update(npcMemoryEntries)
      .set({ compressedAt })
      .where(inArray(npcMemoryEntries.id, ids));
  }

  async createFragment(input: CreateMemoryFragmentInput): Promise<MemoryFragmentRecord> {
    const [row] = await this.db
      .insert(npcMemoryFragments)
      .values({
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
      })
      .returning();

    if (!row) throw new Error("Failed to create NPC memory fragment");
    return toMemoryFragment(row);
  }

  async listFragments(input: {
    npcActorId: string;
    characterId: string | null;
    limit: number;
  }): Promise<MemoryFragmentRecord[]> {
    const rows = await this.db
      .select()
      .from(npcMemoryFragments)
      .where(
        and(
          eq(npcMemoryFragments.npcActorId, input.npcActorId),
          characterWhere(input.characterId, npcMemoryFragments.characterId)
        )
      )
      .orderBy(desc(npcMemoryFragments.lastOccurredAt))
      .limit(input.limit);

    return rows.map(toMemoryFragment);
  }

  async listRecentEntries(input: {
    npcActorId: string;
    characterId: string | null;
    limit: number;
  }): Promise<MemoryEntryRecord[]> {
    const rows = await this.db
      .select()
      .from(npcMemoryEntries)
      .where(
        and(
          eq(npcMemoryEntries.npcActorId, input.npcActorId),
          characterWhere(input.characterId, npcMemoryEntries.characterId),
          isNull(npcMemoryEntries.compressedAt)
        )
      )
      .orderBy(desc(npcMemoryEntries.occurredAt))
      .limit(input.limit);

    return rows.map(toMemoryEntry);
  }

  async listAdminMemory(input: { limit: number }): Promise<{
    entries: NpcMemoryEntryDto[];
    fragments: NpcMemoryFragmentDto[];
  }> {
    const [entryRows, fragmentRows] = await Promise.all([
      this.db.select().from(npcMemoryEntries).orderBy(desc(npcMemoryEntries.occurredAt)).limit(input.limit),
      this.db
        .select()
        .from(npcMemoryFragments)
        .orderBy(desc(npcMemoryFragments.lastOccurredAt))
        .limit(input.limit)
    ]);

    return {
      entries: entryRows.map(toMemoryEntry).map(toEntryDto),
      fragments: fragmentRows.map(toMemoryFragment).map(toFragmentDto)
    };
  }
}
