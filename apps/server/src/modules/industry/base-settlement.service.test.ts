// M12-B 基地 tick 参与者测试（全部内存假端口；computeBaseTick 为真身）。
import { describe, expect, it } from "vitest";
import type { ProjectTemplateDto, RobotTemplateDto } from "@ai-mud/shared";
import {
  BaseSettlementService,
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
    lastLoadW: 0
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
  bases: Array<{ baseId: string; simTime: Date; speed: number; deltaSimMs: number; nextLastAdvancedAt: Date; catchUp: boolean }> = [];
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
    patch: { storageWh: number; lastLoadW: number }
  ) {
    this.savedPower.push({ baseId, storageWh: patch.storageWh, lastLoadW: patch.lastLoadW });
    const stored = this.power.get(baseId);
    if (stored) {
      stored.storageWh = patch.storageWh;
      stored.lastLoadW = patch.lastLoadW;
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

function makeHarness() {
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
    openIndustry: () => industry,
    openRobots: () => robots
  });
  return { service, clock, sites, assets, catalog, industry, robots };
}

interface ScenarioOptions {
  templateRevision?: number;
  stepOverrides?: Partial<BaseStepRecord>;
  robotOverrides?: Partial<BaseRobotRecord>;
  catalogRevision?: number;
}

function seedStandardBase(harness: ReturnType<typeof makeHarness>, options: ScenarioOptions = {}) {
  harness.clock.bases.push({ baseId: "base-1", simTime: T0, speed: 1, deltaSimMs: TICK_MS, nextLastAdvancedAt: new Date(T0.getTime() + TICK_MS), catchUp: false });
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
      catchUp: false
    });

    const tx = {} as IndustryTx;
    await harness.service.settleBases(tx, new Date(T0.getTime() + TICK_MS));

    const step = harness.industry.savedSteps.at(-1);
    expect(step?.workDone).toBe(4);
  });
});

describe("BaseSettlementService.settleBases > catch-up steps", () => {
  it("追补步只推时钟：不产工作量、不落盘生产状态，仅 saveSimAdvance", async () => {
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
      nextLastAdvancedAt: new Date(T0.getTime() + TICK_MS),
      catchUp: true
    });

    const tx = {} as IndustryTx;
    const settled = await harness.service.settleBases(tx, new Date(T0.getTime() + TICK_MS));

    expect(settled).toBe(1);
    expect(harness.clock.saved).toEqual([
      {
        baseId: "base-1",
        simTime: new Date(T0.getTime() + TICK_MS),
        lastAdvancedAt: new Date(T0.getTime() + TICK_MS)
      }
    ]);
  });
});
