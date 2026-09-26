// M12-B 基地 tick 参与者测试（全部内存假端口；computeBaseTick 为真身）。
import { describe, expect, it } from "vitest";
import type { ProjectTemplateDto, RobotTemplateDto } from "@ai-mud/shared";
import {
  BaseSettlementService,
  type BaseManufacturingSettlePort,
  type BaseSettlementDeps,
  type SettlementAssetPort,
  type SettlementCatalogPort,
  type SettlementClockPort,
  type SettlementRobotPort,
  type SettlementSitePort
} from "./base-settlement.service.js";
import type {
  BasePowerRecord,
  BaseProjectRecord,
  BaseRobotRecord,
  BaseStepRecord,
  BaseTickRobotUpdate,
  BaseTickStepUpdate
} from "./industry.pure.js";
import type {
  IndustryReadPort,
  IndustrySettlementWriter,
  IndustryTx,
  ProjectRecordPatch
} from "./industry.repository.js";

const T0 = new Date("2026-06-01T10:00:00.000Z");
const TICK_MS = 60_000;

const ENGINEERING_TEMPLATE: RobotTemplateDto = {
  ref: { kind: "robot_template", stableId: "yd-e1", revision: 1 },
  name: "YD-E1 筑垒",
  groupId: "engineering",
  description: "工程维护组",
  batteryCapacityWh: 30_000,
  chargeRateW: 6_000,
  workRatePerTick: 1
};

const SURVEY_TEMPLATE: RobotTemplateDto = {
  ref: { kind: "robot_template", stableId: "yd-s1", revision: 1 },
  name: "YD-S1 望山",
  groupId: "survey",
  description: "勘测巡检组",
  batteryCapacityWh: 10_000,
  chargeRateW: 2_000,
  workRatePerTick: 1
};

