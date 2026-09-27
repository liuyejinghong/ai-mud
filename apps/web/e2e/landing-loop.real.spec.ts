// 三圈都要有真实产出和用途：先建太阳能扩建，再用自产备件恢复停机加工槽，最后建加工扩建。
// 所有写操作都经真实 UI；GET 快照只读核对精确工单、库存和设施终态。
// U07 只在浏览器确实失焦后等待20分钟；U09只在真实浏览器缩放可测时记录200%。
import { expect, test } from "@playwright/test";
import {
  checkpoint,
  clickForId,
  finishManufacturingJob,
  maintainProcessingSlot,
  quantity,
  readSnapshot,
  readSnapshotFromPublicGet,
  resetBrowserZoom,
  setBrowserZoom200,
  waitForSnapshot
} from "./landing-browser-helpers.js";

const runId = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
const email = `r1-loop-${runId}@example.test`;
const password = "r1-loop-password";

const GOAL = "[aria-label='当前目标']";
const MAP = "[aria-label='基地地图']";
const PANEL = "[aria-label='对象操作']";

async function ensureControl(page: import("@playwright/test").Page) {
  await page.bringToFront();
  const takeOver = page.getByRole("button", { name: "接管", exact: true });
  if (await takeOver.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await takeOver.click();
    await expect(page.getByRole("button", { name: "接管", exact: true })).toHaveCount(0, { timeout: 30_000 });
  }
}

// 在指定配方块内下批数并下单（按块定位，避免全局 nth 漂移）。
async function orderRecipe(page: import("@playwright/test").Page, recipeName: string, batches: number) {
  const block = page.locator(".landing-build-option").filter({ has: page.getByText(recipeName, { exact: true }) });
  await expect(block).toHaveCount(1);
  await expect(block).toBeVisible({ timeout: 30_000 });
  await ensureControl(page);
  await block.getByRole("spinbutton").fill(String(batches));
  const button = block.getByRole("button", { name: "下单", exact: true });
  await expect(button).toHaveCount(1);
  return clickForId(page, "/base/manufacturing", "jobId", () => button.click());
}

async function startProjectAt(page: import("@playwright/test").Page, siteName: string, projectName: string) {
  const site = page.locator(MAP).getByRole("button", { name: siteName });
  await expect(site).toHaveCount(1);
  await ensureControl(page);
  await site.click();
  const action = page.locator(PANEL).getByRole("button", { name: projectName, exact: true });
  await expect(action).toHaveCount(1);
  return clickForId(page, "/base/projects", "projectId", () => action.click());
}

async function installAt(
  page: import("@playwright/test").Page,
  siteName: string,
  projectName: string,
  stableId: string,
  builtNote: string
) {
  const projectId = await startProjectAt(page, siteName, projectName);
  const snapshot = await waitForSnapshot(page, (current) =>
    current.projects.some((project) => project.projectId === projectId && project.status === "completed")
  , `${projectName} did not complete`);
  const project = snapshot.projects.find((item) => item.projectId === projectId);
  expect(project?.definitionRef.stableId).toBe(stableId);
  expect(snapshot.sites.find((site) => site.siteId === project?.siteId)?.state).toBe("built");
  await expect(page.locator(MAP).getByRole("button", { name: siteName })).toContainText(builtNote);
  return snapshot;
}

async function surveyNode(page: import("@playwright/test").Page, nodeName: string): Promise<void> {
  const snapshot = await readSnapshot(page);
  const node = snapshot.resourceNodes?.find((candidate) => candidate.name.includes(nodeName));
  if (!node) throw new Error(`resource node not found: ${nodeName}`);
  if (node.discovered) return;
  const surveyor = snapshot.devices.find((device) =>
    device.groupId === "survey" && !device.currentAssignment && !device.currentExtractionJobId && device.batteryWh >= 2
  );
  if (!surveyor) throw new Error(`no available surveyor for ${nodeName}`);
  const card = page.locator(MAP).getByRole("button", { name: nodeName });
  await expect(card).toHaveCount(1);
  await ensureControl(page);
  await card.click();
  await page.getByLabel("望山").selectOption(surveyor.operatorId);
  const surveyButton = page.locator(PANEL).getByRole("button", { name: "开始勘探", exact: true });
  const jobId = await clickForId(page, `/base/resource-nodes/${node.nodeId}/survey`, "jobId", () => surveyButton.click());
  await waitForSnapshot(page, (current) =>
    current.extractionJobs?.some((job) => job.jobId === jobId && job.status === "completed") === true &&
    current.resourceNodes?.some((candidate) => candidate.nodeId === node.nodeId && candidate.discovered) === true
  , `${nodeName} survey did not complete`);
}

