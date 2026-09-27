import { expect, test, type Page, type TestInfo } from "@playwright/test";
import type { BaseSnapshotDto } from "@ai-mud/shared";
import {
  clickForId,
  quantity,
  readSnapshotFromPublicGet,
  waitForSnapshot
} from "./landing-browser-helpers.js";

const MAP = "[aria-label='基地地图']";
const PANEL = "[aria-label='对象操作']";
const QUEUE = "[aria-label='进行中的工作']";
const BUILDER_DRAIN_WH = 6;
const HAULER_DRAIN_WH = 3;
const MINING_POINTS_PER_BATCH = 2;
const runId = Date.now() + "-" + Math.floor(Math.random() * 10_000);
const email = "r1-u08-recovery-" + runId + "@example.test";
const password = "r1-u08-recovery-password";

type MiningOrder = {
  jobId: string;
  nodeId: string;
  nodeName: string;
  itemId: string;
  batches: number;
  builderOperatorIds: string[];
  haulerOperatorId: string;
};

async function ensureControl(page: Page): Promise<void> {
  await page.bringToFront();
  const takeover = page.getByRole("button", { name: "接管", exact: true });
  if (await takeover.isVisible().catch(() => false)) {
    await takeover.click();
    await expect(takeover).toHaveCount(0, { timeout: 30_000 });
  }
}

async function record(page: Page, testInfo: TestInfo, name: string, facts: unknown = {}): Promise<BaseSnapshotDto> {
  const snapshot = await readSnapshotFromPublicGet(page);
  await testInfo.attach(name + ".json", {
    body: JSON.stringify({ facts, snapshot }, null, 2),
    contentType: "application/json"
  });
  await testInfo.attach(name + ".png", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png"
  });
  console.info("[landing-recovery] " + name + " simTime=" + snapshot.simTime);
  return snapshot;
}

async function setClockToFour(page: Page): Promise<BaseSnapshotDto> {
  let snapshot = await readSnapshotFromPublicGet(page);
  const clock = page.getByLabel("基地时间");
  if (snapshot.timeMode === "paused") {
    await ensureControl(page);
    await clock.getByRole("button", { name: "恢复", exact: true }).click();
    snapshot = await waitForSnapshot(page, (current) => current.timeMode === "running",
      "基地未能通过时间面板恢复运行", 30_000);
  }
  if (snapshot.speed !== 4) {
    await ensureControl(page);
    await clock.getByRole("button", { name: "×4", exact: true }).click();
    snapshot = await waitForSnapshot(page, (current) => current.timeMode === "running" && current.speed === 4,
      "基地未能通过时间面板设为×4", 30_000);
  }
  return snapshot;
}

async function returnToMap(page: Page): Promise<void> {
  const back = page.locator(PANEL).getByRole("button", { name: "返回地图", exact: true });
  if (await back.isVisible().catch(() => false)) await back.click();
}

async function installFacility(
  page: Page,
  testInfo: TestInfo,
  stableId: string,
  installed: Set<string>
): Promise<BaseSnapshotDto> {
  const before = await readSnapshotFromPublicGet(page);
  const template = before.buildableProjects.find((candidate) => candidate.definitionRef.stableId === stableId);
  if (!template) throw new Error("public snapshot has no facility project " + stableId);
  for (const required of template.requiresFacilities ?? []) {
    expect(installed.has(required), stableId + " requires installed " + required).toBe(true);
  }
  expect(template.canStart, stableId + " must be startable in the public snapshot").toBe(true);
  const siteKey = template.allowedSiteKeys?.find((key) =>
    before.sites.some((site) => site.siteKey === key && site.state === "free")
  );
  if (!siteKey) throw new Error(stableId + " has no free allowed site in the public snapshot");
  const site = before.sites.find((candidate) => candidate.siteKey === siteKey && candidate.state === "free");
  if (!site) throw new Error(stableId + " allowed site " + siteKey + " disappeared");

  await returnToMap(page);
  const siteButton = page.locator(MAP).getByRole("button", { name: site.name });
  await expect(siteButton).toHaveCount(1);
  await siteButton.click();
  const action = page.locator(PANEL).getByRole("button", { name: template.name, exact: true });
  await expect(action).toHaveCount(1);
  await ensureControl(page);
  console.info("[landing-recovery] waiting project " + stableId);
  const projectId = await clickForId(page, "/base/projects", "projectId", () => action.click());
  const completed = await waitForSnapshot(page, (current) =>
    current.projects.some((project) => project.projectId === projectId && project.status === "completed"),
  stableId + " project " + projectId + " did not complete");
  const project = completed.projects.find((candidate) => candidate.projectId === projectId);
  expect(project?.definitionRef.stableId).toBe(stableId);
  expect(project?.siteId).toBe(site.siteId);
  expect(completed.sites.find((candidate) => candidate.siteId === site.siteId)?.state).toBe("built");
  for (const capability of template.outputFacility.effects?.capabilities ?? []) {
    expect(completed.capabilities).toContain(capability);
  }
  installed.add(stableId);
  return record(page, testInfo, "facility-" + stableId, {
    projectId,
    stableId,
    requiredFacilities: template.requiresFacilities ?? [],
    siteId: site.siteId,
    siteKey,
    status: project?.status,
    capabilities: completed.capabilities
  });
}

