// M12-B 创建/取消项目业务测试（全部内存假端口，无真库、无真事务）。
// 回执 requestHash 由被测服务内部计算；测试只经服务自身播种收据，避免复制哈希细节。
import { describe, expect, it } from "vitest";
import type { ProjectTemplateDto } from "@ai-mud/shared";
import {
  BaseOperationError,
  ConstructionService,
  type ConstructionAssetPort,
  type ConstructionCatalogPort,
  type ConstructionCooperationPort,
  type ConstructionLookupPort,
  type ConstructionReceiptsPort,
  type ConstructionRobotPort,
  type ConstructionServiceDeps,
  type ConstructionSitePort,
  type ConstructionTx
} from "./construction.service.js";
import type { CooperationCloseReason } from "./cooperation.repository.js";
import type { BaseProjectRecord } from "./industry.pure.js";
import type { IndustryProjectStore } from "./industry.repository.js";

const TEMPLATE: ProjectTemplateDto = {
  ref: { kind: "project", stableId: "install_solar_array", revision: 1 },
  name: "架设光伏阵列",
  description: "首工程：安装太阳阵列",
  steps: [
    { kind: "site_clearing", groupId: "engineering", workRequired: 40 },
    { kind: "transport", groupId: "transport", workRequired: 60 },
    { kind: "installation", groupId: "engineering", workRequired: 80 },
    { kind: "commissioning", groupId: "survey", workRequired: 20 }
  ],
  inputs: [
    { itemId: "solar_panel_set", quantity: 6 },
    { itemId: "anchor", quantity: 8 }
  ],
  outputFacility: {
    ref: { kind: "facility", stableId: "solar_array_unit", revision: 1 },
    name: "光伏阵列单元",
    generationWPeak: 5000
  }
};

const CREATE_INPUT = {
  definitionRef: { kind: "project" as const, stableId: "install_solar_array", revision: 1 },
  siteId: "site-1",
  commandId: "cmd-create-1"
};

class FakeLookup implements ConstructionLookupPort {
  locked: string[] = [];
  constructor(private readonly baseByAccount: Map<string, string>) {}
  async findBaseIdByAccount(_tx: ConstructionTx, accountId: string): Promise<string | null> {
    return this.baseByAccount.get(accountId) ?? null;
  }
  async getBaseForUpdate(_tx: ConstructionTx, baseId: string): Promise<{ id: string } | null> {
    this.locked.push(baseId);
    return [...this.baseByAccount.values()].includes(baseId) ? { id: baseId } : null;
  }
}

class FakeAssets implements ConstructionAssetPort {
  reserved: Array<{ itemId: string; quantity: number }> = [];
  released: Array<{ itemId: string; quantity: number }> = [];
  failItems = new Set<string>();

  async reserveBaseInventoryIfAvailable(
    _tx: ConstructionTx,
    _baseId: string,
    itemId: string,
    quantity: number
  ): Promise<boolean> {
    if (this.failItems.has(itemId)) return false;
    this.reserved.push({ itemId, quantity });
    return true;
  }

  async releaseReservedBaseInventory(
    _tx: ConstructionTx,
    _baseId: string,
    itemId: string,
    quantity: number
  ): Promise<void> {
    this.released.push({ itemId, quantity });
  }
}

interface FakeSite {
  id: string;
  state: "free" | "reserved" | "built";
}

class FakeSites implements ConstructionSitePort {
  sites = new Map<string, FakeSite>([
    ["site-1", { id: "site-1", state: "free" }],
    ["site-2", { id: "site-2", state: "free" }]
  ]);
  reservedCalls: string[] = [];
  releasedCalls: string[] = [];

  async getSite(_tx: ConstructionTx, _baseId: string, siteId: string): Promise<FakeSite | null> {
    return this.sites.get(siteId) ?? null;
  }
  async markSiteReserved(_tx: ConstructionTx, siteId: string): Promise<void> {
    this.reservedCalls.push(siteId);
    const site = this.sites.get(siteId);
    if (site) site.state = "reserved";
  }
  async releaseSite(_tx: ConstructionTx, siteId: string): Promise<void> {
    this.releasedCalls.push(siteId);
  }
}

