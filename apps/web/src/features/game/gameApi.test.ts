import { afterEach, describe, expect, it, vi } from "vitest";
import { GameApiError, getGameState, heartbeatPresence, sendLobbyChat } from "./gameApi";

describe("gameApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws structured server validation errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({
          error: { code: "VALIDATION_ERROR", message: "背包物品不足。" }
        })
      }))
    );

    await expect(getGameState()).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "背包物品不足。"
    });
  });

  it("uses a clear authentication-expired fallback for bare 401 responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => {
          throw new Error("no json");
        }
      }))
    );

    await expect(getGameState()).rejects.toBeInstanceOf(GameApiError);
    await expect(getGameState()).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
      message: "登录已失效，请重新登录。"
    });
  });

  it("sends bounded lobby chat through the shared API client", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        id: "chat-1",
        characterId: "character-1",
        characterName: "Zichen",
        channel: "lobby",
        body: "矿洞有人吗？",
        createdAt: "2026-07-03T08:00:00.000Z"
      })
    }));
    vi.stubGlobal("fetch", fetchMock);

    await sendLobbyChat("矿洞有人吗？", "csrf");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/game/chat",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ body: "矿洞有人吗？" }),
        headers: expect.objectContaining({ "x-csrf-token": "csrf" })
      })
    );
  });

  it("updates presence without opening a second read poller", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true })
    }));
    vi.stubGlobal("fetch", fetchMock);

    await heartbeatPresence("csrf");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/game/presence/heartbeat",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({}),
        headers: expect.objectContaining({ "x-csrf-token": "csrf" })
      })
    );
  });
});
