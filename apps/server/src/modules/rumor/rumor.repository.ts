import type { RumorSourceType, WorldRumorDto } from "@ai-mud/shared";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { gameEvents, npcEvents, worldRumors } from "../../db/schema.js";

type RumorDb = Pick<Db, "insert" | "select">;

export interface RumorSourceRecord {
  sourceType: RumorSourceType;
  sourceId: string;
  sourceMessage: string;
  npcActorId: string | null;
  sourceActorName: string | null;
  sourceLocationName: string | null;
  createdAt: Date;
  tags: string[];
}

export interface InsertRumorInput {
  sourceType: RumorSourceType;
  sourceId: string | null;
  settlementId: string | null;
  audience: "public";
  message: string;
  tags: string[];
  generatedBy: "template" | "ai";
  createdAt?: Date;
  expiresAt?: Date | null;
}

export class RumorRepository {
  constructor(private readonly db: RumorDb) {}

  async listRecentPublicRumors(limit: number): Promise<WorldRumorDto[]> {
    const rows = await this.db
      .select()
      .from(worldRumors)
      .where(eq(worldRumors.audience, "public"))
      .orderBy(desc(worldRumors.createdAt))
      .limit(clampLimit(limit));

    return rows.map(toWorldRumor);
  }

  async listUnrumoredNpcEvents(limit: number): Promise<RumorSourceRecord[]> {
    const rows = await this.db
      .select()
      .from(npcEvents)
      .orderBy(desc(npcEvents.createdAt))
      .limit(clampLimit(limit));

    const sources = rows.map((row) => ({
      sourceType: "npc_event" as const,
      sourceId: row.id,
      sourceMessage: row.message,
      npcActorId: row.actorId,
      sourceActorName: null,
      sourceLocationName: null,
      createdAt: row.createdAt,
      tags: [row.eventType]
    }));

    return this.filterUnrumored(sources);
  }

  async listUnrumoredGameEvents(limit: number): Promise<RumorSourceRecord[]> {
    const rows = await this.db
      .select()
      .from(gameEvents)
      .orderBy(desc(gameEvents.createdAt))
      .limit(clampLimit(limit));

    const sources = rows.map((row) => ({
      sourceType: "game_event" as const,
      sourceId: row.id,
      sourceMessage: row.message,
      npcActorId: null,
      sourceActorName: null,
      sourceLocationName: null,
      createdAt: row.createdAt,
      tags: [row.eventType]
    }));

    return this.filterUnrumored(sources);
  }

  async insertRumor(input: InsertRumorInput): Promise<WorldRumorDto> {
    const values: typeof worldRumors.$inferInsert = {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      settlementId: input.settlementId,
      audience: input.audience,
      message: input.message,
      tags: input.tags,
      generatedBy: input.generatedBy,
      expiresAt: input.expiresAt ?? null
    };
    if (input.createdAt !== undefined) values.createdAt = input.createdAt;

    const [row] = await this.db.insert(worldRumors).values(values).returning();
    if (!row) throw new Error("Failed to insert world rumor");
    return toWorldRumor(row);
  }

  async hasRumorForSource(sourceType: RumorSourceType, sourceId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: worldRumors.id })
      .from(worldRumors)
      .where(and(eq(worldRumors.sourceType, sourceType), eq(worldRumors.sourceId, sourceId)))
      .limit(1);
    return rows.length > 0;
  }

  private async filterUnrumored(sources: RumorSourceRecord[]) {
    const result: RumorSourceRecord[] = [];
    for (const source of sources) {
      if (!(await this.hasRumorForSource(source.sourceType, source.sourceId))) {
        result.push(source);
      }
    }
    return result;
  }
}

export function toWorldRumor(row: typeof worldRumors.$inferSelect): WorldRumorDto {
  return {
    id: row.id,
    sourceType: row.sourceType as RumorSourceType,
    sourceId: row.sourceId,
    audience: "public",
    message: row.message,
    tags: parseTags(row.tags),
    generatedBy: row.generatedBy === "ai" ? "ai" : "template",
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null
  };
}

function parseTags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function clampLimit(limit: number) {
  return Math.min(100, Math.max(1, Math.floor(limit)));
}