class FakeRobots implements ConstructionRobotPort {
  released: Array<{ tx: ConstructionTx; baseId: string; projectId: string }> = [];
  async releaseProjectAssignments(tx: ConstructionTx, baseId: string, projectId: string): Promise<void> {
    this.released.push({ tx, baseId, projectId });
  }
}

class FakeCatalog implements ConstructionCatalogPort {
  templates = new Map<string, ProjectTemplateDto | null>([
    [TEMPLATE.ref.stableId, TEMPLATE]
  ]);
  getProjectTemplate(stableId: string): ProjectTemplateDto | null {
    return this.templates.get(stableId) ?? null;
  }
}

interface StoredProject extends BaseProjectRecord {
  baseId: string;
}

class FakeStore implements IndustryProjectStore {
  inserted: Array<{ baseId: string; stepCount: number }> = [];
  projects = new Map<string, StoredProject>();
  statusCalls: Array<{ projectId: string; status: string }> = [];
  private sequence = 0;

  async hasLiveOrCompletedProject(_tx: ConstructionTx, baseId: string, projectDefId: string): Promise<boolean> {
    return [...this.projects.values()].some((project) =>
      project.baseId === baseId && project.projectDefId === projectDefId &&
      project.status !== "cancelled" && project.status !== "failed"
    );
  }

  async insertProjectWithSteps(
    _tx: ConstructionTx,
    input: {
      baseId: string;
      steps: Array<{ workRequired: number }>;
      reservedInputs: Array<{ itemId: string; quantity: number }>;
      siteId: string;
    }
  ): Promise<{ projectId: string }> {
    this.sequence += 1;
    const projectId = `project-${this.sequence}`;
    this.inserted.push({ baseId: input.baseId, stepCount: input.steps.length });
    this.projects.set(projectId, {
      id: projectId,
      baseId: input.baseId,
      projectDefId: "install_solar_array",
      templateRevision: 1,
      status: "active",
      currentStepIndex: 0,
      siteId: input.siteId,
      reservedInputs: input.reservedInputs
    });
    return { projectId };
  }

  async findProject(_tx: ConstructionTx, baseId: string, projectId: string): Promise<StoredProject | null> {
    const project = this.projects.get(projectId);
    if (!project || project.baseId !== baseId) return null;
    return project;
  }

  async updateProjectStatus(_tx: ConstructionTx, projectId: string, status: string): Promise<void> {
    this.statusCalls.push({ projectId, status });
    const project = this.projects.get(projectId);
    if (project) project.status = status;
  }
}

interface ReceiptRow {
  actorScope: string;
  commandKind: string;
  commandId: string;
  worldEpoch: number;
  requestHash: string;
  result: unknown;
}

class FakeReceipts implements ConstructionReceiptsPort {
  rows = new Map<string, ReceiptRow>();
  savedResults: unknown[] = [];

  private key(actorScope: string, commandKind: string, commandId: string): string {
    return `${actorScope}|${commandKind}|${commandId}`;
  }

  async findReceiptForUpdate(
    actorScope: string,
    commandKind: string,
    commandId: string
  ): Promise<ReceiptRow | null> {
    return this.rows.get(this.key(actorScope, commandKind, commandId)) ?? null;
  }

  async claimReceipt(input: {
    actorScope: string;
    commandKind: string;
    commandId: string;
    requestHash: string;
  }): Promise<boolean> {
    const key = this.key(input.actorScope, input.commandKind, input.commandId);
    if (this.rows.has(key)) return false;
    this.rows.set(key, {
      actorScope: input.actorScope,
      commandKind: input.commandKind,
      commandId: input.commandId,
      worldEpoch: 1,
      requestHash: input.requestHash,
      result: { status: "pending" }
    });
    return true;
  }

  async saveReceiptResult(input: {
    actorScope: string;
    commandKind: string;
    commandId: string;
    result: unknown;
  }): Promise<void> {
    this.savedResults.push(input.result);
    const row = this.rows.get(this.key(input.actorScope, input.commandKind, input.commandId));
    if (row) row.result = input.result;
  }
}

