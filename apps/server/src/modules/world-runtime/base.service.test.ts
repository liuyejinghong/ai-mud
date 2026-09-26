import { describe, expect, it } from "vitest";
import type { BaseSnapshotDto, RecipeTemplateDto } from "@ai-mud/shared";
import { BASE_LEASE_TTL_MS } from "@ai-mud/shared";
import type { BaseDb, BaseRecord, BaseRepoTx, BaseRepository } from "./base.repository.js";
import { BASE_PROVISION_COMMAND_KIND, hashRequestPayload } from "./base.repository.js";
import type {
  BaseIndustryReadPort,
  BaseRobotReadPort,
  BaseAssetPort,
  BaseServiceDeps,
  ContentCatalogPort,
  ProjectTemplateSpec,
  ProvisionSeedSpec,
  RobotFactoryPort,
  RobotTemplateSpec
} from "./base.service.js";
import { BaseService } from "./base.service.js";

// M12-A 服务用例：内存假 repo / 假端口，覆盖 provision 全链种子装配、幂等重放、
// 收据冲突、resume 重置 lastAdvancedAt、租约续期、快照组装与 BASE_SCOPE_INVALID。
// clock 用假时钟 { now: () => fixed }。

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const T0 = new Date("2026-09-19T08:00:00.000Z");
const T1 = new Date("2026-09-19T08:05:00.000Z");
const S0 = new Date("2026-09-19T02:00:00.000Z");

function clockAt(at: Date): BaseServiceDeps["clock"] {
  return { now: () => new Date(at) };
}

function makeBase(overrides: Partial<BaseRecord> = {}): BaseRecord {
  return {
    id: "base-1",
    accountId: ACCOUNT_ID,
    name: "余电前哨",
    timeMode: "paused",
    speed: 1,
    simTime: S0,
    lastAdvancedAt: T0,
    epoch: 1,
    baseRevision: 1,
    contentRelease: "release-yudian-0.12",
    createdAt: T0,
    ...overrides
  };
}

