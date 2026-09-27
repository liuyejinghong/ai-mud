// U06 alternate reinvestment: both routes first build the solar, warehouse and operating bootstrap;
// this new save chooses a second processing slot where the companion route chooses solar capacity.
import { expect, test, type Page } from "@playwright/test";
import {
  checkpoint,
  clickForId,
  finishManufacturingJob,
  maintainProcessingSlot,
  quantity,
  readSnapshot,
  waitForSnapshot
} from "./landing-browser-helpers.js";

const runId = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
const email = `r1-alt-${runId}@example.test`;
const password = "r1-alt-password";

const GOAL = "[aria-label='当前目标']";
const MAP = "[aria-label='基地地图']";
const PANEL = "[aria-label='对象操作']";
const GOAL_ACTION = { name: "前往处理", exact: true };

async function ensureControl(page: Page) {
  await page.bringToFront();
  const takeOver = page.getByRole("button", { name: "接管", exact: true });
  if (await takeOver.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await takeOver.click();
    await expect(page.getByRole("button", { name: "接管", exact: true })).toHaveCount(0, { timeout: 30_000 });
  }
}

async function startProjectAt(page: Page, siteName: string, projectName: string) {
  const site = page.locator(MAP).getByRole("button", { name: siteName });
  await expect(site).toHaveCount(1);
  await ensureControl(page);
  await site.click();
  const action = page.locator(PANEL).getByRole("button", { name: projectName, exact: true });
  await expect(action).toHaveCount(1);
  return clickForId(page, "/base/projects", "projectId", () => action.click());
}

