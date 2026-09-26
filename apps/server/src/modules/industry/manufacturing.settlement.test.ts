// M13-C 制造结算测试（全部内存假端口，无真库、无真事务）。
// 配方/负载 fixture = m13-p-contract.md §5（manufacture-yd-h1：inputs 4/6/1、
// workPerUnit 30、产出 yd-h1 initialBatteryWh 12000；制造负载 1500W）。
// 能量折算：Δh = deltaSimMs/3_600_000；可用能 = min(powerW×Δh, availableEnergyWh)，1:1 工作点。
// 2026-09-25 B001：结算按基地隔离（deps.baseId），同基地多张工单按 FIFO 分摊本子 tick 预算。
import { describe, expect, it } from "vitest";
import type { RecipeTemplateDto, RobotTemplateDto } from "@ai-mud/shared";
import {
  measureManufacturingDemand,
  settleManufacturing,
  type ManufacturingSettlementDeps,
  type ManufacturingSettleAssetsPort,
  type ManufacturingSettleRobotsPort,
  type ManufacturingSettlementCatalogPort
} from "./manufacturing.settlement.js";
import { CONTENT_BLOCK_REASON, POWER_BLOCK_REASON } from "./industry.pure.js";
import type {
  JobProgressPatch,
  ManufacturingJobRecord,
  ManufacturingOutputRow,
  ManufacturingSettlementRepo,
  ManufacturingTx
} from "./manufacturing.repository.js";

const RECIPE: RecipeTemplateDto = {
  ref: { kind: "recipe", stableId: "manufacture-yd-h1", revision: 1 },
  name: "制造余电-H1",
  description: "整机装配：余电-H1 巡检机器人",
  inputs: [
    { itemId: "support_frame", quantity: 4 },
    { itemId: "spare_parts", quantity: 6 },
    { itemId: "power_box", quantity: 1 }
  ],
  workPerUnit: 30,
  output: { templateStableId: "yd-h1", initialBatteryWh: 12000 }
};

const ROBOT: RobotTemplateDto = {
  ref: { kind: "robot_template", stableId: "yd-h1", revision: 1 },
  name: "余电-H1",
  groupId: "engineering",
  description: "巡检机器人",
  batteryCapacityWh: 20000,
  chargeRateW: 2000,
  workRatePerTick: 10
};

// 该台份额 = inputs 原始量
const UNIT_SHARE = [
  { itemId: "support_frame", quantity: 4 },
  { itemId: "spare_parts", quantity: 6 },
  { itemId: "power_box", quantity: 1 }
];

function makeJob(overrides: Partial<ManufacturingJobRecord> = {}): ManufacturingJobRecord {
  return {
    id: "job-1",
    baseId: "base-1",
    recipeDefId: "manufacture-yd-h1",
    recipeRevision: 1,
    status: "active",
    outputsPlanned: 1,
    outputsDone: 0,
    currentUnitWorkDone: 0,
    reservedInputs: UNIT_SHARE.map((item) => ({ ...item })),
    blockedReason: null,
    ...overrides
  };
}

class FakeCatalog implements ManufacturingSettlementCatalogPort {
  recipes = new Map<string, RecipeTemplateDto>([[RECIPE.ref.stableId, RECIPE]]);
  robots = new Map<string, RobotTemplateDto>([[ROBOT.ref.stableId, ROBOT]]);
  getRecipeTemplate(stableId: string): RecipeTemplateDto | null {
    return this.recipes.get(stableId) ?? null;
  }
  getRobotTemplate(stableId: string): RobotTemplateDto | null {
    return this.robots.get(stableId) ?? null;
  }
}

class FakeSettleAssets implements ManufacturingSettleAssetsPort {
  consumed: Array<{ itemId: string; quantity: number }> = [];
  devices: Array<{
    baseId: string;
    deviceDefId: string;
    templateRevision: number;
    sourceOperation: string;
  }> = [];

  async consumeReservedBaseInventory(
    _tx: ManufacturingTx,
    _baseId: string,
    itemId: string,
    quantity: number
  ): Promise<void> {
    this.consumed.push({ itemId, quantity });
  }