async function startMining(
  page: import("@playwright/test").Page,
  nodeName: string,
  batches: number,
  haulerOperatorId?: string
): Promise<{ jobId: string; itemId: string; before: number }> {
  const snapshot = await readSnapshot(page);
  const node = snapshot.resourceNodes?.find((candidate) => candidate.name.includes(nodeName));
  if (!node?.discovered || !node.itemId) throw new Error(`resource node is not discovered: ${nodeName}`);
  const builders = snapshot.devices.filter((device) => device.groupId === "engineering");
  const builderIndex = builders.findIndex((device) =>
    !device.currentAssignment && !device.currentExtractionJobId && device.batteryWh >= 6
  );
  if (builderIndex < 0) throw new Error(`no available builder for ${nodeName}`);
  const haulers = snapshot.devices.filter((device) => device.groupId === "transport");
  const hauler = haulers.find((device) =>
    device.operatorId === haulerOperatorId &&
    !device.currentAssignment && !device.currentExtractionJobId && device.batteryWh >= 3
  ) ?? (!haulerOperatorId ? haulers.find((device) =>
    !device.currentAssignment && !device.currentExtractionJobId && device.batteryWh >= 3
  ) : undefined);
  if (!hauler) throw new Error(`no available hauler for ${nodeName}`);

  const card = page.locator(MAP).getByRole("button", { name: nodeName });
  await expect(card).toHaveCount(1);
  await ensureControl(page);
  await card.click();
  await expect(page.locator(PANEL)).toContainText("采矿运输");
  const builderChecks = page.locator(PANEL).getByRole("checkbox");
  await expect(builderChecks).toHaveCount(builders.length);
  await builderChecks.nth(builderIndex).check();
  await page.getByLabel("驮运").selectOption(hauler.operatorId);
  await page.getByLabel(/批数/).fill(String(batches));
  const submit = page.locator(PANEL).getByRole("button", { name: /^下采矿单/ });
  await expect(submit).toHaveCount(1);
  const before = quantity(snapshot, node.itemId);
  const jobId = await clickForId(page, "/base/extraction-jobs", "jobId", () => submit.click());
  return { jobId, itemId: node.itemId, before };
}

async function finishMining(
  page: import("@playwright/test").Page,
  mining: { jobId: string; itemId: string; before: number },
  batches: number
) {
  const snapshot = await waitForSnapshot(page, (current) =>
    current.extractionJobs?.some((job) =>
      job.jobId === mining.jobId && job.status === "completed" && job.batchesDelivered === batches
    ) === true
  , `mining job ${mining.jobId} did not deliver ${batches} batches`);
  expect(quantity(snapshot, mining.itemId)).toBe(mining.before + batches * 4);
  return snapshot;
}

async function openProcessing(page: import("@playwright/test").Page) {
  const back = page.locator(PANEL).getByRole("button", { name: "返回地图", exact: true });
  await expect(back).toHaveCount(1);
  await back.click();
  const processing = page.locator(PANEL).getByRole("button", { name: "加工间", exact: true });
  await expect(processing).toHaveCount(1);
  await processing.click();
}

