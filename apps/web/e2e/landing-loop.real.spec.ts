// R1 返工：U04/U05 真实浏览器全循环（正常 UI，无 SQL 赠料/改时钟；真实 API+隔离 PG）。
// 能源路线三圈：①安装自举→采矿→加工→维护→扩建 ②备件生产+维护 ③后续生产意图；
// 另含 U07 离开回访（暂停/刷新/无离线收益）与 U09 720×450/200% 缩放。
// 时钟为真 tick（runner 以 REAL_E2E_WORLD_TICK=true 启动服务端），倍率 ×4 由 UI 设置。
import { expect, test } from "@playwright/test";

const runId = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
const email = `r1-loop-${runId}@example.test`;
const password = "r1-loop-password";

const GOAL = "[aria-label='当前目标']";
const MAP = "[aria-label='基地地图']";
const PANEL = "[aria-label='对象操作']";
const QUEUE = "[aria-label='进行中的工作']";

// 长等待统一走轮询：每 3 秒强制窗口前台（无头长跑中 macOS 焦点会丢 → 心跳停 → 模拟冻结；
// 真实玩家窗口始终前台，此操作只是恢复等价前台事实，不改产品规则）。
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

async function goalSays(page: import("@playwright/test").Page, text: string) {
  await waitForText(page, page.locator(GOAL), text);
}

// 长时间运行中无头页可能失焦 → 心跳停止 → 控制租约过期；命令前确保持有控制权。
async function ensureControl(page: import("@playwright/test").Page) {
  await page.bringToFront();
  await page.evaluate(() => { window.focus(); }).catch(() => undefined);
  const takeOver = page.getByRole("button", { name: "接管", exact: true });
  if (await takeOver.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await takeOver.click();
    await expect(page.getByRole("button", { name: "接管", exact: true })).toHaveCount(0, { timeout: 30_000 });
  }
}

// 在指定配方块内下批数并下单（按块定位，避免全局 nth 漂移）。
async function orderRecipe(page: import("@playwright/test").Page, recipeName: string, batches: number) {
  const block = page.locator(".landing-build-option", { hasText: recipeName }).first();
  await expect(block).toBeVisible({ timeout: 30_000 });
  await ensureControl(page);
  await block.getByRole("spinbutton").fill(String(batches));
  await block.getByRole("button", { name: "下单", exact: true }).click();
}

