// R1-Q 真实浏览器验收（05 §3 可自动化的门槛；真实 API，无 mock）：
// U01 首访可读性（运抵/未安装）、U02 固定工作区（1280×800 不滚根页面）、
// U03 缺料回路（净缺口→来源链→返回）、同档刷新保留回执。
// 深度生产链（勘探→采矿→加工→扩建的真实时长过程）由真 PG 集成验收覆盖；
// 本用例验证浏览器端交互与布局合同。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, test, type Locator } from "@playwright/test";

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

  // 窄屏选择目标后，操作区独占主区，主动作无需滚根页面。
  await page.setViewportSize({ width: 720, height: 450 });
  await goal.getByRole("button", { name: "前往处理" }).click();
  const panel = page.getByLabel("对象操作");
  await expect(panel).toContainText("太阳能安装位 · 开工");
  const install = panel.getByRole("button", { name: "安装首座太阳能", exact: true });
  await expect(install).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("01b-narrow-action.png"), fullPage: true });
  await install.click();
  await page.setViewportSize({ width: 1280, height: 800 });
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

test("U09 原生浏览器200%：首太阳能操作完整可见并真实提交", async ({}, testInfo) => {
  test.skip(process.env.REAL_E2E_HEADED !== "true", "原生浏览器缩放验收需 REAL_E2E_HEADED=true");
  test.setTimeout(180_000);

  const profileDir = await mkdtemp(join(tmpdir(), "ai-mud-u09-native-zoom-"));
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      channel: "chromium",
      viewport: { width: 1280, height: 800 }
    });
    const page = context.pages()[0] ?? await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const appUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_WEB_PORT ?? "5180"}/`;
    const zoomEmail = `r1-u09-${Date.now()}-${Math.floor(Math.random() * 10_000)}@example.test`;

    const saveScreenshot = async (name: string) => {
      const path = testInfo.outputPath(name);
      await page.screenshot({ path, fullPage: false });
      await testInfo.attach(name, { path, contentType: "image/png" });
    };
    const saveJson = async (name: string, data: unknown) => {
      const path = testInfo.outputPath(name);
      await writeFile(path, JSON.stringify(data, null, 2));
      await testInfo.attach(name, { path, contentType: "application/json" });
    };
    const viewportFacts = () => page.evaluate(() => {
      const root = document.documentElement;
      const shell = document.querySelector<HTMLElement>(".landing-shell");
      if (!shell) throw new Error("landing shell is missing");
      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        documentScrollWidth: root.scrollWidth,
        documentScrollHeight: root.scrollHeight,
        shellScrollWidth: shell.scrollWidth,
        shellScrollHeight: shell.scrollHeight
      };
    });
    const expectNoRootOverflow = (facts: Awaited<ReturnType<typeof viewportFacts>>) => {
      expect(facts.documentScrollWidth).toBeLessThanOrEqual(facts.innerWidth + 1);
      expect(facts.documentScrollHeight).toBeLessThanOrEqual(facts.innerHeight + 1);
      expect(facts.shellScrollWidth).toBeLessThanOrEqual(facts.innerWidth + 1);
      expect(facts.shellScrollHeight).toBeLessThanOrEqual(facts.innerHeight + 1);
    };
    const tabTo = async (locator: Locator, description: string) => {
      for (let presses = 1; presses <= 30; presses += 1) {
        await page.keyboard.press("Tab");
        if (await locator.evaluate((element) => element === document.activeElement)) return presses;
      }
      throw new Error(`Tab did not focus ${description} within 30 presses`);
    };

    await page.goto(appUrl);
    await page.getByLabel("邮箱").fill(zoomEmail);
    await page.getByLabel("密码").fill(password);
    await page.getByRole("button", { name: "领取试玩基地", exact: true }).click();
    const goal = page.getByRole("region", { name: "当前目标" });
    await expect(goal).toContainText("安装首座太阳能");
    const beforeZoom = await viewportFacts();
    await saveScreenshot("U09-before-native-zoom.png");

    const settingsPage = await context.newPage();
    await settingsPage.goto("chrome://settings/appearance");
    const zoomLevel = settingsPage.locator("#zoomLevel");
    await expect(zoomLevel).toHaveValue("1");
    await zoomLevel.selectOption({ label: "200%" });
    const zoomValue = await zoomLevel.inputValue();
    await expect(zoomLevel).toHaveValue("2");
    await settingsPage.close();

    await page.bringToFront();
    await page.reload();
    await expect(goal).toContainText("安装首座太阳能");
    const afterZoom = await viewportFacts();
    await saveScreenshot("U09-native-zoom-200-app.png");
    await saveJson("U09-native-zoom-measurements.json", {
      method: "chromium.launchPersistentContext + chrome://settings/appearance #zoomLevel",
      headless: false,
      channel: "chromium",
      settingsValue: zoomValue,
      before: beforeZoom,
      after: afterZoom,
      widthScale: beforeZoom.innerWidth / afterZoom.innerWidth,
      dprScale: afterZoom.devicePixelRatio / beforeZoom.devicePixelRatio
    });
    expect(zoomValue).toBe("2");
    expect(beforeZoom.innerWidth / afterZoom.innerWidth).toBeCloseTo(2, 5);
    expect(afterZoom.devicePixelRatio / beforeZoom.devicePixelRatio).toBeCloseTo(2, 5);
    expectNoRootOverflow(afterZoom);

    // If the lease expired while Chrome Settings was foregrounded, reclaim it through the visible UI.
    const takeover = page.getByRole("button", { name: "接管", exact: true });
    if (await takeover.isVisible().catch(() => false)) {
      await takeover.click();
      await expect(takeover).toHaveCount(0);
    }

    const goalAction = goal.getByRole("button", { name: "前往处理", exact: true });
    await expect(goalAction).toHaveCount(1);
    const goalTabPresses = await tabTo(goalAction, "the current goal action");
    await expect(goalAction).toBeFocused();
    const goalBounds = await goalAction.boundingBox();
    await saveJson("U09-goal-action-visibility.json", {
      viewport: afterZoom,
      tabPresses: goalTabPresses,
      goalBounds,
      goalSnapshot: await goal.ariaSnapshot()
    });
    await saveScreenshot("U09-native-zoom-goal-action.png");
    expect(goalBounds).not.toBeNull();
    await expect(goalAction).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Enter");

    const panel = page.getByLabel("对象操作");
    await expect(panel).toContainText("太阳能安装位 · 开工");
    const install = panel.getByRole("button", { name: "安装首座太阳能", exact: true });
    await expect(install).toHaveCount(1);
    await expect(install).toBeVisible();
    const installTabPresses = await tabTo(install, "the first-solar install action");
    await expect(install).toBeFocused();
    const installBounds = await install.boundingBox();
    const panelScrollTop = await panel.evaluate((element) => element.scrollTop);
    const atOperation = await viewportFacts();
    await saveJson("U09-install-action-visibility.json", {
      viewport: atOperation,
      tabPresses: installTabPresses,
      installBounds,
      panelScrollTop,
      operationSnapshot: await panel.ariaSnapshot()
    });
    await saveScreenshot("U09-native-zoom-install-action.png");
    expectNoRootOverflow(atOperation);
    expect(installBounds).not.toBeNull();
    await expect(install).toBeInViewport({ ratio: 1 });
    expect(panelScrollTop).toBe(0);

    const projectResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/base/projects" && response.request().method() === "POST"
    );
    await page.keyboard.press("Enter");
    const projectResponse = await projectResponsePromise;
    expect(projectResponse.ok()).toBe(true);
    const result = await projectResponse.json() as { projectId?: unknown };
    if (typeof result.projectId !== "string") throw new Error("POST /base/projects returned no projectId");
    const receipt = page.getByRole("status").filter({ hasText: /工程「安装首座太阳能」已开工/ });
    await expect(receipt).toBeVisible();
    const receiptText = await receipt.innerText();
    const queue = page.getByLabel("进行中的工作");
    await expect(queue).toContainText("安装首座太阳能");
    await saveScreenshot("U09-native-zoom-project-submitted.png");
    await saveJson("U09-native-zoom-project-submit.json", {
      status: "POST_ACCEPTED_AND_UI_ACKNOWLEDGED",
      projectId: result.projectId,
      responseStatus: projectResponse.status(),
      receiptText,
      queueText: await queue.innerText(),
      finalViewport: await viewportFacts()
    });

    const returnMap = panel.getByRole("button", { name: "返回地图", exact: true });
    const returnMapTabPresses = await tabTo(returnMap, "the return-to-map action");
    await expect(returnMap).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "场景", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("基地地图")).toBeVisible();
    await expect(panel).toBeHidden();
    await saveScreenshot("U09-native-zoom-returned-to-scene.png");
    await saveJson("U09-native-zoom-returned-to-scene.json", {
      returnMapTabPresses,
      sceneSelected: await page.getByRole("button", { name: "场景", exact: true }).getAttribute("aria-pressed"),
      mapVisible: await page.getByLabel("基地地图").isVisible(),
      panelVisible: await panel.isVisible(),
      viewport: await viewportFacts()
    });
    expect(pageErrors).toEqual([]);
  } finally {
    try {
      await context?.close();
    } finally {
      await rm(profileDir, { recursive: true, force: true });
    }
  }
});
