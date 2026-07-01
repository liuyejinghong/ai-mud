import { expect, test } from "@playwright/test";

const createCharacterState = {
  character: null,
  locationTitle: "黑松哨站",
  locationDescription: "你尚未创建角色。",
  map: null,
  inventory: [],
  equipment: [],
  market: null,
  currentAction: null,
  availableActions: ["create_character"],
  log: []
};

const economySnapshot = {
  settlementId: "blackpine_outpost",
  settlementName: "黑松哨站市政集市",
  generatedAt: "2026-07-01T12:00:00.000Z",
  taxSummary: {
    transactionCount: 1,
    grossCopper: 18,
    taxCopper: 1,
    buyTaxCopper: 0,
    sellTaxCopper: 1,
    netCopper: 17
  },
  marketItems: [
    {
      itemId: "wild_berry",
      name: "野莓",
      category: "food",
      itemLevel: 1,
      stockQuantity: 12,
      targetQuantity: 20,
      baseBuyPrice: { gold: 0, silver: 0, copper: 6, totalCopper: 6 },
      baseSellPrice: { gold: 0, silver: 0, copper: 10, totalCopper: 10 }
    }
  ],
  recentTransactions: [
    {
      id: "tx-1",
      settlementId: "blackpine_outpost",
      characterId: "character-1",
      transactionType: "sell",
      itemId: "wild_berry",
      itemName: "野莓",
      quantity: 3,
      unitPrice: { gold: 0, silver: 0, copper: 6, totalCopper: 6 },
      gross: { gold: 0, silver: 0, copper: 18, totalCopper: 18 },
      tax: { gold: 0, silver: 0, copper: 1, totalCopper: 1 },
      net: { gold: 0, silver: 0, copper: 17, totalCopper: 17 },
      createdAt: "2026-07-01T12:00:00.000Z"
    }
  ]
};

test("renders closed-test auth without exposing admin invite management", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI MUD 内测登录" })).toBeVisible();
  await expect(page.getByLabel("邮箱")).toBeVisible();
  await expect(page.getByLabel("密码")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "激活码" })).toBeVisible();
  await expect(page.getByRole("button", { name: "注册并进入" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "激活码管理" })).toHaveCount(0);
});

test("renders economy visibility for admins", async ({ page }) => {
  await page.route("**/auth/me", async (route) => {
    await route.fulfill({
      json: {
        user: {
          id: "admin-1",
          email: "admin@example.com",
          role: "admin",
          status: "active"
        },
        csrfToken: "csrf"
      }
    });
  });
  await page.route("**/game/state", async (route) => route.fulfill({ json: createCharacterState }));
  await page.route("**/admin/economy", async (route) => route.fulfill({ json: economySnapshot }));

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "激活码管理" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "经济监控" })).toBeVisible();
  await expect(page.getByText("税收合计 1 铜")).toBeVisible();
});
