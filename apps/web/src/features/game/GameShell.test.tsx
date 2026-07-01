import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GameStateDto } from "@ai-mud/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GameShell } from "./GameShell";

const createCharacterState: GameStateDto = {
  character: null,
  locationTitle: "黑松哨站",
  locationDescription: "你尚未创建角色。",
  map: null,
  inventory: [],
  currentAction: null,
  availableActions: ["create_character"],
  log: []
};

const villageState: GameStateDto = {
  character: {
    id: "character-1",
    name: "Zichen",
    classId: "ranger",
    level: 1,
    xp: 0,
    hp: 100,
    maxHp: 100,
    currentLocation: "blackpine_outpost",
    position: null,
    injuryUntil: null
  },
  locationTitle: "黑松哨站",
  locationDescription: "潮湿黑松围住木墙，哨塔上的火盆把灰雾照成暗红色。",
  map: null,
  inventory: [],
  currentAction: null,
  availableActions: ["enter_corrupt_forest"],
  log: []
};

const forestState: GameStateDto = {
  ...villageState,
  character: {
    ...villageState.character!,
    currentLocation: "corrupt_forest",
    position: { x: 2, y: 4 }
  },
  locationTitle: "腐林",
  locationDescription: "被诅咒的树根像黑色筋脉一样拱出湿土。",
  map: {
    zoneId: "corrupt_forest",
    width: 5,
    height: 5,
    cells: [
      { x: 0, y: 0, markers: ["ordinary"] },
      { x: 1, y: 0, markers: ["resource"] },
      { x: 2, y: 0, markers: ["ordinary"] },
      { x: 3, y: 0, markers: ["ordinary"] },
      { x: 4, y: 0, markers: ["ordinary"] },
      { x: 0, y: 1, markers: ["ordinary"] },
      { x: 1, y: 1, markers: ["ordinary"] },
      { x: 2, y: 1, markers: ["ordinary"] },
      { x: 3, y: 1, markers: ["ordinary"] },
      { x: 4, y: 1, markers: ["ordinary"] },
      { x: 0, y: 2, markers: ["ordinary"] },
      { x: 1, y: 2, markers: ["ordinary"] },
      { x: 2, y: 2, markers: ["ordinary"] },
      { x: 3, y: 2, markers: ["ordinary"] },
      { x: 4, y: 2, markers: ["ordinary"] },
      { x: 0, y: 3, markers: ["ordinary"] },
      { x: 1, y: 3, markers: ["ordinary"] },
      { x: 2, y: 3, markers: ["ordinary"] },
      { x: 3, y: 3, markers: ["encounter"] },
      { x: 4, y: 3, markers: ["ordinary"] },
      { x: 0, y: 4, markers: ["ordinary"] },
      { x: 1, y: 4, markers: ["ordinary"] },
      { x: 2, y: 4, markers: ["player", "exit"] },
      { x: 3, y: 4, markers: ["ordinary"] },
      { x: 4, y: 4, markers: ["ordinary"] }
    ]
  },
  inventory: [{ itemId: "wild_berry", name: "野莓", quantity: 2 }],
  currentAction: null,
  availableActions: ["move", "start_gathering", "start_combat", "return_to_village"],
  log: [{ id: "event-1", message: "你踏入腐林。", createdAt: "2026-07-01T00:00:00.000Z" }]
};

function mockFetchWithStates(states: GameStateDto[]) {
  const queue = [...states];
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => queue.shift() ?? states.at(-1) ?? createCharacterState
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("GameShell", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders character creation when no character exists", async () => {
    mockFetchWithStates([createCharacterState]);

    render(<GameShell csrfToken="csrf" />);

    expect(await screen.findByRole("heading", { name: "创建角色" })).toBeTruthy();
  });

  it("enters the forest, supports keyboard movement, gathering, and item detail dialogs", async () => {
    const fetchMock = mockFetchWithStates([villageState, forestState, forestState, forestState]);
    render(<GameShell csrfToken="csrf" />);

    fireEvent.click(await screen.findByRole("button", { name: "前往腐林" }));
    expect(await screen.findByRole("heading", { name: "腐林" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "开始采集" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "w" });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:3000/game/move",
        expect.objectContaining({
          body: JSON.stringify({ direction: "north" }),
          method: "POST"
        })
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "野莓 x2" }));
    expect(screen.getByRole("dialog", { name: "野莓" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "关闭" })).toBeTruthy();
  });

  it("shows active gathering progress and cancels completed cycles", async () => {
    const activeGatheringState: GameStateDto = {
      ...forestState,
      currentAction: {
        id: "action-1",
        actionType: "gathering",
        status: "active",
        description: "正在采集野莓灌木",
        startedAt: "2026-07-01T00:00:00.000Z",
        endsAt: "2026-07-01T00:10:00.000Z",
        progressPct: 50,
        cycleProgressPct: 25,
        completedCycles: 5,
        settledCycles: 4,
        plannedCycles: 10,
        expectedYield: [{ itemId: "wild_berry", name: "野莓", quantity: 10 }],
        combatLog: []
      },
      availableActions: ["cancel_action"]
    };
    const fetchMock = mockFetchWithStates([activeGatheringState, forestState]);

    render(<GameShell csrfToken="csrf" />);

    expect(await screen.findByRole("heading", { name: "当前行动" })).toBeTruthy();
    expect(screen.getByText("正在采集野莓灌木")).toBeTruthy();
    expect(screen.getByText(/当前周期 25%/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消行动" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:3000/game/action/cancel",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("opens combat detail dialog", async () => {
    mockFetchWithStates([
      {
        ...forestState,
        currentAction: {
          id: "action-1",
          actionType: "combat",
          status: "active",
          description: "正在与腐化野狼群战斗",
          startedAt: "2026-07-01T00:00:00.000Z",
          endsAt: "2026-07-01T00:02:00.000Z",
          progressPct: 20,
          cycleProgressPct: null,
          completedCycles: null,
          settledCycles: null,
          plannedCycles: null,
          expectedYield: [],
          combatLog: ["Zichen 攻击腐化野狼，造成 16 点伤害。"]
        },
        availableActions: ["cancel_action"]
      }
    ]);

    render(<GameShell csrfToken="csrf" />);

    expect(await screen.findByText("正在与腐化野狼群战斗")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看战斗" }));
    expect(screen.getByRole("dialog", { name: "战斗详情" })).toBeTruthy();
  });
});
