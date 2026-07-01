import { expect, test } from "@playwright/test";

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
  await page.route("**/game/move", async (route) => route.fulfill({ json: forestState }));
  await page.route("**/game/gather", async (route) => route.fulfill({ json: activeGatheringState }));
  await page.route("**/game/action/cancel", async (route) => route.fulfill({ json: forestState }));
  await page.route("**/game/combat/start", async (route) => route.fulfill({ json: activeCombatState }));
  await page.route("**/game/return-village", async (route) => route.fulfill({ json: villageState }));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "黑松哨站" })).toBeVisible();

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
