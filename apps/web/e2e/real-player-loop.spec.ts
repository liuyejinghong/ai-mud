import { expect, test } from "@playwright/test";

const activationCode = process.env.REAL_E2E_ACTIVATION_CODE;
const email = process.env.REAL_E2E_PLAYER_EMAIL;
const password = process.env.REAL_E2E_PLAYER_PASSWORD;

if (!activationCode || !email || !password) {
  throw new Error("The real PostgreSQL E2E runner must provide player credentials.");
}

test("a new player can complete and retain the first real gathering loop", async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto("/");
  await page.getByRole("tab", { name: "注册" }).click();
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByLabel("确认密码").fill(password);
  await page.getByLabel("激活码").fill(activationCode);
  await page.getByRole("button", { name: "创建账号" }).click();
  await expect(page.getByRole("status")).toHaveText("注册成功，请使用邮箱和密码登录。");

  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "创建角色" })).toBeVisible();

  await page.getByLabel("角色名").fill("E2E游侠");
  await page.getByLabel("职业").selectOption("ranger");
  await page.getByRole("button", { name: "进入世界" }).click();
  await expect(page.getByRole("heading", { name: "黑松哨站" })).toBeVisible();

  await page.getByRole("button", { name: "前往腐林" }).click();
  await expect(page.getByRole("heading", { name: "腐林" })).toBeVisible();
  await page.getByRole("button", { name: "向北移动" }).click();
  await page.getByRole("button", { name: "向西移动" }).click();
  await expect(page.getByRole("button", { name: "开始采集" })).toBeVisible();

  await page.getByLabel("采集时长").selectOption("10");
  await page.getByRole("button", { name: "开始采集" }).click();
  await expect(page.getByRole("heading", { name: "当前行动" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "当前行动" })).toBeHidden({ timeout: 12_000 });
  await expect(page.getByRole("button", { name: "野莓 x6" })).toBeVisible();
  await expect(page.getByLabel("最近事件记录").getByText("你获得了野莓 x6。")).toBeVisible();
  await expect(page.getByLabel("同步事件提示")).toContainText("获得 野莓 x6");

  await page.getByLabel("大厅发言").fill("E2E 采集完成");
  await page.getByRole("button", { name: "发送到大厅" }).click();
  await expect(page.getByLabel("大厅聊天")).toContainText("E2E 采集完成");

  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByRole("heading", { name: "AI MUD 内测登录" })).toBeVisible();
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "腐林" })).toBeVisible();
  await expect(page.getByRole("button", { name: "野莓 x6" })).toBeVisible();
});