async function surveyNode(page: Page, testInfo: TestInfo, nodeName: string, itemId: string): Promise<string> {
  const before = await readSnapshotFromPublicGet(page);
  const node = before.resourceNodes?.find((candidate) => candidate.name === nodeName);
  if (!node || node.discovered) throw new Error("expected fresh undiscovered node " + nodeName);
  const surveyor = before.devices.find((device) =>
    device.groupId === "survey" && device.currentAssignment === null &&
    device.currentExtractionJobId == null && device.batteryWh >= 2
  );
  if (!surveyor) throw new Error("no ready surveyor for " + nodeName);
  await page.locator(MAP).getByRole("button", { name: nodeName }).click();
  await page.locator(PANEL).getByLabel("望山").selectOption(surveyor.operatorId);
  const surveyButton = page.locator(PANEL).getByRole("button", { name: "开始勘探", exact: true });
  await expect(surveyButton).toBeEnabled();
  await ensureControl(page);
  const jobId = await clickForId(
    page,
    "/base/resource-nodes/" + node.nodeId + "/survey",
    "jobId",
    () => surveyButton.click()
  );
  console.info("[landing-recovery] waiting survey " + jobId + " at " + nodeName);
  const completed = await waitForSnapshot(page, (current) =>
    current.extractionJobs?.some((job) => job.jobId === jobId && job.status === "completed") === true &&
    current.resourceNodes?.some((candidate) => candidate.nodeId === node.nodeId && candidate.discovered) === true,
  "survey " + jobId + " for " + nodeName + " did not complete");
  const discovered = completed.resourceNodes?.find((candidate) => candidate.nodeId === node.nodeId);
  expect(discovered?.itemId).toBe(itemId);
  expect(quantity(completed, "iron_ore")).toBe(quantity(before, "iron_ore"));
  expect(quantity(completed, "copper_ore")).toBe(quantity(before, "copper_ore"));
  await record(page, testInfo, "survey-" + node.nodeId, { jobId, nodeId: node.nodeId, nodeName, itemId });
  return node.nodeId;
}

async function startMining(
  page: Page,
  nodeId: string,
  batches: number,
  builderOperatorIds: string[],
  haulerOperatorId: string
): Promise<MiningOrder> {
  const before = await readSnapshotFromPublicGet(page);
  const node = before.resourceNodes?.find((candidate) => candidate.nodeId === nodeId);
  if (!node?.discovered || !node.itemId) throw new Error("node " + nodeId + " is not a discovered resource");
  if (batches < 1 || batches > 10) throw new Error("invalid mining order size " + batches);
  const itemName = node.itemName ?? before.displayNames?.items[node.itemId] ?? node.itemId;
  const builders = before.devices.filter((device) => device.groupId === "engineering");
  const selectedBuilders = builderOperatorIds.map((operatorId) =>
    before.devices.find((device) => device.operatorId === operatorId)
  );
  expect(selectedBuilders.every((device) =>
    device?.groupId === "engineering" && device.currentAssignment === null &&
    device.currentExtractionJobId == null && device.batteryWh >= BUILDER_DRAIN_WH
  )).toBe(true);
  const hauler = before.devices.find((device) => device.operatorId === haulerOperatorId);
  expect(hauler?.groupId).toBe("transport");
  expect(hauler?.currentAssignment).toBeNull();
  expect(hauler?.currentExtractionJobId ?? null).toBeNull();
  expect(hauler?.batteryWh ?? 0).toBeGreaterThanOrEqual(HAULER_DRAIN_WH);

  const nodeCard = page.locator(MAP).getByRole("button", { name: itemName });
  await expect(nodeCard).toHaveCount(1);
  await nodeCard.click();
  const panel = page.locator(PANEL);
  await expect(panel).toContainText("采矿运输");
  const builderChecks = panel.getByRole("checkbox");
  await expect(builderChecks).toHaveCount(builders.length);
  for (const operatorId of builderOperatorIds) {
    const index = builders.findIndex((device) => device.operatorId === operatorId);
    if (index < 0) throw new Error("builder " + operatorId + " is not present in the mining panel");
    await builderChecks.nth(index).check();
  }
  await panel.getByLabel("驮运").selectOption(haulerOperatorId);
  await panel.getByLabel(/批数/).fill(String(batches));
  const submit = panel.getByRole("button", { name: /^下采矿单/ });
  await expect(submit).toBeEnabled();
  await ensureControl(page);
  const jobId = await clickForId(page, "/base/extraction-jobs", "jobId", () => submit.click());
  const created = await readSnapshotFromPublicGet(page);
  const job = created.extractionJobs?.find((candidate) => candidate.jobId === jobId);
  expect(job).toMatchObject({
    jobId,
    kind: "mine",
    nodeId,
    status: "active",
    batchesPlanned: batches,
    builderOperatorIds: [...builderOperatorIds].sort(),
    haulerOperatorId
  });
  expect(created.resourceNodes?.find((candidate) => candidate.nodeId === nodeId)?.reservedQuantity)
    .toBe((node.reservedQuantity ?? 0) + batches * 4);
  return {
    jobId,
    nodeId,
    nodeName: node.name,
    itemId: node.itemId,
    batches,
    builderOperatorIds,
    haulerOperatorId
  };
}

