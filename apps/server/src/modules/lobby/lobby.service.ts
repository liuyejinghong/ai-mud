import type {
  ChatMessageDto,
  GameLocationId,
  GameSyncEventDto,
  LeaderboardEntryDto,
  PresenceDto
} from "@ai-mud/shared";
import { toSystemChatDto, type SystemAnnouncementRecord } from "../announcement/announcement.service.js";

export const LOBBY_CHAT_MAX_CHARS = 240;
export const LOBBY_CHAT_RATE_WINDOW_MS = 10_000;
export const LOBBY_CHAT_MAX_MESSAGES_PER_WINDOW = 3;
export const LOBBY_PRESENCE_WINDOW_MS = 90_000;
export const LOBBY_LEADERBOARD_LIMIT = 10;

export interface LobbyCharacterRecord {
  accountId: string;
  characterId: string;
  characterName: string;
  currentLocation: GameLocationId;
  level: number;
  xp: number;
  wealthCopper: number;
}

export interface LobbyChatRecord {
  id: string;
  accountId: string;
  characterId: string;
  characterName: string;
  channel: "lobby";
  body: string;
  createdAt: Date;
}

export interface LobbyPresenceRecord {
  accountId: string;
  characterId: string;
  characterName: string;
  currentLocation: GameLocationId;
  lastSeenAt: Date;
}

export type LobbyLeaderboardKind = "level" | "wealth";

export interface LobbyLeaderboardRecord {
  characterId: string;
  characterName: string;
  level: number;
  xp: number;
  wealthCopper: number;
}

export interface LobbyRepositoryPort {
  findCharacterByAccountId(accountId: string): Promise<LobbyCharacterRecord | null>;
  countCharacterMessagesSince(characterId: string, since: Date): Promise<number>;
  createLobbyChatMessage(input: {
    accountId: string;
    characterId: string;
    characterName: string;
    body: string;
  }): Promise<LobbyChatRecord>;
  writePublicSyncEvent(input: {
    eventType: string;
    payload: Record<string, unknown>;
    source: string;
  }): Promise<number>;
  upsertPresence(input: {
    accountId: string;
    characterId: string;
    seenAt: Date;
  }): Promise<void>;
  listActivePresence(input: { since: Date; limit: number }): Promise<LobbyPresenceRecord[]>;
  listLeaderboard(kind: LobbyLeaderboardKind, limit: number): Promise<LobbyLeaderboardRecord[]>;
  listChatMessagesByIds(ids: string[]): Promise<LobbyChatRecord[]>;
  listSystemAnnouncementsByIds(ids: string[]): Promise<SystemAnnouncementRecord[]>;
}

export class LobbyServiceError extends Error {
  constructor(
    readonly code: "VALIDATION_ERROR",
    message: string
  ) {
    super(message);
  }
}

export interface LobbySyncPayload {
  chat: ChatMessageDto[];
  presence: PresenceDto[];
  leaderboards: {
    level: LeaderboardEntryDto[];
    wealth: LeaderboardEntryDto[];
  };
}

export class LobbyService {
  constructor(
    private readonly repo: LobbyRepositoryPort,
    private readonly options: {
      now?: () => Date;
      maxMessagesPerWindow?: number;
    } = {}
  ) {}

  async sendLobbyChat(accountId: string, rawBody: string): Promise<ChatMessageDto> {
    const body = rawBody.trim();
    if (!body || body.length > LOBBY_CHAT_MAX_CHARS) {
      throw new LobbyServiceError("VALIDATION_ERROR", "聊天内容长度不合法。");
    }

    const character = await this.requireCharacter(accountId);
    const now = this.now();
    const since = new Date(now.getTime() - LOBBY_CHAT_RATE_WINDOW_MS);
    const recentCount = await this.repo.countCharacterMessagesSince(character.characterId, since);
    const maxMessages =
      this.options.maxMessagesPerWindow ?? LOBBY_CHAT_MAX_MESSAGES_PER_WINDOW;
    if (recentCount >= maxMessages) {
      throw new LobbyServiceError("VALIDATION_ERROR", "发言太快了，稍后再试。");
    }

    const message = await this.repo.createLobbyChatMessage({
      accountId,
      characterId: character.characterId,
      characterName: character.characterName,
      body
    });
    await this.repo.writePublicSyncEvent({
      eventType: "lobby.chat",
      payload: { chatMessageId: message.id },
      source: "lobby"
    });

    return toChatDto(message);
  }

  async heartbeat(accountId: string): Promise<void> {
    const character = await this.requireCharacter(accountId);
    await this.repo.upsertPresence({
      accountId,
      characterId: character.characterId,
      seenAt: this.now()
    });
  }

  async buildSyncPayload(input: {
    events: Array<Pick<GameSyncEventDto, "eventType" | "payload">>;
    now?: Date;
  }): Promise<LobbySyncPayload> {
    const chatIds = input.events
      .filter((event) => event.eventType === "lobby.chat")
      .map((event) => event.payload.chatMessageId)
      .filter((value): value is string => typeof value === "string");
    const announcementIds = input.events
      .filter((event) => event.eventType === "system.announcement")
      .map((event) => event.payload.announcementId)
      .filter((value): value is string => typeof value === "string");
    // Game sync calls this through a transaction-scoped repository, whose PostgreSQL client only
    // accepts one query at a time. Keeping these reads ordered preserves that contract.
    const chat = await this.repo.listChatMessagesByIds(Array.from(new Set(chatIds)));
    const announcements = await this.repo.listSystemAnnouncementsByIds(
      Array.from(new Set(announcementIds))
    );
    const presence = await this.repo.listActivePresence({
      since: new Date((input.now ?? this.now()).getTime() - LOBBY_PRESENCE_WINDOW_MS),
      limit: 50
    });
    const level = await this.repo.listLeaderboard("level", LOBBY_LEADERBOARD_LIMIT);
    const wealth = await this.repo.listLeaderboard("wealth", LOBBY_LEADERBOARD_LIMIT);

    return {
      chat: [...chat.map(toChatDto), ...announcements.map(toSystemChatDto)].sort(
        (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)
      ),
      presence: presence.map((entry) => ({
        accountId: entry.accountId,
        characterId: entry.characterId,
        characterName: entry.characterName,
        currentLocation: entry.currentLocation,
        lastSeenAt: entry.lastSeenAt.toISOString()
      })),
      leaderboards: {
        level: level.map(toLeaderboardDto),
        wealth: wealth.map(toLeaderboardDto)
      }
    };
  }

  private async requireCharacter(accountId: string): Promise<LobbyCharacterRecord> {
    const character = await this.repo.findCharacterByAccountId(accountId);
    if (!character) {
      throw new LobbyServiceError("VALIDATION_ERROR", "请先创建角色。");
    }
    return character;
  }

  private now() {
    return this.options.now?.() ?? new Date();
  }
}

function toChatDto(message: LobbyChatRecord): ChatMessageDto {
  return {
    id: message.id,
    characterId: message.characterId,
    characterName: message.characterName,
    channel: "lobby",
    body: message.body,
    createdAt: message.createdAt.toISOString()
  };
}

function toLeaderboardDto(entry: LobbyLeaderboardRecord, index: number): LeaderboardEntryDto {
  return {
    rank: index + 1,
    characterId: entry.characterId,
    characterName: entry.characterName,
    level: entry.level,
    xp: entry.xp,
    wealthCopper: entry.wealthCopper
  };
}
