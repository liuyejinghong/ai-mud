import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  GameSyncResponseDto,
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
  backpackEquipment: [],
  market: null,
  npcTasks: [],
  currentAction: null,
  rumors: [],
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
      rarity: "common",
      itemLevel: 5,
      attackBonus: 2,
      defenseBonus: 0,
      agilityBonus: 0,
      maxHpBonus: 0,
      affixes: [],
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
  backpackEquipment: [],
  market: null,
  npcTasks: [],
  currentAction: null,
  rumors: [],
  availableActions: ["enter_corrupt_forest", "enter_old_mine", "open_market", "repair_equipment"],
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
    "enter_old_mine",
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
    "enter_old_mine",
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
      proposalSource: "ai",
      proposalReason: "没有矿石，哨站的修理活会拖到深夜。",
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

function isSyncResponse(value: unknown) {
  return (
    typeof value === "object" &&
    value !== null &&
    "nextCursor" in value &&
    "events" in value
  );
}

function emptySyncResponse(overrides: Partial<GameSyncResponseDto> = {}): GameSyncResponseDto {
  return {
    stateVersion: 1,
    state: null,
    events: [],
    chat: [],
    presence: [],
    leaderboards: { level: [], wealth: [] },
    nextCursor: 1,
    ...overrides
  };
}