async function waitForMining(page: Page, order: MiningOrder): Promise<BaseSnapshotDto> {
  console.info("[landing-recovery] waiting mining " + order.jobId + " batches=" + order.batches);
  return waitForSnapshot(page, (current) =>
    current.extractionJobs?.some((job) =>
      job.jobId === order.jobId && job.status === "completed" && job.batchesDelivered === order.batches
    ) === true,
  "mining job " + order.jobId + " did not deliver " + order.batches + " batches", 900_000);
}

async function openOverviewAndSetPolicy(page: Page, policy: "charging" | "production"): Promise<void> {
  await returnToMap(page);
  const panel = page.locator(PANEL);
  await panel.getByRole("button", { name: "生产总览", exact: true }).click();
  const label = policy === "charging" ? "充电优先" : "加工优先";
  const button = panel.getByRole("button", { name: label, exact: true });
  if (await button.getAttribute("aria-pressed") !== "true") {
    await ensureControl(page);
    await button.click();
    await waitForSnapshot(page, (snapshot) => snapshot.power.powerPolicy === policy,
      "基地未能通过生产总览切换为" + label, 30_000);
  }
}

async function gatherSafely(
  page: Page,
  testInfo: TestInfo,
  nodeId: string,
  remainingBatches: number
): Promise<BaseSnapshotDto> {
  let delivered = 0;
  let last = await readSnapshotFromPublicGet(page);
  while (delivered < remainingBatches) {
    last = await readSnapshotFromPublicGet(page);
    const node = last.resourceNodes?.find((candidate) => candidate.nodeId === nodeId);
    if (!node?.discovered || !node.itemId) throw new Error("node " + nodeId + " lost its discovered resource");
    const free = last.devices.filter((device) =>
      device.currentAssignment === null && device.currentExtractionJobId == null
    );
    const builders = free.filter((device) => device.groupId === "engineering" && device.batteryWh >= BUILDER_DRAIN_WH)
      .sort((left, right) => right.batteryWh - left.batteryWh);
    const haulers = free.filter((device) => device.groupId === "transport" && device.batteryWh >= HAULER_DRAIN_WH)
      .sort((left, right) => right.batteryWh - left.batteryWh);
    const pair = builders.slice(0, 2);
    let builderOperatorIds = pair.map((device) => device.operatorId);
    let builderLimit = pair.length === 2
      ? Math.floor((Math.min(pair[0]!.batteryWh, pair[1]!.batteryWh) - BUILDER_DRAIN_WH) / BUILDER_DRAIN_WH)
      : 0;
    if (builderLimit < 1 && builders[0] &&
      builders[0].batteryWh >= MINING_POINTS_PER_BATCH * BUILDER_DRAIN_WH + BUILDER_DRAIN_WH) {
      builderOperatorIds = [builders[0].operatorId];
      builderLimit = Math.floor(
        (builders[0].batteryWh - BUILDER_DRAIN_WH) /
        (MINING_POINTS_PER_BATCH * BUILDER_DRAIN_WH)
      );
    }
    const hauler = haulers[0];
    const haulerLimit = hauler ? Math.floor((hauler.batteryWh - HAULER_DRAIN_WH) / HAULER_DRAIN_WH) : 0;
    const safeBatches = Math.min(10, remainingBatches - delivered, builderLimit, haulerLimit);
    if (safeBatches < 1 || !hauler) {
      console.info("[landing-recovery] no safe crew yet; use visible charging priority");
      await openOverviewAndSetPolicy(page, "charging");
      await waitForSnapshot(page, (current) => {
        const available = current.devices.filter((device) =>
          device.currentAssignment === null && device.currentExtractionJobId == null
        );
        const readyBuilders = available.filter((device) => device.groupId === "engineering")
          .sort((left, right) => right.batteryWh - left.batteryWh);
        const pairReady = readyBuilders.length >= 2 &&
          Math.min(readyBuilders[0]!.batteryWh, readyBuilders[1]!.batteryWh) >= 2 * BUILDER_DRAIN_WH;
        const oneReady = readyBuilders.some((device) =>
          device.batteryWh >= (MINING_POINTS_PER_BATCH + 1) * BUILDER_DRAIN_WH
        );
        const readyHauler = available.some((device) =>
          device.groupId === "transport" && device.batteryWh >= 2 * HAULER_DRAIN_WH
        );
        return (pairReady || oneReady) && readyHauler;
      }, "no safe mining crew recharged for node " + node.name, 300_000);
      continue;
    }

    const beforeQuantity = quantity(last, node.itemId);
    console.info("[landing-recovery] gather " + node.name + " " + delivered + "/" + remainingBatches +
      ", order=" + safeBatches + ", builders=" + builderOperatorIds.join(",") + ", hauler=" + hauler.operatorId);
    const order = await startMining(page, nodeId, safeBatches, builderOperatorIds, hauler.operatorId);
    last = await waitForMining(page, order);
    delivered += safeBatches;
    expect(quantity(last, node.itemId)).toBe(beforeQuantity + safeBatches * 4);
    await record(page, testInfo, "mining-" + node.name + "-" + delivered + "-of-" + remainingBatches, {
      jobId: order.jobId,
      batches: safeBatches,
      builderOperatorIds,
      haulerOperatorId: hauler.operatorId,
      deliveredTotal: delivered,
      nodeId
    });
  }
  return last;
}

