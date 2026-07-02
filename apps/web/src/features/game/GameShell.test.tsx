import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  GameStateDto,
  MarketDto,
  NpcDialogueResponseDto,
  NpcDialogueTargetDto
} from "@ai-mud/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GameShell } from "./GameShell";

const fedNeeds = {
  hunger: {
    current: 5,
    max: 5,
    status: "fed" as const,
    nextMealAt: "2026-07-01T18:00:00.000Z"
  }
};

const createCharacterState: GameStateDto = {
  character: null,
  locationTitle: "黑松哨站",
  locationDescription: "你尚未创建角色。",
  map: null,
  inventory: [],
  equipment: [],
  market: null,
  npcTasks: [],
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
    injuryUntil: null,
    money: { gold: 0, silver: 12, copper: 35, totalCopper: 1235 },
    needs: fedNeeds
  },
  locationTitle: "黑松哨站",
  locationDescription: "潮湿黑松围住木墙，哨塔上的火盆把灰雾照成暗红色。",
  map: null,
  inventory: [],
  equipment: [
    {
      id: "equipment-1",
      slot: "weapon",
      itemKey: "training_sword",
      name: "训练短剑",
      itemLevel: 5,
      attackBonus: 2,
      defenseBonus: 0,
      maxDurability: 100,
      currentDurability: 60,
      durabilityPct: 60,
      effectiveStatRatio: 1,
      repairQuote: {
        copperCost: { gold: 0, silver: 0, copper: 50, totalCopper: 50 },
        ironOreCost: 1
      }
    }
  ],
  market: null,
  npcTasks: [],
  currentAction: null,
  availableActions: ["enter_corrupt_forest", "open_market", "repair_equipment"],
  log: []
};

const hungryVillageState: GameStateDto = {
  ...villageState,
  character: {
    ...villageState.character!,
    needs: {
      hunger: {
        current: 2,
        max: 5,
        status: "hungry",
        nextMealAt: "2026-07-01T18:00:00.000Z"
      }
    }
  },
  inventory: [{ itemId: "wild_berry", name: "野莓", quantity: 2 }],
  availableActions: [
    "enter_corrupt_forest",
    "open_market",
    "repair_equipment",
    "eat_food"
  ]
};

const taskVillageState: GameStateDto = {
  ...villageState,
  inventory: [{ itemId: "iron_ore", name: "基础铁矿石", quantity: 3 }],
  availableActions: [
    "enter_corrupt_forest",
    "open_market",
    "repair_equipment",
    "view_npc_tasks"
  ],
  npcTasks: [
    {
      id: "task-1",
      npcActorId: "npc-blacksmith",
      npcName: "伯林",
      needType: "ore_shortage",
      status: "open",
      title: "炉火缺矿",
      description: "伯林缺少基础铁矿石，修理炉火和补强装备都会被拖慢。",
      requestedItem: { itemId: "iron_ore", name: "基础铁矿石", quantity: 3 },
      rewardCopper: { gold: 0, silver: 0, copper: 36, totalCopper: 36 },
      acceptedByCharacterId: null,
      expiresAt: "2026-07-03T08:00:00.000Z",
      createdAt: "2026-07-02T08:00:00.000Z",
      acceptedAt: null,
      completedAt: null
    }
  ]
};

const marketState: MarketDto = {
  settlementId: "blackpine_outpost",
  settlementName: "黑松哨站市政集市",
  items: [
    {
      itemId: "iron_ore",
      name: "基础铁矿石",
      category: "ore",
      itemLevel: 1,
      stockQuantity: 12,
      playerQuantity: 3,
      buyPrice: { gold: 0, silver: 0, copper: 30, totalCopper: 30 },
      sellPrice: { gold: 0, silver: 0, copper: 18, totalCopper: 18 },
      buyTax: { gold: 0, silver: 0, copper: 2, totalCopper: 2 },
      sellTax: { gold: 0, silver: 0, copper: 1, totalCopper: 1 }
    }
  ]
};

