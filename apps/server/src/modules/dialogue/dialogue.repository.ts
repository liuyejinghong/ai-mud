import type {
  AiCallLogDto,
  AiCallPurpose,
  AiCallStatus,
  NpcDialogueSpeakerType
} from "@ai-mud/shared";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { aiCallLogs, npcDialogueMessages, npcRelationships } from "../../db/schema.js";

type DialogueDb = Pick<Db, "insert" | "select" | "update">;

export interface DialogueMessageRecord {
  id: string;
  accountId: string;
  characterId: string;
  npcActorId: string;
  speakerType: NpcDialogueSpeakerType;
  message: string;
  safetyFlags: string[];
  createdAt: Date;
}

export interface RelationshipRecord {
  id: string;
  characterId: string;
  npcActorId: string;
  familiarity: number;
  trust: number;
  lastInteractionAt: Date;
  shortSummary: string;
}

export type CreateDialogueMessageInput = Omit<DialogueMessageRecord, "id" | "createdAt"> & {
  createdAt?: Date;
};

export interface UpsertRelationshipInput {
  characterId: string;
  npcActorId: string;
  familiarityDelta: number;
  trustDelta: number;
  shortSummary: string;
  interactedAt: Date;
}

export type CreateAiCallLogInput = Omit<AiCallLogDto, "id" | "createdAt"> & {
  requestHash: string;
  createdAt?: Date;
};

function parseSafetyFlags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function toDialogueMessage(row: typeof npcDialogueMessages.$inferSelect): DialogueMessageRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    characterId: row.characterId,
    npcActorId: row.npcActorId,
    speakerType: row.speakerType as NpcDialogueSpeakerType,
    message: row.message,
    safetyFlags: parseSafetyFlags(row.safetyFlags),
    createdAt: row.createdAt
  };
}

function toRelationship(row: typeof npcRelationships.$inferSelect): RelationshipRecord {
  return {
    id: row.id,
    characterId: row.characterId,
    npcActorId: row.npcActorId,
    familiarity: row.familiarity,
    trust: row.trust,
    lastInteractionAt: row.lastInteractionAt,
    shortSummary: row.shortSummary
  };
}

function toAiCallLog(row: typeof aiCallLogs.$inferSelect): AiCallLogDto {
  return {
    id: row.id,
    purpose: row.purpose as AiCallPurpose,
    status: row.status as AiCallStatus,
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    accountId: row.accountId,
    characterId: row.characterId,
    npcActorId: row.npcActorId,
    inputSummary: row.inputSummary,
    outputSummary: row.outputSummary,
    latencyMs: row.latencyMs,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    errorCode: row.errorCode,
    createdAt: row.createdAt.toISOString()
  };
}

export class DialogueRepository {
  constructor(private readonly db: DialogueDb) {}

  async listDialogueMessages(input: {
    characterId: string;
    npcActorId: string;
    limit: number;
  }): Promise<DialogueMessageRecord[]> {
    const rows = await this.db
      .select()
      .from(npcDialogueMessages)
      .where(
        and(
          eq(npcDialogueMessages.characterId, input.characterId),
          eq(npcDialogueMessages.npcActorId, input.npcActorId)
        )
      )
      .orderBy(desc(npcDialogueMessages.createdAt))
      .limit(input.limit);

    return rows.map(toDialogueMessage).reverse();
  }

  async createDialogueMessage(input: CreateDialogueMessageInput): Promise<DialogueMessageRecord> {
    const values: typeof npcDialogueMessages.$inferInsert = {
      accountId: input.accountId,
      characterId: input.characterId,
      npcActorId: input.npcActorId,
      speakerType: input.speakerType,
      message: input.message,
      safetyFlags: input.safetyFlags
    };
    if (input.createdAt !== undefined) values.createdAt = input.createdAt;

    const [row] = await this.db
      .insert(npcDialogueMessages)
      .values(values)
      .returning();

    if (!row) throw new Error("Failed to create dialogue message");
    return toDialogueMessage(row);
  }

  async findRelationship(input: {
    characterId: string;
    npcActorId: string;
  }): Promise<RelationshipRecord | null> {
    const [row] = await this.db
      .select()
      .from(npcRelationships)
      .where(
        and(
          eq(npcRelationships.characterId, input.characterId),
          eq(npcRelationships.npcActorId, input.npcActorId)
        )
      )
      .limit(1);

    return row ? toRelationship(row) : null;
  }

  async upsertRelationship(input: UpsertRelationshipInput): Promise<void> {
    const existing = await this.findRelationship(input);
    if (existing) {
      await this.db
        .update(npcRelationships)
        .set({
          familiarity: existing.familiarity + input.familiarityDelta,
          trust: existing.trust + input.trustDelta,
          shortSummary: input.shortSummary,
          lastInteractionAt: input.interactedAt,
          updatedAt: input.interactedAt
        })
        .where(eq(npcRelationships.id, existing.id));
      return;
    }

    await this.db.insert(npcRelationships).values({
      characterId: input.characterId,
      npcActorId: input.npcActorId,
      familiarity: input.familiarityDelta,
      trust: input.trustDelta,
      shortSummary: input.shortSummary,
      lastInteractionAt: input.interactedAt,
      updatedAt: input.interactedAt
    });
  }

  async createAiCallLog(input: CreateAiCallLogInput): Promise<void> {
    const values: typeof aiCallLogs.$inferInsert = {
      provider: input.provider,
      model: input.model,
      promptVersion: input.promptVersion,
      purpose: input.purpose,
      accountId: input.accountId,
      characterId: input.characterId,
      npcActorId: input.npcActorId,
      requestHash: input.requestHash,
      inputSummary: input.inputSummary,
      outputSummary: input.outputSummary,
      status: input.status,
      latencyMs: input.latencyMs,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      errorCode: input.errorCode
    };
    if (input.createdAt !== undefined) values.createdAt = input.createdAt;

    await this.db.insert(aiCallLogs).values(values);
  }

  async listAiCallLogs(input: { limit: number }): Promise<AiCallLogDto[]> {
    const rows = await this.db
      .select()
      .from(aiCallLogs)
      .orderBy(desc(aiCallLogs.createdAt))
      .limit(input.limit);

    return rows.map(toAiCallLog);
  }
}