  async createDeviceAsset(
    _tx: ManufacturingTx,
    input: {
      baseId: string;
      deviceDefId: string;
      templateRevision: number;
      sourceOperation: string;
    }
  ): Promise<{ deviceId: string }> {
    this.devices.push(input);
    return { deviceId: `device-${this.devices.length}` };
  }
}

class FakeSettleRobots implements ManufacturingSettleRobotsPort {
  operators: Array<{
    deviceId: string;
    baseId: string;
    groupId: string;
    batteryCapacityWh: number;
    initialBatteryWh: number;
  }> = [];

  async initializeOperator(
    _tx: ManufacturingTx,
    input: {
      deviceId: string;
      baseId: string;
      groupId: string;
      batteryCapacityWh: number;
      initialBatteryWh: number;
    }
  ): Promise<{ operatorId: string }> {
    this.operators.push(input);
    return { operatorId: `operator-${this.operators.length}` };
  }
}

class FakeRepo implements ManufacturingSettlementRepo {
  jobsByBase = new Map<string, ManufacturingJobRecord[]>();
  outputs = new Map<string, ManufacturingOutputRow>();
  saved: JobProgressPatch[] = [];

  constructor(jobs: Array<[string, ManufacturingJobRecord[]]> = [["base-1", []]]) {
    for (const [baseId, list] of jobs) this.jobsByBase.set(baseId, list);
  }

  async listJobsForBase(tx: ManufacturingTx, baseId: string) {
    return this.jobsByBase.get(baseId) ?? [];
  }

  listedBases: string[] = [];

  async listSettleableJobs(
    _tx: ManufacturingTx,
    baseId: string
  ): Promise<ManufacturingJobRecord[]> {
    this.listedBases.push(baseId);
    return (this.jobsByBase.get(baseId) ?? []).filter(
      (job) => job.status === "active" || job.status === "blocked"
    );
  }

  async findOutputByOrdinal(
    _tx: ManufacturingTx,
    jobId: string,
    ordinal: number
  ): Promise<ManufacturingOutputRow | null> {
    return this.outputs.get(`${jobId}:${ordinal}`) ?? null;
  }

  async insertOutput(
    _tx: ManufacturingTx,
    input: { jobId: string; ordinal: number; deviceId: string; operatorId: string }
  ): Promise<{ duplicate: boolean }> {
    const key = `${input.jobId}:${input.ordinal}`;
    if (this.outputs.has(key)) return { duplicate: true };
    this.outputs.set(key, {
      ordinal: input.ordinal,
      deviceId: input.deviceId,
      operatorId: input.operatorId
    });
    return { duplicate: false };
  }

  async saveJobProgress(_tx: ManufacturingTx, patch: JobProgressPatch): Promise<void> {
    this.saved.push(patch);
    for (const list of this.jobsByBase.values()) {
      const job = list.find((entry) => entry.id === patch.jobId);
      if (job) {
        job.status = patch.status;
        job.outputsDone = patch.outputsDone;
        job.currentUnitWorkDone = patch.currentUnitWorkDone;
        job.blockedReason = patch.blockedReason;
        job.reservedInputs = patch.reservedInputs.map((item) => ({ ...item }));
      }
    }
  }
}

function makeDeps(
  jobs: ManufacturingJobRecord[] | Array<[string, ManufacturingJobRecord[]]>,
  energy: { availableEnergyWh?: number; powerW?: number; deltaSimMs?: number; baseId?: string } = {}
) {
  const catalog = new FakeCatalog();
  const settleAssets = new FakeSettleAssets();
  const settleRobots = new FakeSettleRobots();
  const byBase: Array<[string, ManufacturingJobRecord[]]> =
    jobs.length > 0 && Array.isArray(jobs[0])
      ? (jobs as Array<[string, ManufacturingJobRecord[]]>)
      : [["base-1", jobs as ManufacturingJobRecord[]]];
  const repo = new FakeRepo(byBase);
  const deps: ManufacturingSettlementDeps = {
    baseId: energy.baseId ?? "base-1",
    availableEnergyWh: energy.availableEnergyWh ?? 30,
    powerW: energy.powerW ?? 1500,
    deltaSimMs: energy.deltaSimMs ?? 3_600_000,
    catalog,
    settleAssets,
    settleRobots,
    openManufacturing: (tx: ManufacturingTx) => repo
  };
  return { deps, catalog, settleAssets, settleRobots, repo };
}

