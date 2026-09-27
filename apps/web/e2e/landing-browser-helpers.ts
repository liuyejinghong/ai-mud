import type { BaseSnapshotDto } from "@ai-mud/shared";
import type { Page, TestInfo } from "@playwright/test";
import { expect } from "@playwright/test";

const PANEL = "[aria-label='对象操作']";

export async function clickForId(
  page: Page,
  path: string,
  idField: "projectId" | "jobId",
  click: () => Promise<void>
): Promise<string> {
  const responsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === path && response.request().method() === "POST"
  );
  await click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`${path} returned HTTP ${response.status()}`);
  const result = await response.json() as Record<string, unknown>;
  const id = result[idField];
  if (typeof id !== "string") throw new Error(`${path} response has no ${idField}`);
  return id;
}

export async function waitForSnapshot(
  page: Page,
  matches: (snapshot: BaseSnapshotDto) => boolean,
  description: string,
  timeoutMs = 900_000
): Promise<BaseSnapshotDto> {
  const deadline = Date.now() + timeoutMs;
  let last: BaseSnapshotDto | undefined;
  while (Date.now() < deadline) {
    const response = await page.waitForResponse((candidate) =>
      new URL(candidate.url()).pathname === "/base/snapshot" &&
      candidate.request().method() === "GET" &&
      candidate.ok()
    , { timeout: Math.min(15_000, deadline - Date.now()) });
    last = await response.json() as BaseSnapshotDto;
    if (matches(last)) return last;
  }
  throw new Error(`${description}; last public snapshot: ${JSON.stringify({
    simTime: last?.simTime,
    projects: last?.projects.map(({ projectId, status }) => ({ projectId, status })),
    jobs: last?.manufacturingJobs.map(({ jobId, status, outputsDone, outputsPlanned }) => ({
      jobId, status, outputsDone, outputsPlanned
    }))
  })}`);
}

export async function readSnapshot(page: Page): Promise<BaseSnapshotDto> {
  const response = await page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname === "/base/snapshot" &&
    candidate.request().method() === "GET" &&
    candidate.ok()
  );
  return response.json() as Promise<BaseSnapshotDto>;
}

// A foreground poll is intentionally unavailable while the original tab is hidden.
// Playwright's context request reuses the signed-in browser cookies for this read-only GET.
export async function readSnapshotFromPublicGet(page: Page): Promise<BaseSnapshotDto> {
  const apiBase = process.env.VITE_API_BASE ?? "http://127.0.0.1:3000";
  const response = await page.request.get(`${apiBase}/base/snapshot`);
  if (!response.ok()) throw new Error(`/base/snapshot returned HTTP ${response.status()}`);
  return await response.json() as BaseSnapshotDto;
}

export async function finishManufacturingJob(page: Page, jobId: string, timeoutMs = 900_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let maintenances = 0;
  while (Date.now() < deadline) {
    const snapshot = await waitForSnapshot(page, (current) => {
      const job = current.manufacturingJobs.find((candidate) => candidate.jobId === jobId);
      return job?.status === "completed" || job?.status === "blocked" || job?.status === "cancelled";
    }, `manufacturing job ${jobId} did not reach a terminal or blocked state`, deadline - Date.now());
    const job = snapshot.manufacturingJobs.find((candidate) => candidate.jobId === jobId);
    if (!job) throw new Error(`manufacturing job ${jobId} disappeared from the public snapshot`);
    if (job.status === "completed") {
      if (job.outputsDone !== job.outputsPlanned) throw new Error(`manufacturing job ${jobId} completed with partial output`);
      return maintenances;
    }
    if (job.status !== "blocked" || job.blockedReason !== "maintenance_required") {
      throw new Error(`manufacturing job ${jobId} stopped: ${job.status}/${job.blockedReason}`);
    }

    await maintainProcessingSlot(page);
    maintenances += 1;
    await waitForSnapshot(page, (current) => {
      const resumed = current.manufacturingJobs.find((candidate) => candidate.jobId === jobId);
      const slot = current.productionSlots?.find((candidate) => candidate.siteId === resumed?.productionSiteId);
      return resumed?.status !== "blocked" && !slot?.maintenanceBlocked;
    }, `manufacturing job ${jobId} did not resume after maintenance`, deadline - Date.now());
  }
  throw new Error(`manufacturing job ${jobId} did not finish`);
}

export async function maintainProcessingSlot(page: Page): Promise<void> {
  const button = page.locator(PANEL).getByRole("button", { name: "维护（1 备件）", exact: true });
  await expect(button).toHaveCount(1);
  await button.click();
  await expect(page.locator(PANEL)).toContainText("维护完成", { timeout: 20_000 });
}

export async function setBrowserZoom200(page: Page): Promise<{
  supported: boolean;
  beforeWidth: number;
  afterWidth: number;
  beforeDpr: number;
  afterDpr: number;
}> {
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.bringToFront();
  await page.keyboard.press(`${modifier}+0`);
  const before = await page.evaluate(() => ({ width: window.innerWidth, dpr: window.devicePixelRatio }));
  let after = before;
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press(`${modifier}+Shift+Equal`);
    await page.waitForTimeout(150);
    after = await page.evaluate(() => ({ width: window.innerWidth, dpr: window.devicePixelRatio }));
    const widthRatio = before.width / after.width;
    const dprRatio = after.dpr / before.dpr;
    if (Math.abs(widthRatio - 2) < 0.1 && Math.abs(dprRatio - 2) < 0.1) {
      return { supported: true, beforeWidth: before.width, afterWidth: after.width, beforeDpr: before.dpr, afterDpr: after.dpr };
    }
    if (widthRatio > 2.2 || dprRatio > 2.2) break;
  }
  await page.keyboard.press(`${modifier}+0`);
  return { supported: false, beforeWidth: before.width, afterWidth: after.width, beforeDpr: before.dpr, afterDpr: after.dpr };
}

export async function resetBrowserZoom(page: Page): Promise<void> {
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${modifier}+0`);
}

export async function checkpoint(page: Page, testInfo: TestInfo, name: string): Promise<BaseSnapshotDto> {
  const snapshot = await readSnapshot(page);
  await testInfo.attach(`${name}.json`, {
    body: JSON.stringify(snapshot, null, 2),
    contentType: "application/json"
  });
  await testInfo.attach(`${name}.png`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png"
  });
  return snapshot;
}

export function quantity(snapshot: BaseSnapshotDto, itemId: string): number {
  return snapshot.resources.find((resource) => resource.itemId === itemId)?.quantity ?? 0;
}