async function openProcessing(page: Page): Promise<void> {
  await returnToMap(page);
  const panel = page.locator(PANEL);
  await panel.getByRole("button", { name: "加工间", exact: true }).click();
  await expect(panel).toContainText("着陆器手工恢复");
}

async function orderRecipe(page: Page, stableId: string, batches: number): Promise<string> {
  const snapshot = await readSnapshotFromPublicGet(page);
  const recipe = snapshot.availableRecipes.find((candidate) => candidate.ref.stableId === stableId);
  if (!recipe) throw new Error("public snapshot has no available recipe " + stableId);
  const block = page.locator(".landing-build-option").filter({
    has: page.getByText(recipe.name, { exact: true })
  });
  await expect(block).toHaveCount(1);
  await block.getByLabel(recipe.name + " 批数").fill(String(batches));
  const submit = block.getByRole("button", { name: "下单", exact: true });
  await expect(submit).toBeEnabled();
  await ensureControl(page);
  return clickForId(page, "/base/manufacturing", "jobId", () => submit.click());
}

async function waitForManufacturing(page: Page, jobId: string, outputsDone: number): Promise<BaseSnapshotDto> {
  console.info("[landing-recovery] waiting manufacturing " + jobId + " outputs=" + outputsDone);
  return waitForSnapshot(page, (current) =>
    current.manufacturingJobs.some((job) => job.jobId === jobId &&
      job.status === "completed" && job.outputsDone === outputsDone && job.outputsPlanned === outputsDone),
  "manufacturing job " + jobId + " did not complete " + outputsDone + " outputs", 900_000);
}

async function maintainSlot(page: Page, siteId: string): Promise<{ slotId: string; batchesSinceMaintenance: number }> {
  const button = page.locator(PANEL).getByRole("button", { name: "维护（1 备件）", exact: true });
  await expect(button).toHaveCount(1);
  await ensureControl(page);
  const responsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/base/production-slots/" + siteId + "/maintain" &&
    response.request().method() === "POST"
  );
  await button.click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error("maintenance for " + siteId + " returned HTTP " + response.status());
  const result = await response.json() as { slotId?: unknown; batchesSinceMaintenance?: unknown };
  if (typeof result.slotId !== "string" || typeof result.batchesSinceMaintenance !== "number") {
    throw new Error("maintenance for " + siteId + " returned no slot facts");
  }
  expect(result.batchesSinceMaintenance).toBe(0);
  await expect(page.locator(PANEL).getByRole("status").filter({ hasText: "维护完成" })).toBeVisible();
  return { slotId: result.slotId, batchesSinceMaintenance: result.batchesSinceMaintenance };
}

