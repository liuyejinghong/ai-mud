import { expect, test } from "@playwright/test";

test("renders closed-test auth without exposing admin invite management", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AI MUD 内测登录" })).toBeVisible();
  await expect(page.getByLabel("邮箱")).toBeVisible();
  await expect(page.getByLabel("密码")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "激活码" })).toBeVisible();
  await expect(page.getByRole("button", { name: "注册并进入" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "激活码管理" })).toHaveCount(0);
});
