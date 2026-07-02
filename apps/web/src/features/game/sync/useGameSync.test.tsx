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
});