function mockFetchWithStates(states: unknown[]) {
  const queue = [...states];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => ({
    ok: true,
    json: async () => {
      const url = String(input);
      if (url.includes("/game/presence/heartbeat")) {
        return { ok: true };
      }
      if (url.includes("/game/chat")) {
        return {
          id: "chat-created",
          characterId: "character-1",
          characterName: "Zichen",
          channel: "lobby",
          body: "矿洞有人吗？",
          createdAt: "2026-07-03T08:00:05.000Z"
        };
      }
      if (url.includes("/game/sync?cursor=")) {
        const next = queue[0];
        if (isSyncResponse(next)) {
          return queue.shift();
        }
        return emptySyncResponse();
      }
      const next = queue.shift() ?? states.at(-1) ?? createCharacterState;
      if (url.includes("/game/sync") && !isSyncResponse(next)) {
        return emptySyncResponse({ state: next as GameStateDto });
      }
      return next;
    }
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

  it("shows a compact beginner guide after entering the world", async () => {
    mockFetchWithStates([villageState]);

    render(<GameShell csrfToken="csrf" />);

    expect(await screen.findByRole("heading", { name: "新手指引" })).toBeTruthy();
    expect(screen.getByText("先从旧矿坑或腐林开始探索。")).toBeTruthy();
  });

  it("keeps equipment details behind a slot dialog", async () => {
    mockFetchWithStates([villageState]);

    render(<GameShell csrfToken="csrf" />);

    expect(await screen.findByRole("heading", { name: "装备" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "武器 训练短剑 普通 耐久 60%" })).toBeTruthy();
    expect(screen.queryByText("攻 +2")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "武器 训练短剑 普通 耐久 60%" }));

    expect(screen.getByRole("dialog", { name: "训练短剑 装备详情" })).toBeTruthy();
    expect(screen.getByText("攻 +2")).toBeTruthy();
  });

  it("renders the event log as a fixed recent feed with timestamps", async () => {
    const logState: GameStateDto = {
      ...villageState,
      log: Array.from({ length: 35 }, (_, index) => ({
        id: `event-${index + 1}`,
        message: `事件 ${index + 1}`,
        createdAt: new Date(Date.UTC(2026, 6, 6, 8, index, 0)).toISOString()
      }))
    };
    mockFetchWithStates([logState]);

    render(<GameShell csrfToken="csrf" />);

    expect(await screen.findByRole("heading", { name: "事件记录" })).toBeTruthy();
    expect(screen.queryByText("事件 1")).toBeNull();
    expect(screen.getByText("事件 35")).toBeTruthy();
    expect(screen.getByText("08:34")).toBeTruthy();
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

  it("enters Old Mine through the same zone endpoint", async () => {
    const oldMineState: GameStateDto = {
      ...forestState,
      locationTitle: "旧矿坑",
      locationDescription: "废弃矿道向山腹深处倾斜，潮湿木梁在黑暗里发出细碎呻吟。",
      character: {
        ...forestState.character!,
        currentLocation: "old_mine",
        position: { x: 2, y: 4 }
      },
      map: {
        ...forestState.map!,
        zoneId: "old_mine"
      }
    };
    const fetchMock = mockFetchWithStates([villageState, oldMineState]);
    render(<GameShell csrfToken="csrf" />);

    fireEvent.click(await screen.findByRole("button", { name: "前往旧矿坑" }));

    expect(await screen.findByRole("heading", { name: "旧矿坑" })).toBeTruthy();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:3000/game/enter-zone",
        expect.objectContaining({
          body: JSON.stringify({ zoneId: "old_mine" }),
          method: "POST"
        })
      );
    });
  });

  it("renders loot and level feedback from the sync event stream", async () => {
    mockFetchWithStates([
      {
        stateVersion: 4,
        state: forestState,
        nextCursor: 4,
        events: [
          {
            id: 1,
            eventType: "item.grant",
            stateDirty: true,
            payload: { itemId: "rough_hide", itemName: "粗糙皮革", quantity: 2 },
            source: "item-service",
            createdAt: "2026-07-02T08:00:00.000Z"
          },
          {
            id: 2,
            eventType: "item.instance.grant",
            stateDirty: true,
            payload: { itemDefId: "wolfbone_shiv", itemName: "狼骨短刃", rarity: "rare" },
            source: "item-service",
            createdAt: "2026-07-02T08:00:01.000Z"
          },
          {
            id: 3,
            eventType: "character.level_up",
            stateDirty: true,
            payload: { previousLevel: 1, level: 2, xp: 48 },
            source: "game-service",
            createdAt: "2026-07-02T08:00:02.000Z"
          }
        ]
      }
    ]);

    render(<GameShell csrfToken="csrf" />);

    expect(await screen.findByText("获得 粗糙皮革 x2")).toBeTruthy();
    expect(screen.getByText("获得稀有装备：狼骨短刃")).toBeTruthy();
    expect(screen.getByText("等级提升至 2")).toBeTruthy();
  });

  it("renders public world broadcasts from other characters and skips self duplicates", async () => {
    mockFetchWithStates([
      {
        stateVersion: 5,
        state: forestState,
        nextCursor: 6,
        events: [
          {
            id: 4,
            eventType: "world.broadcast",
            stateDirty: false,
            payload: {
              kind: "rare_drop",
              characterId: "character-2",
              characterName: "Alden",
              itemName: "狼骨短刃",
              rarity: "rare"
            },
            source: "item-service",
            createdAt: "2026-07-02T08:00:03.000Z"
          },
          {
            id: 5,
            eventType: "world.broadcast",
            stateDirty: false,
            payload: {
              kind: "level_up",
              characterId: "character-3",
              characterName: "Mira",
              level: 7
            },
            source: "game-service",
            createdAt: "2026-07-02T08:00:04.000Z"
          },
          {
            id: 6,
            eventType: "world.broadcast",
            stateDirty: false,
            payload: {
              kind: "rare_drop",
              characterId: "character-1",
              characterName: "Zichen",
              itemName: "狼骨短刃",
              rarity: "rare"
            },
            source: "item-service",
            createdAt: "2026-07-02T08:00:05.000Z"
          }
        ]
      }
    ]);

    render(<GameShell csrfToken="csrf" />);

    expect(await screen.findByText("Alden 获得稀有装备：狼骨短刃")).toBeTruthy();
    expect(screen.getByText("Mira 升到 7 级")).toBeTruthy();
    expect(screen.queryByText("Zichen 获得稀有装备：狼骨短刃")).toBeNull();
  });

  it("renders system announcements in the lobby chat stream", async () => {
    mockFetchWithStates([
      emptySyncResponse({
        state: villageState,
        events: [
          {
            id: 7,
            eventType: "system.announcement",
            stateDirty: false,
            payload: { announcementId: "announcement-1", severity: "info" },
            source: "admin",
            createdAt: "2026-07-05T12:00:00.000Z"
          }
        ],
        chat: [
          {
            id: "announcement-1",
            characterId: "system",
            characterName: "系统公告",
            kind: "system",
            channel: "lobby",
            body: "今晚 22:00 将进行世界重置演练。",
            createdAt: "2026-07-05T12:00:00.000Z"
          }
        ]
      })
    ]);

    render(<GameShell csrfToken="csrf" />);

    expect(await screen.findByText("系统公告")).toBeTruthy();
    expect(screen.getByText("今晚 22:00 将进行世界重置演练。")).toBeTruthy();
    expect(screen.getByText("系统公告已发布")).toBeTruthy();
  });

  it("blocks movement shortcuts while an item dialog is open", async () => {
    const fetchMock = mockFetchWithStates([forestState]);
    render(<GameShell csrfToken="csrf" />);

    expect(await screen.findByRole("heading", { name: "腐林" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "野莓 x2" }));
    expect(screen.getByRole("button", { name: "向东移动" })).toHaveProperty("disabled", true);

    fireEvent.keyDown(window, { key: "d" });

    expect(fetchMock).not.toHaveBeenCalledWith(
      "http://127.0.0.1:3000/game/move",
      expect.objectContaining({
        body: JSON.stringify({ direction: "east" }),
        method: "POST"
      })
    );
  });

  it("blocks movement shortcuts while a dialogue text input is focused", async () => {
    const fetchMock = mockFetchWithStates([villageState, dialogueTargets, emptyDialogue]);
    render(<GameShell csrfToken="csrf" />);

    fireEvent.click(await screen.findByRole("button", { name: "附近 NPC" }));
    fireEvent.click(await screen.findByRole("button", { name: /伯林/ }));
    const dialogueInput = await screen.findByLabelText("对 NPC 说");
    fireEvent.change(dialogueInput, { target: { value: "w" } });
    fireEvent.keyDown(dialogueInput, { key: "w" });

    expect(fetchMock).not.toHaveBeenCalledWith(
      "http://127.0.0.1:3000/game/move",
      expect.objectContaining({
        body: JSON.stringify({ direction: "north" }),
        method: "POST"
      })
    );
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

  it("renders recent world rumors in the main game feed", async () => {
    mockFetchWithStates([
      {
        ...villageState,
        rumors: [
          {
            id: "rumor-1",
            sourceType: "npc_event",
            sourceId: "event-1",
            audience: "public",
            message: "村里有人低声谈起：伯林的矿箱又见了底。",
            tags: ["ore_shortage"],
            generatedBy: "ai",
            createdAt: "2026-07-02T10:00:00.000Z",
            expiresAt: null
          }
        ]
      }
    ]);
    render(<GameShell csrfToken="csrf" />);

    expect(await screen.findByText("传闻")).toBeTruthy();
    expect(screen.getByText("村里有人低声谈起：伯林的矿箱又见了底。")).toBeTruthy();
  });

  it("renders the offline report returned by the first sync", async () => {
    mockFetchWithStates([
      emptySyncResponse({
        state: villageState,
        offlineReport: {
          generatedAt: "2026-07-02T10:00:00.000Z",
          since: "2026-07-02T08:00:00.000Z",
          until: "2026-07-02T10:00:00.000Z",
          status: "fallback",
          provider: "template",
          model: "template",
          fallbackReason: "budget_exhausted",
          title: "离线简报",
          summary: "Zichen离开期间，黑松哨站留下了1条可核验记录。",
          highlights: ["集市记录了基础铁矿石成交。"]
        }
      })
    ]);

    render(<GameShell csrfToken="csrf" />);

    expect(await screen.findByRole("heading", { name: "离线简报" })).toBeTruthy();
    expect(screen.getByText("Zichen离开期间，黑松哨站留下了1条可核验记录。")).toBeTruthy();
    expect(screen.getByText("集市记录了基础铁矿石成交。")).toBeTruthy();
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
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:3000/game/sync", expect.any(Object));
  });

  it("renders asset feedback from the sync event stream", async () => {
    mockFetchWithStates([
      {
        stateVersion: 3,
        state: forestState,
        events: [
          {
            id: 3,
            eventType: "item.grant",
            stateDirty: true,
            payload: { itemId: "wild_berry", quantity: 2, reason: "action.gathering.settle" },
            source: "item-service",
            createdAt: "2026-07-02T08:00:00.000Z"
          }
        ],
        nextCursor: 3
      }
    ]);

    render(<GameShell csrfToken="csrf" />);

    expect(await screen.findByLabelText("同步事件提示")).toBeTruthy();
    expect(screen.getByText("获得 wild_berry x2")).toBeTruthy();
  });

  it("renders lobby chat, presence, and leaderboard data from the sync payload", async () => {
    mockFetchWithStates([
      emptySyncResponse({
        state: villageState,
        nextCursor: 4,
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
        }
      })
    ]);

    render(<GameShell csrfToken="csrf" />);

    expect(await screen.findByRole("heading", { name: "大厅" })).toBeTruthy();
    expect(screen.getByText("矿洞有人吗？")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "在线 1" }));
    expect(screen.getByText("Zichen · 黑松哨站")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "排行" }));
    expect(screen.getByText("等级榜")).toBeTruthy();
    expect(screen.getByText("1. Zichen Lv.3")).toBeTruthy();
  });

  it("sends lobby chat and immediately refreshes the shared sync stream", async () => {
    const fetchMock = mockFetchWithStates([
      emptySyncResponse({ state: villageState, nextCursor: 4 }),
      emptySyncResponse({
        nextCursor: 5,
        chat: [
          {
            id: "chat-2",
            characterId: "character-1",
            characterName: "Zichen",
            channel: "lobby",
            body: "矿洞有人吗？",
            createdAt: "2026-07-03T08:00:05.000Z"
          }
        ]
      })
    ]);
    render(<GameShell csrfToken="csrf" />);

    const chatInput = await screen.findByLabelText("大厅发言");
    fireEvent.change(chatInput, { target: { value: "矿洞有人吗？" } });
    fireEvent.click(screen.getByRole("button", { name: "发送到大厅" }));

    expect(await screen.findByText("矿洞有人吗？")).toBeTruthy();
    expect(chatInput).toHaveProperty("value", "");
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:3000/game/chat",
        expect.objectContaining({
          body: JSON.stringify({ body: "矿洞有人吗？" }),
          method: "POST"
        })
      );
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/game/sync?cursor=4",
      expect.any(Object)
    );
  });

  it("blocks movement shortcuts while the lobby chat input is focused", async () => {
    const fetchMock = mockFetchWithStates([emptySyncResponse({ state: forestState })]);
    render(<GameShell csrfToken="csrf" />);

    expect(await screen.findByRole("heading", { name: "腐林" })).toBeTruthy();
    const chatInput = screen.getByLabelText("大厅发言");
    fireEvent.change(chatInput, { target: { value: "w" } });
    fireEvent.keyDown(chatInput, { key: "w" });

    expect(fetchMock).not.toHaveBeenCalledWith(
      "http://127.0.0.1:3000/game/move",
      expect.objectContaining({
        body: JSON.stringify({ direction: "north" }),
        method: "POST"
      })
    );
  });

  it("publishes presence heartbeat from the active character without another read poller", async () => {
    const fetchMock = mockFetchWithStates([emptySyncResponse({ state: villageState })]);
    render(<GameShell csrfToken="csrf" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:3000/game/presence/heartbeat",
        expect.objectContaining({
          body: JSON.stringify({}),
          method: "POST"
        })
      );
    });
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
    expect(screen.getByText("没有矿石，哨站的修理活会拖到深夜。")).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "武器 训练短剑 普通 耐久 60%" }));
    expect(screen.getByRole("dialog", { name: "训练短剑 装备详情" })).toBeTruthy();
    expect(screen.getByText("60/100")).toBeTruthy();
    expect(screen.getByText("金币 0 | 银币 0 | 铜币 50 + 基础铁矿石 x1")).toBeTruthy();

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

  it("opens backpack equipment compare and equips the selected instance", async () => {
    const backpackState: GameStateDto = {
      ...villageState,
      backpackEquipment: [
        {
          id: "instance-1",
          slot: "weapon",
          itemKey: "wolfbone_shiv",
          name: "狼骨短刃",
          rarity: "rare",
          itemLevel: 3,
          attackBonus: 4,
          defenseBonus: 0,
          agilityBonus: 1,
          maxHpBonus: 0,
          affixes: [{ affixId: "sharp", name: "锋利", stat: "attack", value: 1 }],
          maxDurability: 70,
          currentDurability: 70,
          durabilityPct: 100,
          effectiveStatRatio: 1,
          repairQuote: null
        }
      ]
    };
    const equippedState: GameStateDto = {
      ...backpackState,
      equipment: [backpackState.backpackEquipment[0]!],
      backpackEquipment: []
    };
    const fetchMock = mockFetchWithStates([backpackState, equippedState]);

    render(<GameShell csrfToken="csrf" />);

    fireEvent.click(await screen.findByRole("button", { name: /狼骨短刃/ }));
    expect(screen.getByRole("dialog", { name: "狼骨短刃 装备对比" })).toBeTruthy();
    expect(screen.getByText("综合属性差异：+3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "装备" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:3000/game/equipment/equip",
        expect.objectContaining({
          body: JSON.stringify({ instanceId: "instance-1" }),
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

    fireEvent.click(await screen.findByRole("button", { name: "武器 训练短剑 普通 耐久 60%" }));

    expect(screen.getByRole("button", { name: "修理 训练短剑" })).toHaveProperty(
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
    expect(screen.getByText(/本轮采集 25%/)).toBeTruthy();
    expect(screen.getByText(/已入账\s*4\/10/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消行动" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:3000/game/action/cancel",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("opens combat detail dialog", async () => {
    const activeCombatState: GameStateDto = {
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
    };
    const fetchMock = mockFetchWithStates([activeCombatState, forestState]);

    render(<GameShell csrfToken="csrf" />);

    expect(await screen.findByText("正在与腐化野狼群战斗")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看战斗" }));
    expect(screen.getByRole("dialog", { name: "战斗详情" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "撤离" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "战斗详情" })).toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/game/action/cancel",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("resets stale combat dialog when currentAction changes away from combat", async () => {
    const activeCombatState: GameStateDto = {
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
    };
    const activeGatheringState: GameStateDto = {
      ...forestState,
      currentAction: {
        id: "action-2",
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
    const fetchMock = mockFetchWithStates([activeCombatState, activeGatheringState]);

    render(<GameShell csrfToken="csrf" />);

    expect(await screen.findByText("正在与腐化野狼群战斗")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看战斗" }));
    expect(screen.getByRole("dialog", { name: "战斗详情" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "撤离" }));

    expect(await screen.findByText("正在采集野莓灌木")).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "战斗详情" })).toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/game/action/cancel",
      expect.objectContaining({ method: "POST" })
    );
  });
});