test("U04+U05 全循环：安装→勘探采矿→加工维护→扩建→再投资；回访与缩放", async ({ page }, testInfo) => {
  test.setTimeout(42 * 60_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "领取试玩基地" }).click();
  await expect(page.locator(GOAL)).toContainText("安装首座太阳能");
  await page.screenshot({ path: testInfo.outputPath("00-first.png"), fullPage: true });

  // 恢复计时并 ×4（玩家时间政策）。
  await page.getByRole("button", { name: "恢复", exact: true }).click();
  await page.getByRole("button", { name: "×4" }).click();

  // 开工后等真实建成（地图卡片出现建成注记；设施效果事实到位才进行下一步）。
  const installAt = async (siteName: string, projectName: string, builtNote: string) => {
    await ensureControl(page);
    await page.locator(MAP).getByRole("button", { name: siteName }).click();
    await expect(page.locator(PANEL)).toContainText(projectName, { timeout: 20_000 });
    await page.locator(PANEL).getByRole("button", { name: projectName, exact: true }).click();
    await expect(page.locator(PANEL)).toContainText(/已开工|已创建|已提交/, { timeout: 20_000 });
    const siteCard = page.locator(MAP).getByRole("button", { name: siteName });
    await waitForText(page, siteCard, builtNote);
  };

  // 圈1a：首太阳能 → 仓储棚（顺带储能/充电区）。
  await page.locator(GOAL).getByRole("button", { name: "前往处理" }).click();
  await page.locator(PANEL).getByRole("button", { name: "安装首座太阳能", exact: true }).click();
  await goalSays(page, "安装仓储棚");
  await page.screenshot({ path: testInfo.outputPath("01-solar-built.png"), fullPage: true });

  await installAt("仓储棚安装位", "安装仓储棚", "矿石入库与加工前置");
  await installAt("储能间安装位", "安装储能间", "扩大储电容量");
  await installAt("充电区安装位", "安装充电区", "提高充电上限");
  await goalSays(page, "勘探");

  // 圈1b：勘探铁→采矿 4 批。
  await page.locator(GOAL).getByRole("button", { name: "前往处理" }).click();
  await expect(page.locator(PANEL)).toContainText("勘探");
  await ensureControl(page);
  await page.getByLabel("望山").selectOption({ index: 1 });
  await page.getByRole("button", { name: "开始勘探" }).click();
  await goalSays(page, "安排采矿运输");
  await page.screenshot({ path: testInfo.outputPath("02-surveyed.png"), fullPage: true });

  const checkboxes = page.getByRole("checkbox");
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await page.getByLabel("驮运").selectOption({ index: 1 });
  await ensureControl(page);
  await page.getByRole("button", { name: /下采矿单/ }).click();
  await waitForText(page, page.locator(QUEUE), "已送 0/4", 30_000);
  await goalSays(page, "安装加工间"); // 16 铁矿入仓
  await page.screenshot({ path: testInfo.outputPath("03-ore-delivered.png"), fullPage: true });

  // 圈1c：加工间 + 维护工位。
  await installAt("加工间安装位", "安装加工间", "冶炼与材料制造");
  await installAt("维护工位安装位", "安装维护工位", "维护加工槽");

  // 圈1d：冶炼 8 → 结构件 4（第 10 批停机 → 维护）→ 线缆（铜未采，能源路线先铁）。
  await page.locator(PANEL).getByRole("button", { name: "返回地图" }).click();
  await page.locator(PANEL).getByRole("button", { name: "加工间", exact: true }).click();
  await expect(page.locator(PANEL)).toContainText("冶炼铁料", { timeout: 30_000 });
  await orderRecipe(page, "冶炼铁料", 8);
  await waitForText(page, page.locator(QUEUE), "产出 0/8", 60_000);
  await orderRecipe(page, "加工结构件", 4);

  // 等维护窗口（第 10 批）：维护按钮出现在队列/加工面板。
  await waitForText(page, page.locator(QUEUE), "维护（1 备件）", 300_000);
  await page.screenshot({ path: testInfo.outputPath("04-maintenance-window.png"), fullPage: true });
  await ensureControl(page);
  await page.getByRole("button", { name: "维护（1 备件）" }).first().click();
  await expect(page.locator(PANEL)).toContainText("维护完成", { timeout: 20_000 });

  // 勘探铜 + 采 1 批 + 线缆 1。
  await page.locator(PANEL).getByRole("button", { name: "返回地图" }).click();
  await page.locator(MAP).getByRole("button", { name: /脊线蓝绿氧化带/ }).click();
  await ensureControl(page);
  await page.getByLabel("望山").selectOption({ index: 1 });
  await page.getByRole("button", { name: "开始勘探" }).click();
  await waitForText(page, page.locator(PANEL), "采矿运输", 120_000);
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await page.getByLabel("驮运").selectOption({ index: 1 });
  await page.getByRole("button", { name: /下采矿单/ }).click();
  await page.locator(PANEL).getByRole("button", { name: "返回地图" }).click();
  await page.locator(PANEL).getByRole("button", { name: "加工间", exact: true }).click();
  await waitForText(page, page.locator(PANEL), "制造线缆", 300_000); // 铜料就绪后配方可下
  await orderRecipe(page, "制造线缆", 1);

  // 圈1e：扩建（目标条第 6 步）。
  await goalSays(page, "扩建");
  await page.locator(GOAL).getByRole("button", { name: "前往处理" }).click();
  await expect(page.locator(PANEL)).toContainText("扩建位");
  await page.locator(PANEL).getByRole("button", { name: "增建太阳能", exact: true }).click();
  await expect(page.locator(PANEL)).toContainText(/已开工/, { timeout: 20_000 });
  await goalSays(page, "继续下一轮"); // 首扩建完成 → 再投资轮次
  await waitForText(page, page.getByLabel("电力概览"), "峰值 8.0 kW", 120_000);
  await page.screenshot({ path: testInfo.outputPath("05-expansion-done-8kW.png"), fullPage: true });

  // 圈2：备件生产 + 维护（采矿补充 → 制造备件）。
  await page.locator(MAP).getByRole("button", { name: /北坡磁异常/ }).click();
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await page.getByLabel("驮运").selectOption({ index: 1 });
  await page.getByRole("button", { name: /下采矿单/ }).click();
  await page.locator(PANEL).getByRole("button", { name: "返回地图" }).click();
  await page.locator(PANEL).getByRole("button", { name: "加工间", exact: true }).click();
  await orderRecipe(page, "制造备件", 1);
  await waitForText(page, page.locator(QUEUE), "制造备件", 120_000);

  // 圈3：后续生产意图（为下一处扩建继续冶炼）。
  await orderRecipe(page, "冶炼铁料", 4);
  await waitForText(page, page.locator(QUEUE), "冶炼铁料", 120_000);
  await page.screenshot({ path: testInfo.outputPath("06-rounds-2-3.png"), fullPage: true });

  // U07 离开回访：暂停 → 记录时间 → 刷新 → 时间/队列不变 → 恢复。
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const clockBefore = await page.locator(".landing-clock").innerText();
  await page.reload();
  await expect(page.locator(GOAL)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".landing-clock")).toHaveText(clockBefore, { timeout: 30_000 });
  await expect(page.locator(QUEUE)).toContainText("冶炼铁料");
  await ensureControl(page);
  await page.getByRole("button", { name: "恢复", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("07-revisit.png"), fullPage: true });

  // U09：720×450 与真实 200% 缩放下目标与主动作可见。
  await page.setViewportSize({ width: 720, height: 450 });
  await expect(page.locator(GOAL)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("08-720x450.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => { document.documentElement.style.zoom = "200%"; });
  await expect(page.locator(GOAL)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("09-zoom200.png"), fullPage: true });
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });

  expect(pageErrors).toEqual([]);
});
