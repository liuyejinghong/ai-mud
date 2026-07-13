import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GameStateDto } from "@ai-mud/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TutorialGuide, TUTORIAL_VERSION } from "./TutorialGuide";

const baseState: GameStateDto = {
  character: {
    id: "character-tutorial",
    name: "Zichen",
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
        nextMealAt: "2026-07-13T18:00:00.000Z"
      }
    }
  },
  locationTitle: "黑松哨站",
  locationDescription: "哨站",
  map: null,
  inventory: [],
  equipment: [],
  backpackEquipment: [],
  market: null,
  npcTasks: [],
  currentAction: null,
  rumors: [],
  availableActions: ["enter_old_mine"],
  log: []
};

describe("TutorialGuide", () => {
  beforeEach(() => {
    cleanup();
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key)
      }
    });
    vi.restoreAllMocks();
  });

  it("shows the first contextual goal and persists collapse by character and version", async () => {
    const first = render(
      <TutorialGuide characterId="character-tutorial" state={{ ...baseState, character: baseState.character! }} />
    );

    expect(await screen.findByRole("heading", { name: "新手引导" })).toBeTruthy();
    expect(screen.getByText("前往旧矿坑或腐林，开始第一次野外探索。")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(screen.queryByText("前往旧矿坑或腐林，开始第一次野外探索。"))
      .toBeNull();
    first.unmount();

    render(
      <TutorialGuide characterId="character-tutorial" state={{ ...baseState, character: baseState.character! }} />
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "展开" })).toBeTruthy());
    expect(window.localStorage.getItem(`ai-mud:tutorial:${TUTORIAL_VERSION}:character-tutorial`)).toContain(
      '"collapsed":true'
    );
  });

  it("infers progress from world state and can be reset without a server call", async () => {
    const progressedState: GameStateDto = {
      ...baseState,
      character: { ...baseState.character!, currentLocation: "old_mine", position: { x: 2, y: 2 } },
      inventory: [{ itemId: "iron_ore", name: "基础铁矿石", quantity: 1 }],
      currentAction: null,
      log: [
        {
          id: "movement",
          message: "你向北移动。",
          createdAt: "2026-07-13T10:00:00.000Z"
        },
        {
          id: "gathering",
          message: "你开始采集旧矿坑铁矿脉。",
          createdAt: "2026-07-13T10:01:00.000Z"
        }
      ]
    };

    render(
      <TutorialGuide
        characterId="character-tutorial"
        state={{ ...progressedState, character: progressedState.character! }}
      />
    );

    expect(await screen.findByText("返回哨站，再处理 NPC、集市和装备。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重置" }));
    expect(screen.getByText("前往旧矿坑或腐林，开始第一次野外探索。")).toBeTruthy();
  });
});