const dialogueTargets: NpcDialogueTargetDto[] = [
  {
    npcActorId: "npc-blacksmith",
    npcKey: "blackpine_blacksmith_borin",
    name: "伯林",
    profession: "blacksmith",
    currentLocation: "blackpine_outpost",
    statusLine: "正在盘点基础铁矿石库存。",
    hasTask: true,
    taskStatus: "open",
    taskTitle: "炉火缺矿"
  }
];

const emptyDialogue: NpcDialogueResponseDto = {
  target: dialogueTargets[0]!,
  messages: [],
  ai: {
    status: "fallback",
    provider: "template",
    model: "template",
    fallbackReason: null
  }
};

const repliedDialogue: NpcDialogueResponseDto = {
  target: dialogueTargets[0]!,
  messages: [
    {
      id: "msg-player",
      npcActorId: "npc-blacksmith",
      speakerType: "player",
      message: "最近缺什么？",
      createdAt: "2026-07-01T12:00:00.000Z"
    },
    {
      id: "msg-npc",
      npcActorId: "npc-blacksmith",
      speakerType: "npc",
      message: "基础铁矿石快见底了。",
      createdAt: "2026-07-01T12:00:01.000Z"
    }
  ],
  ai: {
    status: "success",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    fallbackReason: null
  }
};

const grantedDialogue: NpcDialogueResponseDto = {
  target: dialogueTargets[0]!,
  messages: [
    {
      id: "msg-player",
      npcActorId: "npc-blacksmith",
      speakerType: "player",
      message: "能不能给我一块基础铁矿石？",
      createdAt: "2026-07-01T12:00:00.000Z"
    },
    {
      id: "msg-npc",
      npcActorId: "npc-blacksmith",
      speakerType: "npc",
      message: "伯林从自己的库存里取出 基础铁矿石 x1 交给你。",
      createdAt: "2026-07-01T12:00:01.000Z"
    }
  ],
  ai: {
    status: "fallback",
    provider: "rules",
    model: "npc-resource-request",
    fallbackReason: "rule_verified"
  }
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
  market: null,
  currentAction: null,
  availableActions: ["move", "start_gathering", "start_combat", "return_to_village"],
  log: [{ id: "event-1", message: "你踏入腐林。", createdAt: "2026-07-01T00:00:00.000Z" }]
};

