import type { GameLocationId } from "@ai-mud/shared";
import { and, count, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { characterPresence, characters, chatMessages, syncEvents } from "../../db/schema.js";
import type {
  LobbyCharacterRecord,
  LobbyChatRecord,
  LobbyLeaderboardKind,
  LobbyLeaderboardRecord,
  LobbyPresenceRecord,
  LobbyRepositoryPort
} from "./lobby.service.js";

type LobbyDb = Pick<Db, "insert" | "select" | "update">;

export class LobbyRepository implements LobbyRepositoryPort {
  constructor(private readonly db: LobbyDb) {}

  async findCharacterByAccountId(accountId: string): Promise<LobbyCharacterRecord | null> {
    const [row] = await this.db
      .select({
        accountId: characters.accountId,
        characterId: characters.id,
        characterName: characters.name,
        currentLocation: characters.currentLocation,
        level: characters.level,
        xp: characters.xp,
        wealthCopper: characters.copperBalance
      })
      .from(characters)
      .where(eq(characters.accountId, accountId))
      .limit(1);

    return row ? normalizeCharacter(row) : null;
  }

  async countCharacterMessagesSince(characterId: string, since: Date): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.characterId, characterId),
          eq(chatMessages.channel, "lobby"),
          gt(chatMessages.createdAt, since),
          isNull(chatMessages.deletedAt)
        )
      );

    return Number(row?.value ?? 0);
  }

  async createLobbyChatMessage(input: {
    accountId: string;
    characterId: string;
    characterName: string;
    body: string;
  }): Promise<LobbyChatRecord> {
    const [row] = await this.db
      .insert(chatMessages)
      .values({
        accountId: input.accountId,
        characterId: input.characterId,
        channel: "lobby",
        body: input.body
      })
      .returning({
        id: chatMessages.id,
        accountId: chatMessages.accountId,
        characterId: chatMessages.characterId,
        channel: chatMessages.channel,
        body: chatMessages.body,
        createdAt: chatMessages.createdAt
      });

    if (!row) throw new Error("Failed to create lobby chat message");
    return {
      id: row.id,
      accountId: row.accountId,
      characterId: row.characterId,
      characterName: input.characterName,
      channel: "lobby",
      body: row.body,
      createdAt: row.createdAt
    };
  }

  async writePublicSyncEvent(input: {
    eventType: string;
    payload: Record<string, unknown>;
    source: string;
  }): Promise<number> {
    const [row] = await this.db
      .insert(syncEvents)
      .values({
        audience: "public",
        eventType: input.eventType,
        stateDirty: false,
        payload: input.payload,
        source: input.source
      })
      .returning({ id: syncEvents.id });

    if (!row) throw new Error("Failed to write public sync event");
    return row.id;
  }

  async upsertPresence(input: {
    accountId: string;
    characterId: string;
    seenAt: Date;
  }): Promise<void> {
    await this.db
      .insert(characterPresence)
      .values({
        accountId: input.accountId,
        characterId: input.characterId,
        lastSeenAt: input.seenAt,
        updatedAt: input.seenAt
      })
      .onConflictDoUpdate({
        target: characterPresence.accountId,
        set: {
          characterId: input.characterId,
          lastSeenAt: input.seenAt,
          updatedAt: input.seenAt
        }
      });
  }

  async listActivePresence(input: {
    since: Date;
    limit: number;
  }): Promise<LobbyPresenceRecord[]> {
    const rows = await this.db
      .select({
        accountId: characterPresence.accountId,
        characterId: characterPresence.characterId,
        characterName: characters.name,
        currentLocation: characters.currentLocation,
        lastSeenAt: characterPresence.lastSeenAt
      })
      .from(characterPresence)
      .innerJoin(characters, eq(characters.id, characterPresence.characterId))
      .where(gt(characterPresence.lastSeenAt, input.since))
      .orderBy(desc(characterPresence.lastSeenAt))
      .limit(input.limit);

    return rows.map((row) => ({
      accountId: row.accountId,
      characterId: row.characterId,
      characterName: row.characterName,
      currentLocation: row.currentLocation as GameLocationId,
      lastSeenAt: row.lastSeenAt
    }));
  }

  async listLeaderboard(
    kind: LobbyLeaderboardKind,
    limit: number
  ): Promise<LobbyLeaderboardRecord[]> {
    const rows = await this.db
      .select({
        characterId: characters.id,
        characterName: characters.name,
        level: characters.level,
        xp: characters.xp,
        wealthCopper: characters.copperBalance
      })
      .from(characters)
      .orderBy(
        kind === "level" ? desc(characters.level) : desc(characters.copperBalance),
        kind === "level" ? desc(characters.xp) : desc(characters.level),
        desc(characters.createdAt)
      )
      .limit(limit);

    return rows.map(normalizeLeaderboard);
  }

  async listChatMessagesByIds(ids: string[]): Promise<LobbyChatRecord[]> {
    if (ids.length === 0) return [];

    const rows = await this.db
      .select({
        id: chatMessages.id,
        accountId: chatMessages.accountId,
        characterId: chatMessages.characterId,
        characterName: characters.name,
        channel: chatMessages.channel,
        body: chatMessages.body,
        createdAt: chatMessages.createdAt
      })
      .from(chatMessages)
      .innerJoin(characters, eq(characters.id, chatMessages.characterId))
      .where(and(inArray(chatMessages.id, ids), isNull(chatMessages.deletedAt)))
      .orderBy(chatMessages.createdAt);

    return rows.map((row) => ({
      id: row.id,
      accountId: row.accountId,
      characterId: row.characterId,
      characterName: row.characterName,
      channel: "lobby",
      body: row.body,
      createdAt: row.createdAt
    }));
  }
}

function normalizeCharacter(row: {
  accountId: string;
  characterId: string;
  characterName: string;
  currentLocation: string;
  level: number;
  xp: number;
  wealthCopper: number;
}): LobbyCharacterRecord {
  return {
    ...row,
    currentLocation: row.currentLocation as GameLocationId
  };
}

function normalizeLeaderboard(row: {
  characterId: string;
  characterName: string;
  level: number;
  xp: number;
  wealthCopper: number;
}): LobbyLeaderboardRecord {
  return row;
}