const tx = {} as ManufacturingTx;
const now = new Date("2026-09-19T08:00:00Z");

describe("settleManufacturing", () => {
  it("新目录仍按旧工单保存的 @1 配方产出 12000Wh", async () => {
    const { deps, settleRobots } = makeDeps([makeJob({ recipeRevision: 1 })]);
    const current = {
      ...RECIPE,
      ref: { ...RECIPE.ref, revision: 2 },
      output: { ...RECIPE.output, initialBatteryWh: 1000 }
    };
    deps.catalog = {
      getRecipeTemplate: (_stableId: string, revision?: number) => revision === 1 ? RECIPE : current,
      getRobotTemplate: () => ROBOT
    };
    expect((await measureManufacturingDemand(tx, "base-1", deps)).pendingWorkWh).toBe(30);
    expect((await settleManufacturing(tx, now, deps)).unitsProduced).toBe(1);
    expect(settleRobots.operators[0]?.initialBatteryWh).toBe(12000);
  });

  it("正常产出单台原子写入：消耗该台份额 → 建设备+作业者 → 写 outputs → 计数推进", async () => {
    const job = makeJob({ outputsPlanned: 1 });
    const { deps, settleAssets, settleRobots, repo } = makeDeps([job], { availableEnergyWh: 30 });

    const result = await settleManufacturing(tx, now, deps);

    expect(result).toEqual({ unitsProduced: 1, jobsCompleted: 1, jobsBlocked: 0, energyUsedWh: 30 });
    expect(settleAssets.consumed).toEqual(UNIT_SHARE);
    expect(settleAssets.devices).toEqual([
      {
        baseId: "base-1",
        deviceDefId: "yd-h1",
        templateRevision: 1,
        sourceOperation: "job:job-1:1"
      }
    ]);
    expect(settleRobots.operators).toEqual([
      {
        deviceId: "device-1",
        baseId: "base-1",
        groupId: "engineering",
        batteryCapacityWh: 20000,
        initialBatteryWh: 12000
      }
    ]);
    expect(repo.outputs.get("job-1:1")).toEqual({
      ordinal: 1,
      deviceId: "device-1",
      operatorId: "operator-1"
    });
    expect(job.outputsDone).toBe(1);
    expect(job.currentUnitWorkDone).toBe(0);
    // 该台份额已从 reserved_inputs 扣除（唯一一台 → 全部清零）
    expect(job.reservedInputs).toEqual(UNIT_SHARE.map((item) => ({ itemId: item.itemId, quantity: 0 })));
  });

  it("完成时 status completed 且落 completedAt；未完成保持 active", async () => {
    const single = makeJob({ outputsPlanned: 1 });
    const { deps: depsSingle } = makeDeps([single], { availableEnergyWh: 30 });
    await settleManufacturing(tx, now, depsSingle);
    expect(single.status).toBe("completed");
    expect(single.outputsDone).toBe(single.outputsPlanned);

    const partial = makeJob({ outputsPlanned: 2, reservedInputs: UNIT_SHARE.map((item) => ({ ...item, quantity: item.quantity * 2 })) });
    const { deps: depsPartial } = makeDeps([partial], { availableEnergyWh: 30 });
    await settleManufacturing(tx, now, depsPartial);
    expect(partial.status).toBe("active");
    expect(partial.outputsDone).toBe(1);
  });

  it("连续多台：本 tick 工作点足够时循环产出（余量清零重计）", async () => {
    const job = makeJob({
      outputsPlanned: 3,
      reservedInputs: UNIT_SHARE.map((item) => ({ ...item, quantity: item.quantity * 3 }))
    });
    const { deps, settleAssets } = makeDeps([job], { availableEnergyWh: 90 });

    const result = await settleManufacturing(tx, now, deps);

    expect(result.unitsProduced).toBe(3);
    expect(settleAssets.consumed).toHaveLength(9); // 3 台 × 3 项
    expect(settleAssets.devices.map((device) => device.sourceOperation)).toEqual([
      "job:job-1:1",
      "job:job-1:2",
      "job:job-1:3"
    ]);
    expect(job.outputsDone).toBe(3);
    expect(job.status).toBe("completed");
    expect(job.currentUnitWorkDone).toBe(0);
  });

  it("余量保留：45 工作点 → 产出 1 台 + current 15（不足下一台）", async () => {
    const job = makeJob({
      outputsPlanned: 2,
      reservedInputs: UNIT_SHARE.map((item) => ({ ...item, quantity: item.quantity * 2 }))
    });
    const { deps } = makeDeps([job], { availableEnergyWh: 45 });

    await settleManufacturing(tx, now, deps);

    expect(job.outputsDone).toBe(1);
    expect(job.currentUnitWorkDone).toBe(15);
    expect(job.status).toBe("active");
  });

  it("电力不足 → blocked 'insufficient_power'，工作量不动、零消耗", async () => {
    const job = makeJob({ currentUnitWorkDone: 7 });
    const { deps, settleAssets, settleRobots } = makeDeps([job], { availableEnergyWh: 0 });

    const result = await settleManufacturing(tx, now, deps);

    expect(result.jobsBlocked).toBe(1);
    expect(result.unitsProduced).toBe(0);
    expect(job.status).toBe("blocked");
    expect(job.blockedReason).toBe(POWER_BLOCK_REASON);
    expect(job.currentUnitWorkDone).toBe(7);
    expect(job.outputsDone).toBe(0);
    expect(settleAssets.consumed).toHaveLength(0);
    expect(settleAssets.devices).toHaveLength(0);
    expect(settleRobots.operators).toHaveLength(0);
  });

  it("复电恢复：blocked 工单恢复供电 → 回 active 继续推进", async () => {
    const job = makeJob({
      status: "blocked",
      blockedReason: POWER_BLOCK_REASON,
      outputsPlanned: 2,
      reservedInputs: UNIT_SHARE.map((item) => ({ ...item, quantity: item.quantity * 2 }))
    });
    const { deps } = makeDeps([job], { availableEnergyWh: 30 });

    const result = await settleManufacturing(tx, now, deps);

    expect(result.jobsBlocked).toBe(0);
    expect(job.status).toBe("active");
    expect(job.blockedReason).toBeNull();
    expect(job.outputsDone).toBe(1);
  });

  it("重复 ordinal 幂等：outputs 已有该 ordinal → 吞掉返回已有，不重复消耗/建设备", async () => {
    const job = makeJob({
      outputsPlanned: 2,
      reservedInputs: UNIT_SHARE.map((item) => ({ ...item, quantity: item.quantity * 2 }))
    });
    const { deps, settleAssets, settleRobots, repo } = makeDeps([job], { availableEnergyWh: 60 });
    // 模拟此前已提交的 ordinal 1（部分完成后的重放）
    repo.outputs.set("job-1:1", { ordinal: 1, deviceId: "device-0", operatorId: "operator-0" });

    const result = await settleManufacturing(tx, now, deps);

    expect(result.unitsProduced).toBe(2);
    // 只有 ordinal 2 真正产出一台：1 台份额消耗 + 1 台设备/作业者
    expect(settleAssets.consumed).toEqual(UNIT_SHARE);
    expect(settleAssets.devices).toEqual([
      {
        baseId: "base-1",
        deviceDefId: "yd-h1",
        templateRevision: 1,
        sourceOperation: "job:job-1:2"
      }
    ]);
    expect(settleRobots.operators).toHaveLength(1);
    expect(job.outputsDone).toBe(2);
    expect(job.status).toBe("completed");
  });

  it("材料消耗正确：只消耗产出台数的份额，job 剩余预留同步递减", async () => {
    const job = makeJob({
      outputsPlanned: 2,
      reservedInputs: UNIT_SHARE.map((item) => ({ ...item, quantity: item.quantity * 2 }))
    });
    const { deps, settleAssets } = makeDeps([job], { availableEnergyWh: 30 });

    await settleManufacturing(tx, now, deps);

    expect(settleAssets.consumed).toEqual(UNIT_SHARE); // 1 台，而非 2 台总量
    expect(job.reservedInputs).toEqual([
      { itemId: "support_frame", quantity: 4 },
      { itemId: "spare_parts", quantity: 6 },
      { itemId: "power_box", quantity: 1 }
    ]);
  });

  it("内容修订不一致（在途工单持旧修订）→ blocked 'content_missing'，工作量不动", async () => {
    const job = makeJob({ recipeRevision: 2, currentUnitWorkDone: 5 });
    const { deps, settleAssets } = makeDeps([job], { availableEnergyWh: 30 });

    const result = await settleManufacturing(tx, now, deps);

    expect(result.jobsBlocked).toBe(1);
    expect(result.unitsProduced).toBe(0);
    expect(job.status).toBe("blocked");
    expect(job.blockedReason).toBe(CONTENT_BLOCK_REASON);
    expect(job.currentUnitWorkDone).toBe(5);
    expect(settleAssets.consumed).toHaveLength(0);
  });

  it("需求侧封顶：可用能受 powerW×Δh 限制（1500W×1h 上限）；只结算 deps.baseId 本基地（多基地隔离）", async () => {
    const jobA = makeJob({
      id: "job-a",
      outputsPlanned: 2,
      reservedInputs: UNIT_SHARE.map((item) => ({ ...item, quantity: item.quantity * 2 }))
    });
    const jobB = makeJob({
      id: "job-b",
      outputsPlanned: 2,
      reservedInputs: UNIT_SHARE.map((item) => ({ ...item, quantity: item.quantity * 2 }))
    });
    // 另一基地（暂停或租约失效——不在本次结算里）的在途工单。
    const otherJob = makeJob({
      id: "job-other",
      baseId: "base-2",
      outputsPlanned: 2,
      currentUnitWorkDone: 7,
      reservedInputs: UNIT_SHARE.map((item) => ({ ...item, quantity: item.quantity * 2 }))
    });
    const otherBefore = structuredClone(otherJob);
    const { deps, settleAssets, settleRobots, repo } = makeDeps(
      [
        ["base-1", [jobA, jobB]],
        ["base-2", [otherJob]]
      ],
      { availableEnergyWh: 999_999, powerW: 1500, deltaSimMs: 3_600_000, baseId: "base-1" }
    );

    const result = await settleManufacturing(tx, now, deps);

    // 1500 工作点预算 ≥ 2×30 + 2×30：本基地两单各两台全部产出，实际只用 120（封顶=1500 而非 999999）。
    expect(result.unitsProduced).toBe(4);
    expect(result.energyUsedWh).toBe(120);
    expect(jobA.outputsDone).toBe(2);
    expect(jobB.outputsDone).toBe(2);
    expect(settleAssets.devices.filter((d) => d.sourceOperation.startsWith("job:job-a"))).toHaveLength(2);
    expect(settleAssets.devices.filter((d) => d.sourceOperation.startsWith("job:job-b"))).toHaveLength(2);
    // 多基地隔离：只读本基地工单；另一基地逐字段不变、零产出、零消耗、零写入。
    expect(repo.listedBases).toEqual(["base-1"]);
    expect(otherJob).toEqual(otherBefore);
    expect(settleAssets.devices.every((d) => d.baseId === "base-1")).toBe(true);
    expect(settleRobots.operators.every((o) => o.baseId === "base-1")).toBe(true);
    expect(repo.saved.some((patch) => patch.jobId === "job-other")).toBe(false);
  });

  it("同基地多张工单按 FIFO 分摊本子 tick 预算：先到先得，合计不超过预算，排队单保持 active", async () => {
    const first = makeJob({
      id: "job-first",
      outputsPlanned: 2,
      reservedInputs: UNIT_SHARE.map((item) => ({ ...item, quantity: item.quantity * 2 }))
    });
    const second = makeJob({
      id: "job-second",
      outputsPlanned: 2,
      reservedInputs: UNIT_SHARE.map((item) => ({ ...item, quantity: item.quantity * 2 }))
    });
    // 1 基地分钟 × 1500W = 25Wh 预算。
    const { deps, settleAssets } = makeDeps([first, second], {
      availableEnergyWh: 25,
      powerW: 1500,
      deltaSimMs: 60_000
    });

    const result = await settleManufacturing(tx, now, deps);

    expect(first.currentUnitWorkDone).toBeCloseTo(25, 6);
    expect(second.currentUnitWorkDone).toBe(0);
    expect(second.status).toBe("active");
    expect(second.blockedReason).toBeNull();
    expect(result.energyUsedWh).toBeCloseTo(25, 6);
    expect(result.unitsProduced).toBe(0);
    expect(settleAssets.consumed).toHaveLength(0);
  });

  it("FIFO 余量顺延：前单只差 10 点时拿 10 点完工，剩余 15 点给下一单", async () => {
    const first = makeJob({ id: "job-first", outputsPlanned: 1, currentUnitWorkDone: 20 });
    const second = makeJob({
      id: "job-second",
      outputsPlanned: 2,
      reservedInputs: UNIT_SHARE.map((item) => ({ ...item, quantity: item.quantity * 2 }))
    });
    const { deps } = makeDeps([first, second], {
      availableEnergyWh: 25,
      powerW: 1500,
      deltaSimMs: 60_000
    });

    const result = await settleManufacturing(tx, now, deps);

    expect(first.status).toBe("completed");
    expect(first.outputsDone).toBe(1);
    expect(second.currentUnitWorkDone).toBeCloseTo(15, 6);
    expect(result.energyUsedWh).toBeCloseTo(25, 6);
    expect(first.currentUnitWorkDone + second.currentUnitWorkDone).toBeLessThanOrEqual(25 + 1e-6);
  });

  it("排队单曾因缺电阻塞：本子 tick 制造线有电（被前单用满）→ 解除缺电阻塞回 active，工作量不动", async () => {
    const first = makeJob({
      id: "job-first",
      outputsPlanned: 2,
      reservedInputs: UNIT_SHARE.map((item) => ({ ...item, quantity: item.quantity * 2 }))
    });
    const second = makeJob({
      id: "job-second",
      status: "blocked",
      blockedReason: POWER_BLOCK_REASON,
      currentUnitWorkDone: 3
    });
    const { deps } = makeDeps([first, second], { availableEnergyWh: 25, deltaSimMs: 60_000 });

    await settleManufacturing(tx, now, deps);

    expect(second.status).toBe("active");
    expect(second.blockedReason).toBeNull();
    expect(second.currentUnitWorkDone).toBe(3);
  });
});

