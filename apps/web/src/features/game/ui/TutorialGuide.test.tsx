import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GameStateDto } from "@ai-mud/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TutorialGuide, TUTORIAL_VERSION, inferTutorialProgress } from "./TutorialGuide";

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
          eventType: "character.move",
          message: "你向北移动。",
          createdAt: "2026-07-13T10:00:00.000Z"
        },
        {
          id: "gathering",
          eventType: "action.gathering.start",
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

  it("derives milestones from structured event types instead of log copy", () => {
    const base = {
      ...baseState,
      character: baseState.character!
    };
    const withLog = (log: GameStateDto["log"]) => ({ ...base, log });

    // Lv1: location only. At the outpost with an empty log, progress is 0.
    expect(inferTutorialProgress(withLog([]))).toBe(0);
    expect(
      inferTutorialProgress({
        ...withLog([]),
        character: { ...base.character!, currentLocation: "old_mine" as const, position: { x: 1, y: 1 } }
      })
    ).toBe(1);

    // Lv2: character.move triggers even when the copy never mentions moving.
    expect(
      inferTutorialProgress({
        ...withLog([
          { id: "move-1", eventType: "character.move", message: "Wandered north.", createdAt: "" }
        ]),
        character: { ...base.character!, currentLocation: "old_mine" as const, position: { x: 1, y: 1 } }
      })
    ).toBe(2);

    // Chinese movement copy without the event type must not advance to Lv2.
    expect(
      inferTutorialProgress({
        ...withLog([
          { id: "move-fake", eventType: "world.broadcast", message: "你向北移动。", createdAt: "" }
        ]),
        character: { ...base.character!, currentLocation: "old_mine" as const, position: { x: 1, y: 1 } }
      })
    ).toBe(1);

    // Lv3: gathering action or action.gathering.start.
    expect(
      inferTutorialProgress({
        ...withLog([
          { id: "move-1", eventType: "character.move", message: "Wandered north.", createdAt: "" }
        ]),
        character: { ...base.character!, currentLocation: "old_mine" as const, position: { x: 1, y: 1 } },
        currentAction: {
          id: "action-1",
          actionType: "gathering",
          status: "active",
          description: "gathering",
          startedAt: "",
          endsAt: "",
          progressPct: 0,
          cycleProgressPct: 0,
          completedCycles: 0,
          settledCycles: 0,
          plannedCycles: 1,
          expectedYield: [],
          combatLog: []
        }
      })
    ).toBe(3);

    // Lv4: non-empty inventory unlocks after Lv3, without any harvest copy.
    const readyForHarvest = {
      ...withLog([
        { id: "move-1", eventType: "character.move", message: "Wandered north.", createdAt: "" },
        {
          id: "gather-1",
          eventType: "action.gathering.start",
          message: "Gathering started.",
          createdAt: ""
        }
      ]),
      character: { ...base.character!, currentLocation: "old_mine" as const, position: { x: 1, y: 1 } },
      inventory: [{ itemId: "iron_ore", name: "基础铁矿石", quantity: 1 }]
    };
    expect(inferTutorialProgress(readyForHarvest)).toBe(4);

    // Lv5: back at the outpost with zone.return completes the tutorial.
    expect(
      inferTutorialProgress({
        ...readyForHarvest,
        character: { ...base.character!, currentLocation: "blackpine_outpost" as const, position: null },
        log: [
          ...readyForHarvest.log,
          { id: "return-1", eventType: "zone.return", message: "Back home.", createdAt: "" }
        ]
      })
    ).toBe(5);
  });

  it("keeps milestones stable when log copy is rewritten with the same event types", () => {
    const snapshot = (message: string) => ({
      ...baseState,
      character: { ...baseState.character!, currentLocation: "blackpine_outpost" as const, position: null },
      inventory: [{ itemId: "iron_ore", name: "基础铁矿石", quantity: 1 }],
      log: [
        { id: "move-1", eventType: "character.move", message, createdAt: "" },
        { id: "gather-1", eventType: "action.gathering.start", message, createdAt: "" },
        { id: "return-1", eventType: "zone.return", message, createdAt: "" }
      ]
    });

    expect(inferTutorialProgress(snapshot("你向北移动，开始采集，返回黑松哨站。"))).toBe(5);
    expect(inferTutorialProgress(snapshot("Completely different wording, no keywords."))).toBe(5);
  });
});