const PROJECT_TEMPLATE: ProjectTemplateDto = {
  ref: { kind: "project", stableId: "install_solar_array", revision: 1 },
  name: "架设光伏阵列",
  description: "首工程：安装太阳阵列",
  steps: [],
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

function makePower(): BasePowerRecord {
  return {
    generationWPeak: 15_000,
    storageWh: 100_000,
    storageCapacityWh: 200_000,
    lastLoadW: 0,
    dustLevel: 0
  };
}

function makeProject(overrides: Partial<BaseProjectRecord> = {}): BaseProjectRecord {
  return {
    id: "p1",
    projectDefId: "install_solar_array",
    templateRevision: 1,
    status: "active",
    currentStepIndex: 0,
    siteId: "site-1",
    reservedInputs: [
      { itemId: "solar_panel_set", quantity: 6 },
      { itemId: "anchor", quantity: 8 }
    ],
    ...overrides
  };
}

class FakeClock implements SettlementClockPort {
  bases: Array<{ baseId: string; simTime: Date; speed: number; deltaSimMs: number; nextLastAdvancedAt: Date }> = [];
  saved: Array<{ baseId: string; simTime: Date; lastAdvancedAt: Date }> = [];

  async lockAdvanceableBases(_tx: IndustryTx, _now: Date) {
    return this.bases;
  }
  async saveSimAdvance(_tx: IndustryTx, baseId: string, simTime: Date, lastAdvancedAt: Date) {
    this.saved.push({ baseId, simTime, lastAdvancedAt });
  }
}

class FakeSites implements SettlementSitePort {
  built: Array<{ siteId: string; facilityRef: string }> = [];
  async markSiteBuilt(_tx: IndustryTx, siteId: string, facilityRef: string): Promise<void> {
    this.built.push({ siteId, facilityRef });
  }
}

class FakeAssets implements SettlementAssetPort {
  consumed: Array<{ baseId: string; itemId: string; quantity: number }> = [];
  async consumeReservedBaseInventory(
    _tx: IndustryTx,
    baseId: string,
    itemId: string,
    quantity: number
  ): Promise<void> {
    this.consumed.push({ baseId, itemId, quantity });
  }
}

class FakeCatalog implements SettlementCatalogPort {
  robots = new Map<string, RobotTemplateDto>([
    ["yd-e1", ENGINEERING_TEMPLATE],
    ["yd-s1", SURVEY_TEMPLATE]
  ]);
  projects = new Map<string, ProjectTemplateDto>([
    ["install_solar_array", PROJECT_TEMPLATE]
  ]);
  getRobotTemplate(stableId: string): RobotTemplateDto | null {
    return this.robots.get(stableId) ?? null;
  }
  getProjectTemplate(stableId: string): ProjectTemplateDto | null {
    return this.projects.get(stableId) ?? null;
  }
}

class FakeIndustry implements IndustryReadPort, IndustrySettlementWriter {
  readonly generationBumps: Array<{ baseId: string; deltaW: number }> = [];
  power = new Map<string, BasePowerRecord>();
  projects = new Map<string, BaseProjectRecord[]>();
  steps: BaseStepRecord[] = [];
  savedPower: Array<{ baseId: string; storageWh: number; lastLoadW: number }> = [];
  savedSteps: BaseTickStepUpdate[] = [];
  savedProjects: ProjectRecordPatch[] = [];

  async getPowerState(baseId: string) {
    return this.power.get(baseId) ?? null;
  }
  async listProjects(baseId: string) {
    return this.projects.get(baseId) ?? [];
  }
  async listSteps(projectIds: string[]) {
    return this.steps.filter((step) => projectIds.includes(step.projectId));
  }
  async savePowerState(
    _tx: IndustryTx,
    baseId: string,
    patch: { storageWh: number; lastLoadW: number; dustLevel?: number }
  ) {
    this.savedPower.push({ baseId, storageWh: patch.storageWh, lastLoadW: patch.lastLoadW });
    const stored = this.power.get(baseId);
    if (stored) {
      stored.storageWh = patch.storageWh;
      stored.lastLoadW = patch.lastLoadW;
      if (patch.dustLevel !== undefined) stored.dustLevel = patch.dustLevel;
    }
  }
  async saveStepUpdates(_tx: IndustryTx, updates: BaseTickStepUpdate[]) {
    this.savedSteps.push(...updates);
    for (const update of updates) {
      const stored = this.steps.find(
        (step) => step.projectId === update.projectId && step.stepIndex === update.stepIndex
      );
      if (!stored) continue;
      stored.workDone = update.workDone;
      stored.status = update.status as BaseStepRecord["status"];
      stored.blockedReason = update.blockedReason;
    }
  }
  async addGenerationWPeak(tx: unknown, baseId: string, deltaW: number): Promise<void> {
    this.generationBumps.push({ baseId, deltaW });
  }

  async saveProjectUpdates(_tx: IndustryTx, updates: ProjectRecordPatch[]) {
    this.savedProjects.push(...updates);
  }
}

class FakeRobots implements SettlementRobotPort {
  operators = new Map<string, BaseRobotRecord[]>();
  applied: BaseTickRobotUpdate[] = [];
  async listOperators(baseId: string) {
    return this.operators.get(baseId) ?? [];
  }
  async applyRobotUpdates(_tx: IndustryTx, updates: BaseTickRobotUpdate[]) {
    this.applied.push(...updates);
    const byId = new Map(updates.map((update) => [update.operatorId, update]));
    for (const list of this.operators.values()) {
      for (const operator of list) {
        const update = byId.get(operator.operatorId);
        if (!update) continue;
        operator.batteryWh = update.batteryWh;
        operator.status = update.status;
        operator.currentProjectId = update.currentProjectId;
        operator.currentStepIndex = update.currentStepIndex;
      }
    }
  }
}

class FakeManufacturing implements BaseManufacturingSettlePort {
  demandByBase = new Map<string, { settleableJobs: number; pendingWorkWh: number }>();
  measured: string[] = [];
  settled: Array<{
    baseId: string;
    simTime: Date;
    availableEnergyWh: number;
    powerW: number;
    deltaSimMs: number;
  }> = [];
  async measure(_tx: IndustryTx, baseId: string) {
    this.measured.push(baseId);
    return this.demandByBase.get(baseId) ?? { settleableJobs: 0, pendingWorkWh: 0 };
  }
  async settle(
    _tx: IndustryTx,
    baseId: string,
    simTime: Date,
    input: { availableEnergyWh: number; powerW: number; deltaSimMs: number }
  ) {
    this.settled.push({ baseId, simTime, ...input });
    return { unitsProduced: 0, jobsCompleted: 0 };
  }
}

function makeHarness(
  cooperation?: BaseSettlementDeps["cooperation"],
  manufacturing?: BaseManufacturingSettlePort,
  weather?: BaseSettlementDeps["weather"]
) {
  const clock = new FakeClock();
  const sites = new FakeSites();
  const assets = new FakeAssets();
  const catalog = new FakeCatalog();
  const industry = new FakeIndustry();
  const robots = new FakeRobots();
  const service = new BaseSettlementService({
    clock,
    sites,
    assets,
    catalog,
    ...(cooperation ? { cooperation } : {}),
    ...(manufacturing ? { manufacturing } : {}),
    ...(weather ? { weather } : {}),
    openIndustry: () => industry,
    openRobots: () => robots
  });
  return { service, clock, sites, assets, catalog, industry, robots };
}

describe("BaseSettlementService.settleBases > C07 cooperation", () => {
  it.each(["ready", "running"] as const)("%s 且本组无人出工时仍发起协作检测", async (status) => {
    const detected: Array<Array<{ projectId: string; stepIndex: number }>> = [];
    const harness = makeHarness({
      listOpenRequests: async () => [],
      detectAndResolve: async (_tx, _baseId, steps) => { detected.push(steps); },
      applyAcceptedHelpers: async () => 0,
      markFulfilledByStep: async () => {}
    });
    seedStandardBase(harness, {
      stepOverrides: { status, workDone: status === "ready" ? 0 : 10 },
      robotOverrides: {
        deviceDefId: "yd-s1", groupId: "survey", status: "idle",
        currentProjectId: null, currentStepIndex: null
      }
    });

    await harness.service.settleBases({} as IndustryTx, T0);

    expect(detected[0]).toEqual([{
      projectId: "p1", projectName: "架设光伏阵列", stepIndex: 0, groupId: "engineering"
    }]);
  });

  it("running 且本组正在出工时不发请求", async () => {
    const detected: unknown[][] = [];
    const harness = makeHarness({
      listOpenRequests: async () => [],
      detectAndResolve: async (_tx, _baseId, steps) => { detected.push(steps); },
      applyAcceptedHelpers: async () => 0,
      markFulfilledByStep: async () => {}
    });
    seedStandardBase(harness);

    await harness.service.settleBases({} as IndustryTx, T0);

    expect(detected).toEqual([[]]);
  });

  it("running 步骤本组已有可出工电量时不虚报缺工", async () => {
    const detected: unknown[][] = [];
    const harness = makeHarness({
      listOpenRequests: async () => [],
      detectAndResolve: async (_tx, _baseId, steps) => { detected.push(steps); },
      applyAcceptedHelpers: async () => 0,
      markFulfilledByStep: async () => {}
    });
    seedStandardBase(harness, {
      robotOverrides: {
        status: "charging", batteryWh: 506,
        currentProjectId: null, currentStepIndex: null
      }
    });

    await harness.service.settleBases({} as IndustryTx, T0);

    expect(detected).toEqual([[]]);
  });

  it("accepted 跨组 helper 下一 tick 出工，中途步骤完成即 fulfilled", async () => {
    const fulfilled: Array<[string, number]> = [];
    const harness = makeHarness({
      listOpenRequests: async () => [{ status: "accepted", operatorId: "op-1", projectId: "p1", stepIndex: 0 }],
      detectAndResolve: async () => {},
      applyAcceptedHelpers: async () => 0,
      markFulfilledByStep: async (_tx, _baseId, projectId, stepIndex) => {
        fulfilled.push([projectId, stepIndex]);
      }
    });
    seedStandardBase(harness, {
      stepOverrides: { workRequired: 1, workDone: 0 },
      robotOverrides: {
        deviceDefId: "yd-s1", groupId: "survey",
        batteryWh: 10_000, batteryCapacityWh: 10_000
      }
    });
    harness.industry.steps.push({
      projectId: "p1", stepIndex: 1, kind: "commissioning", groupId: "engineering",
      status: "pending", workRequired: 10, workDone: 0, blockedReason: null
    });

    await harness.service.settleBases({} as IndustryTx, T0);

    expect(harness.industry.steps[0]).toMatchObject({ status: "completed", workDone: 1 });
    expect(harness.industry.steps[1]).toMatchObject({ status: "ready" });
    expect(harness.robots.operators.get("base-1")?.[0]).toMatchObject({ status: "idle", batteryWh: 9500 });
    expect(fulfilled).toEqual([["p1", 0]]);
    expect(harness.industry.savedProjects.at(-1)?.status).toBe("active");
  });

  it("复电后原步骤可重新接入 charging helper", async () => {
    const runnable: Array<{ projectId: string; stepIndex: number }> = [];
    const harness = makeHarness({
      listOpenRequests: async () => [{ status: "accepted", operatorId: "op-1", projectId: "p1", stepIndex: 0 }],
      detectAndResolve: async () => {},
      applyAcceptedHelpers: async (_tx, _baseId, steps) => { runnable.push(...steps); },
      markFulfilledByStep: async () => {}
    });
    seedStandardBase(harness, {
      stepOverrides: { status: "blocked", blockedReason: "insufficient_power" },
      robotOverrides: {
        deviceDefId: "yd-s1", groupId: "survey", status: "charging",
        batteryWh: 10_000, batteryCapacityWh: 10_000
      }
    });

    await harness.service.settleBases({} as IndustryTx, T0);

    expect(harness.industry.steps[0]?.status).toBe("ready");
    expect(runnable).toEqual([{ projectId: "p1", stepIndex: 0 }]);
  });

  it("旧存档已完成的中途步骤补结案且不再接入 helper", async () => {
    const fulfilled: Array<[string, number]> = [];
    const runnable: Array<{ projectId: string; stepIndex: number }> = [];
    const harness = makeHarness({
      listOpenRequests: async () => [{ status: "accepted", operatorId: "op-1", projectId: "p1", stepIndex: 0 }],
      detectAndResolve: async () => {},
      applyAcceptedHelpers: async (_tx, _baseId, steps) => { runnable.push(...steps); },
      markFulfilledByStep: async (_tx, _baseId, projectId, stepIndex) => {
        fulfilled.push([projectId, stepIndex]);
      }
    });
    seedStandardBase(harness, {
      stepOverrides: { status: "completed", workDone: 80 },
      robotOverrides: { status: "idle", currentProjectId: null, currentStepIndex: null }
    });
    harness.industry.steps.push({
      projectId: "p1", stepIndex: 1, kind: "commissioning", groupId: "engineering",
      status: "pending", workRequired: 10, workDone: 0, blockedReason: null
    });

    await harness.service.settleBases({} as IndustryTx, T0);

    expect(fulfilled).toEqual([["p1", 0]]);
    expect(runnable).toEqual([]);
  });
});

interface ScenarioOptions {
  templateRevision?: number;
  stepOverrides?: Partial<BaseStepRecord>;
  robotOverrides?: Partial<BaseRobotRecord>;
  catalogRevision?: number;
}

function seedStandardBase(harness: ReturnType<typeof makeHarness>, options: ScenarioOptions = {}) {
  harness.clock.bases.push({ baseId: "base-1", simTime: T0, speed: 1, deltaSimMs: TICK_MS, nextLastAdvancedAt: new Date(T0.getTime() + TICK_MS) });
  harness.industry.power.set("base-1", makePower());
  harness.industry.projects.set("base-1", [
    makeProject({ templateRevision: options.templateRevision ?? 1 })
  ]);
  harness.industry.steps = [
    {
      projectId: "p1",
      stepIndex: 0,
      kind: "installation",
      groupId: "engineering",
      status: "running",
      workRequired: 80,
      workDone: 10,
      blockedReason: null,
      ...options.stepOverrides
    }
  ];
  harness.robots.operators.set("base-1", [
    {
      operatorId: "op-1",
      deviceId: "dev-1",
      deviceDefId: "yd-e1",
      groupId: "engineering",
      batteryWh: 30_000,
      batteryCapacityWh: 30_000,
      status: "working",
      currentProjectId: "p1",
      currentStepIndex: 0,
      ...options.robotOverrides
    }
  ]);
}

describe("BaseSettlementService.settleBases", () => {
  it("推进可结算基地：供能/工作量落盘 + 时钟 saveSimAdvance，返回处理数", async () => {
    const harness = makeHarness();
    seedStandardBase(harness);
    const now = new Date("2026-06-01T12:00:00.000Z");

    const handled = await harness.service.settleBases({} as IndustryTx, now);

    expect(handled).toBe(1);
    expect(harness.industry.savedPower).toEqual([
      { baseId: "base-1", storageWh: 100_175, lastLoadW: 3000 }
    ]);
    expect(harness.industry.savedSteps).toEqual([
      { projectId: "p1", stepIndex: 0, workDone: 11, status: "running", blockedReason: null }
    ]);
    expect(harness.robots.applied).toEqual([
      {
        operatorId: "op-1",
        batteryWh: 29_500,
        status: "working",
        currentProjectId: "p1",
        currentStepIndex: 0
      }
    ]);
    expect(harness.industry.savedProjects).toEqual([
      {
        projectId: "p1",
        status: "active",
        currentStepIndex: 0,
        completedAt: null
      }
    ]);
    expect(harness.clock.saved).toEqual([
      { baseId: "base-1", simTime: new Date(T0.getTime() + TICK_MS), lastAdvancedAt: new Date(T0.getTime() + TICK_MS) }
    ]);
  });

  it("验收完成：消耗全部预留物料 + 站点 built(facilityRef) + 项目 completed/completedAt", async () => {
    const harness = makeHarness();
    seedStandardBase(harness, {
      stepOverrides: {
        kind: "commissioning",
        groupId: "survey",
        workRequired: 20,
        workDone: 19
      },
      robotOverrides: {
        deviceDefId: "yd-s1",
        groupId: "survey",
        batteryWh: 10_000,
        batteryCapacityWh: 10_000
      }
    });

    await harness.service.settleBases({} as IndustryTx, new Date());

    expect(harness.assets.consumed).toEqual([
      { baseId: "base-1", itemId: "solar_panel_set", quantity: 6 },
      { baseId: "base-1", itemId: "anchor", quantity: 8 }
    ]);
    expect(harness.sites.built).toEqual([
      { siteId: "site-1", facilityRef: "facility:solar_array_unit@1" }
    ]);
    expect(harness.industry.savedProjects).toEqual([
      {
        projectId: "p1",
        status: "completed",
        currentStepIndex: 0,
        completedAt: new Date(T0.getTime() + TICK_MS)
      }
    ]);
  });

  it("模板 revision 不一致：该项目步骤全 blocked content_missing，不抛、时钟照常推进", async () => {
    const harness = makeHarness();
    seedStandardBase(harness, { templateRevision: 2 });

    const handled = await harness.service.settleBases({} as IndustryTx, new Date());

    expect(handled).toBe(1);
    expect(harness.industry.savedSteps).toEqual([
      { projectId: "p1", stepIndex: 0, workDone: 10, status: "blocked", blockedReason: "content_missing" }
    ]);
    expect(harness.sites.built).toEqual([]);
    expect(harness.assets.consumed).toEqual([]);
    expect(harness.clock.saved).toHaveLength(1);
    // 指向缺失项目的作业者被释放（pure 对未知分配的清理）
    expect(harness.robots.applied).toEqual([
      {
        operatorId: "op-1",
        batteryWh: 30_000,
        status: "idle",
        currentProjectId: null,
        currentStepIndex: null
      }
    ]);
  });

  it("无基地可推进时返回 0 且不写任何状态", async () => {
    const harness = makeHarness();

    const handled = await harness.service.settleBases({} as IndustryTx, new Date());

    expect(handled).toBe(0);
    expect(harness.clock.saved).toHaveLength(0);
    expect(harness.industry.savedPower).toHaveLength(0);
    expect(harness.industry.savedSteps).toHaveLength(0);
    expect(harness.robots.applied).toHaveLength(0);
  });
});

describe("BaseSettlementService.settleBases > sub-tick scaling", () => {
  it("×4 模拟步长拆 4 个子 tick：工作量与能耗按模拟时长推进", async () => {
    const harness = makeHarness();
    harness.industry.power.set("base-1", makePower());
    harness.industry.projects.set("base-1", [makeProject({ status: "active", currentStepIndex: 0 })]);
    harness.industry.steps = [
      {
        projectId: "p1",
        stepIndex: 0,
        kind: "installation",
        groupId: "engineering",
        status: "running",
        workRequired: 80,
        workDone: 0,
        blockedReason: null
      }
    ];
    harness.robots.operators.set("base-1", [
      {
        operatorId: "op-1",
        deviceId: "dev-1",
        deviceDefId: "yd-e1",
        groupId: "engineering",
        batteryWh: 30_000,
        batteryCapacityWh: 30_000,
        status: "working",
        currentProjectId: "p1",
        currentStepIndex: 0
      }
    ]);
    harness.catalog.projects.set("install_solar_array", {
      ...PROJECT_TEMPLATE,
      ref: { kind: "project", stableId: "install_solar_array", revision: 1 }
    });
    harness.clock.bases.push({
      baseId: "base-1",
      simTime: T0,
      speed: 4,
      deltaSimMs: TICK_MS * 4,
      nextLastAdvancedAt: new Date(T0.getTime() + TICK_MS),
    });

    const tx = {} as IndustryTx;
    await harness.service.settleBases(tx, new Date(T0.getTime() + TICK_MS));

    const step = harness.industry.savedSteps.at(-1);
    expect(step?.workDone).toBe(4);
  });
});

describe("BaseSettlementService.settleBases > confirmed foreground catch-up", () => {
  it("已确认时段即使由历史 tick 结清，也正常结算电力和施工", async () => {
    const harness = makeHarness();
    harness.industry.power.set("base-1", makePower());
    harness.industry.projects.set("base-1", [makeProject({ status: "active", currentStepIndex: 0 })]);
    harness.industry.steps = [
      {
        projectId: "p1",
        stepIndex: 0,
        kind: "installation",
        groupId: "engineering",
        status: "running",
        workRequired: 80,
        workDone: 10,
        blockedReason: null
      }
    ];
    harness.robots.operators.set("base-1", [
      {
        operatorId: "op-1",
        deviceId: "dev-1",
        deviceDefId: "yd-e1",
        groupId: "engineering",
        batteryWh: 30_000,
        batteryCapacityWh: 30_000,
        status: "idle",
        currentProjectId: null,
        currentStepIndex: null
      }
    ]);
    harness.clock.bases.push({
      baseId: "base-1",
      simTime: T0,
      speed: 1,
      deltaSimMs: TICK_MS,
      nextLastAdvancedAt: new Date(T0.getTime() + TICK_MS)
    });

    const tx = {} as IndustryTx;
    const settled = await harness.service.settleBases(tx, new Date(T0.getTime() + TICK_MS));

    expect(settled).toBe(1);
    expect(harness.industry.savedPower).toHaveLength(1);
    expect(harness.industry.savedSteps.length).toBeGreaterThan(0);
    expect(harness.clock.saved).toEqual([
      {
        baseId: "base-1",
        simTime: new Date(T0.getTime() + TICK_MS),
        lastAdvancedAt: new Date(T0.getTime() + TICK_MS)
      }
    ]);
  });
});

// ---------- 2026-09-25 B001（ARCH-domain-01）：制造结算按基地隔离 + 计入电力池 ----------

describe("BaseSettlementService.settleBases > B001 制造按基地隔离", () => {
  it("只对被推进的基地测量/结算制造，端口携带该基地 baseId（暂停基地不在推进集合里即不碰）", async () => {
    const manufacturing = new FakeManufacturing();
    manufacturing.demandByBase.set("base-1", { settleableJobs: 1, pendingWorkWh: 1_000 });
    // base-2 暂停：lockAdvanceableBases 不返回它，但它也有在途工单。
    manufacturing.demandByBase.set("base-2", { settleableJobs: 1, pendingWorkWh: 1_000 });
    const harness = makeHarness(undefined, manufacturing);
    seedStandardBase(harness);

    await harness.service.settleBases({} as IndustryTx, T0);

    expect(manufacturing.measured).toEqual(["base-1"]);
    expect(manufacturing.settled.map((entry) => entry.baseId)).toEqual(["base-1"]);
  });

  it("制造负载进入同一电力池：储能扣减、lastLoadW 含 1500W，端口拿到电力池实际分给制造的能量", async () => {
    const manufacturing = new FakeManufacturing();
    manufacturing.demandByBase.set("base-1", { settleableJobs: 1, pendingWorkWh: 1_000 });
    const harness = makeHarness(undefined, manufacturing);
    seedStandardBase(harness);

    await harness.service.settleBases({} as IndustryTx, T0);

    // 发电 13500W；基础 1000 + 施工 2000 + 制造 1500 = 4500W → 盈余 9000W×(1/60)h = 150Wh。
    expect(harness.industry.savedPower).toEqual([
      { baseId: "base-1", storageWh: 100_150, lastLoadW: 4_500 }
    ]);
    expect(manufacturing.settled).toHaveLength(1);
    expect(manufacturing.settled[0]?.availableEnergyWh).toBeCloseTo(25, 6);
    expect(manufacturing.settled[0]?.deltaSimMs).toBe(TICK_MS);
  });

  it("本基地无可结算工单时不调用制造结算、无制造负载", async () => {
    const manufacturing = new FakeManufacturing();
    const harness = makeHarness(undefined, manufacturing);
    seedStandardBase(harness);

    await harness.service.settleBases({} as IndustryTx, T0);

    expect(manufacturing.measured).toEqual(["base-1"]);
    expect(manufacturing.settled).toEqual([]);
    expect(harness.industry.savedPower).toEqual([
      { baseId: "base-1", storageWh: 100_175, lastLoadW: 3000 }
    ]);
  });
});

// ---------- 2026-09-25 B008（ARCH-domain-02）：结算结果只依赖模拟时长 ----------

describe("BaseSettlementService.settleBases > B008 调度频率无关", () => {
  it("同一基地 60 秒一次结算 与 12 次 5 秒结算 的施工工作量、机器人电量一致", async () => {
    const once = makeHarness();
    seedStandardBase(once);
    await once.service.settleBases({} as IndustryTx, T0);

    const frequent = makeHarness();
    seedStandardBase(frequent);
    for (let i = 0; i < 12; i += 1) {
      const simTime = new Date(T0.getTime() + i * 5_000);
      frequent.clock.bases = [{
        baseId: "base-1",
        simTime,
        speed: 1,
        deltaSimMs: 5_000,
        nextLastAdvancedAt: new Date(simTime.getTime() + 5_000),
      }];
      await frequent.service.settleBases({} as IndustryTx, simTime);
    }

    expect(once.industry.steps[0]?.workDone).toBe(11);
    expect(frequent.industry.steps[0]?.workDone).toBe(11);
    expect(frequent.robots.operators.get("base-1")?.[0]?.batteryWh).toBe(
      once.robots.operators.get("base-1")?.[0]?.batteryWh
    );
  });

  it("天气切换和小数积尘按同一基地分钟采样，长调用与逐分钟调用一致", async () => {
    const scenario = () => {
      const sampled: number[] = [];
      const harness = makeHarness(undefined, undefined, {
        current: async (_baseId, simTime) => {
          sampled.push(simTime.getTime());
          return { lightFactor: simTime.getTime() < T0.getTime() + 2 * TICK_MS ? 1 : 0.25 };
        }
      });
      seedStandardBase(harness);
      return { harness, sampled };
    };
    const once = scenario();
    once.harness.clock.bases[0]!.deltaSimMs = 4 * TICK_MS;
    await once.harness.service.settleBases({} as IndustryTx, T0);

    const sliced = scenario();
    for (let minute = 0; minute < 4; minute += 1) {
      sliced.harness.clock.bases[0] = {
        baseId: "base-1",
        simTime: new Date(T0.getTime() + minute * TICK_MS),
        speed: 1,
        deltaSimMs: TICK_MS,
        nextLastAdvancedAt: new Date(T0.getTime() + (minute + 1) * TICK_MS),
      };
      await sliced.harness.service.settleBases({} as IndustryTx, T0);
    }

    expect(once.sampled).toEqual(sliced.sampled);
    expect(once.harness.industry.power.get("base-1")?.storageWh).toBe(sliced.harness.industry.power.get("base-1")?.storageWh);
    expect(once.harness.industry.power.get("base-1")?.dustLevel).toBeCloseTo(8 / 60 * 2, 6);
    expect(once.harness.industry.power.get("base-1")?.dustLevel).toBeCloseTo(sliced.harness.industry.power.get("base-1")?.dustLevel ?? 0, 6);
  });

  it("不足整分钟的余量留在时钟，下一次跨界时只结算那个完整基地分钟", async () => {
    const manufacturing = new FakeManufacturing();
    manufacturing.demandByBase.set("base-1", { settleableJobs: 1, pendingWorkWh: 10_000 });
    const harness = makeHarness(undefined, manufacturing);
    seedStandardBase(harness);
    const deltaSimMs = 100_001;
    harness.clock.bases = [{
      baseId: "base-1",
      simTime: T0,
      speed: 1,
      deltaSimMs,
      nextLastAdvancedAt: new Date(T0.getTime() + deltaSimMs),
    }];

    await harness.service.settleBases({} as IndustryTx, T0);

    expect(manufacturing.settled.map((entry) => [entry.simTime.getTime(), entry.deltaSimMs])).toEqual([
      [T0.getTime(), 60_000]
    ]);
    expect(harness.clock.saved[0]?.simTime.getTime()).toBe(T0.getTime() + 100_001);

    harness.clock.bases = [{
      baseId: "base-1",
      simTime: new Date(T0.getTime() + 100_001),
      speed: 1,
      deltaSimMs: 19_999,
      nextLastAdvancedAt: new Date(T0.getTime() + 120_000),
    }];
    await harness.service.settleBases({} as IndustryTx, T0);
    expect(manufacturing.settled.map((entry) => [entry.simTime.getTime(), entry.deltaSimMs])).toEqual([
      [T0.getTime(), 60_000],
      [T0.getTime() + 60_000, 60_000]
    ]);
  });
});