// B005：取消项目时同事务结案本项目协作请求的端口替身（记录调用时的 tx 与回执进度）。
class FakeCooperation implements ConstructionCooperationPort {
  calls: Array<{
    tx: ConstructionTx;
    baseId: string;
    projectId: string;
    reason: CooperationCloseReason;
    receiptsSavedBefore: number;
  }> = [];
  factoryTxs: ConstructionTx[] = [];
  failWith: Error | null = null;

  constructor(private readonly receipts: { savedResults: unknown[] }) {}

  async closeOpenByProject(
    tx: ConstructionTx,
    baseId: string,
    projectId: string,
    reason: CooperationCloseReason
  ): Promise<number> {
    if (this.failWith) throw this.failWith;
    this.calls.push({ tx, baseId, projectId, reason, receiptsSavedBefore: this.receipts.savedResults.length });
    return 2;
  }
}

function makeService(overrides: {
  baseByAccount?: Map<string, string>;
  failItems?: Set<string>;
} = {}) {
  const lookup = new FakeLookup(overrides.baseByAccount ?? new Map([["account-1", "base-1"]]));
  const assets = new FakeAssets();
  if (overrides.failItems) assets.failItems = overrides.failItems;
  const sites = new FakeSites();
  const robots = new FakeRobots();
  const catalog = new FakeCatalog();
  const store = new FakeStore();
  const receipts = new FakeReceipts();
  const cooperation = new FakeCooperation(receipts);
  const deps: ConstructionServiceDeps = {
    lookup,
    assets,
    sites,
    robots,
    catalog,
    store,
    receipts: () => receipts,
    cooperation: (scopedTx) => {
      cooperation.factoryTxs.push(scopedTx);
      return cooperation;
    }
  };
  return { service: new ConstructionService(deps), lookup, assets, sites, robots, catalog, store, receipts, cooperation };
}

const tx = {} as ConstructionTx;
const principal = { accountId: "account-1" };

async function createFirstProject(service: ConstructionService) {
  return service.create(tx, principal, CREATE_INPUT);
}

