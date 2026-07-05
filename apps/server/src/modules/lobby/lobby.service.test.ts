import { describe, expect, it } from "vitest";
import { LobbyService, LobbyServiceError, type LobbyRepositoryPort } from "./lobby.service.js";

function makeRepo(overrides: Partial<LobbyRepositoryPort> = {}): LobbyRepositoryPort {
  return {
    findCharacterByAccountId: async () => ({
      accountId: "account-1",
      characterId: "character-1",
      characterName: "Zichen",
      currentLocation: "blackpine_outpost",
      level: 9,
      xp: 1802,
      wealthCopper: 4409
    }),
    countCharacterMessagesSince: async () => 0,
    createLobbyChatMessage: async (input) => ({
      id: "chat-1",
      accountId: input.accountId,
      characterId: input.characterId,
      characterName: "Zichen",
      channel: "lobby",
      body: input.body,
      createdAt: new Date("2026-07-02T00:00:00.000Z")
    }),
    writePublicSyncEvent: async () => 12,
    upsertPresence: async () => undefined,
    listActivePresence: async () => [],
    listLeaderboard: async () => [],
    listChatMessagesByIds: async () => [],
    listSystemAnnouncementsByIds: async () => [],
    ...overrides
  };
}

describe("LobbyService", () => {
  it("trims and records lobby chat, then emits one public sync event", async () => {
    const syncEvents: unknown[] = [];
    const repo = makeRepo({
      writePublicSyncEvent: async (input) => {
        syncEvents.push(input);
        return 12;
      }
    });
    const service = new LobbyService(repo, {
      now: () => new Date("2026-07-02T00:00:00.000Z")
    });

    const message = await service.sendLobbyChat("account-1", " 黑松哨站有人吗？ ");

    expect(message.body).toBe("黑松哨站有人吗？");
    expect(syncEvents).toEqual([
      {
        eventType: "lobby.chat",
        payload: { chatMessageId: "chat-1" },
        source: "lobby"
      }
    ]);
  });

  it("rejects overlong lobby chat before writing anything", async () => {
    const writes: string[] = [];
    const service = new LobbyService(
      makeRepo({
        createLobbyChatMessage: async (input) => {
          writes.push(input.body);
          throw new Error("should not write");
        }
      })
    );

    await expect(service.sendLobbyChat("account-1", "x".repeat(241))).rejects.toMatchObject({
      code: "VALIDATION_ERROR"
    });
    expect(writes).toEqual([]);
  });

  it("rate limits lobby chat per character", async () => {
    const service = new LobbyService(
      makeRepo({
        countCharacterMessagesSince: async () => 3
      }),
      { maxMessagesPerWindow: 3 }
    );

    await expect(service.sendLobbyChat("account-1", "太快了")).rejects.toBeInstanceOf(
      LobbyServiceError
    );
  });

  it("records heartbeat presence for the current character", async () => {
    const presenceWrites: unknown[] = [];
    const service = new LobbyService(
      makeRepo({
        upsertPresence: async (input) => {
          presenceWrites.push(input);
        }
      }),
      { now: () => new Date("2026-07-02T00:00:00.000Z") }
    );

    await service.heartbeat("account-1");

    expect(presenceWrites).toEqual([
      {
        accountId: "account-1",
        characterId: "character-1",
        seenAt: new Date("2026-07-02T00:00:00.000Z")
      }
    ]);
  });

  it("builds the sync lobby payload from public chat events, presence, and leaderboards", async () => {
    const service = new LobbyService(
      makeRepo({
        listChatMessagesByIds: async (ids) =>
          ids.map((id) => ({
            id,
            accountId: "account-2",
            characterId: "character-2",
            characterName: "Borin",
            channel: "lobby",
            body: "我看到蓝装广播了。",
            createdAt: new Date("2026-07-02T00:00:00.000Z")
          })),
        listActivePresence: async () => [
          {
            accountId: "account-2",
            characterId: "character-2",
            characterName: "Borin",
            currentLocation: "old_mine",
            lastSeenAt: new Date("2026-07-02T00:00:00.000Z")
          }
        ],
        listLeaderboard: async (kind) => [
          {
            characterId: kind === "level" ? "character-2" : "character-1",
            characterName: kind === "level" ? "Borin" : "Zichen",
            level: kind === "level" ? 10 : 9,
            xp: kind === "level" ? 2000 : 1802,
            wealthCopper: kind === "level" ? 100 : 4409
          }
        ]
      })
    );

    const payload = await service.buildSyncPayload({
      events: [
        {
          eventType: "lobby.chat",
          payload: { chatMessageId: "chat-1" }
        }
      ],
      now: new Date("2026-07-02T00:01:00.000Z")
    });

    expect(payload.chat).toEqual([
      {
        id: "chat-1",
        characterId: "character-2",
        characterName: "Borin",
        channel: "lobby",
        body: "我看到蓝装广播了。",
        createdAt: "2026-07-02T00:00:00.000Z"
      }
    ]);
    expect(payload.presence[0]?.currentLocation).toBe("old_mine");
    expect(payload.leaderboards.level?.[0]?.rank).toBe(1);
    expect(payload.leaderboards.wealth?.[0]?.characterName).toBe("Zichen");
  });

  it("adds system announcements from the public sync stream without a fake character row", async () => {
    const service = new LobbyService(
      makeRepo({
        listSystemAnnouncementsByIds: async (ids) =>
          ids.map((id) => ({
            id,
            adminAccountId: "admin-1",
            body: "今晚 22:00 将进行世界重置演练。",
            severity: "info",
            createdAt: new Date("2026-07-05T12:00:00.000Z")
          }))
      })
    );

    const payload = await service.buildSyncPayload({
      events: [
        {
          eventType: "system.announcement",
          payload: { announcementId: "announcement-1", severity: "info" }
        }
      ],
      now: new Date("2026-07-05T12:00:05.000Z")
    });

    expect(payload.chat).toEqual([
      {
        id: "announcement-1",
        characterId: "system",
        characterName: "系统公告",
        kind: "system",
        channel: "lobby",
        body: "今晚 22:00 将进行世界重置演练。",
        createdAt: "2026-07-05T12:00:00.000Z"
      }
    ]);
  });
});
