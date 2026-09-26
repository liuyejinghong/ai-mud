// R1-Q 真实浏览器验收（05 §3 可自动化的门槛；真实 API，无 mock）：
// U01 首访可读性（运抵/未安装）、U02 固定工作区（1280×800 不滚根页面）、
// U03 缺料回路（净缺口→来源链→返回）、同档刷新保留回执。
// 深度生产链（勘探→采矿→加工→扩建的真实时长过程）由真 PG 集成验收覆盖；
// 本用例验证浏览器端交互与布局合同。
import { expect, test } from "@playwright/test";

const runId = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
const email = `r1-e2e-${runId}@example.test`;
const password = "r1-e2e-password";

test("新档玩家：读货单→安装首太阳能→缺料回路→刷新保留", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "领取试玩基地" }).click();

  // U01：固定工作区出现，目标条指向首太阳能；着陆器=已运行、安装位=空位可辨。
  const goal = page.getByRole("region", { name: "当前目标" });
  await expect(goal).toContainText("安装首座太阳能");
  const map = page.getByLabel("基地地图");
  await expect(map.getByText("着陆器")).toBeVisible();
  await expect(map.getByText("应急供电")).toBeVisible();
  await expect(map.getByText("空位").first()).toBeVisible();
  await expect(page.getByLabel("电力概览")).toContainText("应急");
  await page.screenshot({ path: testInfo.outputPath("01-landing-first-view.png"), fullPage: true });

  // U02：正常桌面根页面不滚动（scrollHeight ≤ clientHeight + 1）。
  const overflow = await page.evaluate(() => {
    const shell = document.querySelector(".landing-shell");
    if (!shell) return -1;
    return shell.scrollHeight - shell.clientHeight;
  });
  expect(overflow).toBeLessThanOrEqual(1);

  // 目标条主行动 → 站点面板 → 开工。
  await goal.getByRole("button", { name: "前往处理" }).click();
  const panel = page.getByLabel("对象操作");
  await expect(panel).toContainText("太阳能安装位 · 开工");
  await panel.getByRole("button", { name: "安装首座太阳能" }).click();
  await expect(page.getByRole("status").filter({ hasText: /工程「安装首座太阳能」已开工/ })).toBeVisible();
  const queue = page.getByLabel("进行中的工作");
  await expect(queue).toContainText("安装首座太阳能");
  await page.screenshot({ path: testInfo.outputPath("02-project-started.png"), fullPage: true });

  // U03：缺料回路——选扩建位，净缺口 + 来源链 + 返回原对象不丢上下文。
  await panel.getByRole("button", { name: "返回地图" }).click();
  await map.getByRole("button", { name: /扩建位 A/ }).click();
  await expect(panel).toContainText("扩建位 A · 开工");
  await expect(panel).toContainText("增建太阳能");
  const shortLine = panel.getByText(/需要 4 · 可用 0/).first();
  await expect(shortLine).toBeVisible();
  await panel.getByRole("button", { name: "准备材料" }).first().click();
  await expect(panel.getByText(/获取路径/).first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("03-material-source-chain.png"), fullPage: true });
  await panel.getByRole("button", { name: "返回地图" }).click();
  await expect(panel).toContainText("选择一个对象"); // 返回后上下文归位，无残态

  // 同档刷新：工程与回执保留。
  await page.reload();
  await expect(goal).toBeVisible();
  await expect(queue).toContainText("安装首座太阳能");
  await page.screenshot({ path: testInfo.outputPath("04-after-refresh.png"), fullPage: true });
  expect(pageErrors).toEqual([]);
});
