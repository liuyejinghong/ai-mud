import { expect, test } from "@playwright/test";

const fedNeeds = {
  hunger: {
    current: 5,
    max: 5,
    status: "fed",
    nextMealAt: "2026-07-01T18:00:00.000Z"
  }
};

const almostFedNeeds = {
  hunger: {
    current: 4,
    max: 5,
    status: "fed",
    nextMealAt: "2026-07-01T18:00:00.000Z"
  }
};

const villageState = {
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
    needs: almostFedNeeds
  },
  locationTitle: "黑松哨站",
  locationDescription: "潮湿黑松围住木墙，哨塔上的火盆把灰雾照成暗红色。",
  map: null,
  inventory: [{ itemId: "wild_berry", name: "野莓", quantity: 2 }],
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
  currentAction: null,
  availableActions: ["enter_corrupt_forest", "open_market", "repair_equipment", "eat_food"],
  log: []
};

const eatenVillageState = {
  ...villageState,
  character: {
    ...villageState.character,
    needs: fedNeeds
  },
  inventory: [{ itemId: "wild_berry", name: "野莓", quantity: 1 }],
  availableActions: ["enter_corrupt_forest", "open_market", "repair_equipment"]
};

const repairedVillageState = {
  ...eatenVillageState,
  equipment: [
    {
      ...villageState.equipment[0],
      currentDurability: 100,
      durabilityPct: 100,
      repairQuote: null
    }
  ],
  availableActions: ["enter_corrupt_forest", "open_market"]
};

const marketState = {
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

const dialogueTargets = [
  {
    npcActorId: "npc-blacksmith",
    npcKey: "blackpine_blacksmith_borin",
    name: "伯林",
    profession: "blacksmith",
    currentLocation: "blackpine_outpost",
    statusLine: "正在盘点基础铁矿石库存。"
  }
];

const emptyDialogue = {
  target: dialogueTargets[0],
  messages: [],
  ai: {
    status: "fallback",
    provider: "template",
    model: "template",
    fallbackReason: null
  }
};

const repliedDialogue = {
  target: dialogueTargets[0],
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

const forestState = {
  ...villageState,
  character: {
    ...villageState.character,
    currentLocation: "corrupt_forest",
    position: { x: 2, y: 4 }
  },
  locationTitle: "腐林",
  locationDescription: "被诅咒的树根像黑色筋脉一样拱出湿土。",
  map: {
    zoneId: "corrupt_forest",
    width: 5,
    height: 5,
    cells: Array.from({ length: 25 }, (_, index) => ({
      x: index % 5,
      y: Math.floor(index / 5),
      markers:
        index === 22
          ? ["player", "exit"]
          : index === 18
            ? ["encounter"]
            : index === 1
              ? ["resource"]
              : ["ordinary"]
    }))
  },
  inventory: [{ itemId: "wild_berry", name: "野莓", quantity: 2 }],
  market: null,
  currentAction: null,
  availableActions: ["move", "start_gathering", "start_combat", "return_to_village"],
  log: [{ id: "event-1", message: "你踏入腐林。", createdAt: "2026-07-01T00:00:00.000Z" }]
};

const activeGatheringState = {
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

const activeCombatState = {
  ...forestState,
  currentAction: {
    id: "action-2",
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

test("player can use the first playable MUD screen", async ({ page }) => {
  await page.route("**/auth/me", async (route) => {
    await route.fulfill({
      json: {
        user: {
          id: "account-1",
          email: "player@example.com",
          role: "player",
          status: "active"
        },
        csrfToken: "csrf"
      }
    });
  });
  await page.route("**/game/state", async (route) => route.fulfill({ json: villageState }));
  await page.route("**/game/enter-zone", async (route) => route.fulfill({ json: forestState }));
  await page.route("**/game/market", async (route) => route.fulfill({ json: marketState }));
  await page.route("**/game/npcs/dialogue-targets", async (route) =>
    route.fulfill({ json: dialogueTargets })
  );
  await page.route("**/game/npcs/npc-blacksmith/dialogue", async (route) =>
    route.fulfill({
      json: route.request().method() === "POST" ? repliedDialogue : emptyDialogue
    })
  );
  await page.route("**/game/eat", async (route) => route.fulfill({ json: eatenVillageState }));
  await page.route("**/game/repair", async (route) => route.fulfill({ json: repairedVillageState }));
  await page.route("**/game/move", async (route) => route.fulfill({ json: forestState }));
  await page.route("**/game/gather", async (route) => route.fulfill({ json: activeGatheringState }));
  await page.route("**/game/action/cancel", async (route) => route.fulfill({ json: forestState }));
  await page.route("**/game/combat/start", async (route) => route.fulfill({ json: activeCombatState }));
  await page.route("**/game/return-village", async (route) => route.fulfill({ json: villageState }));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "黑松哨站" })).toBeVisible();
  await expect(page.getByText("金币 0 | 银币 12 | 铜币 35")).toBeVisible();
  await expect(page.getByText("饱腹 4/5")).toBeVisible();
  await page.getByRole("button", { name: "食用 野莓" }).click();
  await expect(page.getByText("饱腹 5/5")).toBeVisible();
  await expect(page.getByRole("heading", { name: "装备" })).toBeVisible();
  await expect(page.getByText("训练短剑", { exact: true })).toBeVisible();
  const trainingSword = page.getByRole("article").filter({ hasText: "训练短剑" });
  await expect(trainingSword.getByText("60/100")).toBeVisible();
  await page.getByRole("button", { name: "修理 训练短剑" }).click();
  await expect(trainingSword.getByText("100/100")).toBeVisible();
  await expect(trainingSword.getByText("无需修理")).toBeVisible();

  await page.getByRole("button", { name: "附近 NPC" }).click();
  await expect(page.getByRole("dialog", { name: "附近 NPC 对话" })).toBeVisible();
  await page.getByRole("button", { name: /伯林/ }).click();
  await expect(page.getByText("还没有交谈记录。")).toBeVisible();
  await page.getByLabel("对 NPC 说").fill("最近缺什么？");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("基础铁矿石快见底了。")).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).click();

  await page.getByRole("button", { name: "市政集市" }).click();
  await expect(page.getByRole("dialog", { name: "市政集市" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "基础铁矿石", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).click();

  await page.getByRole("button", { name: "前往腐林" }).click();
  await expect(page.getByRole("heading", { name: "腐林" })).toBeVisible();

  await page.keyboard.press("KeyW");
  await expect(page.getByRole("button", { name: "开始采集" })).toBeVisible();
  await page.getByRole("button", { name: "开始采集" }).click();
  await expect(page.getByRole("heading", { name: "当前行动" })).toBeVisible();
  await expect(page.getByText(/当前周期 25%/)).toBeVisible();
  await page.getByRole("button", { name: "取消行动" }).click();
  await page.getByRole("button", { name: "攻击野狼" }).click();
  await page.getByRole("button", { name: "查看战斗" }).click();
  await expect(page.getByRole("dialog", { name: "战斗详情" })).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).click();

  await page.getByRole("button", { name: "野莓 x2" }).click();
  await expect(page.getByRole("dialog", { name: "野莓" })).toBeVisible();
});