describe("ConstructionService.create", () => {
  it("happy path：全额预留 → 插项目+步骤 → 站点 reserved → 回执落结果", async () => {
    const { service, assets, sites, store, receipts } = makeService();

    const result = await createFirstProject(service);

    expect(result).toEqual({ projectId: "project-1", duplicate: false });
    expect(assets.reserved).toEqual([
      { itemId: "solar_panel_set", quantity: 6 },
      { itemId: "anchor", quantity: 8 }
    ]);
    expect(store.inserted).toHaveLength(1);
    expect(sites.reservedCalls).toEqual(["site-1"]);
    const saved = receipts.savedResults.at(-1);
    expect(saved).toEqual({ projectId: "project-1", duplicate: false });
  });

  it("首工程在别的建设位进行中或已完成时不能再建，失败后可重试", async () => {
    const { service, store, assets } = makeService();
    await createFirstProject(service);
    const secondInput = { ...CREATE_INPUT, siteId: "site-2", commandId: "cmd-create-2" };
    await expect(service.create(tx, principal, { ...secondInput, commandId: "cmd-create-2a" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(store.inserted).toHaveLength(1);
    expect(assets.reserved).toHaveLength(2);

    store.projects.get("project-1")!.status = "completed";
    await expect(service.create(tx, principal, { ...secondInput, commandId: "cmd-create-2b" })).rejects.toMatchObject({ code: "CONFLICT" });
    store.projects.get("project-1")!.status = "failed";
    expect((await service.create(tx, principal, { ...secondInput, commandId: "cmd-create-3" })).duplicate).toBe(false);
  });

  it("重复 commandId 且请求一致 → 原样重放，不重复预留/建项目", async () => {
    const { service, assets, store } = makeService();
    await createFirstProject(service);

    const replay = await service.create(tx, principal, {
      ...CREATE_INPUT,
      definitionRef: { kind: "project", stableId: "install_solar_array", revision: 1 }
    });

    expect(replay).toEqual({ projectId: "project-1", duplicate: true });
    expect(store.inserted).toHaveLength(1);
    expect(assets.reserved).toHaveLength(2); // 仅首次的两个 input
  });

  it("重复 commandId 但请求不一致 → IDEMPOTENCY_CONFLICT", async () => {
    const { service } = makeService();
    await createFirstProject(service);

    const conflict = service.create(tx, principal, { ...CREATE_INPUT, siteId: "site-other" });

    await expect(conflict).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      statusCode: 409
    });
  });

  it("任一 input 不足 → RESOURCE_INSUFFICIENT，且不建项目/不占站点", async () => {
    const { service, sites, store } = makeService({ failItems: new Set(["anchor"]) });

    const failure = createFirstProject(service);

    await expect(failure).rejects.toMatchObject({
      code: "RESOURCE_INSUFFICIENT",
      statusCode: 409
    });
    expect(store.inserted).toHaveLength(0);
    expect(sites.reservedCalls).toHaveLength(0);
  });

  it("站点不存在 → VALIDATION_ERROR；站点非 free → SITE_OCCUPIED", async () => {
    const missing = makeService();
    missing.sites.sites.clear();
    await expect(createFirstProject(missing.service)).rejects.toMatchObject({
      code: "VALIDATION_ERROR"
    });

    const occupied = makeService();
    occupied.sites.sites.set("site-1", { id: "site-1", state: "reserved" });
    await expect(createFirstProject(occupied.service)).rejects.toMatchObject({
      code: "SITE_OCCUPIED",
      statusCode: 409
    });
  });

  it("模板缺失或 revision 不匹配 → CONTENT_INCOMPATIBLE，不 fallback latest", async () => {
    const unknownTemplate = makeService();
    unknownTemplate.catalog.templates.set("install_solar_array", null);
    await expect(createFirstProject(unknownTemplate.service)).rejects.toMatchObject({
      code: "CONTENT_INCOMPATIBLE"
    });

    const staleRevision = makeService();
    staleRevision.catalog.templates.set("install_solar_array", {
      ...TEMPLATE,
      ref: { kind: "project", stableId: "install_solar_array", revision: 2 }
    });
    await expect(createFirstProject(staleRevision.service)).rejects.toMatchObject({
      code: "CONTENT_INCOMPATIBLE"
    });
  });

  it("账号无基地 → BASE_SCOPE_INVALID（403 防探测）", async () => {
    const { service } = makeService({ baseByAccount: new Map() });

    await expect(createFirstProject(service)).rejects.toMatchObject({
      code: "BASE_SCOPE_INVALID",
      statusCode: 403
    });
  });
});

describe("ConstructionService.cancel", () => {
  it("取消：释放全部未消耗预留 → cancelled → 释放站点 → 回执落结果", async () => {
    const { service, lookup, assets, sites, robots, store } = makeService();
    await createFirstProject(service);

    const result = await service.cancel(tx, principal, {
      projectId: "project-1",
      commandId: "cmd-cancel-1"
    });

    expect(result).toEqual({
      cancelled: true,
      duplicate: false,
      completed: false,
      releasedInputs: [
        { itemId: "solar_panel_set", quantity: 6 },
        { itemId: "anchor", quantity: 8 }
      ]
    });
    expect(assets.released).toEqual([
      { itemId: "solar_panel_set", quantity: 6 },
      { itemId: "anchor", quantity: 8 }
    ]);
    expect(store.statusCalls).toEqual([{ projectId: "project-1", status: "cancelled" }]);
    expect(lookup.locked).toEqual(["base-1", "base-1"]);
    expect(sites.releasedCalls).toEqual(["site-1"]);
    expect(robots.released).toEqual([{ tx, baseId: "base-1", projectId: "project-1" }]);
  });

  it("取消重放：重复 commandId → 原结果 duplicate=true，不二次释放", async () => {
    const { service, assets } = makeService();
    await createFirstProject(service);
    await service.cancel(tx, principal, { projectId: "project-1", commandId: "cmd-cancel-1" });

    const replay = await service.cancel(tx, principal, {
      projectId: "project-1",
      commandId: "cmd-cancel-1"
    });

    expect(replay).toEqual({
      cancelled: true,
      duplicate: true,
      completed: false,
      releasedInputs: [
        { itemId: "solar_panel_set", quantity: 6 },
        { itemId: "anchor", quantity: 8 }
      ]
    });
    expect(assets.released).toHaveLength(2); // 仅首次取消释放
  });

  it("终态项目（completed）→ CONFLICT；他基地项目 → BASE_SCOPE_INVALID", async () => {
    const foreign = makeService();
    await expect(
      foreign.service.cancel(tx, principal, { projectId: "no-such", commandId: "cmd-x" })
    ).rejects.toMatchObject({ code: "BASE_SCOPE_INVALID", statusCode: 403 });

    const completed = makeService();
    await createFirstProject(completed.service);
    const project = completed.store.projects.get("project-1");
    if (project) project.status = "completed";
    await expect(
      completed.service.cancel(tx, principal, { projectId: "project-1", commandId: "cmd-y" })
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });
  });
});