test("U08低电与零备件恢复", async ({ page }, testInfo) => {
  test.setTimeout(120 * 60_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "领取试玩基地" }).click();
  const goal = page.getByRole("region", { name: "当前目标" });
  await expect(goal).toBeVisible();
  let snapshot = await setClockToFour(page);
  const baseId = snapshot.baseId;
  console.info("[landing-recovery] start base=" + baseId + " speed=" + snapshot.speed);
  expect(quantity(snapshot, "iron_ore")).toBe(0);
  expect(quantity(snapshot, "copper_ore")).toBe(0);
  expect(quantity(snapshot, "spare_part")).toBe(6);
  const installed = new Set<string>();
  for (const stableId of ["landing-install-solar", "landing-install-warehouse"]) {
    snapshot = await installFacility(page, testInfo, stableId, installed);
  }
  expect(snapshot.capabilities).toContain("warehouse");
  const ironNodeId = await surveyNode(page, testInfo, "北坡磁异常", "iron_ore");
  snapshot = await readSnapshotFromPublicGet(page);
  const builders = snapshot.devices.filter((device) => device.groupId === "engineering" &&
    device.currentAssignment === null && device.currentExtractionJobId == null &&
    device.batteryWh >= BUILDER_DRAIN_WH
  ).sort((left, right) => left.batteryWh - right.batteryWh);
  const haulers = snapshot.devices.filter((device) => device.groupId === "transport" &&
    device.currentAssignment === null && device.currentExtractionJobId == null &&
    device.batteryWh >= HAULER_DRAIN_WH
  ).sort((left, right) => right.batteryWh - left.batteryWh);
  const lowBuilder = builders[0];
  const lowHauler = haulers[0];
  if (!lowBuilder || !lowHauler) throw new Error("no ready builder or hauler after bootstrap and survey");
  const tenBatchBuilderNeedWh = 10 * MINING_POINTS_PER_BATCH * BUILDER_DRAIN_WH;
  expect(lowBuilder.batteryWh, "use the live lowest-charge builder; ten batches require 120Wh of single-builder work")
    .toBeLessThan(tenBatchBuilderNeedWh);
  expect(lowBuilder.batteryWh).toBeGreaterThanOrEqual(BUILDER_DRAIN_WH);
  await record(page, testInfo, "lowest-builder-before-low-order", {
    baseId,
    operatorId: lowBuilder.operatorId,
    batteryWh: lowBuilder.batteryWh,
    batteryCapacityWh: lowBuilder.batteryCapacityWh,
    tenBatchBuilderNeedWh,
    haulerOperatorId: lowHauler.operatorId,
    haulerBatteryWh: lowHauler.batteryWh
  });

  console.info("[landing-recovery] start low-battery mining with actual minimum " +
    lowBuilder.operatorId + "=" + lowBuilder.batteryWh + "Wh");
  const lowOrder = await startMining(page, ironNodeId, 10, [lowBuilder.operatorId], lowHauler.operatorId);
  snapshot = await waitForSnapshot(page, (current) => current.extractionJobs?.some((job) =>
    job.jobId === lowOrder.jobId && job.status === "active" && job.blockedReason === "device_low_battery"
  ) === true, "ten-batch job " + lowOrder.jobId + " did not stop on low battery", 600_000);
  const lowJob = snapshot.extractionJobs?.find((job) => job.jobId === lowOrder.jobId);
  expect(lowJob?.phase).toBe("mining");
  expect(lowJob?.batchesDelivered).toBeLessThan(10);
  await expect(page.locator(PANEL)).toContainText("受阻：设备电量不足（等待充电或换人）");
  await record(page, testInfo, "low-battery-stop", {
    baseId,
    jobId: lowOrder.jobId,
    job: lowJob,
    lowBuilder: snapshot.devices.find((device) => device.operatorId === lowBuilder.operatorId)
  });

  const queue = page.locator(QUEUE);
  const queueCard = queue.locator(".landing-queue-card").filter({
    hasText: "采矿 · " + lowOrder.nodeName
  });
  await expect(queueCard).toHaveCount(1);
  await ensureControl(page);
  const pauseId = await clickForId(page, "/base/extraction-jobs/" + lowOrder.jobId + "/pause", "jobId", () =>
    queueCard.getByRole("button", { name: "暂停", exact: true }).click()
  );
  expect(pauseId).toBe(lowOrder.jobId);
  snapshot = await waitForSnapshot(page, (current) => current.extractionJobs?.some((job) =>
    job.jobId === lowOrder.jobId && job.status === "paused"
  ) === true, "low-battery job " + lowOrder.jobId + " did not pause");
  const pausedJob = snapshot.extractionJobs?.find((job) => job.jobId === lowOrder.jobId);
  if (!pausedJob) throw new Error("paused job " + lowOrder.jobId + " disappeared");
  await expect(page.locator(PANEL)).toContainText("恢复采矿");
  const availableBuilders = snapshot.devices.filter((device) =>
    device.groupId === "engineering" && device.operatorId !== lowBuilder.operatorId &&
    device.currentAssignment === null && device.currentExtractionJobId == null
  ).sort((left, right) => right.batteryWh - left.batteryWh);
  const remainingMiningTicks = pausedJob.batchesPlanned - pausedJob.batchesExtracted;
  const replacements = availableBuilders.filter((device) =>
    device.batteryWh >= remainingMiningTicks * BUILDER_DRAIN_WH
  ).slice(0, 2);
  expect(replacements.length, "two replacement builders have enough live charge to finish this job").toBe(2);
  const haulerChoices = snapshot.devices.filter((device) =>
    device.groupId === "transport" && device.currentAssignment === null && device.currentExtractionJobId == null &&
    device.batteryWh >= (pausedJob.batchesPlanned - pausedJob.batchesDelivered) * HAULER_DRAIN_WH
  ).sort((left, right) => right.batteryWh - left.batteryWh);
  const replacementHauler = haulerChoices[0];
  if (!replacementHauler) throw new Error("no hauler has enough live charge for the remaining low-battery job");
  const builderOrder = snapshot.devices.filter((device) => device.groupId === "engineering");
  const builderChecks = page.locator(PANEL).getByRole("checkbox");
  await expect(builderChecks).toHaveCount(builderOrder.length);
  for (const oldBuilderId of pausedJob.builderOperatorIds) {
    if (!replacements.some((device) => device.operatorId === oldBuilderId)) {
      const index = builderOrder.findIndex((device) => device.operatorId === oldBuilderId);
      if (index >= 0) await builderChecks.nth(index).uncheck();
    }
  }
  for (const replacement of replacements) {
    const index = builderOrder.findIndex((device) => device.operatorId === replacement.operatorId);
    await builderChecks.nth(index).check();
  }
  await page.locator(PANEL).getByLabel("驮运").selectOption(replacementHauler.operatorId);
  const resume = page.locator(PANEL).getByRole("button", { name: "换设备并恢复", exact: true });
  await expect(resume).toBeEnabled();
  await ensureControl(page);
  const resumedId = await clickForId(page, "/base/extraction-jobs/" + lowOrder.jobId + "/resume", "jobId", () =>
    resume.click()
  );
  expect(resumedId).toBe(lowOrder.jobId);
  snapshot = await waitForSnapshot(page, (current) => current.extractionJobs?.some((job) =>
    job.jobId === lowOrder.jobId && job.status === "active" &&
    replacements.every((device) => job.builderOperatorIds.includes(device.operatorId)) &&
    job.haulerOperatorId === replacementHauler.operatorId
  ) === true, "low-battery job did not resume on selected replacement devices");
  expect(snapshot.extractionJobs?.find((job) => job.jobId === lowOrder.jobId)?.builderOperatorIds)
    .not.toContain(lowBuilder.operatorId);
  await record(page, testInfo, "low-battery-job-resumed-with-new-devices", {
    jobId: lowOrder.jobId,
    oldBuilderOperatorId: lowBuilder.operatorId,
    newBuilderOperatorIds: replacements.map((device) => device.operatorId),
    newHaulerOperatorId: replacementHauler.operatorId
  });
  snapshot = await waitForMining(page, lowOrder);
  expect(quantity(snapshot, "iron_ore")).toBe(40);
  await record(page, testInfo, "low-battery-same-job-completed", {
    jobId: lowOrder.jobId,
    delivered: snapshot.extractionJobs?.find((job) => job.jobId === lowOrder.jobId)?.batchesDelivered,
    ironOre: quantity(snapshot, "iron_ore")
  });

  for (const stableId of [
    "landing-install-processing",
    "landing-install-maintenance",
    "landing-install-charging",
    "landing-install-storage"
  ]) {
    snapshot = await installFacility(page, testInfo, stableId, installed);
  }
  expect(snapshot.capabilities).toEqual(expect.arrayContaining(["warehouse", "processing", "maintenance"]));
  const processingSite = snapshot.sites.find((site) => site.siteKey === "install_processing" && site.state === "built");
  if (!processingSite) throw new Error("completed processing project has no built processing site");
  expect(snapshot.power.chargeLimitW).toBeGreaterThanOrEqual(2_000);
  expect(snapshot.power.storageCapacityWh).toBeGreaterThanOrEqual(7_000);

  await surveyNode(page, testInfo, "脊线蓝绿氧化带", "copper_ore");
  snapshot = await gatherSafely(page, testInfo, ironNodeId, 21);
  expect(quantity(snapshot, "iron_ore")).toBe(124);
  const copperNode = snapshot.resourceNodes?.find((node) => node.name === "脊线蓝绿氧化带");
  if (!copperNode?.discovered) throw new Error("copper node was not discovered by the real survey");
  snapshot = await gatherSafely(page, testInfo, copperNode.nodeId, 1);
  expect(quantity(snapshot, "iron_ore")).toBe(124);
  expect(quantity(snapshot, "copper_ore")).toBe(4);
  expect(quantity(snapshot, "spare_part")).toBe(6);
  await record(page, testInfo, "all-recovery-input-ore-delivered", {
    baseId,
    ironMiningBatches: 31,
    copperMiningBatches: 1,
    ironOre: quantity(snapshot, "iron_ore"),
    copperOre: quantity(snapshot, "copper_ore"),
    sparePart: quantity(snapshot, "spare_part")
  });

  if (snapshot.power.powerPolicy === "charging") await openOverviewAndSetPolicy(page, "production");
  await openProcessing(page);
  const beforeSmelting = await readSnapshotFromPublicGet(page);
  const ironRecipe = beforeSmelting.availableRecipes.find((recipe) => recipe.ref.stableId === "landing-smelt-iron");
  const handcraftRecipe = beforeSmelting.availableRecipes.find((recipe) => recipe.ref.stableId === "landing-handcraft-spares");
  expect(ironRecipe?.inputs).toEqual([{ itemId: "iron_ore", quantity: 2 }]);
  expect(handcraftRecipe?.inputs).toEqual([
    { itemId: "iron_ore", quantity: 2 },
    { itemId: "copper_ore", quantity: 2 }
  ]);
  expect(handcraftRecipe?.workMinutesPerBatch).toBe(4);
  let accumulatedIronOutputs = 0;

  for (let round = 1; round <= 6; round += 1) {
    const before = await readSnapshotFromPublicGet(page);
    expect(quantity(before, "spare_part")).toBe(7 - round);
    const slot = before.productionSlots?.find((candidate) => candidate.siteId === processingSite.siteId);
    expect(slot).toMatchObject({ batchesSinceMaintenance: 0, maintenanceBlocked: false });
    console.info("[landing-recovery] smelt cycle " + round + "/6: 8 outputs, then spend one initial spare");
    const jobId = await orderRecipe(page, "landing-smelt-iron", 8);
    const outputs = await waitForManufacturing(page, jobId, 8);
    accumulatedIronOutputs += 8;
    expect(quantity(outputs, "iron_ore")).toBe(quantity(before, "iron_ore") - 16);
    expect(quantity(outputs, "iron_ingot")).toBe(quantity(before, "iron_ingot") + 8);
    const slotAtWindow = outputs.productionSlots?.find((candidate) => candidate.siteId === processingSite.siteId);
    expect(slotAtWindow).toMatchObject({ batchesSinceMaintenance: 8, maintenanceBlocked: false });
    await record(page, testInfo, "spare-" + round + "-before-maintenance", {
      jobId,
      outputs: 8,
      slot: slotAtWindow,
      spareBefore: quantity(before, "spare_part"),
      spareAfterOutput: quantity(outputs, "spare_part")
    });
    const maintenance = await maintainSlot(page, processingSite.siteId);
    const maintained = await readSnapshotFromPublicGet(page);
    expect(maintenance.slotId).toBe(slotAtWindow?.slotId);
    expect(maintained.productionSlots?.find((candidate) => candidate.siteId === processingSite.siteId))
      .toMatchObject({ batchesSinceMaintenance: 0, maintenanceBlocked: false });
    expect(quantity(maintained, "spare_part")).toBe(6 - round);
    expect(quantity(maintained, "iron_ore")).toBe(quantity(outputs, "iron_ore"));
    await record(page, testInfo, "spare-" + round + "-consumed", {
      jobId,
      maintenance,
      accumulatedIronOutputs,
      sparePart: quantity(maintained, "spare_part")
    });
  }

  const beforeBlocked = await readSnapshotFromPublicGet(page);
  expect(accumulatedIronOutputs).toBe(48);
  expect(quantity(beforeBlocked, "spare_part")).toBe(0);
  expect(quantity(beforeBlocked, "iron_ore")).toBe(124 - 48 * 2);
  console.info("[landing-recovery] with six spares exhausted, run one 11-batch job to its tenth-output stop");
  const stoppedIronJobId = await orderRecipe(page, "landing-smelt-iron", 11);
  snapshot = await waitForSnapshot(page, (current) => {
    const job = current.manufacturingJobs.find((candidate) => candidate.jobId === stoppedIronJobId);
    const slot = current.productionSlots?.find((candidate) => candidate.siteId === processingSite.siteId);
    return job?.status === "blocked" && job.blockedReason === "maintenance_required" &&
      job.outputsDone === 10 && job.outputsPlanned === 11 && slot?.maintenanceBlocked === true &&
      slot.batchesSinceMaintenance === 10;
  }, "11-output iron job " + stoppedIronJobId + " did not stop after output ten", 900_000);
  const stoppedIronJob = snapshot.manufacturingJobs.find((candidate) => candidate.jobId === stoppedIronJobId);
  const stoppedSlot = snapshot.productionSlots?.find((candidate) => candidate.siteId === processingSite.siteId);
  expect(stoppedIronJob).toMatchObject({
    jobId: stoppedIronJobId,
    status: "blocked",
    blockedReason: "maintenance_required",
    outputsDone: 10,
    outputsPlanned: 11
  });
  expect(stoppedSlot).toMatchObject({ batchesSinceMaintenance: 10, maintenanceBlocked: true });
  expect(quantity(snapshot, "spare_part")).toBe(0);
  expect(quantity(snapshot, "iron_ore")).toBe(8);
  const ironBeforeManual = snapshot.resources.find((resource) => resource.itemId === "iron_ore");
  const copperBeforeManual = snapshot.resources.find((resource) => resource.itemId === "copper_ore");
  expect(ironBeforeManual?.reservedQuantity).toBe(2);
  expect(ironBeforeManual?.reservationSources).toContainEqual({
    kind: "manufacturing",
    id: stoppedIronJobId,
    name: ironRecipe?.name,
    quantity: 2
  });
  expect(copperBeforeManual?.reservedQuantity).toBe(0);
  await expect(page.locator(PANEL)).toContainText("待维护停机");
  await record(page, testInfo, "zero-spare-maintenance-stop", {
    jobId: stoppedIronJobId,
    job: stoppedIronJob,
    slot: stoppedSlot,
    ironOre: ironBeforeManual,
    copperOre: copperBeforeManual,
    sparePart: quantity(snapshot, "spare_part")
  });

  const zeroSpareButton = page.locator(PANEL).getByRole("button", { name: "维护（1 备件）", exact: true });
  await expect(zeroSpareButton).toHaveCount(1);
  await ensureControl(page);
  const failedMaintenancePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/base/production-slots/" + processingSite.siteId + "/maintain" &&
    response.request().method() === "POST"
  );
  await zeroSpareButton.click();
  const failedMaintenance = await failedMaintenancePromise;
  expect(failedMaintenance.status()).toBe(409);
  const failure = await failedMaintenance.json() as { error?: { code?: unknown; message?: unknown } };
  expect(failure.error?.code).toBe("RESOURCE_INSUFFICIENT");
  expect(failure.error?.message).toContain("备件不足");
  await expect(page.locator(PANEL).getByRole("status").filter({ hasText: "备件不足" })).toBeVisible();
  const afterFailedMaintenance = await readSnapshotFromPublicGet(page);
  expect(afterFailedMaintenance.baseId).toBe(baseId);
  expect(quantity(afterFailedMaintenance, "spare_part")).toBe(0);
  expect(afterFailedMaintenance.productionSlots?.find((candidate) => candidate.siteId === processingSite.siteId))
    .toMatchObject({ batchesSinceMaintenance: 10, maintenanceBlocked: true });
  expect(afterFailedMaintenance.manufacturingJobs.find((candidate) => candidate.jobId === stoppedIronJobId))
    .toMatchObject({ status: "blocked", blockedReason: "maintenance_required", outputsDone: 10 });
  expect(afterFailedMaintenance.resources.find((resource) => resource.itemId === "iron_ore")?.reservedQuantity).toBe(2);
  expect(afterFailedMaintenance.resources.find((resource) => resource.itemId === "copper_ore")?.reservedQuantity).toBe(0);
  await record(page, testInfo, "zero-spare-maintenance-refused", {
    responseStatus: failedMaintenance.status(),
    error: failure.error,
    stoppedJobId: stoppedIronJobId,
    sparePart: quantity(afterFailedMaintenance, "spare_part")
  });

  const ironResource = afterFailedMaintenance.resources.find((resource) => resource.itemId === "iron_ore");
  const copperResource = afterFailedMaintenance.resources.find((resource) => resource.itemId === "copper_ore");
  expect((ironResource?.quantity ?? 0) - (ironResource?.reservedQuantity ?? 0)).toBeGreaterThanOrEqual(2);
  expect((copperResource?.quantity ?? 0) - (copperResource?.reservedQuantity ?? 0)).toBeGreaterThanOrEqual(2);
  const manualJobId = await orderRecipe(page, "landing-handcraft-spares", 1);
  const manualReserved = await readSnapshotFromPublicGet(page);
  expect(manualReserved.manufacturingJobs.find((candidate) => candidate.jobId === manualJobId))
    .toMatchObject({ jobId: manualJobId, status: "active", outputsPlanned: 1 });
  expect(manualReserved.resources.find((resource) => resource.itemId === "iron_ore")?.reservedQuantity).toBe(4);
  expect(manualReserved.resources.find((resource) => resource.itemId === "copper_ore")?.reservedQuantity).toBe(2);
  expect(manualReserved.manufacturingJobs.find((candidate) => candidate.jobId === stoppedIronJobId)?.status).toBe("blocked");
  await record(page, testInfo, "manual-spare-resources-reserved", {
    manualJobId,
    blockedIronJobId: stoppedIronJobId,
    ironOre: manualReserved.resources.find((resource) => resource.itemId === "iron_ore"),
    copperOre: manualReserved.resources.find((resource) => resource.itemId === "copper_ore")
  });

  snapshot = await waitForManufacturing(page, manualJobId, 1);
  expect(quantity(snapshot, "spare_part")).toBe(1);
  expect(quantity(snapshot, "iron_ore")).toBe(6);
  expect(snapshot.resources.find((resource) => resource.itemId === "iron_ore")?.reservedQuantity).toBe(2);
  expect(quantity(snapshot, "copper_ore")).toBe(2);
  expect(snapshot.resources.find((resource) => resource.itemId === "copper_ore")?.reservedQuantity).toBe(0);
  expect(snapshot.productionSlots?.find((candidate) => candidate.siteId === processingSite.siteId))
    .toMatchObject({ batchesSinceMaintenance: 10, maintenanceBlocked: true });
  expect(snapshot.manufacturingJobs.find((candidate) => candidate.jobId === stoppedIronJobId)?.status).toBe("blocked");
  await record(page, testInfo, "manual-spare-produced", {
    manualJobId,
    outputsDone: snapshot.manufacturingJobs.find((candidate) => candidate.jobId === manualJobId)?.outputsDone,
    blockedIronJobId: stoppedIronJobId,
    ironOre: snapshot.resources.find((resource) => resource.itemId === "iron_ore"),
    copperOre: snapshot.resources.find((resource) => resource.itemId === "copper_ore"),
    sparePart: quantity(snapshot, "spare_part")
  });

  const maintenance = await maintainSlot(page, processingSite.siteId);
  snapshot = await waitForSnapshot(page, (current) => {
    const job = current.manufacturingJobs.find((candidate) => candidate.jobId === stoppedIronJobId);
    const slot = current.productionSlots?.find((candidate) => candidate.siteId === processingSite.siteId);
    return job?.status === "completed" && job.outputsDone === 11 && slot?.maintenanceBlocked === false &&
      slot.batchesSinceMaintenance === 1 && quantity(current, "spare_part") === 0;
  }, "same 11-output job " + stoppedIronJobId + " did not complete after manual-spare maintenance", 300_000);
  expect(maintenance.batchesSinceMaintenance).toBe(0);
  expect(quantity(snapshot, "iron_ore")).toBe(4);
  expect(snapshot.resources.find((resource) => resource.itemId === "iron_ore")?.reservedQuantity).toBe(0);
  expect(quantity(snapshot, "copper_ore")).toBe(2);
  expect(snapshot.resources.find((resource) => resource.itemId === "copper_ore")?.reservedQuantity).toBe(0);
  expect(quantity(snapshot, "iron_ingot")).toBe(59);
  expect(quantity(snapshot, "spare_part")).toBe(0);
  expect(snapshot.manufacturingJobs.find((candidate) => candidate.jobId === stoppedIronJobId))
    .toMatchObject({ status: "completed", outputsDone: 11, outputsPlanned: 11 });
  expect(snapshot.manufacturingJobs.find((candidate) => candidate.jobId === manualJobId))
    .toMatchObject({ status: "completed", outputsDone: 1, outputsPlanned: 1 });
  expect(snapshot.productionSlots?.find((candidate) => candidate.siteId === processingSite.siteId))
    .toMatchObject({ batchesSinceMaintenance: 1, maintenanceBlocked: false });
  await record(page, testInfo, "same-job-resumed-after-manual-spare", {
    blockedIronJobId: stoppedIronJobId,
    manualJobId,
    maintenance,
    finalLedger: {
      ironOre: snapshot.resources.find((resource) => resource.itemId === "iron_ore"),
      copperOre: snapshot.resources.find((resource) => resource.itemId === "copper_ore"),
      ironIngot: quantity(snapshot, "iron_ingot"),
      sparePart: quantity(snapshot, "spare_part"),
      slot: snapshot.productionSlots?.find((candidate) => candidate.siteId === processingSite.siteId)
    }
  });

  if (snapshot.power.powerPolicy === "charging") await openOverviewAndSetPolicy(page, "production");
  expect(snapshot.baseId).toBe(baseId);
  expect(pageErrors).toEqual([]);
});
