import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { GameStateDto, GameSyncResponseDto } from "@ai-mud/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useGameController } from "./useGameController";

function baseState(): GameStateDto {
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
    log: []
  };
}

function characterState(name: string): GameStateDto {
  return {
    ...baseState(),
    character: {
      id: "character-1",
      name,
      classId: "ranger",
      level: 1,
      xp: 0,
      hp: 100,
      maxHp: 100,
      currentLocation: "blackpine_outpost",
      position: null,
      injuryUntil: null,
      money: { gold: 0, silver: 0, copper: 0, totalCopper: 0 },
      needs: {
        hunger: {
          current: 5,
          max: 5,
          status: "fed",
          nextMealAt: "2026-07-01T18:00:00.000Z"
        }
      }
    }
  };
}

function syncDto(overrides: Partial<GameSyncResponseDto> = {}): GameSyncResponseDto {
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

function stubSync(queue: GameSyncResponseDto[]) {
  const pending = [...queue];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => ({
    ok: true,
    json: async () => {
      const url = String(input);
      if (url.includes("/game/presence/heartbeat")) {
        return { ok: true };
      }
      if (url.includes("/game/sync")) {
        return pending.shift() ?? syncDto();
      }
      return syncDto();
    }
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("useGameController sync guards", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("ignores a same-epoch full state whose characterRevision regressed, but still advances cursor", async () => {
    stubSync([
      syncDto({ state: characterState("Zichen"), characterRevision: 2, nextCursor: 4 })
    ]);
    const { result } = renderHook(() => useGameController({ csrfToken: "csrf" }));

    await waitFor(() => {
      expect(result.current.state.character?.name).toBe("Zichen");
    });
    expect(result.current.sync.cursor).toBe(4);

    act(() => {
      result.current.sync.applyResponse(
        syncDto({
          state: characterState("旧快照"),
          characterRevision: 1,
          nextCursor: 5
        })
      );
    });

    expect(result.current.sync.cursor).toBe(5);
    expect(result.current.state.character?.name).toBe("Zichen");
  });

  it("applies a same-epoch full state with a newer characterRevision", async () => {
    stubSync([
      syncDto({ state: characterState("Zichen"), characterRevision: 2, nextCursor: 4 })
    ]);
    const { result } = renderHook(() => useGameController({ csrfToken: "csrf" }));

    await waitFor(() => {
      expect(result.current.state.character?.name).toBe("Zichen");
    });

    act(() => {
      result.current.sync.applyResponse(
        syncDto({
          state: characterState("Zichen改名"),
          characterRevision: 3,
          nextCursor: 5
        })
      );
    });

    expect(result.current.sync.cursor).toBe(5);
    expect(result.current.state.character?.name).toBe("Zichen改名");
  });
});