describe("ConstructionService.cancel > B005 协作请求结案", () => {
  it("取消在同一事务内以 project_cancelled 结案本项目的协作请求，且先于回执落结果", async () => {
    const { service, cooperation, receipts } = makeService();
    await createFirstProject(service);
    const savedBeforeCancel = receipts.savedResults.length;

    await service.cancel(tx, principal, { projectId: "project-1", commandId: "cmd-cancel-1" });

    expect(cooperation.calls).toHaveLength(1);
    expect(cooperation.calls[0]).toMatchObject({
      baseId: "base-1",
      projectId: "project-1",
      reason: "project_cancelled",
      receiptsSavedBefore: savedBeforeCancel
    });
    // 与取消共用调用方事务（同一 tx 对象），不另开连接/事务。
    expect(cooperation.calls[0]?.tx).toBe(tx);
    expect(cooperation.factoryTxs).toEqual([tx]);
    expect(receipts.savedResults).toHaveLength(savedBeforeCancel + 1);
  });

  it("取消重放（同 commandId）不再次结案", async () => {
    const { service, cooperation } = makeService();
    await createFirstProject(service);
    await service.cancel(tx, principal, { projectId: "project-1", commandId: "cmd-cancel-1" });

    await service.cancel(tx, principal, { projectId: "project-1", commandId: "cmd-cancel-1" });

    expect(cooperation.calls).toHaveLength(1);
  });

  it("项目不存在或已终态：取消被拒，不结案任何协作请求", async () => {
    const foreign = makeService();
    await expect(
      foreign.service.cancel(tx, principal, { projectId: "no-such", commandId: "cmd-x" })
    ).rejects.toMatchObject({ code: "BASE_SCOPE_INVALID" });
    expect(foreign.cooperation.calls).toHaveLength(0);

    const completed = makeService();
    await createFirstProject(completed.service);
    const project = completed.store.projects.get("project-1");
    if (project) project.status = "completed";
    await expect(
      completed.service.cancel(tx, principal, { projectId: "project-1", commandId: "cmd-y" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(completed.cooperation.calls).toHaveLength(0);
  });

  it("结案失败 → 取消整体抛错、回执不落结果（由调用方事务整体回滚）", async () => {
    const { service, cooperation, receipts } = makeService();
    await createFirstProject(service);
    const savedBeforeCancel = receipts.savedResults.length;
    cooperation.failWith = new Error("cooperation write failed");

    await expect(
      service.cancel(tx, principal, { projectId: "project-1", commandId: "cmd-cancel-1" })
    ).rejects.toThrow("cooperation write failed");
    expect(receipts.savedResults).toHaveLength(savedBeforeCancel);
  });
});

describe("BaseOperationError", () => {
  it("携带 ErrorCode 与 HTTP 状态码", () => {
    const error = new BaseOperationError(409, "SITE_OCCUPIED", "占用");
    expect(error.code).toBe("SITE_OCCUPIED");
    expect(error.statusCode).toBe(409);
  });
});