function mockFetchWithStates(states: unknown[]) {
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
    cleanup();
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

  it("shows money and trades through the municipal market", async () => {
    const fetchMock = mockFetchWithStates([villageState, marketState, villageState]);
    render(<GameShell csrfToken="csrf" />);

    expect(await screen.findByText("金币 0 | 银币 12 | 铜币 35")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "市政集市" }));
    expect(await screen.findByRole("dialog", { name: "市政集市" })).toBeTruthy();
    expect(screen.getByText("基础铁矿石")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "出售 基础铁矿石" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:3000/game/market/sell",
        expect.objectContaining({
          body: JSON.stringify({ itemId: "iron_ore", quantity: 1 }),
          method: "POST"
        })
      );
    });
  });

  it("opens NPC dialogue and sends one free-text message", async () => {
    const fetchMock = mockFetchWithStates([
      villageState,
      dialogueTargets,
      emptyDialogue,
      repliedDialogue,
      villageState
    ]);
    render(<GameShell csrfToken="csrf" />);

    fireEvent.click(await screen.findByRole("button", { name: "附近 NPC" }));
    expect(await screen.findByRole("dialog", { name: "附近 NPC 对话" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /伯林/ })).toBeTruthy();
    expect(screen.getByText("可接取：炉火缺矿")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /伯林/ }));
    expect(await screen.findByText("还没有交谈记录。")).toBeTruthy();
    expect(screen.getByText("可接取：炉火缺矿。请在 NPC 任务面板接取或提交。")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("对 NPC 说"), {
      target: { value: "最近缺什么？" }
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("基础铁矿石快见底了。")).toBeTruthy();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:3000/game/npcs/npc-blacksmith/dialogue",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ message: "最近缺什么？" })
        })
      );
    });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:3000/game/state", expect.any(Object));
  });

  it("refreshes visible inventory after a rule-verified NPC resource grant", async () => {
    const grantedState: GameStateDto = {
      ...villageState,
      inventory: [{ itemId: "iron_ore", name: "基础铁矿石", quantity: 1 }]
    };
    mockFetchWithStates([villageState, dialogueTargets, emptyDialogue, grantedDialogue, grantedState]);
    render(<GameShell csrfToken="csrf" />);

    fireEvent.click(await screen.findByRole("button", { name: "附近 NPC" }));
    fireEvent.click(await screen.findByRole("button", { name: /伯林/ }));
    fireEvent.change(await screen.findByLabelText("对 NPC 说"), {
      target: { value: "能不能给我一块基础铁矿石？" }
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("伯林从自己的库存里取出 基础铁矿石 x1 交给你。")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "基础铁矿石 x1" })).toBeTruthy();
  });

  it("shows NPC demand tasks and accepts then completes one with mouse actions", async () => {
    const acceptedState: GameStateDto = {
      ...taskVillageState,
      npcTasks: [
        {
          ...taskVillageState.npcTasks[0]!,
          status: "accepted",
          acceptedByCharacterId: "character-1",
          acceptedAt: "2026-07-02T08:05:00.000Z"
        }
      ]
    };
    const completedState: GameStateDto = {
      ...taskVillageState,
      npcTasks: [],
      inventory: [{ itemId: "iron_ore", name: "基础铁矿石", quantity: 0 }],
      character: {
        ...taskVillageState.character!,
        money: { gold: 0, silver: 12, copper: 71, totalCopper: 1271 }
      }
    };
    const fetchMock = mockFetchWithStates([taskVillageState, acceptedState, completedState]);

    render(<GameShell csrfToken="csrf" />);

    expect(await screen.findByRole("heading", { name: "NPC 任务" })).toBeTruthy();
    expect(screen.getByText("! 炉火缺矿")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "接取" }));

    expect(await screen.findByText("进行中")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "提交" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:3000/game/npc-tasks/task-1/complete",
        expect.objectContaining({ method: "POST" })
      );
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/game/npc-tasks/task-1/accept",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("shows hunger and eats a food item", async () => {
    const eatenState: GameStateDto = {
      ...hungryVillageState,
      character: {
        ...hungryVillageState.character!,
        needs: fedNeeds
      },
      inventory: [{ itemId: "wild_berry", name: "野莓", quantity: 1 }],
      availableActions: ["enter_corrupt_forest", "open_market", "repair_equipment"]
    };
    const fetchMock = mockFetchWithStates([hungryVillageState, eatenState]);

    render(<GameShell csrfToken="csrf" />);

    expect(await screen.findByText("饱腹 2/5")).toBeTruthy();
    expect(screen.getByText("饥饿：继续外出前最好准备食物。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "食用 野莓" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:3000/game/eat",
        expect.objectContaining({
          body: JSON.stringify({ itemId: "wild_berry" }),
          method: "POST"
        })
      );
    });
  });

  it("shows equipment durability and repairs one item", async () => {
    const repairedState: GameStateDto = {
      ...villageState,
      equipment: [
        {
          ...villageState.equipment[0]!,
          currentDurability: 100,
          durabilityPct: 100,
          repairQuote: null
        }
      ],
      availableActions: ["enter_corrupt_forest", "open_market"]
    };
    const fetchMock = mockFetchWithStates([villageState, repairedState]);

    render(<GameShell csrfToken="csrf" />);

    expect(await screen.findByRole("heading", { name: "装备" })).toBeTruthy();
    expect(screen.getByText("训练短剑")).toBeTruthy();
    expect(screen.getByText("60/100")).toBeTruthy();
    expect(screen.getByText("修理：金币 0 | 银币 0 | 铜币 50 + 基础铁矿石 x1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "修理 训练短剑" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:3000/game/repair",
        expect.objectContaining({
          body: JSON.stringify({ equipmentId: "equipment-1" }),
          method: "POST"
        })
      );
    });
  });

  it("disables equipment repair while an action is active", async () => {
    mockFetchWithStates([
      {
        ...villageState,
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
      }
    ]);

    render(<GameShell csrfToken="csrf" />);

    expect(await screen.findByRole("button", { name: "修理 训练短剑" })).toHaveProperty(
      "disabled",
      true
    );
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