describe("settleManufacturing > 无电但单台工作量已够", () => {
  it("预算为 0 时，工作量已达 workPerUnit 的单台仍落产出（不卡在缺电阻塞）", async () => {
    const job = makeJob({ outputsPlanned: 1, currentUnitWorkDone: 30 });
    const { deps, settleAssets } = makeDeps([job], { availableEnergyWh: 0 });

    const result = await settleManufacturing(tx, now, deps);

    expect(result.unitsProduced).toBe(1);
    expect(result.jobsBlocked).toBe(0);
    expect(job.status).toBe("completed");
    expect(settleAssets.consumed).toEqual(UNIT_SHARE);
  });
});

describe("measureManufacturingDemand", () => {
  it("只统计本基地、内容有效工单的剩余工作量", async () => {
    const running = makeJob({ id: "job-run", outputsPlanned: 2, outputsDone: 1, currentUnitWorkDone: 12 });
    const stale = makeJob({ id: "job-stale", recipeRevision: 2 });
    const other = makeJob({ id: "job-other", baseId: "base-2", outputsPlanned: 5 });
    const { deps, repo } = makeDeps(
      [
        ["base-1", [running, stale]],
        ["base-2", [other]]
      ],
      { baseId: "base-1" }
    );

    const demand = await measureManufacturingDemand(tx, "base-1", deps);

    // 剩 1 台 × 30 − 已做 12 = 18；修订不一致的工单不计负载，但仍计入可结算数（需落 content_missing）。
    expect(demand).toEqual({ settleableJobs: 2, pendingWorkWh: 18 });
    expect(repo.listedBases).toEqual(["base-1"]);
  });

  it("本基地无可结算工单 → 0/0", async () => {
    const { deps } = makeDeps([], { baseId: "base-1" });

    expect(await measureManufacturingDemand(tx, "base-1", deps)).toEqual({
      settleableJobs: 0,
      pendingWorkWh: 0
    });
  });
});
