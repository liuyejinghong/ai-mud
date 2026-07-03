import { act, cleanup, renderHook } from "@testing-library/react";
import type { GameSyncResponseDto } from "@ai-mud/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useGameSync } from "./useGameSync";

function syncResponse(overrides: Partial<GameSyncResponseDto> = {}): GameSyncResponseDto {
  return {
    stateVersion: 1,
    state: null,
    events: [],
    nextCursor: 1,
    ...overrides
  };
}

describe("useGameSync", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("requests initial state without a cursor and advances later polls from nextCursor", async () => {
    vi.useFakeTimers();
    const fetchSync = vi
      .fn()
      .mockResolvedValueOnce(syncResponse({ nextCursor: 7 }))
      .mockResolvedValueOnce(syncResponse({ nextCursor: 8 }));

    const { result } = renderHook(() =>
      useGameSync({ fetchSync, idleIntervalMs: 1000, activeIntervalMs: 100 })
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchSync).toHaveBeenNthCalledWith(1, undefined);
    expect(result.current.cursor).toBe(7);

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(fetchSync).toHaveBeenCalledTimes(2);
    expect(fetchSync).toHaveBeenNthCalledWith(2, 7);
    expect(result.current.cursor).toBe(8);
  });

  it("uses the active-action interval while an action is running", async () => {
    vi.useFakeTimers();
    const fetchSync = vi.fn().mockResolvedValue(syncResponse({ nextCursor: 2 }));
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");

    renderHook(() =>
      useGameSync({
        fetchSync,
        activeAction: {
          id: "action-1",
          actionType: "gathering",
          status: "active",
          description: "采集中",
          startedAt: "2026-07-02T00:00:00.000Z",
          endsAt: "2026-07-02T00:10:00.000Z",
          progressPct: 0,
          cycleProgressPct: 0,
          completedCycles: 0,
          settledCycles: 0,
          plannedCycles: 10,
          expectedYield: [],
          combatLog: []
        },
        idleIntervalMs: 10_000,
        activeIntervalMs: 500
      })
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(fetchSync).toHaveBeenCalled();
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 500);
  });

  it("emits lobby payloads through the same sync poll", async () => {
    vi.useFakeTimers();
    const onLobby = vi.fn();
    const fetchSync = vi.fn().mockResolvedValue(
      syncResponse({
        chat: [
          {
            id: "chat-1",
            characterId: "character-1",
            characterName: "Zichen",
            channel: "lobby",
            body: "矿洞有人吗？",
            createdAt: "2026-07-03T08:00:00.000Z"
          }
        ],
        presence: [
          {
            accountId: "account-1",
            characterId: "character-1",
            characterName: "Zichen",
            currentLocation: "blackpine_outpost",
            lastSeenAt: "2026-07-03T08:00:00.000Z"
          }
        ],
        leaderboards: {
          level: [
            {
              rank: 1,
              characterId: "character-1",
              characterName: "Zichen",
              level: 3,
              xp: 120,
              wealthCopper: 1235
            }
          ],
          wealth: []
        },
        nextCursor: 9
      })
    );

    renderHook(() => useGameSync({ fetchSync, onLobby }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(onLobby).toHaveBeenCalledWith({
      chat: expect.arrayContaining([expect.objectContaining({ body: "矿洞有人吗？" })]),
      presence: expect.arrayContaining([expect.objectContaining({ characterName: "Zichen" })]),
      leaderboards: expect.objectContaining({
        level: expect.arrayContaining([expect.objectContaining({ rank: 1 })])
      })
    });
  });
});
