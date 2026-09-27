// R1 返工补充：U06 替代路线（先加工间，不走首太阳能）真实浏览器证据。
// 与 landing-loop（先能源路线，另一新档）对照：同货单同天气开局，本档全程应急 1 kW 供电，
// 24 铁矿 + 4 铜矿 → 6 结构件 + 2 线缆 → 增建加工间（第二加工槽）。
// 取舍记录：加工分摊 ~800 W（应急 1000 − 基础 200）对槽额 2 kW → ~0.4 批/分，
// 慢于能源路线（白天 ~1.9 批/分），但不依赖白天与首太阳能。里程碑墙钟/基地钟随证据输出。
import { expect, test } from "@playwright/test";

const runId = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
const email = `r1-alt-${runId}@example.test`;
const password = "r1-alt-password";

const GOAL = "[aria-label='当前目标']";
const MAP = "[aria-label='基地地图']";
const PANEL = "[aria-label='对象操作']";
const QUEUE = "[aria-label='进行中的工作']";

// 与 landing-loop 相同披露：无头长跑中 macOS 焦点丢失会停心跳冻结模拟；
// 钉 hasFocus 只恢复「窗口在前台」这一浏览器事实，产品规则全走真实路径。
async function waitForText(
  page: import("@playwright/test").Page,
  locator: import("@playwright/test").Locator,
  text: string,
  timeoutMs = 240_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.evaluate(() => { window.focus(); }).catch(() => undefined);
    if (await locator.textContent({ timeout: 5_000 }).then((v) => v?.includes(text) ?? false).catch(() => false)) {
      return;
    }
    await page.waitForTimeout(3_000);
  }
  throw new Error(`waitForText timed out: ${await locator.textContent().catch(() => "<null>")} 不含 "${text}"`);
}

async function ensureControl(page: import("@playwright/test").Page) {
  await page.bringToFront();
  await page.evaluate(() => { window.focus(); }).catch(() => undefined);
  const takeOver = page.getByRole("button", { name: "接管", exact: true });
  if (await takeOver.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await takeOver.click();
    await expect(page.getByRole("button", { name: "接管", exact: true })).toHaveCount(0, { timeout: 30_000 });
  }
}

async function orderRecipe(page: import("@playwright/test").Page, recipeName: string, batches: number) {
  const block = page.locator(".landing-build-option", { hasText: recipeName }).first();
  await expect(block).toBeVisible({ timeout: 30_000 });
  await ensureControl(page);
  await block.getByRole("spinbutton").fill(String(batches));
  await block.getByRole("button", { name: "下单", exact: true }).click();
}

// 等某配方全部产出；期间维护窗口（第 10/20 批）出现即点，恢复产出。
async function drainRecipe(
  page: import("@playwright/test").Page,
  recipeName: string,
  batches: number,
  timeoutMs = 900_000
) {
  const done = `产出 ${batches}/${batches}`;
  const deadline = Date.now() + timeoutMs;
  let maintenances = 0;
  while (Date.now() < deadline) {
    await page.evaluate(() => { window.focus(); }).catch(() => undefined);
    const queueText = await page.locator(QUEUE).textContent({ timeout: 5_000 }).catch(() => "");
    if (queueText?.includes(done)) return maintenances;
    const maintainButton = page.getByRole("button", { name: "维护（1 备件）" }).first();
    if (await maintainButton.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await ensureControl(page);
      await maintainButton.click();
      await expect(page.locator(PANEL)).toContainText("维护完成", { timeout: 20_000 });
      maintenances += 1;
      continue;
    }
    await page.waitForTimeout(5_000);
  }
  throw new Error(`drainRecipe 超时：${recipeName} 未达到 ${done}`);
}