class FakeBaseRepository {
  bases: BaseRecord[] = [];
  sites: Array<{
    id: string;
    baseId: string;
    siteKey: string;
    state: "free" | "reserved" | "built";
    builtFacilityRef: string | null;
  }> = [];
  leases = new Map<string, { leaseToken: string; leaseUntil: Date; updatedAt: Date }>();
  receipts = new Map<string, { requestHash: string; result: unknown }>();
  savedResults: unknown[] = [];
  private counter = 0;

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${this.counter}`;
  }

  private receiptKey(actorScope: string, commandKind: string, commandId: string): string {
    return `${actorScope}|${commandKind}|${commandId}`;
  }

  async findReceiptForUpdate(
    _tx: BaseRepoTx,
    actorScope: string,
    commandKind: string,
    commandId: string
  ) {
    const found = this.receipts.get(this.receiptKey(actorScope, commandKind, commandId));
    return found
      ? {
          actorScope,
          commandKind,
          commandId,
          worldEpoch: 1,
          requestHash: found.requestHash,
          result: found.result
        }
      : null;
  }

  async claimReceipt(_tx: BaseRepoTx, input: {
    actorScope: string;
    commandKind: string;
    commandId: string;
    requestHash: string;
  }) {
    const key = this.receiptKey(input.actorScope, input.commandKind, input.commandId);
    if (this.receipts.has(key)) return false;
    this.receipts.set(key, { requestHash: input.requestHash, result: { status: "pending" } });
    return true;
  }

  async saveReceiptResult(_tx: BaseRepoTx, input: {
    actorScope: string;
    commandKind: string;
    commandId: string;
    result: unknown;
  }) {
    const found = this.receipts.get(
      this.receiptKey(input.actorScope, input.commandKind, input.commandId)
    );
    if (found) found.result = input.result;
    this.savedResults.push(input.result);
  }

  async findBaseIdByAccount(_tx: BaseRepoTx, accountId: string): Promise<string | null> {
    return this.bases.find((base) => base.accountId === accountId)?.id ?? null;
  }

  async getBaseByAccount(_tx: BaseRepoTx, accountId: string): Promise<BaseRecord | null> {
    return this.bases.find((base) => base.accountId === accountId) ?? null;
  }

  async getBaseForUpdate(_tx: BaseRepoTx, baseId: string): Promise<BaseRecord | null> {
    return this.bases.find((base) => base.id === baseId) ?? null;
  }

  async insertBase(_tx: BaseRepoTx, input: {
    accountId: string;
    name: string;
    contentRelease: string;
    timeMode: BaseRecord["timeMode"];
    speed: number;
    simTime: Date;
    lastAdvancedAt: Date;
  }): Promise<string> {
    const id = this.nextId("base");
    this.bases.push({
      id,
      accountId: input.accountId,
      name: input.name,
      timeMode: input.timeMode,
      speed: input.speed,
      simTime: input.simTime,
      lastAdvancedAt: input.lastAdvancedAt,
      epoch: 1,
      baseRevision: 1,
      contentRelease: input.contentRelease,
      createdAt: input.simTime
    });
    return id;
  }

  async updateBaseClock(_tx: BaseRepoTx, input: {
    baseId: string;
    expectedBaseRevision: number;
    timeMode: BaseRecord["timeMode"];
    speed: number;
    lastAdvancedAt: Date;
  }): Promise<boolean> {
    const base = this.bases.find((candidate) => candidate.id === input.baseId);
    if (!base || base.baseRevision !== input.expectedBaseRevision) return false;
    base.timeMode = input.timeMode;
    base.speed = input.speed;
    base.lastAdvancedAt = input.lastAdvancedAt;
    base.baseRevision += 1;
    return true;
  }

  async upsertControlLease(_tx: BaseRepoTx, input: {
    baseId: string;
    leaseToken: string;
    leaseUntil: Date;
    updatedAt: Date;
  }): Promise<void> {
    this.leases.set(input.baseId, {
      leaseToken: input.leaseToken,
      leaseUntil: input.leaseUntil,
      updatedAt: input.updatedAt
    });
  }

  async getControlLease(_tx: BaseRepoTx, baseId: string) {
    const lease = this.leases.get(baseId);
    return lease ? { baseId, ...lease } : null;
  }

  async clearControlLease(_tx: BaseRepoTx, baseId: string, leaseToken: string): Promise<void> {
    if (this.leases.get(baseId)?.leaseToken === leaseToken) this.leases.delete(baseId);
  }

  async insertSite(_tx: BaseRepoTx, input: {
    baseId: string;
    siteKey: string;
    state: "free" | "reserved" | "built";
    builtFacilityRef: string | null;
  }): Promise<string> {
    const id = this.nextId("site");
    this.sites.push({ id, ...input });
    return id;
  }

  async listSites(_tx: BaseRepoTx, baseId: string) {
    return this.sites.filter((site) => site.baseId === baseId);
  }
}

class FakeAssets implements Pick<BaseAssetPort, "creditBaseInventory" | "createDeviceAsset" | "listBaseInventory"> {
  credits: Array<{ baseId: string; itemId: string; quantity: number }> = [];
  devices: Array<{ input: Parameters<BaseAssetPort["createDeviceAsset"]>[1]; deviceId: string }> = [];
  inventory: Array<{ itemId: string; quantity: number; reservedQuantity: number }> = [];

  async creditBaseInventory(_tx: BaseRepoTx, baseId: string, itemId: string, quantity: number) {
    this.credits.push({ baseId, itemId, quantity });
  }

  async createDeviceAsset(_tx: BaseRepoTx, input: Parameters<BaseAssetPort["createDeviceAsset"]>[1]) {
    const deviceId = `dev-${this.devices.length + 1}`;
    this.devices.push({ input, deviceId });
    return { deviceId };
  }

  async listBaseInventory(_tx: BaseRepoTx, _baseId: string) {
    return this.inventory;
  }
}

class FakeRobots implements Pick<RobotFactoryPort, "initializeOperator"> {
  operators: Array<{ input: Parameters<RobotFactoryPort["initializeOperator"]>[1]; operatorId: string }> = [];

  async initializeOperator(_tx: BaseRepoTx, input: Parameters<RobotFactoryPort["initializeOperator"]>[1]) {
    const operatorId = `op-${this.operators.length + 1}`;
    this.operators.push({ input, operatorId });
    return { operatorId };
  }
}

class FakeIndustryInit implements Pick<BaseServiceDeps["industryInit"], "ensurePowerState"> {
  seeds: Array<{
    baseId: string;
    seed: Parameters<BaseServiceDeps["industryInit"]["ensurePowerState"]>[2];
  }> = [];

  async ensurePowerState(_tx: BaseRepoTx, baseId: string, seed: Parameters<BaseServiceDeps["industryInit"]["ensurePowerState"]>[2]) {
    this.seeds.push({ baseId, seed });
  }
}

class FakeCatalog implements Pick<ContentCatalogPort, "getProvisionSeed" | "getRobotTemplate" | "getProjectTemplate" | "listTemplates" | "getRecipeTemplate" | "listRecipes" | "getOrderTemplate" | "listOrderTemplates"> {
  seed: ProvisionSeedSpec;
  robots = new Map<string, RobotTemplateSpec>();
  projects = new Map<string, ProjectTemplateSpec>();

  recipes = new Map<string, RecipeTemplateDto>();

  listTemplates() {
    return { robots: [...this.robots.values()], projects: [...this.projects.values()] };
  }

  getRecipeTemplate(stableId: string) {
    return this.recipes.get(stableId) ?? null;
  }

  listRecipes() {
    return [];
  }

  getOrderTemplate(stableId: string) {
    return null;
  }

  listOrderTemplates() {
    return [];
  }

  getItemInfo(): Record<string, { name: string; description: string }> {
    return {
      anchor: { name: "锚固件", description: "地基锚固件" },
      spare_parts: { name: "通用备件", description: "维修耗材" }
    };
  }

  getFacilityInfo(stableId: string) {
    return stableId === "solar_array_unit"
      ? {
          name: "太阳能阵列单元",
          note: "昼间为基地供电",
          description: "现场安装并网的阵列单元。",
          attributes: [{ label: "峰值发电", value: "5.0 kW" }]
        }
      : null;
  }

  constructor(seed: ProvisionSeedSpec) {
    this.seed = seed;
  }

  getProvisionSeed(): ProvisionSeedSpec {
    return this.seed;
  }

  getRobotTemplate(stableId: string): RobotTemplateSpec | null {
    return this.robots.get(stableId) ?? null;
  }

  getProjectTemplate(stableId: string): ProjectTemplateSpec | null {
    return this.projects.get(stableId) ?? null;
  }
}

class FakeIndustryRead implements Pick<BaseIndustryReadPort, "getPowerState" | "listProjects" | "listSteps"> {
  power: Awaited<ReturnType<BaseIndustryReadPort["getPowerState"]>> = null;
  projects: Awaited<ReturnType<BaseIndustryReadPort["listProjects"]>> = [];
  steps: Awaited<ReturnType<BaseIndustryReadPort["listSteps"]>> = [];

  async getPowerState(baseId: string) {
    return this.power;
  }

  async listProjects(baseId: string) {
    return this.projects;
  }

  async listSteps(projectIds: string[]) {
    return this.steps.filter((step) => projectIds.includes(step.projectId));
  }
}

class FakeRobotRead implements Pick<BaseRobotReadPort, "listOperators"> {
  operators: Awaited<ReturnType<BaseRobotReadPort["listOperators"]>> = [];

  async listOperators(baseId: string) {
    return this.operators;
  }
}

const PROVISION_SEED: ProvisionSeedSpec = {
  releaseId: "release-yudian-0.12",
  baseName: "余电前哨",
  power: { generationWPeak: 15000, storageCapacityWh: 200000, initialStorageWh: 100000 },
  sites: [
    {
      siteKey: "array",
      name: "太阳能阵列",
      state: "built",
      facilityRef: { kind: "facility", stableId: "solar_array_unit", revision: 1 }
    },
    { siteKey: "storage", name: "储能间", state: "built" },
    { siteKey: "site_a", name: "建设位 A", state: "free" }
  ],
  inventory: [
    { itemId: "anchor", quantity: 8 },
    { itemId: "spare_parts", quantity: 30 }
  ],
  devices: [
    { templateStableId: "yd-h1", groupId: "transport", count: 2, initialBatteryWh: 12000 },
    { templateStableId: "yd-e1", groupId: "engineering", count: 1, initialBatteryWh: 18000 }
  ]
};

type ManufacturingJobReadRecord = Awaited<
  ReturnType<BaseServiceDeps["manufacturingRead"]["listJobsForBase"]>
>[number];

interface Fixture {
  service: BaseService;
  repo: FakeBaseRepository;
  assets: FakeAssets;
  robots: FakeRobots;
  industryInit: FakeIndustryInit;
  catalog: FakeCatalog;
  industryRead: FakeIndustryRead;
  robotRead: FakeRobotRead;
  manufacturingJobs: ManufacturingJobReadRecord[];
  settlementCalls: Date[];
}

function createFixture(options: {
  now?: Date;
  clock?: { now(): Date };
  seed?: ProvisionSeedSpec;
} = {}): Fixture {
  const repo = new FakeBaseRepository();
  const assets = new FakeAssets();
  const robots = new FakeRobots();
  const industryInit = new FakeIndustryInit();
  const catalog = new FakeCatalog(options.seed ?? PROVISION_SEED);
  catalog.robots.set("yd-h1", {
    ref: { kind: "robot_template", stableId: "yd-h1", revision: 1 },
    name: "驮运机器人 YD-H1",
    groupId: "transport",
    description: "资源运输组：货场与建设位之间的往返搬运。",
    batteryCapacityWh: 20000
  });
  catalog.robots.set("yd-e1", {
    ref: { kind: "robot_template", stableId: "yd-e1", revision: 2 },
    name: "筑垒机器人 YD-E1",
    groupId: "engineering",
    description: "工程维护组：清场、安装、接线、检修。",
    batteryCapacityWh: 30000
  });
  catalog.projects.set("install_solar_array", {
    ref: { kind: "project", stableId: "install_solar_array", revision: 1 },
    name: "安装太阳电池阵",
    description: "把运抵的太阳电池阵安装到建设位并并网。",
    inputs: [{ itemId: "solar_panel_set", quantity: 6 }]
  });
  const industryRead = new FakeIndustryRead();
  const robotRead = new FakeRobotRead();
  const manufacturingJobs: ManufacturingJobReadRecord[] = [];
  const fakeDb = {} as unknown as BaseDb; // 无 transaction：直用当前 repo（透传模式的替身路径）
  const settlementCalls: Date[] = [];

  const service = new BaseService({
    db: fakeDb,
    clock: options.clock ?? clockAt(options.now ?? T1),
    repo: repo as unknown as BaseRepository,
    settleConfirmedThrough: async (_tx, baseId, at) => {
      settlementCalls.push(at);
      const base = repo.bases.find((candidate) => candidate.id === baseId);
      const lease = repo.leases.get(baseId);
      if (!base || !lease || base.timeMode !== "running") return;
      const end = Math.min(at.getTime(), lease.updatedAt.getTime());
      if (end <= base.lastAdvancedAt.getTime()) return;
      base.simTime = new Date(base.simTime.getTime() + (end - base.lastAdvancedAt.getTime()) * base.speed);
      base.lastAdvancedAt = new Date(end);
      base.baseRevision += 1;
    },
    assets,
    robots,
    industryInit,
    catalog,
    industryRead,
    robotRead,
    manufacturingRead: { listJobsForBase: async () => manufacturingJobs },
    cooperationRead: { listByBase: async () => [] },
    economyRead: {
      getCredits: async () => 500,
      listOrdersForBase: async () => [],
      listPurchasesForBase: async () => []
    }
  });
  return { service, repo, assets, robots, industryInit, catalog, industryRead, robotRead, manufacturingJobs, settlementCalls };
}

describe("BaseService.provision", () => {
  it("assembles the full seed chain inside one transaction and stores the receipt", async () => {
    const fx = createFixture();

    const result = await fx.service.provision({ accountId: ACCOUNT_ID }, { commandId: "cmd-1" });

    expect(result.duplicate).toBe(false);

    const base = fx.repo.bases[0]!;
    expect(base).toBeDefined();
    expect(base.accountId).toBe(ACCOUNT_ID);
    expect(base.name).toBe("余电前哨");
    expect(base.contentRelease).toBe("release-yudian-0.12");
    expect(base.timeMode).toBe("paused");
    expect(base.speed).toBe(1);
    expect(base.simTime).toEqual(T0);
    expect(base.lastAdvancedAt).toEqual(T1);
    const baseId = base.id;

    expect(fx.repo.sites).toEqual([
      {
        id: expect.any(String),
        baseId,
        siteKey: "array",
        state: "built",
        builtFacilityRef: "facility:solar_array_unit@1"
      },
      {
        id: expect.any(String),
        baseId,
        siteKey: "storage",
        state: "built",
        builtFacilityRef: null
      },
      { id: expect.any(String), baseId, siteKey: "site_a", state: "free", builtFacilityRef: null }
    ]);

    expect(fx.industryInit.seeds).toEqual([
      { baseId, seed: PROVISION_SEED.power }
    ]);

    expect(fx.assets.credits).toEqual([
      { baseId, itemId: "anchor", quantity: 8 },
      { baseId, itemId: "spare_parts", quantity: 30 }
    ]);

    // 3 台设备：sourceOperation 每实例唯一（公共前缀 provision:${accountId}），
    // 模板修订取 catalog.getRobotTemplate。
    expect(fx.assets.devices.map((device) => device.input)).toEqual([
      {
        baseId,
        deviceDefId: "yd-h1",
        templateRevision: 1,
        sourceOperation: `provision:${ACCOUNT_ID}:yd-h1:1`
      },
      {
        baseId,
        deviceDefId: "yd-h1",
        templateRevision: 1,
        sourceOperation: `provision:${ACCOUNT_ID}:yd-h1:2`
      },
      {
        baseId,
        deviceDefId: "yd-e1",
        templateRevision: 2,
        sourceOperation: `provision:${ACCOUNT_ID}:yd-e1:1`
      }
    ]);

    // 作业者 1:1 关联设备；groupId/电池容量取模板，期初电量取种子。
    expect(fx.robots.operators.map((operator) => operator.input)).toEqual([
      {
        deviceId: "dev-1",
        baseId,
        groupId: "transport",
        batteryCapacityWh: 20000,
        initialBatteryWh: 12000
      },
      {
        deviceId: "dev-2",
        baseId,
        groupId: "transport",
        batteryCapacityWh: 20000,
        initialBatteryWh: 12000
      },
      {
        deviceId: "dev-3",
        baseId,
        groupId: "engineering",
        batteryCapacityWh: 30000,
        initialBatteryWh: 18000
      }
    ]);

    expect(fx.repo.savedResults).toEqual([{ baseId, duplicate: false }]);
  });

  it("replays the stored receipt with the same baseId without re-seeding anything", async () => {
    const fx = createFixture();
    const key = `account:${ACCOUNT_ID}|${BASE_PROVISION_COMMAND_KIND}|cmd-1`;
    fx.repo.receipts.set(key, {
      requestHash: hashRequestPayload({}),
      result: { baseId: "base-42", duplicate: false }
    });

    const result = await fx.service.provision({ accountId: ACCOUNT_ID }, { commandId: "cmd-1" });

    expect(result).toEqual({ baseId: "base-42", duplicate: true });
    expect(fx.repo.bases).toHaveLength(0);
    expect(fx.repo.sites).toHaveLength(0);
    expect(fx.assets.devices).toHaveLength(0);
    expect(fx.robots.operators).toHaveLength(0);
    expect(fx.assets.credits).toHaveLength(0);
    expect(fx.industryInit.seeds).toHaveLength(0);
  });

  it("converges to the owned base under a fresh commandId instead of inserting a second base", async () => {
    const fx = createFixture();
    fx.repo.bases.push(makeBase({ accountId: ACCOUNT_ID, id: "base-7" }));

    const result = await fx.service.provision({ accountId: ACCOUNT_ID }, { commandId: "cmd-2" });

    expect(result).toEqual({ baseId: "base-7", duplicate: true });
    expect(fx.repo.bases).toHaveLength(1);
    expect(fx.repo.sites).toHaveLength(0);
    expect(fx.assets.devices).toHaveLength(0);
    expect(fx.robots.operators).toHaveLength(0);
    expect(fx.assets.credits).toHaveLength(0);
    expect(fx.industryInit.seeds).toHaveLength(0);
    // 新 commandId 的收据照常落库，之后同 ID 重放收敛到同一结果。
    expect(fx.repo.savedResults).toEqual([{ baseId: "base-7", duplicate: true }]);
  });

  it("raises IDEMPOTENCY_CONFLICT when the same commandId carries a different request hash", async () => {
    const fx = createFixture();
    const key = `account:${ACCOUNT_ID}|${BASE_PROVISION_COMMAND_KIND}|cmd-1`;
    fx.repo.receipts.set(key, {
      requestHash: "hash-of-a-different-request",
      result: { baseId: "base-42", duplicate: false }
    });

    await expect(
      fx.service.provision({ accountId: ACCOUNT_ID }, { commandId: "cmd-1" })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(fx.repo.bases).toHaveLength(0);
  });

  it("raises CONTENT_INCOMPATIBLE when the seed references an unknown robot template", async () => {
    const fx = createFixture({
      seed: {
        ...PROVISION_SEED,
        devices: [{ templateStableId: "yd-ghost", groupId: "survey", count: 1, initialBatteryWh: 0 }]
      }
    });

    await expect(
      fx.service.provision({ accountId: ACCOUNT_ID }, { commandId: "cmd-1" })
    ).rejects.toMatchObject({ code: "CONTENT_INCOMPATIBLE" });
  });
});

describe("BaseService foreground control", () => {
  it("renew records a checkpoint without moving the settlement cursor", async () => {
    const time = { current: T0, now() { return this.current; } };
    const fx = createFixture({ clock: time });
    const base = makeBase({ timeMode: "running" });
    fx.repo.bases.push(base);
    const acquired = await fx.service.heartbeat({ accountId: ACCOUNT_ID }, { action: "acquire" });
    time.current = new Date(T0.getTime() + 30_000);
    const renewed = await fx.service.heartbeat({ accountId: ACCOUNT_ID }, {
      action: "renew", controlToken: acquired.controlToken
    });
    expect(renewed.controlToken).toBe(acquired.controlToken);
    expect(renewed.leaseUntil).toBe(new Date(time.current.getTime() + BASE_LEASE_TTL_MS).toISOString());
    expect(fx.repo.leases.get(base.id)?.updatedAt).toEqual(time.current);
    expect(base.lastAdvancedAt).toEqual(T0);
  });

  it("settles the previous confirmed span before a new tab takes control and rejects stale tokens", async () => {
    const time = { current: T1, now() { return this.current; } };
    const fx = createFixture({ clock: time });
    const base = makeBase({ timeMode: "running" });
    fx.repo.bases.push(base);
    fx.repo.leases.set(base.id, {
      leaseToken: "old-tab",
      leaseUntil: new Date(T1.getTime() - 60_000),
      updatedAt: new Date(T0.getTime() + 2 * 60_000)
    });

    const acquired = await fx.service.heartbeat({ accountId: ACCOUNT_ID }, { action: "acquire" });
    expect(acquired.controlToken).toEqual(expect.any(String));
    expect(acquired.controlToken).not.toBe("old-tab");
    expect(base.simTime).toEqual(new Date(S0.getTime() + 2 * 60_000));
    expect(base.lastAdvancedAt).toEqual(T1);
    expect(fx.repo.leases.get(base.id)?.updatedAt).toEqual(T1);
    await expect(fx.service.heartbeat(
      { accountId: ACCOUNT_ID },
      { action: "renew", controlToken: "old-tab" }
    )).rejects.toMatchObject({ code: "CONTROL_EXPIRED" });
  });

  it("settles using the old speed before speed change or pause, then resumes without offline time", async () => {
    const time = { current: T0, now() { return this.current; } };
    const fx = createFixture({ clock: time });
    const base = makeBase({ timeMode: "running" });
    fx.repo.bases.push(base);
    const acquired = await fx.service.heartbeat({ accountId: ACCOUNT_ID }, { action: "acquire" });
    const token = acquired.controlToken!;

    time.current = new Date(T0.getTime() + 60_000);
    await fx.service.applyCommand({ accountId: ACCOUNT_ID }, { command: "set_speed", speed: 4 }, token);
    expect(base.simTime).toEqual(new Date(S0.getTime() + 60_000));
    expect(base.speed).toBe(4);

    time.current = new Date(T0.getTime() + 2 * 60_000);
    await fx.service.applyCommand({ accountId: ACCOUNT_ID }, { command: "pause" }, token);
    expect(base.simTime).toEqual(new Date(S0.getTime() + 5 * 60_000));
    time.current = new Date(T0.getTime() + 12 * 60_000);
    const resumedControl = await fx.service.heartbeat({ accountId: ACCOUNT_ID }, { action: "acquire" });
    await fx.service.applyCommand({ accountId: ACCOUNT_ID }, { command: "resume" }, resumedControl.controlToken!);
    expect(base.simTime).toEqual(new Date(S0.getTime() + 5 * 60_000));
    expect(base.lastAdvancedAt).toEqual(time.current);
  });

  it("release confirms departure and closes the lease", async () => {
    const time = { current: T0, now() { return this.current; } };
    const fx = createFixture({ clock: time });
    const base = makeBase({ timeMode: "running" });
    fx.repo.bases.push(base);
    const acquired = await fx.service.heartbeat({ accountId: ACCOUNT_ID }, { action: "acquire" });
    time.current = new Date(T0.getTime() + 60_000);
    const released = await fx.service.heartbeat({ accountId: ACCOUNT_ID }, {
      action: "release", controlToken: acquired.controlToken
    });
    expect(released.controlToken).toBeNull();
    expect(base.simTime).toEqual(new Date(S0.getTime() + 60_000));
    expect(fx.repo.leases.has(base.id)).toBe(false);
  });
});

describe("BaseService.clock", () => {
  it("validates speed before mutating the lease or settlement", async () => {
    const fx = createFixture({ now: T1 });
    fx.repo.bases.push(makeBase({ timeMode: "running" }));

    await expect(
      fx.service.applyCommand({ accountId: ACCOUNT_ID }, { command: "set_speed", speed: 3 }, "stale")
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fx.repo.leases.size).toBe(0);
    expect(fx.settlementCalls).toEqual([]);
  });

  it("raises BASE_SCOPE_INVALID for accounts without a base (clock and heartbeat alike)", async () => {
    const fx = createFixture({ now: T1 });

    await expect(
      fx.service.applyCommand({ accountId: "nobody" }, { command: "resume" }, "token")
    ).rejects.toMatchObject({ code: "BASE_SCOPE_INVALID" });
    await expect(fx.service.heartbeat({ accountId: "nobody" }, { action: "acquire" })).rejects.toMatchObject({
      code: "BASE_SCOPE_INVALID"
    });
  });
});

describe("BaseService.snapshot", () => {
  it("assembles the complete BaseSnapshotDto from world rows plus read ports", async () => {
    const fx = createFixture({ now: T1 });
    fx.repo.bases.push(
      makeBase({
        timeMode: "running",
        speed: 2,
        baseRevision: 7,
        contentRelease: "release-yudian-0.12"
      })
    );
    fx.repo.sites.push(
      { id: "site-b", baseId: "base-1", siteKey: "storage", state: "built", builtFacilityRef: "facility:solar_array_unit@1" },
      { id: "site-a", baseId: "base-1", siteKey: "site_a", state: "free", builtFacilityRef: null }
    );
    fx.repo.leases.set("base-1", {
      leaseToken: `account:${ACCOUNT_ID}`,
      leaseUntil: new Date(T1.getTime() + 60_000),
      updatedAt: T1
    });
    fx.assets.inventory = [
      { itemId: "anchor", quantity: 8, reservedQuantity: 8 },
      { itemId: "spare_parts", quantity: 30, reservedQuantity: 6 }
    ];
    fx.industryRead.power = {
      generationWPeak: 15000,
      storageWh: 100000,
      storageCapacityWh: 200000,
      lastLoadW: 1000,
      dustLevel: 30
    };
    fx.industryRead.projects = [
      {
        id: "p-1",
        projectDefId: "install_solar_array",
        templateRevision: 1,
        status: "active",
        currentStepIndex: 1,
        siteId: "site-a",
        reservedInputs: [{ itemId: "anchor", quantity: 8 }]
      }
    ];
    fx.industryRead.steps = [
      {
        projectId: "p-1",
        stepIndex: 1,
        kind: "transport",
        groupId: "transport",
        status: "running",
        workRequired: 60,
        workDone: 10,
        blockedReason: null
      },
      {
        projectId: "p-1",
        stepIndex: 0,
        kind: "site_clearing",
        groupId: "engineering",
        status: "completed",
        workRequired: 40,
        workDone: 40,
        blockedReason: null
      }
    ];
    fx.robotRead.operators = [
      {
        operatorId: "op-1",
        deviceId: "dev-1",
        deviceDefId: "yd-h1",
        groupId: "transport",
        batteryWh: 12000,
        batteryCapacityWh: 20000,
        status: "working",
        currentProjectId: "p-1",
        currentStepIndex: 1
      },
      {
        operatorId: "op-2",
        deviceId: "dev-2",
        deviceDefId: "yd-e1",
        groupId: "engineering",
        batteryWh: 30000,
        batteryCapacityWh: 30000,
        status: "idle",
        currentProjectId: null,
        currentStepIndex: null
      }
    ];
    fx.catalog.recipes.set("manufacture-yd-s1", {
      ref: { kind: "recipe", stableId: "manufacture-yd-s1", revision: 1 },
      name: "制造望山巡检机器人",
      description: "用备件组装一台轻量勘测巡检机器人。",
      inputs: [{ itemId: "spare_parts", quantity: 3 }],
      workPerUnit: 20,
      output: { templateStableId: "yd-s1", initialBatteryWh: 6000 }
    });
    fx.manufacturingJobs.push({
      id: "job-1",
      recipeDefId: "manufacture-yd-s1",
      recipeRevision: 1,
      status: "active",
      outputsPlanned: 2,
      outputsDone: 0,
      currentUnitWorkDone: 0,
      reservedInputs: [{ itemId: "spare_parts", quantity: 6 }],
      blockedReason: null
    });

    const snapshot: BaseSnapshotDto = await fx.service.snapshot({ accountId: ACCOUNT_ID }, `account:${ACCOUNT_ID}`);

    expect(snapshot).toEqual({
      name: "余电前哨",
      baseId: "base-1",
      epoch: 1,
      baseRevision: 7,
      simTime: S0.toISOString(),
      timeMode: "running",
      speed: 2,
      activeContentRelease: "release-yudian-0.12",
      power: {
        generationWPeak: 15000,
        availableW: 15000,
        storageWh: 100000,
        storageCapacityWh: 200000,
        loadW: 1000
      },
      resources: [
        {
          itemId: "anchor",
          name: "锚固件",
          quantity: 8,
          reservedQuantity: 8,
          reservationSources: [{ kind: "project", id: "p-1", name: "安装太阳电池阵", quantity: 8 }],
          description: "地基锚固件"
        },
        {
          itemId: "spare_parts",
          name: "通用备件",
          quantity: 30,
          reservedQuantity: 6,
          reservationSources: [
            { kind: "manufacturing", id: "job-1", name: "制造望山巡检机器人", quantity: 6 }
          ],
          description: "维修耗材"
        }
      ],
      sites: [
        {
          siteId: "site-b",
          siteKey: "storage",
          name: "储能间",
          state: "built",
          note: "昼间为基地供电",
          description: "现场安装并网的阵列单元。",
          attributes: [{ label: "峰值发电", value: "5.0 kW" }]
        },
        {
          siteId: "site-a",
          siteKey: "site_a",
          name: "建设位 A",
          state: "free",
          note: null,
          description: null,
          attributes: []
        }
      ],
      devices: [
        {
          deviceId: "dev-1",
          operatorId: "op-1",
          name: "驮运机器人 YD-H1",
          groupId: "transport",
          description: "资源运输组：货场与建设位之间的往返搬运。",
          status: "working",
          batteryWh: 12000,
          batteryCapacityWh: 20000,
          currentAssignment: { projectId: "p-1", stepIndex: 1 }
        },
        {
          deviceId: "dev-2",
          operatorId: "op-2",
          name: "筑垒机器人 YD-E1",
          groupId: "engineering",
          description: "工程维护组：清场、安装、接线、检修。",
          status: "idle",
          batteryWh: 30000,
          batteryCapacityWh: 30000,
          currentAssignment: null
        }
      ],
      projects: [
        {
          projectId: "p-1",
          definitionRef: { kind: "project", stableId: "install_solar_array", revision: 1 },
          name: "安装太阳电池阵",
          status: "active",
          siteId: "site-a",
          steps: [
            {
              index: 0,
              kind: "site_clearing",
              groupId: "engineering",
              status: "completed",
              workRequired: 40,
              workDone: 40,
              blockedReason: null
            },
            {
              index: 1,
              kind: "transport",
              groupId: "transport",
              status: "running",
              workRequired: 60,
              workDone: 10,
              blockedReason: null
            }
          ]
        }
      ],
      buildableProjects: [
        {
          definitionRef: { kind: "project", stableId: "install_solar_array", revision: 1 },
          name: "安装太阳电池阵",
          description: "把运抵的太阳电池阵安装到建设位并并网。",
          inputs: [{ itemId: "solar_panel_set", quantity: 6 }]
        }
      ],
      availableRecipes: [],
      manufacturingJobs: [
        {
          jobId: "job-1",
          recipeRef: { kind: "recipe", stableId: "manufacture-yd-s1", revision: 1 },
          recipeName: "制造望山巡检机器人",
          status: "active",
          outputsPlanned: 2,
          outputsDone: 0,
          currentUnitWorkDone: 0,
          blockedReason: null
        }
      ],
      cooperationRequests: [],
      credits: 500,
      orders: [],
      purchases: [],
      weather: {
        current: "clear",
        lightFactor: 1.0,
        dustLevel: 30,
        nextChangeAt: "2026-09-19T02:00:00.000Z", // fallback：无天气绑定 → base.simTime
        nextWeather: "clear"
      },
      controlLease: {
        heldByThisSession: true,
        controlActive: true,
        leaseUntil: new Date(T1.getTime() + 60_000).toISOString()
      }
    });
  });

  it("projects reservationSources from live holders only, skipping terminal projects and jobs", async () => {
    const fx = createFixture({ now: T1 });
    fx.repo.bases.push(makeBase());
    fx.assets.inventory = [
      { itemId: "anchor", quantity: 8, reservedQuantity: 8 },
      { itemId: "spare_parts", quantity: 30, reservedQuantity: 6 }
    ];
    fx.industryRead.projects = [
      {
        id: "p-1",
        projectDefId: "install_solar_array",
        templateRevision: 1,
        status: "active",
        currentStepIndex: 0,
        siteId: "site-a",
        reservedInputs: [{ itemId: "anchor", quantity: 4 }]
      },
      {
        // 已取消：预留已释放，持久 reserved_inputs 是历史值，不得再作占用来源。
        id: "p-2",
        projectDefId: "install_solar_array",
        templateRevision: 1,
        status: "cancelled",
        currentStepIndex: 0,
        siteId: "site-b",
        reservedInputs: [{ itemId: "anchor", quantity: 8 }]
      }
    ];
    // recipeDefId 不在目录里：来源名称回退到定义 ID（同项目/工单名称回退语义）。
    fx.manufacturingJobs.push(
      {
        id: "job-1",
        recipeDefId: "manufacture-ghost",
        recipeRevision: 1,
        status: "paused",
        outputsPlanned: 2,
        outputsDone: 0,
        currentUnitWorkDone: 0,
        reservedInputs: [
          { itemId: "anchor", quantity: 4 },
          { itemId: "spare_parts", quantity: 6 }
        ],
        blockedReason: null
      },
      {
        // 已完成：结算逐台消耗后不再持有预留。
        id: "job-2",
        recipeDefId: "manufacture-ghost",
        recipeRevision: 1,
        status: "completed",
        outputsPlanned: 1,
        outputsDone: 1,
        currentUnitWorkDone: 0,
        reservedInputs: [{ itemId: "anchor", quantity: 4 }],
        blockedReason: null
      }
    );

    const snapshot = await fx.service.snapshot({ accountId: ACCOUNT_ID });

    const anchor = snapshot.resources.find((resource) => resource.itemId === "anchor");
    const spareParts = snapshot.resources.find((resource) => resource.itemId === "spare_parts");
    expect(anchor).toEqual({
      itemId: "anchor",
      name: "锚固件",
      quantity: 8,
      reservedQuantity: 8,
      reservationSources: [
        { kind: "project", id: "p-1", name: "安装太阳电池阵", quantity: 4 },
        { kind: "manufacturing", id: "job-1", name: "manufacture-ghost", quantity: 4 }
      ],
      description: "地基锚固件"
    });
    expect(spareParts).toEqual({
      itemId: "spare_parts",
      name: "通用备件",
      quantity: 30,
      reservedQuantity: 6,
      reservationSources: [
        { kind: "manufacturing", id: "job-1", name: "manufacture-ghost", quantity: 6 }
      ],
      description: "维修耗材"
    });
  });

  it("marks the control lease as not held when it has expired", async () => {
    const fx = createFixture({ now: T1 });
    fx.repo.bases.push(makeBase());
    fx.repo.leases.set("base-1", {
      leaseToken: `account:${ACCOUNT_ID}`,
      leaseUntil: new Date(T0.getTime()),
      updatedAt: T0
    });

    const snapshot = await fx.service.snapshot({ accountId: ACCOUNT_ID });

    expect(snapshot.controlLease).toEqual({
      heldByThisSession: false,
      controlActive: false,
      leaseUntil: T0.toISOString()
    });
  });

  it("raises BASE_SCOPE_INVALID when the account has no base (S2)", async () => {
    const fx = createFixture({ now: T1 });

    await expect(fx.service.snapshot({ accountId: "nobody" })).rejects.toMatchObject({
      code: "BASE_SCOPE_INVALID"
    });
  });
});
