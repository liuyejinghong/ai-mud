import { describe, expect, it } from "vitest";
import type { BaseSnapshotDto } from "@ai-mud/shared";
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
  leases = new Map<string, { leaseToken: string; leaseUntil: Date }>();
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
    this.leases.set(input.baseId, { leaseToken: input.leaseToken, leaseUntil: input.leaseUntil });
  }

  async getControlLease(_tx: BaseRepoTx, baseId: string) {
    const lease = this.leases.get(baseId);
    return lease ? { baseId, leaseToken: lease.leaseToken, leaseUntil: lease.leaseUntil } : null;
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

class FakeCatalog implements Pick<ContentCatalogPort, "getProvisionSeed" | "getRobotTemplate" | "getProjectTemplate"> {
  seed: ProvisionSeedSpec;
  robots = new Map<string, RobotTemplateSpec>();
  projects = new Map<string, ProjectTemplateSpec>();

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
      state: "built",
      facilityRef: { kind: "facility", stableId: "solar_array_unit", revision: 1 }
    },
    { siteKey: "site_a", state: "free" }
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

interface Fixture {
  service: BaseService;
  repo: FakeBaseRepository;
  assets: FakeAssets;
  robots: FakeRobots;
  industryInit: FakeIndustryInit;
  catalog: FakeCatalog;
  industryRead: FakeIndustryRead;
  robotRead: FakeRobotRead;
}

function createFixture(options: {
  now?: Date;
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
    batteryCapacityWh: 20000
  });
  catalog.robots.set("yd-e1", {
    ref: { kind: "robot_template", stableId: "yd-e1", revision: 2 },
    name: "筑垒机器人 YD-E1",
    groupId: "engineering",
    batteryCapacityWh: 30000
  });
  catalog.projects.set("install_solar_array", {
    ref: { kind: "project", stableId: "install_solar_array", revision: 1 },
    name: "安装太阳电池阵"
  });
  const industryRead = new FakeIndustryRead();
  const robotRead = new FakeRobotRead();
  const fakeDb = {} as unknown as BaseDb; // 无 transaction：直用当前 repo（透传模式的替身路径）

  const service = new BaseService({
    db: fakeDb,
    clock: clockAt(options.now ?? T1),
    repo: repo as unknown as BaseRepository,
    assets,
    robots,
    industryInit,
    catalog,
    industryRead,
    robotRead
  });
  return { service, repo, assets, robots, industryInit, catalog, industryRead, robotRead };
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
    expect(base.simTime).toEqual(T1);
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

describe("BaseService.clock", () => {
  it("resume switches paused to running, resets lastAdvancedAt to now, and renews the lease", async () => {
    const fx = createFixture({ now: T1 });
    const base = makeBase({ timeMode: "paused", baseRevision: 3 });
    fx.repo.bases.push(base);

    const result = await fx.service.applyCommand({ accountId: ACCOUNT_ID }, { command: "resume" });

    expect(result).toEqual({ timeMode: "running", speed: 1, simTime: S0.toISOString() });
    expect(base.timeMode).toBe("running");
    expect(base.lastAdvancedAt).toEqual(T1); // 暂停期不补算
    expect(base.baseRevision).toBe(4);
    expect(fx.repo.leases.get(base.id)?.leaseUntil).toEqual(new Date(T1.getTime() + BASE_LEASE_TTL_MS));
  });

  it("pause only flips timeMode and keeps lastAdvancedAt and the lease untouched", async () => {
    const fx = createFixture({ now: T1 });
    const base = makeBase({ timeMode: "running", speed: 2, baseRevision: 2 });
    fx.repo.bases.push(base);

    const result = await fx.service.applyCommand({ accountId: ACCOUNT_ID }, { command: "pause" });

    expect(result).toEqual({ timeMode: "paused", speed: 2, simTime: S0.toISOString() });
    expect(base.timeMode).toBe("paused");
    expect(base.lastAdvancedAt).toEqual(T0);
    expect(base.baseRevision).toBe(3);
    expect(fx.repo.leases.size).toBe(0); // pause 不清租约也不续租
  });

  it("set_speed validates against BASE_SPEEDS and updates speed without touching time mode", async () => {
    const fx = createFixture({ now: T1 });
    fx.repo.bases.push(makeBase({ timeMode: "running" }));

    await expect(
      fx.service.applyCommand({ accountId: ACCOUNT_ID }, { command: "set_speed", speed: 3 })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const result = await fx.service.applyCommand(
      { accountId: ACCOUNT_ID },
      { command: "set_speed", speed: 4 }
    );
    expect(result).toEqual({ timeMode: "running", speed: 4, simTime: S0.toISOString() });
    expect(fx.repo.bases[0]!.speed).toBe(4);
    expect(fx.repo.bases[0]!.lastAdvancedAt).toEqual(T0);
  });

  it("heartbeat renews the control lease to now + BASE_LEASE_TTL_MS and reports the time mode", async () => {
    const fx = createFixture({ now: T1 });
    fx.repo.bases.push(makeBase({ timeMode: "paused" }));

    const result = await fx.service.heartbeat({ accountId: ACCOUNT_ID });

    expect(result).toEqual({ leaseUntil: new Date(T1.getTime() + BASE_LEASE_TTL_MS).toISOString(), timeMode: "paused" });
    expect(fx.repo.leases.get("base-1")?.leaseToken).toBe(`account:${ACCOUNT_ID}`);
  });

  it("raises BASE_SCOPE_INVALID for accounts without a base (clock and heartbeat alike)", async () => {
    const fx = createFixture({ now: T1 });

    await expect(
      fx.service.applyCommand({ accountId: "nobody" }, { command: "resume" })
    ).rejects.toMatchObject({ code: "BASE_SCOPE_INVALID" });
    await expect(fx.service.heartbeat({ accountId: "nobody" })).rejects.toMatchObject({
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
      leaseUntil: new Date(T1.getTime() + 60_000)
    });
    fx.assets.inventory = [
      { itemId: "anchor", quantity: 8, reservedQuantity: 0 },
      { itemId: "spare_parts", quantity: 30, reservedQuantity: 6 }
    ];
    fx.industryRead.power = {
      generationWPeak: 15000,
      storageWh: 100000,
      storageCapacityWh: 200000,
      lastLoadW: 1000
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

    const snapshot: BaseSnapshotDto = await fx.service.snapshot({ accountId: ACCOUNT_ID });

    expect(snapshot).toEqual({
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
        { itemId: "anchor", name: "anchor", quantity: 8 },
        { itemId: "spare_parts", name: "spare_parts", quantity: 30 }
      ],
      sites: [
        { siteId: "site-b", siteKey: "storage", state: "built" },
        { siteId: "site-a", siteKey: "site_a", state: "free" }
      ],
      devices: [
        {
          deviceId: "dev-1",
          operatorId: "op-1",
          name: "驮运机器人 YD-H1",
          groupId: "transport",
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
      controlLease: {
        heldByThisSession: true,
        leaseUntil: new Date(T1.getTime() + 60_000).toISOString()
      }
    });
  });

  it("marks the control lease as not held when it has expired", async () => {
    const fx = createFixture({ now: T1 });
    fx.repo.bases.push(makeBase());
    fx.repo.leases.set("base-1", {
      leaseToken: `account:${ACCOUNT_ID}`,
      leaseUntil: new Date(T0.getTime())
    });

    const snapshot = await fx.service.snapshot({ accountId: ACCOUNT_ID });

    expect(snapshot.controlLease).toEqual({
      heldByThisSession: false,
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
