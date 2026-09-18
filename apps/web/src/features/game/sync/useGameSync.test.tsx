import { act, cleanup, renderHook } from "@testing-library/react";
import type { GameStateDto, GameSyncResponseDto } from "@ai-mud/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useGameSync } from "./useGameSync";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function activeAction(id = "action-1"): NonNullable<GameStateDto["currentAction"]> {
  return {
    id,
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
  };
}

async function flushPoll(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function advanceTimersByTime(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function syncResponse(overrides: Partial<GameSyncResponseDto> = {}): GameSyncResponseDto {
  return {
    worldEpoch: 1,
    characterRevision: 1,
    stateVersion: 1,
    state: null,
    events: [],
    nextCursor: 1,
    ...overrides
  };
}

function gameState(overrides: Partial<GameStateDto> = {}): GameStateDto {
  return {
    character: null,
    locationTitle: "黑松哨站",
    locationDescription: "潮湿黑松围住木墙。",
    map: null,
    inventory: [],
    equipment: [],
    backpackEquipment: [],
    market: null,
    npcTasks: [],
    currentAction: null,
    rumors: [],
    availableActions: [],
    log: [],
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
    expect(fetchSync.mock.calls[0]?.[0]).toBeUndefined();
    expect(result.current.cursor).toBe(7);

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(fetchSync).toHaveBeenCalledTimes(2);
    expect(fetchSync.mock.calls[1]?.[0]).toBe(7);
    expect(result.current.cursor).toBe(8);
  });

  it("uses the active-action interval while an action is running", async () => {
    vi.useFakeTimers();
    const fetchSync = vi.fn().mockResolvedValue(syncResponse({ nextCursor: 2 }));
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");

    renderHook(() =>
      useGameSync({
        fetchSync,
        activeAction: activeAction(),
        idleIntervalMs: 10_000,
        activeIntervalMs: 500
      })
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(fetchSync).toHaveBeenCalled();
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 500);
  });

  it("does not restart polling for fresh active-action objects with the same id and status", async () => {
    vi.useFakeTimers();
    const fetchSync = vi.fn().mockResolvedValue(syncResponse({ nextCursor: 2 }));
    const { rerender } = renderHook(
      ({ action }) =>
        useGameSync({
          fetchSync,
          activeAction: action,
          idleIntervalMs: 10_000,
          activeIntervalMs: 500
        }),
      { initialProps: { action: activeAction() } }
    );

    await flushPoll();
    expect(fetchSync).toHaveBeenCalledTimes(1);

    for (let index = 0; index < 5; index += 1) {
      rerender({ action: activeAction() });
      await flushPoll();
    }

    expect(fetchSync).toHaveBeenCalledTimes(1);
  });

  it("does not restart polling when response callbacks change identity", async () => {
    vi.useFakeTimers();
    const fetchSync = vi.fn().mockResolvedValue(syncResponse({ nextCursor: 2 }));
    let onState = vi.fn();
    const { rerender } = renderHook(() =>
      useGameSync({
        fetchSync,
        onState,
        idleIntervalMs: 1_000
      })
    );

    await flushPoll();
    expect(fetchSync).toHaveBeenCalledTimes(1);

    for (let index = 0; index < 5; index += 1) {
      onState = vi.fn();
      rerender();
      await flushPoll();
    }

    expect(fetchSync).toHaveBeenCalledTimes(1);
  });

  it("backs off exponentially to 60 seconds and resets to base after success", async () => {
    vi.useFakeTimers();
    const baseIntervalMs = 1_000;
    const expectedFailureDelays = [2_000, 4_000, 8_000, 16_000, 32_000, 60_000];
    const fetchSync = vi.fn();
    for (let failure = 0; failure < expectedFailureDelays.length; failure += 1) {
      fetchSync.mockRejectedValueOnce(new Error(`sync failure ${failure + 1}`));
    }
    fetchSync.mockResolvedValue(syncResponse({ nextCursor: 2 }));
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");

    renderHook(() => useGameSync({ fetchSync, idleIntervalMs: baseIntervalMs }));
    await flushPoll();

    expect(fetchSync).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(
      expect.any(Function),
      expectedFailureDelays[0]
    );

    for (let failure = 1; failure < expectedFailureDelays.length; failure += 1) {
      const previousDelay = expectedFailureDelays[failure - 1];
      const nextDelay = expectedFailureDelays[failure];
      if (previousDelay === undefined || nextDelay === undefined) {
        throw new Error("Missing expected backoff delay");
      }
      await advanceTimersByTime(previousDelay);
      expect(fetchSync).toHaveBeenCalledTimes(failure + 1);
      expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), nextDelay);
    }

    await advanceTimersByTime(expectedFailureDelays.at(-1) ?? 0);
    expect(fetchSync).toHaveBeenCalledTimes(expectedFailureDelays.length + 1);
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), baseIntervalMs);

    await advanceTimersByTime(baseIntervalMs);
    expect(fetchSync).toHaveBeenCalledTimes(expectedFailureDelays.length + 2);
  });

  it("never overlaps an in-flight request across timer advances or rerenders", async () => {
    vi.useFakeTimers();
    let inFlight = 0;
    let maxInFlight = 0;
    const requests: Array<Deferred<GameSyncResponseDto>> = [];
    const transport = vi.fn((_cursor?: number, _signal?: AbortSignal) => {
      const request = deferred<GameSyncResponseDto>();
      requests.push(request);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return request.promise.finally(() => {
        inFlight -= 1;
      });
    });
    const makeFetcher = () =>
      (cursor?: number, signal?: AbortSignal) => transport(cursor, signal);
    const { rerender } = renderHook(
      ({ fetcher }) => useGameSync({ fetchSync: fetcher, idleIntervalMs: 1_000 }),
      { initialProps: { fetcher: makeFetcher() } }
    );

    await flushPoll();
    await advanceTimersByTime(60_000);

    for (let index = 0; index < 5; index += 1) {
      rerender({ fetcher: makeFetcher() });
      await flushPoll();
    }

    for (const request of requests) {
      request.resolve(syncResponse({ nextCursor: 2 }));
    }
    await flushPoll();

    expect(transport).toHaveBeenCalledTimes(1);
    expect(maxInFlight).toBe(1);
  });

  it("clears a scheduled poll timer on unmount", async () => {
    vi.useFakeTimers();
    const fetchSync = vi.fn().mockResolvedValue(syncResponse({ nextCursor: 2 }));
    const { unmount } = renderHook(() =>
      useGameSync({ fetchSync, idleIntervalMs: 1_000 })
    );

    await flushPoll();
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
    await advanceTimersByTime(60_000);
    expect(fetchSync).toHaveBeenCalledTimes(1);
  });

  it.each(["resolve", "reject"] as const)(
    "aborts an in-flight request and remains inert when it later %ss after unmount",
    async (outcome) => {
      vi.useFakeTimers();
      const request = deferred<GameSyncResponseDto>();
      let receivedSignal: AbortSignal | undefined;
      const fetchSync = vi.fn((_cursor?: number, signal?: AbortSignal) => {
        receivedSignal = signal;
        return request.promise;
      });
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { unmount } = renderHook(() =>
        useGameSync({ fetchSync, idleIntervalMs: 1_000 })
      );

      await flushPoll();
      expect(fetchSync).toHaveBeenCalledTimes(1);

      unmount();

      expect(vi.getTimerCount()).toBe(0);

      await act(async () => {
        if (outcome === "resolve") {
          request.resolve(syncResponse({ nextCursor: 9 }));
        } else {
          request.reject(new Error("late sync failure"));
        }
        await Promise.resolve();
      });
      await advanceTimersByTime(60_000);

      expect(fetchSync).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      expect(consoleErrorSpy.mock.calls.flat().join(" ")).not.toMatch(
        /state update on an unmounted component|can't perform a react state update/i
      );
      if (typeof AbortController !== "undefined") {
        expect(receivedSignal).toBeDefined();
        expect(receivedSignal?.aborted).toBe(true);
      }
    }
  );

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

  it("emits offline reports from the initial sync payload", async () => {
    vi.useFakeTimers();
    const onOfflineReport = vi.fn();
    const fetchSync = vi.fn().mockResolvedValue(
      syncResponse({
        offlineReport: {
          generatedAt: "2026-07-02T10:00:00.000Z",
          since: "2026-07-02T08:00:00.000Z",
          until: "2026-07-02T10:00:00.000Z",
          status: "success",
          provider: "deepseek",
          model: "deepseek-v4-flash",
          fallbackReason: null,
          title: "离线简报",
          summary: "黑松哨站记录了一笔基础铁矿石成交。",
          highlights: ["集市记录了基础铁矿石成交。"]
        }
      })
    );

    renderHook(() => useGameSync({ fetchSync, onOfflineReport }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(onOfflineReport).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "离线简报",
        highlights: ["集市记录了基础铁矿石成交。"]
      })
    );
  });

  it("discards a response whose worldEpoch regressed", async () => {
    vi.useFakeTimers();
    const onState = vi.fn();
    const onEvents = vi.fn();
    const fetchSync = vi.fn().mockResolvedValue(syncResponse({ nextCursor: 2 }));
    const { result } = renderHook(() =>
      useGameSync({ fetchSync, onState, onEvents, idleIntervalMs: 1_000 })
    );

    await flushPoll();

    const stale = syncResponse({
      worldEpoch: 0,
      state: gameState({ locationTitle: "旧世界" }),
      events: [
        {
          id: 99,
          eventType: "system.announcement",
          stateDirty: false,
          payload: {},
          source: "admin",
          createdAt: "2026-07-02T08:00:00.000Z"
        }
      ],
      nextCursor: 99
    });
    act(() => {
      result.current.applyResponse(syncResponse({ worldEpoch: 3, nextCursor: 3 }));
    });
    expect(result.current.cursor).toBe(3);

    act(() => {
      result.current.applyResponse(stale);
    });

    expect(result.current.cursor).toBe(3);
    expect(onState).not.toHaveBeenCalledWith(
      expect.objectContaining({ locationTitle: "旧世界" }),
      expect.anything()
    );
    expect(onEvents).not.toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 99 })])
    );
  });

  it("clears the epoch guard when the character changes", async () => {
    vi.useFakeTimers();
    const fetchSync = vi.fn().mockResolvedValue(syncResponse({ nextCursor: 2 }));
    const { result, rerender } = renderHook(
      ({ characterId }) => useGameSync({ fetchSync, characterId, idleIntervalMs: 1_000 }),
      { initialProps: { characterId: "character-1" as string | null } }
    );

    await flushPoll();

    act(() => {
      result.current.applyResponse(syncResponse({ worldEpoch: 5, nextCursor: 5 }));
    });
    expect(result.current.cursor).toBe(5);

    rerender({ characterId: "character-2" });

    act(() => {
      result.current.applyResponse(syncResponse({ worldEpoch: 1, nextCursor: 6 }));
    });
    expect(result.current.cursor).toBe(6);
  });
});