async function installAt(page: Page, siteName: string, projectName: string, stableId: string, builtNote: string) {
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

async function surveyNode(page: Page, nodeName: string): Promise<void> {
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
  const button = page.locator(PANEL).getByRole("button", { name: "开始勘探", exact: true });
  const jobId = await clickForId(page, `/base/resource-nodes/${node.nodeId}/survey`, "jobId", () => button.click());
  await waitForSnapshot(page, (current) =>
    current.extractionJobs?.some((job) => job.jobId === jobId && job.status === "completed") === true &&
    current.resourceNodes?.some((candidate) => candidate.nodeId === node.nodeId && candidate.discovered) === true
  , `${nodeName} survey did not complete`);
}

async function startMining(page: Page, nodeName: string, batches: number) {
  const snapshot = await readSnapshot(page);
  const node = snapshot.resourceNodes?.find((candidate) => candidate.name.includes(nodeName));
  if (!node?.discovered || !node.itemId) throw new Error(`resource node is not discovered: ${nodeName}`);
  const builders = snapshot.devices.filter((device) => device.groupId === "engineering");
  const builderIndex = builders.findIndex((device) =>
    !device.currentAssignment && !device.currentExtractionJobId && device.batteryWh >= 6
  );
  if (builderIndex < 0) throw new Error(`no available builder for ${nodeName}`);
  const hauler = snapshot.devices.find((device) =>
    device.groupId === "transport" && !device.currentAssignment &&
    !device.currentExtractionJobId && device.batteryWh >= 3
  );
  if (!hauler) throw new Error(`no available hauler for ${nodeName}`);
  const card = page.locator(MAP).getByRole("button", { name: nodeName });
  await expect(card).toHaveCount(1);
  await ensureControl(page);
  await card.click();
  await expect(page.locator(PANEL)).toContainText("采矿运输");
  const checks = page.locator(PANEL).getByRole("checkbox");
  await expect(checks).toHaveCount(builders.length);
  await checks.nth(builderIndex).check();
  await page.getByLabel("驮运").selectOption(hauler.operatorId);
  await page.getByLabel(/批数/).fill(String(batches));
  const submit = page.locator(PANEL).getByRole("button", { name: /^下采矿单/ });
  const before = quantity(snapshot, node.itemId);
  const jobId = await clickForId(page, "/base/extraction-jobs", "jobId", () => submit.click());
  return { jobId, itemId: node.itemId, before };
}

async function finishMining(
  page: Page,
  mining: { jobId: string; itemId: string; before: number },
  batches: number
) {
  const snapshot = await waitForSnapshot(page, (current) => current.extractionJobs?.some((job) =>
    job.jobId === mining.jobId && job.status === "completed" && job.batchesDelivered === batches
  ) === true, `mining job ${mining.jobId} did not deliver ${batches} batches`);
  expect(quantity(snapshot, mining.itemId)).toBe(mining.before + batches * 4);
  return snapshot;
}

async function openProcessing(page: Page) {
  await page.locator(PANEL).getByRole("button", { name: "返回地图", exact: true }).click();
  await page.locator(PANEL).getByRole("button", { name: "加工间", exact: true }).click();
}

async function orderRecipe(page: Page, recipeName: string, batches: number) {
  const block = page.locator(".landing-build-option").filter({ has: page.getByText(recipeName, { exact: true }) });
  await expect(block).toHaveCount(1);
  await expect(block).toBeVisible({ timeout: 30_000 });
  await ensureControl(page);
  await block.getByRole("spinbutton").fill(String(batches));
  const button = block.getByRole("button", { name: "下单", exact: true });
  await expect(button).toHaveCount(1);
  return clickForId(page, "/base/manufacturing", "jobId", () => button.click());
}

test("U06 替代路线：自举首太阳能与常设设施后，首次扩建选择第二加工间", async ({ page }, testInfo) => {
  test.setTimeout(60 * 60_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const startedAt = Date.now();
  const milestones: Array<{ step: string; wallMs: number; simTime: string }> = [];
  const mark = async (step: string) => {
    const current = await readSnapshot(page);
    milestones.push({ step, wallMs: Date.now() - startedAt, simTime: current.simTime });
  };

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "领取试玩基地" }).click();
  await expect(page.locator(GOAL)).toContainText("安装首座太阳能");
  let snapshot = await readSnapshot(page);
  expect(snapshot.weather.current).toBe("clear");
  const routeOrigin = {
    baseId: snapshot.baseId,
    contentRelease: snapshot.activeContentRelease,
    weather: snapshot.weather,
    resources: snapshot.resources.map(({ itemId, quantity, reservedQuantity }) => ({ itemId, quantity, reservedQuantity }))
      .sort((left, right) => left.itemId.localeCompare(right.itemId))
  };
  await page.screenshot({ path: testInfo.outputPath("00-alt-start.png"), fullPage: true });
  await mark("注册完成");

  // Match the companion route's self-bootstrap; the fork happens only at first expansion.
  await page.getByLabel("基地时间").getByRole("button", { name: "恢复", exact: true }).click();
  await page.getByLabel("基地时间").getByRole("button", { name: "×4", exact: true }).click();
  const firstSolarGoal = page.locator(GOAL).getByRole("button", GOAL_ACTION);
  await expect(firstSolarGoal).toBeInViewport();
  await firstSolarGoal.click();
  const firstSolarAction = page.locator(PANEL).getByRole("button", { name: "安装首座太阳能", exact: true });
  const firstSolarId = await clickForId(page, "/base/projects", "projectId", () => firstSolarAction.click());
  snapshot = await waitForSnapshot(page, (current) =>
    current.projects.some((project) => project.projectId === firstSolarId && project.status === "completed")
  , "initial solar did not complete");
  const firstSolar = snapshot.projects.find((project) => project.projectId === firstSolarId);
  expect(firstSolar?.definitionRef.stableId).toBe("landing-install-solar");
  expect(snapshot.sites.find((site) => site.siteId === firstSolar?.siteId)?.state).toBe("built");
  expect(snapshot.power.generationWPeak).toBe(4000);
  await mark("首座太阳能完成");
  await checkpoint(page, testInfo, "01-initial-solar-complete");

  await installAt(page, "仓储棚安装位", "安装仓储棚", "landing-install-warehouse", "矿石入库与加工前置");
  await checkpoint(page, testInfo, "02-warehouse-complete");
  await installAt(page, "储能间安装位", "安装储能间", "landing-install-storage", "扩大储电容量");
  await checkpoint(page, testInfo, "03-storage-complete");
  await installAt(page, "充电区安装位", "安装充电区", "landing-install-charging", "提高充电上限");
  await checkpoint(page, testInfo, "04-charging-complete");
  await installAt(page, "加工间安装位", "安装加工间", "landing-install-processing", "冶炼与材料制造");
  await checkpoint(page, testInfo, "05-processing-complete");
  await installAt(page, "维护工位安装位", "安装维护工位", "landing-install-maintenance", "维护加工槽");
  snapshot = await checkpoint(page, testInfo, "06-bootstrap-complete-before-expansion");
  expect(snapshot.capabilities).toContain("warehouse");
  expect(snapshot.capabilities).toContain("processing");
  expect(snapshot.power.generationWPeak).toBe(4000);
  await mark("太阳能、仓储、储能、充电、加工与维护均建成");

  // Exact public job IDs and delivered inventory establish the route's mined inputs.
  await surveyNode(page, "北坡磁异常");
  const ironMine = await startMining(page, "北坡磁异常", 6);
  snapshot = await finishMining(page, ironMine, 6);
  expect(quantity(snapshot, "iron_ore")).toBe(24);
  await mark("24 铁矿送达");
  await checkpoint(page, testInfo, "07-iron-24-delivered");
  await surveyNode(page, "脊线蓝绿氧化带");
  const copperMine = await startMining(page, "脊线蓝绿氧化带", 1);
  snapshot = await finishMining(page, copperMine, 1);
  expect(quantity(snapshot, "copper_ore")).toBe(4);
  await mark("4 铜矿送达");
  await checkpoint(page, testInfo, "08-copper-4-delivered");

  // 21 production batches need two real maintenances: 12 iron, 2 copper, 6 frames, 1 cable.
  await openProcessing(page);
  const ironJob = await orderRecipe(page, "冶炼铁料", 12);
  const firstMaintenance = await finishManufacturingJob(page, ironJob);
  snapshot = await readSnapshot(page);
  expect(snapshot.manufacturingJobs.find((job) => job.jobId === ironJob)?.outputsDone).toBe(12);
  expect(quantity(snapshot, "iron_ingot")).toBe(12);
  await mark("12 批铁料完成");
  await checkpoint(page, testInfo, "09-iron-ingots-complete");
  const copperJob = await orderRecipe(page, "冶炼铜料", 2);
  await finishManufacturingJob(page, copperJob);
  snapshot = await readSnapshot(page);
  expect(snapshot.manufacturingJobs.find((job) => job.jobId === copperJob)?.outputsDone).toBe(2);
  expect(quantity(snapshot, "copper_ingot")).toBe(2);
  await checkpoint(page, testInfo, "10-copper-ingots-complete");
  const frameJob = await orderRecipe(page, "加工结构件", 6);
  const frameMaintenances = await finishManufacturingJob(page, frameJob);
  snapshot = await readSnapshot(page);
  expect(snapshot.manufacturingJobs.find((job) => job.jobId === frameJob)?.outputsDone).toBe(6);
  expect(quantity(snapshot, "structural_frame")).toBe(6);
  expect(snapshot.productionSlots?.[0]?.maintenanceBlocked).toBe(true);
  expect(quantity(snapshot, "spare_part")).toBe(5);
  await checkpoint(page, testInfo, "11-frames-complete-maintenance-due");
  await maintainProcessingSlot(page);
  snapshot = await waitForSnapshot(page, (current) =>
    current.productionSlots?.[0]?.maintenanceBlocked === false && quantity(current, "spare_part") === 4
  , "second maintenance did not consume its spare and restore the slot");
  await checkpoint(page, testInfo, "12-second-maintenance-complete");
  const cableJob = await orderRecipe(page, "制造线缆", 1);
  const cableMaintenances = await finishManufacturingJob(page, cableJob);
  snapshot = await readSnapshot(page);
  expect(snapshot.manufacturingJobs.find((job) => job.jobId === cableJob)?.outputsDone).toBe(1);
  expect(quantity(snapshot, "wire_cable")).toBe(2);
  expect(firstMaintenance + frameMaintenances + 1 + cableMaintenances).toBe(2);
  expect(quantity(snapshot, "structural_frame")).toBe(6);
  expect(quantity(snapshot, "controller")).toBe(12);
  await mark("自产 6 结构件与 2 线缆，维护两次");
  await checkpoint(page, testInfo, "13-self-made-expansion-inputs");

  // The chosen first expansion must finish and add a second real processing slot.
  const processingExpansionId = await startProjectAt(page, "扩建位 A", "增建加工间");
  snapshot = await waitForSnapshot(page, (current) =>
    current.projects.some((project) => project.projectId === processingExpansionId && project.status === "completed")
  , "first processing expansion did not complete");
  const processingExpansion = snapshot.projects.find((project) => project.projectId === processingExpansionId);
  expect(processingExpansion?.definitionRef.stableId).toBe("landing-expand-processing");
  expect(snapshot.sites.find((site) => site.siteId === processingExpansion?.siteId)?.state).toBe("built");
  expect(snapshot.productionSlots).toHaveLength(2);
  expect(quantity(snapshot, "structural_frame")).toBe(0);
  expect(quantity(snapshot, "wire_cable")).toBe(0);
  expect(quantity(snapshot, "controller")).toBe(11);
  expect(snapshot.power.generationWPeak).toBe(4000);
  await mark("首次扩建加工间完成");
  await checkpoint(page, testInfo, "14-first-processing-expansion-complete");

  await testInfo.attach("route-summary", {
    body: JSON.stringify({
      status: "browser-evidence",
      email,
      elapsedWallMs: Date.now() - startedAt,
      route: "initial-solar-bootstrap-then-first-expansion-processing",
      origin: routeOrigin,
      maintenanceCount: firstMaintenance + frameMaintenances + 1 + cableMaintenances,
      final: {
        baseId: snapshot.baseId,
        simTime: snapshot.simTime,
        generationWPeak: snapshot.power.generationWPeak,
        productionSlots: snapshot.productionSlots?.length,
        completedExpansion: processingExpansionId,
        weather: snapshot.weather
      },
      milestones
    }, null, 2),
    contentType: "application/json"
  });
  expect(pageErrors).toEqual([]);
});
