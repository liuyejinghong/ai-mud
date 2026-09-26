import { expect, test } from "@playwright/test";

// R1：默认注册已是 landing-1；本用例回归显式预置的 legacy 教程档（run-real-player-e2e 预置）。
const email = process.env.TUTORIAL_E2E_PLAYER_EMAIL;
const password = process.env.TUTORIAL_E2E_PLAYER_PASSWORD;

if (!email || !password) {
  throw new Error("The tutorial legacy E2E runner must provide preseeded player credentials.");
}

test("新玩家能看见下一步、实际开工并在同档刷新后保留回执", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await page.getByRole("tab", { name: "登录" }).click();
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录并进入基地" }).click();
  await expect(page.getByRole("dialog", { name: "新手引导" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "新手引导" })).toContainText("1200 credits");
  await page.screenshot({ path: testInfo.outputPath("01-intro-1200.png"), fullPage: true });
  await page.getByRole("button", { name: "开始指挥" }).click();

  const goal = page.getByRole("region", { name: "当前目标" });
  const action = goal.getByRole("button", { name: "前往建设位 A" });
  await expect(goal).toContainText("安装运抵的太阳能设施");
  await expect(action).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("02-goal-1200x701.png"), fullPage: true });

  await page.setViewportSize({ width: 720, height: 450 });
  await expect(goal).toBeInViewport();
  await expect(action).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("03-goal-720x450.png"), fullPage: true });

  await page.setViewportSize({ width: 1200, height: 701 });
  await page.evaluate(() => { document.documentElement.style.zoom = "200%"; });
  await expect(goal).toBeInViewport();
  await expect(action).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("04-goal-zoom200.png"), fullPage: true });
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });

  await action.click();
  await expect(page.getByRole("complementary", { name: "对象详情" })).toContainText("安装运抵的太阳能设施");
  await page.getByRole("button", { name: "在这里建设" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: /工程「安装运抵的太阳能设施」已创建/ })).toBeVisible();
  await expect(goal).toContainText("安装运抵的太阳能设施");
  await page.screenshot({ path: testInfo.outputPath("05-project-receipt.png"), fullPage: true });

  await page.reload();
  await expect(page.getByRole("dialog", { name: "新手引导" })).toHaveCount(0);
  await expect(goal).toContainText("安装运抵的太阳能设施");
  await expect(page.getByRole("region", { name: "项目清单" })).toContainText("安装运抵的太阳能设施");
  await page.screenshot({ path: testInfo.outputPath("06-same-save-refresh.png"), fullPage: true });
  expect(pageErrors).toEqual([]);
});