test("U06 替代路线：先加工间（应急电）→采冶→自产材料增建第二加工间", async ({ page }, testInfo) => {
  test.setTimeout(50 * 60_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const milestones: Array<{ step: string; wallMs: number; simClock: string }> = [];
  const mark = async (step: string) => {
    milestones.push({
      step,
      wallMs: Date.now(),
      simClock: await page.locator(".landing-clock").innerText().catch(() => "<unknown>")
    });
  };

  await page.addInitScript(() => {
    Object.defineProperty(Document.prototype, "hasFocus", { value: () => true });
  });

  const startedAt = Date.now();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "领取试玩基地" }).click();
  await expect(page.locator(GOAL)).toContainText("安装首座太阳能"); // 教程仍指能源路线；本档刻意偏离
  await page.screenshot({ path: testInfo.outputPath("00-alt-start.png"), fullPage: true });
  await mark("注册完成");

  await page.getByRole("button", { name: "恢复", exact: true }).click();
  await page.getByRole("button", { name: "×4" }).click();

  const installAt = async (siteName: string, projectName: string, builtNote: string) => {
    await ensureControl(page);
    await page.locator(MAP).getByRole("button", { name: siteName }).click();
    await expect(page.locator(PANEL)).toContainText(projectName, { timeout: 20_000 });
    await page.locator(PANEL).getByRole("button", { name: projectName, exact: true }).click();
    await expect(page.locator(PANEL)).toContainText(/已开工|已创建|已提交/, { timeout: 20_000 });
    const siteCard = page.locator(MAP).getByRole("button", { name: siteName });
    await waitForText(page, siteCard, builtNote);
  };

  // 偏离教程：不装太阳能，先仓储棚 → 加工间 → 维护工位（套件安装，仅需仓储前置）。
  await installAt("仓储棚安装位", "安装仓储棚", "矿石入库与加工前置");
  await installAt("加工间安装位", "安装加工间", "冶炼与材料制造");
  await installAt("维护工位安装位", "安装维护工位", "维护加工槽");
  await mark("三套件安装完成（无太阳能）");
  await page.screenshot({ path: testInfo.outputPath("01-kits-installed-no-solar.png"), fullPage: true });

  // 全程应急供电的对照事实：太阳能 0，应急 1 kW。
  await expect(page.getByLabel("电力概览")).toContainText("太阳能 0 kW");
  await expect(page.getByLabel("电力概览")).toContainText("应急 1 kW");

  // 勘探铁矿 → 采 6 批（24 矿）。
  await page.locator(MAP).getByRole("button", { name: /北坡磁异常/ }).click();
  await waitForText(page, page.locator(PANEL), "勘探", 60_000);
  await ensureControl(page);
  await page.getByLabel("望山").selectOption({ index: 1 });
  await page.getByRole("button", { name: "开始勘探" }).click();
  await waitForText(page, page.locator(PANEL), "采矿运输", 300_000);
  const checkboxes = page.getByRole("checkbox");
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await page.getByLabel("驮运").selectOption({ index: 1 });
  await ensureControl(page);
  await page.getByRole("button", { name: /下采矿单/ }).click();
  await waitForText(page, page.locator(QUEUE), "已送 6/6", 400_000);
  await mark("铁 24 矿入仓");

  // 勘探铜矿 → 采 1 批（4 矿）。
  await page.locator(PANEL).getByRole("button", { name: "返回地图" }).click();
  await page.locator(MAP).getByRole("button", { name: /铜矿|脊线蓝绿氧化带/ }).click();
  await ensureControl(page);
  await page.getByLabel("望山").selectOption({ index: 1 });
  await page.getByRole("button", { name: "开始勘探" }).click();
  await waitForText(page, page.locator(PANEL), "采矿运输", 300_000);
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await page.getByLabel("驮运").selectOption({ index: 1 });
  await page.getByRole("button", { name: /下采矿单/ }).click();
  await waitForText(page, page.locator(QUEUE), "已送 1/1", 300_000);
  await mark("铜 4 矿入仓");

  // 加工（应急电 ~0.4 批/分；21 批两次维护）：铁 12 → 铜 2 → 结构件 6 → 线缆 1。
  await page.locator(PANEL).getByRole("button", { name: "返回地图" }).click();
  await page.locator(PANEL).getByRole("button", { name: "加工间", exact: true }).click();
  await waitForText(page, page.locator(PANEL), "冶炼铁料", 120_000);
  await orderRecipe(page, "冶炼铁料", 12);
  const maintenances1 = await drainRecipe(page, "冶炼铁料", 12);
  await mark("铁料 12 完成");
  await orderRecipe(page, "冶炼铜料", 2);
  await drainRecipe(page, "冶炼铜料", 2);
  await orderRecipe(page, "加工结构件", 6);
  const maintenances2 = await drainRecipe(page, "加工结构件", 6);
  await orderRecipe(page, "制造线缆", 1);
  await drainRecipe(page, "制造线缆", 1);
  expect(maintenances1 + maintenances2).toBe(2); // 21 批 = 两次维护（与账本一致）
  await mark("自产材料齐备（6 结构件 + 2 线缆）");
  await page.screenshot({ path: testInfo.outputPath("02-materials-ready.png"), fullPage: true });

  // 增建加工间（扩建位 A；controller 用随船库存）。
  await page.locator(PANEL).getByRole("button", { name: "返回地图" }).click();
  await page.locator(MAP).getByRole("button", { name: "扩建位 A" }).click();
  await expect(page.locator(PANEL)).toContainText("增建加工间");
  await ensureControl(page);
  await page.locator(PANEL).getByRole("button", { name: "增建加工间", exact: true }).click();
  await expect(page.locator(PANEL)).toContainText(/已开工/, { timeout: 20_000 });
  await waitForText(page, page.locator(MAP).getByRole("button", { name: "扩建位 A" }), "冶炼与材料制造", 300_000);
  await mark("第二加工间建成");

  // 路线终态：电力概览仍是太阳能 0/应急 1 kW；地图出现第二座加工间。
  await expect(page.getByLabel("电力概览")).toContainText("太阳能 0 kW");
  await page.screenshot({ path: testInfo.outputPath("03-second-processing-built.png"), fullPage: true });

  await testInfo.attach("route-summary", {
    body: JSON.stringify({ email, startedAt, milestones, maintenances: maintenances1 + maintenances2 }, null, 2),
    contentType: "application/json"
  });
  expect(pageErrors).toEqual([]);
});