test("U04+U05 三圈经营：扩建太阳能→自产备件维护→扩建加工间；附 U07/U09 证据", async ({ page }, testInfo) => {
  test.setTimeout(120 * 60_000);
  const startedAt = Date.now();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "领取试玩基地" }).click();
  await expect(page.locator(GOAL)).toContainText("安装首座太阳能");
  await page.screenshot({ path: testInfo.outputPath("00-first.png"), fullPage: true });
  const initial = await readSnapshot(page);
  expect(initial.weather.current).toBe("clear");
  expect(quantity(initial, "iron_ore")).toBe(0);
  expect(quantity(initial, "copper_ore")).toBe(0);
  expect(quantity(initial, "structural_frame")).toBe(0);
  expect(quantity(initial, "wire_cable")).toBe(0);
  const routeOrigin = {
    baseId: initial.baseId,
    contentRelease: initial.activeContentRelease,
    weather: initial.weather,
    resources: initial.resources.map(({ itemId, quantity, reservedQuantity }) => ({ itemId, quantity, reservedQuantity }))
      .sort((left, right) => left.itemId.localeCompare(right.itemId))
  };
  const processingSiteId = initial.sites.find((site) => site.siteKey === "install_processing")?.siteId;
  if (!processingSiteId) throw new Error("initial processing site missing from public snapshot");

  // 恢复计时并 ×4（玩家时间政策）。
  await page.getByLabel("基地时间").getByRole("button", { name: "恢复", exact: true }).click();
  await page.getByLabel("基地时间").getByRole("button", { name: "×4", exact: true }).click();

  // 720×450 下实际点目标主动作并建成首太阳能。
  await page.setViewportSize({ width: 720, height: 450 });
  const solarGoal = page.locator(GOAL).getByRole("button", { name: "前往处理", exact: true });
  await expect(solarGoal).toHaveCount(1);
  await expect(solarGoal).toBeInViewport();
  await solarGoal.click();
  const solarAction = page.locator(PANEL).getByRole("button", { name: "安装首座太阳能", exact: true });
  await expect(solarAction).toHaveCount(1);
  await expect(solarAction).toBeInViewport();
  const solarId = await clickForId(page, "/base/projects", "projectId", () => solarAction.click());
  let snapshot = await waitForSnapshot(page, (current) =>
    current.projects.some((project) => project.projectId === solarId && project.status === "completed")
  , "first solar installation did not complete");
  const solarProject = snapshot.projects.find((project) => project.projectId === solarId);
  expect(solarProject?.definitionRef.stableId).toBe("landing-install-solar");
  expect(snapshot.sites.find((site) => site.siteId === solarProject?.siteId)?.state).toBe("built");
  expect(snapshot.power.generationWPeak).toBe(4000);
  await checkpoint(page, testInfo, "01-first-solar-720");

  // 720×450 的库存面板必须局部滚动，不能把列表裁在视口外。
  await page.locator(PANEL).getByRole("button", { name: "返回地图", exact: true }).click();
  const panel = page.locator(PANEL);
  const scrollable = await panel.evaluate((element) => element.scrollHeight > element.clientHeight);
  expect(scrollable).toBe(true);
  const rootScrollBefore = await page.evaluate(() => window.scrollY);
  const lastInventoryItem = panel.getByRole("button", { name: "备件 可用 6", exact: true });
  await expect(lastInventoryItem).toHaveCount(1);
  await lastInventoryItem.scrollIntoViewIfNeeded();
  expect(await panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(rootScrollBefore);
  await expect(lastInventoryItem).toBeInViewport();
  await checkpoint(page, testInfo, "02-720-local-scroll");

  // 浏览器快捷键能实测到 200% 才把 U09 记为已测；不以 CSS zoom 代替。
  await page.setViewportSize({ width: 1280, height: 800 });
  const zoom = await setBrowserZoom200(page);
  if (zoom.supported) {
    try {
      const warehouseGoal = page.locator(GOAL).getByRole("button", { name: "前往处理", exact: true });
      await expect(warehouseGoal).toBeInViewport();
      await warehouseGoal.click();
      const warehouseAction = page.locator(PANEL).getByRole("button", { name: "安装仓储棚", exact: true });
      await expect(warehouseAction).toHaveCount(1);
      await expect(warehouseAction).toBeInViewport();
      const warehouseId = await clickForId(page, "/base/projects", "projectId", () => warehouseAction.click());
      snapshot = await waitForSnapshot(page, (current) =>
        current.projects.some((project) => project.projectId === warehouseId && project.status === "completed")
      , "warehouse installation did not complete at browser zoom 200%");
      await checkpoint(page, testInfo, "03-real-browser-zoom-200");
    } finally {
      await resetBrowserZoom(page);
    }
    await testInfo.attach("U09-real-browser-zoom", {
      body: JSON.stringify({ status: "MEASURED_200_PERCENT", ...zoom }),
      contentType: "application/json"
    });
  } else {
    await testInfo.attach("U09-real-browser-zoom", {
      body: JSON.stringify({ status: "NOT_RUN", reason: "browser zoom shortcut did not produce a measured 2x viewport and DPR", ...zoom }),
      contentType: "application/json"
    });
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  snapshot = await readSnapshot(page);
  if (snapshot.sites.find((site) => site.siteKey === "install_warehouse")?.state !== "built") {
    snapshot = await installAt(page, "仓储棚安装位", "安装仓储棚", "landing-install-warehouse", "矿石入库与加工前置");
    await checkpoint(page, testInfo, "04-bootstrap-warehouse-complete");
  }
  await installAt(page, "储能间安装位", "安装储能间", "landing-install-storage", "扩大储电容量");
  await checkpoint(page, testInfo, "05-bootstrap-storage-complete");
  await installAt(page, "充电区安装位", "安装充电区", "landing-install-charging", "提高充电上限");
  await checkpoint(page, testInfo, "06-bootstrap-charging-complete");
  await installAt(page, "加工间安装位", "安装加工间", "landing-install-processing", "冶炼与材料制造");
  await checkpoint(page, testInfo, "07-bootstrap-processing-complete");
  await installAt(page, "维护工位安装位", "安装维护工位", "landing-install-maintenance", "维护加工槽");
  snapshot = await checkpoint(page, testInfo, "08-bootstrap-maintenance-complete");
  expect(snapshot.capabilities).toContain("warehouse");
  expect(snapshot.capabilities).toContain("processing");

  // 圈1：铁矿16→铁料8→结构件4；维护必须真实消耗随船备件。
  await surveyNode(page, "北坡磁异常");
  const ironMine = await startMining(page, "北坡磁异常", 4);
  snapshot = await finishMining(page, ironMine, 4);
  expect(quantity(snapshot, "iron_ore")).toBe(16);
  await checkpoint(page, testInfo, "09-iron-delivered");
  await openProcessing(page);
  const ironJob = await orderRecipe(page, "冶炼铁料", 8);
  await finishManufacturingJob(page, ironJob);
  expect(quantity(await readSnapshot(page), "iron_ingot")).toBe(8);
  const frameJob = await orderRecipe(page, "加工结构件", 4);
  expect(await finishManufacturingJob(page, frameJob)).toBe(1);
  snapshot = await readSnapshot(page);
  expect(quantity(snapshot, "structural_frame")).toBe(4);
  expect(snapshot.productionSlots?.find((slot) => slot.siteId === processingSiteId)?.batchesSinceMaintenance).toBe(2);
  expect(quantity(snapshot, "spare_part")).toBe(5);
  await checkpoint(page, testInfo, "10-self-made-frames-and-first-maintenance");

  // 铜矿→铜料→线缆，所有产出绑定到精确工单并回读仓库事实。
  await surveyNode(page, "脊线蓝绿氧化带");
  const copperMine = await startMining(page, "脊线蓝绿氧化带", 1);
  snapshot = await finishMining(page, copperMine, 1);
  expect(quantity(snapshot, "copper_ore")).toBe(4);
  await checkpoint(page, testInfo, "11-copper-delivered");
  await openProcessing(page);
  const copperJob = await orderRecipe(page, "冶炼铜料", 2);
  await finishManufacturingJob(page, copperJob);
  snapshot = await readSnapshot(page);
  expect(quantity(snapshot, "copper_ingot")).toBe(2);
  const cableJob = await orderRecipe(page, "制造线缆", 1);
  await finishManufacturingJob(page, cableJob);
  snapshot = await readSnapshot(page);
  expect(quantity(snapshot, "structural_frame")).toBe(4);
  expect(quantity(snapshot, "wire_cable")).toBe(2);
  expect(quantity(snapshot, "copper_ingot")).toBe(1);
  await checkpoint(page, testInfo, "12-self-made-cable-ready");

  // 圈1只有在确切扩建工单完成、站点建成且发电能力增加后才通过。
  const solarExpansionId = await startProjectAt(page, "扩建位 A", "增建太阳能");
  snapshot = await waitForSnapshot(page, (current) =>
    current.projects.some((project) => project.projectId === solarExpansionId && project.status === "completed")
  , "solar expansion did not complete");
  const solarExpansion = snapshot.projects.find((project) => project.projectId === solarExpansionId);
  expect(solarExpansion?.definitionRef.stableId).toBe("landing-expand-solar");
  expect(snapshot.sites.find((site) => site.siteId === solarExpansion?.siteId)?.state).toBe("built");
  expect(snapshot.power.generationWPeak).toBe(8000);
  expect(quantity(snapshot, "structural_frame")).toBe(0);
  expect(quantity(snapshot, "wire_cable")).toBe(0);
  await checkpoint(page, testInfo, "13-circle-1-solar-expansion-complete");

  // U07: a real visible tab change releases normal foreground control; do not pause or reload.
  // Keep an exact mining job in progress so its reservation, queue, inventory and save can be compared.
  await page.getByLabel("基地时间").getByRole("button", { name: "×1", exact: true }).click();
  const circle2Mine = await startMining(page, "北坡磁异常", 3);
  snapshot = await waitForSnapshot(page, (current) => current.extractionJobs?.some((job) =>
    job.jobId === circle2Mine.jobId && job.status === "active" && job.phase === "hauling" &&
    job.batchesExtracted > job.batchesDelivered
  ) === true, "circle 2 mining job never held an in-transit batch", 600_000);
  expect(snapshot.extractionJobs?.find((job) => job.jobId === circle2Mine.jobId)?.batchesExtracted).toBeGreaterThan(
    snapshot.extractionJobs?.find((job) => job.jobId === circle2Mine.jobId)?.batchesDelivered ?? 0
  );
  await testInfo.attach("10-circle-2-mining-in-transit.json", {
    body: JSON.stringify(snapshot, null, 2),
    contentType: "application/json"
  });
  await testInfo.attach("10-circle-2-mining-in-transit.png", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png"
  });
  const goalBeforeLeave = await page.locator(GOAL).innerText();
  const urlBeforeLeave = page.url();
  const away = await page.context().newPage();
  await away.goto("about:blank");
  await away.bringToFront();
  const lostFocus = await page.waitForFunction(
    () => document.visibilityState === "hidden" && !document.hasFocus(),
    undefined,
    { polling: 100, timeout: 10_000 }
  ).then(() => true).catch(() => false);
  if (!lostFocus) {
    await testInfo.attach("U07-real-revisit", {
      body: JSON.stringify({ status: "NOT_RUN", reason: "browser did not expose a hidden and unfocused original tab after switching to a blank tab" }),
      contentType: "application/json"
    });
    await away.close();
    await page.bringToFront();
  } else {
    const readAwaySnapshot = async () => readSnapshotFromPublicGet(page);
    const pauseDeadline = Date.now() + 20_000;
    let beforeAway = await readAwaySnapshot();
    while (beforeAway.timeMode !== "paused" && Date.now() < pauseDeadline) {
      await page.waitForTimeout(1_000);
      beforeAway = await readAwaySnapshot();
    }
    expect(beforeAway.baseId).toBe(initial.baseId);
    expect(beforeAway.timeMode).toBe("paused");
    const awayMine = beforeAway.extractionJobs?.find((job) => job.jobId === circle2Mine.jobId);
    expect(awayMine?.status).toBe("active");
    expect(awayMine?.phase).toBe("hauling");
    expect(awayMine?.batchesExtracted).toBeGreaterThan(awayMine?.batchesDelivered ?? 0);
    const goalAtLeave = goalBeforeLeave;
    const revisitFacts = (current: typeof beforeAway) => ({
      baseId: current.baseId,
      simTime: current.simTime,
      timeMode: current.timeMode,
      resources: current.resources.map(({ itemId, quantity, reservedQuantity }) => ({ itemId, quantity, reservedQuantity }))
        .sort((left, right) => left.itemId.localeCompare(right.itemId)),
      projects: current.projects.map(({ projectId, status }) => ({ projectId, status }))
        .sort((left, right) => left.projectId.localeCompare(right.projectId)),
      manufacturingJobs: current.manufacturingJobs.map(({ jobId, status, outputsDone, outputsPlanned }) => ({
        jobId, status, outputsDone, outputsPlanned
      })).sort((left, right) => left.jobId.localeCompare(right.jobId)),
      extractionJobs: current.extractionJobs?.map(({ jobId, status, batchesExtracted, batchesDelivered, phase, phaseWorkDone }) => ({
        jobId, status, batchesExtracted, batchesDelivered, phase, phaseWorkDone
      })).sort((left, right) => left.jobId.localeCompare(right.jobId)) ?? []
    });
    const awayBaseline = revisitFacts(beforeAway);
    await testInfo.attach("U07-real-revisit-start", {
      body: JSON.stringify({ status: "WAITING", minutes: 20, baseline: awayBaseline }, null, 2),
      contentType: "application/json"
    });
    await away.waitForTimeout(20 * 60_000 + 1_000);
    await away.close();
    await page.bringToFront();
    await page.waitForFunction(
      () => document.visibilityState === "visible" && document.hasFocus(),
      undefined,
      { timeout: 15_000 }
    );
    snapshot = await readSnapshotFromPublicGet(page);
    expect(page.url()).toBe(urlBeforeLeave);
    expect(revisitFacts(snapshot)).toEqual(awayBaseline);
    await ensureControl(page);
    expect(await page.locator(GOAL).innerText()).toBe(goalAtLeave);
    await testInfo.attach("U07-real-revisit", {
      body: JSON.stringify({ status: "PASS", awayMilliseconds: 20 * 60_000 + 1_000, sameBaseAndFacts: true }, null, 2),
      contentType: "application/json"
    });
  await checkpoint(page, testInfo, "14-after-real-revisit");
  }
  await ensureControl(page);
  const resumeClock = page.getByLabel("基地时间").getByRole("button", { name: "恢复", exact: true });
  if (await resumeClock.isVisible().catch(() => false)) await resumeClock.click();
  await page.getByLabel("基地时间").getByRole("button", { name: "×4", exact: true }).click();

  // 圈2：用这笔精确采矿单取得 12 铁矿，再制造出会被下一步维护消耗的备件。
  snapshot = await finishMining(page, circle2Mine, 3);
  expect(quantity(snapshot, circle2Mine.itemId)).toBe(circle2Mine.before + 12);
  const copperForSpare = await startMining(page, "脊线蓝绿氧化带", 1);
  snapshot = await finishMining(page, copperForSpare, 1);
  expect(quantity(snapshot, copperForSpare.itemId)).toBe(copperForSpare.before + 4);
  await checkpoint(page, testInfo, "15-circle-2-ores-delivered");
  await openProcessing(page);
  const circle2Iron = await orderRecipe(page, "冶炼铁料", 1);
  await finishManufacturingJob(page, circle2Iron);
  snapshot = await readSnapshot(page);
  expect(quantity(snapshot, "iron_ingot")).toBe(1);
  const circle2Copper = await orderRecipe(page, "冶炼铜料", 2);
  await finishManufacturingJob(page, circle2Copper);
  snapshot = await readSnapshot(page);
  expect(quantity(snapshot, "copper_ingot")).toBe(3);
  expect(snapshot.productionSlots?.find((slot) => slot.siteId === processingSiteId)?.batchesSinceMaintenance).toBe(8);
  expect(quantity(snapshot, "spare_part")).toBe(5);
  const spareJob = await orderRecipe(page, "制造备件", 1);
  await finishManufacturingJob(page, spareJob);
  snapshot = await readSnapshot(page);
  expect(snapshot.manufacturingJobs.find((job) => job.jobId === spareJob)?.outputsDone).toBe(1);
  expect(quantity(snapshot, "spare_part")).toBe(7);
  expect(quantity(snapshot, "copper_ingot")).toBe(2);
  expect(snapshot.productionSlots?.find((slot) => slot.siteId === processingSiteId)?.batchesSinceMaintenance).toBe(9);
  await checkpoint(page, testInfo, "16-circle-2-spares-self-made");

  // 让同一铁料工单先完成第 10 批，再因第 11 批待维护而阻塞；后续确认此工单复工。
  const resumedIronJob = await orderRecipe(page, "冶炼铁料", 2);
  snapshot = await waitForSnapshot(page, (current) => {
    const job = current.manufacturingJobs.find((candidate) => candidate.jobId === resumedIronJob);
    const slot = current.productionSlots?.find((candidate) => candidate.siteId === processingSiteId);
    return job?.status === "blocked" && job.blockedReason === "maintenance_required" &&
      job.outputsDone === 1 && slot?.maintenanceBlocked === true && slot.batchesSinceMaintenance === 10;
  }, "circle 2 exact iron job did not stop at the maintenance boundary");
  expect(quantity(snapshot, "spare_part")).toBe(7);
  await checkpoint(page, testInfo, "17-circle-2-exact-job-blocked-for-maintenance");
  await maintainProcessingSlot(page);
  snapshot = await waitForSnapshot(page, (current) => {
    const job = current.manufacturingJobs.find((candidate) => candidate.jobId === resumedIronJob);
    const slot = current.productionSlots?.find((candidate) => candidate.siteId === processingSiteId);
    return job?.status !== "blocked" && slot?.maintenanceBlocked === false && quantity(current, "spare_part") === 6;
  }, "UI maintenance did not consume one self-produced spare and unblock the processing slot");
  expect(snapshot.manufacturingJobs.find((job) => job.jobId === resumedIronJob)?.status).not.toBe("blocked");
  expect(snapshot.productionSlots?.find((slot) => slot.siteId === processingSiteId)?.batchesSinceMaintenance).toBeLessThan(10);
  snapshot = await finishManufacturingJob(page, resumedIronJob).then(() => readSnapshot(page));
  expect(snapshot.manufacturingJobs.find((job) => job.jobId === resumedIronJob)?.outputsDone).toBe(2);
  expect(quantity(snapshot, "iron_ingot")).toBe(2);
  expect(quantity(snapshot, "iron_ore")).toBe(6);
  expect(quantity(snapshot, "copper_ore")).toBe(0);
  expect(quantity(snapshot, "copper_ingot")).toBe(2);
  expect(quantity(snapshot, "spare_part")).toBe(6);
  expect(snapshot.productionSlots?.find((slot) => slot.siteId === processingSiteId)?.batchesSinceMaintenance).toBe(1);
  await checkpoint(page, testInfo, "18-circle-2-same-job-resumed");

  // 圈3：新采 20 铁矿并完成另一种扩建，不以排队或“已开工”作为通过。
  const circle3Mine = await startMining(page, "北坡磁异常", 5);
  snapshot = await finishMining(page, circle3Mine, 5);
  expect(quantity(snapshot, circle3Mine.itemId)).toBe(circle3Mine.before + 20);
  await checkpoint(page, testInfo, "19-circle-3-iron-delivered");
  await openProcessing(page);
  const circle3Iron = await orderRecipe(page, "冶炼铁料", 10);
  expect(await finishManufacturingJob(page, circle3Iron)).toBe(1);
  snapshot = await readSnapshot(page);
  expect(quantity(snapshot, "iron_ingot")).toBe(12);
  const circle3Frames = await orderRecipe(page, "加工结构件", 6);
  expect(await finishManufacturingJob(page, circle3Frames)).toBe(0);
  expect(quantity(await readSnapshot(page), "iron_ingot")).toBe(0);
  const circle3Cable = await orderRecipe(page, "制造线缆", 1);
  await finishManufacturingJob(page, circle3Cable);
  snapshot = await readSnapshot(page);
  expect(quantity(snapshot, "structural_frame")).toBe(6);
  expect(quantity(snapshot, "wire_cable")).toBe(2);
  expect(quantity(snapshot, "copper_ingot")).toBe(1);
  expect(quantity(snapshot, "controller")).toBe(12);
  await checkpoint(page, testInfo, "20-circle-3-self-made-expansion-inputs");
  const processingExpansionId = await startProjectAt(page, "扩建位 B", "增建加工间");
  snapshot = await waitForSnapshot(page, (current) =>
    current.projects.some((project) => project.projectId === processingExpansionId && project.status === "completed")
  , "processing expansion did not complete");
  const processingExpansion = snapshot.projects.find((project) => project.projectId === processingExpansionId);
  expect(processingExpansion?.definitionRef.stableId).toBe("landing-expand-processing");
  expect(snapshot.sites.find((site) => site.siteId === processingExpansion?.siteId)?.state).toBe("built");
  expect(snapshot.productionSlots).toHaveLength(2);
  expect(quantity(snapshot, "structural_frame")).toBe(0);
  expect(quantity(snapshot, "wire_cable")).toBe(0);
  expect(quantity(snapshot, "copper_ingot")).toBe(1);
  expect(quantity(snapshot, "controller")).toBe(11);
  await checkpoint(page, testInfo, "21-circle-3-processing-expansion-complete");

  await testInfo.attach("route-summary", {
    body: JSON.stringify({
      status: "browser-evidence",
      email,
      elapsedWallMs: Date.now() - startedAt,
      route: "initial-solar-bootstrap-then-solar-expansion-then-processing-expansion",
      origin: routeOrigin,
      final: {
        baseId: snapshot.baseId,
        simTime: snapshot.simTime,
        generationWPeak: snapshot.power.generationWPeak,
        productionSlots: snapshot.productionSlots?.length,
        completedExpansions: [solarExpansionId, processingExpansionId],
        weather: snapshot.weather
      }
    }, null, 2),
    contentType: "application/json"
  });

  expect(pageErrors).toEqual([]);
});
