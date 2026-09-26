// R1 P 阶段数值探针（05-acceptance §1 P01–P05）：在纯规则层驱动整分钟序列，
// 验证候选数值可达性与守恒（真实 PG 原子性在 landing.integration 覆盖）。
// 探针只证明机制可达与预算合理，不宣称真人节奏已平衡。
import { describe, expect, it } from "vitest";
import {
  computeLandingMinute,
  projectLandingSupplyW,
  LANDING_ORE_PER_BATCH,
  LANDING_SLOT_MAINTENANCE_BATCHES,
  type ComputeLandingMinuteInput,
  type ComputeLandingMinuteResult,
  type LandingExtractionJobRecord,
  type LandingManufacturingJobRecord,
  type LandingRobotRecord,
  type LandingSlotRecord
} from "../../../modules/industry/landing-rules.js";

// 基准时间：08:00 UTC（昼间）。
const T0 = Date.UTC(2026, 8, 26, 8, 0, 0);

function robot(
  operatorId: string,
  stableId: "landing-hauler" | "landing-builder" | "landing-surveyor",
  batteryWh: number
): LandingRobotRecord {
  return {
    operatorId,
    deviceDefId: stableId,
    groupId: stableId === "landing-hauler" ? "transport" : stableId === "landing-builder" ? "engineering" : "survey",
    batteryWh,
    batteryCapacityWh: stableId === "landing-hauler" ? 120 : stableId === "landing-builder" ? 180 : 80,
    status: "idle",
    currentProjectId: null,
    currentStepIndex: null,
    currentExtractionJobId: null
  };
}

const ROBOT_PARAMS = new Map([
  ["landing-hauler", { workRate: 1, workDrainWh: 3, chargeRateW: 360 }],
  ["landing-builder", { workRate: 1, workDrainWh: 6, chargeRateW: 600 }],
  ["landing-surveyor", { workRate: 1, workDrainWh: 2, chargeRateW: 240 }]
]);

function power(seed: Partial<ComputeLandingMinuteInput["power"]> = {}) {
  return {
    solarWPeak: 0,
    emergencyW: 1000,
    baseLoadW: 200,
    chargeLimitW: 400,
    storageWm: 1000 * 60,
    storageCapacityWm: 2000 * 60,
    dustLevel: 0,
    genRemainderWm: 0,
    policy: "production" as const,
    ...seed
  };
}

interface Simulation {
  power: ComputeLandingMinuteInput["power"];
  robots: LandingRobotRecord[];
  steps: ComputeLandingMinuteInput["steps"];
  projects: ComputeLandingMinuteInput["projects"];
  extractionJobs: LandingExtractionJobRecord[];
  manufacturingJobs: LandingManufacturingJobRecord[];
  slots: LandingSlotRecord[];
  minute: number;
  oreDelivered: number;
  oreExtracted: number;
  batchesProduced: Map<string, number>;
  results: ComputeLandingMinuteResult[];
}

function simulate(seed: Partial<Simulation> = {}): Simulation {
  return {
    power: power(),
    robots: [],
    steps: [],
    projects: [],
    extractionJobs: [],
    manufacturingJobs: [],
    slots: [],
    minute: 0,
    oreDelivered: 0,
    oreExtracted: 0,
    batchesProduced: new Map(),
    results: [],
    ...seed
  };
}

function step(sim: Simulation, lightFactor = 1): ComputeLandingMinuteResult {
  const result = computeLandingMinute({
    simTime: new Date(T0 + sim.minute * 60_000),
    power: sim.power,
    weatherLight: lightFactor,
    robots: sim.robots,
    robotParams: ROBOT_PARAMS,
    projects: sim.projects,
    steps: sim.steps,
    extractionJobs: sim.extractionJobs,
    manufacturingJobs: sim.manufacturingJobs,
    slots: sim.slots
  });
  sim.minute += 1;
  // 折叠结果回模拟状态（等价结算落盘）。
  sim.power = {
    ...sim.power,
    storageWm: result.power.storageWm,
    genRemainderWm: result.power.genRemainderWm,
    dustLevel: result.power.dustLevel
  };
  for (const update of result.robotUpdates) {
    const target = sim.robots.find((entry) => entry.operatorId === update.operatorId);
    if (target) {
      target.batteryWh = update.batteryWh;
      target.status = update.status;
      target.currentProjectId = update.currentProjectId;
      target.currentStepIndex = update.currentStepIndex;
      target.currentExtractionJobId = update.currentExtractionJobId;
    }
  }
  for (const update of result.stepUpdates) {
    const target = sim.steps.find(
      (entry) => entry.projectId === update.projectId && entry.stepIndex === update.stepIndex
    );
    if (target) {
      target.workDone = update.workDone;
      target.status = update.status;
      target.blockedReason = update.blockedReason;
    }
  }
  for (const completion of result.projectCompletions) {
    const project = sim.projects.find((entry) => entry.id === completion.projectId);
    if (project) project.status = "completed";
  }
  for (const update of result.extractionUpdates) {
    const job = sim.extractionJobs.find((entry) => entry.id === update.jobId);
    if (!job) continue;
    job.status = update.status;
    job.phase = update.phase;
    job.phaseWorkDone = update.phaseWorkDone;
    job.batchesExtracted = update.batchesExtracted;
    job.batchesDelivered = update.batchesDelivered;
    job.blockedReason = update.blockedReason;
    sim.oreExtracted += update.extractedOrdinals.length * LANDING_ORE_PER_BATCH;
    sim.oreDelivered += update.deliveredOrdinals.length * LANDING_ORE_PER_BATCH;
  }
  for (const update of result.productionUpdates) {
    const job = sim.manufacturingJobs.find((entry) => entry.id === update.jobId);
    if (!job) continue;
    job.status = update.status;
    job.currentBatchEnergyWm = update.currentBatchEnergyWm;
    job.outputsDone = update.outputsDone;
    job.blockedReason = update.blockedReason;
    sim.batchesProduced.set(job.id, (sim.batchesProduced.get(job.id) ?? 0) + update.batchesCompleted);
  }
  for (const update of result.slotUpdates) {
    const slot = sim.slots.find((entry) => entry.id === update.slotId);
    if (slot) {
      slot.batchesSinceMaintenance = update.batchesSinceMaintenance;
      slot.maintenanceBlocked = update.maintenanceBlocked;
    }
  }
  sim.results.push(result);
  return result;
}

describe("P01 着陆器自举：不借任何已安装设施完成首太阳能", () => {
  it("两台筑垒一个基地分钟完成安装工序，电力账目守恒", () => {
    const sim = simulate({
      robots: [robot("b1", "landing-builder", 108), robot("b2", "landing-builder", 108)],
      projects: [{ id: "p1", status: "active", siteId: "solar" }],
      steps: [{
        projectId: "p1", stepIndex: 0, kind: "installation", groupId: "engineering",
        status: "ready", workRequired: 2, workDone: 0, blockedReason: null
      }]
    });
    const result = step(sim);
    // 2 台筑垒 × 1 点 = 工序完成 → 项目完成。
    expect(result.projectCompletions).toEqual([{ projectId: "p1", siteId: "solar" }]);
    // 电力账目：发电 1000 = 基础 200 + 现场 200 + 完工后两台筑垒充电 360 + 盈余 240 入储能。
    // （安装在该分钟内完成，机器人转 idle 后即可在本分钟充电。）
    expect(result.power.lastLoadW).toBe(760);
    expect(result.power.storageWm).toBe(60_000 + 240);
    // 筑垒耗自身电池 6 Wh；同分钟内先完工转 idle 的设备可再获充电（预算内）。
    expect(Math.min(sim.robots[0]!.batteryWh, sim.robots[1]!.batteryWh)).toBe(102);
  });

  it("单台筑垒两分钟完成（1 点/分钟），电池不足一分钟工作电即不出工", () => {
    const sim = simulate({
      robots: [robot("b1", "landing-builder", 108)],
      projects: [{ id: "p1", status: "active", siteId: "solar" }],
      steps: [{
        projectId: "p1", stepIndex: 0, kind: "installation", groupId: "engineering",
        status: "ready", workRequired: 2, workDone: 0, blockedReason: null
      }]
    });
    step(sim);
    expect(sim.steps[0]!.workDone).toBe(1);
    step(sim);
    expect(sim.projects[0]!.status).toBe("completed");
    // 低电筑垒（< 6Wh）不出工。
    sim.robots[0]!.batteryWh = 5;
    sim.projects[0]!.status = "active";
    sim.steps[0]!.status = "ready";
    sim.steps[0]!.workDone = 0;
    step(sim);
    expect(sim.steps[0]!.workDone).toBe(0); // 低于工作电不出工，工作量不动
  });
});

describe("P02/P03 两条加工路线的批数与维护账本", () => {
  function processingSim(batches: number) {
    const sim = simulate({
      power: power({ solarWPeak: 4000, chargeLimitW: 2000 }),
      slots: [{ id: "slot-1", siteId: "processing", slotIndex: 0, batchesSinceMaintenance: 0, maintenanceBlocked: false }],
      manufacturingJobs: [{
        id: "job-1", status: "active", blockedReason: null, productionSiteId: "processing", slotId: "slot-1",
        energyWmPerBatch: 2000, currentBatchEnergyWm: 0,
        outputsPlanned: batches, outputsDone: 0, ratedW: 2000, countsSlotMaintenance: true
      }],
      robots: []
    });
    return sim;
  }

  it("能源路线 15 批：第 10 批后槽维护停机，维护一次后完成全部 15 批", () => {
    const sim = processingSim(15);
    let maintenanceEvents = 0;
    while (sim.minute < 120 && sim.manufacturingJobs[0]!.status !== "completed") {
      step(sim);
      if (sim.slots[0]!.maintenanceBlocked) {
        // 玩家维护：第 8–10 批窗口内消耗 1 备件，计数清零。
        expect(sim.slots[0]!.batchesSinceMaintenance).toBe(LANDING_SLOT_MAINTENANCE_BATCHES);
        sim.slots[0]!.maintenanceBlocked = false;
        sim.slots[0]!.batchesSinceMaintenance = 0;
        maintenanceEvents += 1;
      }
    }
    expect(maintenanceEvents).toBe(1); // 15 批 = 一次维护（01 §4 账本）
    expect(sim.batchesProduced.get("job-1")).toBe(15);
    expect(sim.manufacturingJobs[0]!.status).toBe("completed");
    // 白天 4000 W·min − 基础 200 = 3800 W·min/分钟给加工（本机无其他负载）→ ~1.9 批/分钟。
    expect(sim.minute).toBeGreaterThan(8);
    expect(sim.minute).toBeLessThan(30);
  });

  it("加工路线 21 批：需要两次维护才能完成", () => {
    const sim = processingSim(21);
    let maintenanceEvents = 0;
    while (sim.minute < 200 && sim.manufacturingJobs[0]!.status !== "completed") {
      step(sim);
      if (sim.slots[0]!.maintenanceBlocked) {
        sim.slots[0]!.maintenanceBlocked = false;
        sim.slots[0]!.batchesSinceMaintenance = 0;
        maintenanceEvents += 1;
      }
    }
    expect(maintenanceEvents).toBe(2); // 21 批 = 两次维护（01 §4 账本）
    expect(sim.batchesProduced.get("job-1")).toBe(21);
  });

  it("维护停机时不开第 11 批；早维护窗口从第 8 批起（纯规则侧计数语义）", () => {
    const sim = processingSim(12);
    for (let index = 0; index < 40 && (sim.batchesProduced.get("job-1") ?? 0) < 10; index += 1) step(sim);
    expect(sim.slots[0]!.maintenanceBlocked).toBe(true);
    expect(sim.batchesProduced.get("job-1")).toBe(10);
    // 第 11 批不推进（job blocked 'maintenance_required'）。
    step(sim);
    expect(sim.batchesProduced.get("job-1")).toBe(10);
    expect(sim.manufacturingJobs[0]!.blockedReason).toBe("maintenance_required");
  });
});

describe("P04 勘探→采矿→送达与低电恢复", () => {
  it("两筑垒+一驮运的采矿节奏：1 分钟采出、1 分钟送达，未送达不入仓", () => {
    const claimed = (entry: LandingRobotRecord, jobId: string): LandingRobotRecord => ({
      ...entry, status: "working", currentExtractionJobId: jobId
    });
    const sim = simulate({
      robots: [
        claimed(robot("b1", "landing-builder", 108), "mine-1"),
        claimed(robot("b2", "landing-builder", 108), "mine-1"),
        claimed(robot("h1", "landing-hauler", 72), "mine-1")
      ],
      extractionJobs: [{
        id: "mine-1", kind: "mine", status: "active", nodeId: "iron",
        batchesPlanned: 2, batchesExtracted: 0, batchesDelivered: 0,
        phase: "mining", phaseWorkDone: 0,
        builderOperatorIds: ["b1", "b2"], haulerOperatorId: "h1", surveyorOperatorId: null,
        blockedReason: null
      }]
    });
    const minute1 = step(sim);
    expect(minute1.extractionUpdates[0]!.extractedOrdinals).toEqual([1]); // 第 1 分钟采出，未送达
    expect(sim.oreDelivered).toBe(0);
    const minute2 = step(sim);
    expect(minute2.extractionUpdates[0]!.deliveredOrdinals).toEqual([1]); // 第 2 分钟送达
    expect(sim.oreDelivered).toBe(4);
    // 电池：筑垒只在采矿分钟出工（−6），驮运只在运输分钟出工（−3）。
    expect(sim.robots[0]!.batteryWh).toBe(102);
    expect(sim.robots[2]!.batteryWh).toBe(69);
    // 第 2 批继续。
    step(sim);
    step(sim);
    expect(sim.extractionJobs[0]!.status).toBe("completed");
    expect(sim.oreDelivered).toBe(8);
  });

  it("全队低电不软锁：应急充电 400 W 上限内活动工序低电设备优先，充满即复工", () => {
    const sim = simulate({
      robots: [
        robot("b1", "landing-builder", 3),  // 低于 6 Wh 工作电
        robot("h1", "landing-hauler", 2)
      ],
      extractionJobs: [{
        id: "mine-1", kind: "mine", status: "active", nodeId: "iron",
        batchesPlanned: 1, batchesExtracted: 0, batchesDelivered: 0,
        phase: "mining", phaseWorkDone: 0,
        builderOperatorIds: ["b1"], haulerOperatorId: "h1", surveyorOperatorId: null,
        blockedReason: null
      }]
    });
    const blocked = step(sim);
    expect(blocked.extractionUpdates[0]!.blockedReason).toBe("device_low_battery");
    // 低电活动设备优先充电：筑垒 360/240→本轮充电受 400 W·min 上限约束（builder 优先）。
    expect(sim.robots[0]!.batteryWh).toBe(3 + Math.floor(400 / 60)); // +6
    // 充电不超出电池容量；多轮后可复工。
    for (let index = 0; index < 20 && sim.extractionJobs[0]!.blockedReason !== null; index += 1) {
      step(sim);
    }
    expect(sim.extractionJobs[0]!.blockedReason).toBeNull();
  });

  it("单台筑垒采矿：2 分钟采出（2 工作点），当前批多余预算不提前进下一工序", () => {
    const sim = simulate({
      robots: [
        { ...robot("b1", "landing-builder", 108), status: "working" as const, currentExtractionJobId: "mine-1" },
        { ...robot("h1", "landing-hauler", 72), status: "working" as const, currentExtractionJobId: "mine-1" }
      ],
      extractionJobs: [{
        id: "mine-1", kind: "mine", status: "active", nodeId: "iron",
        batchesPlanned: 1, batchesExtracted: 0, batchesDelivered: 0,
        phase: "mining", phaseWorkDone: 0,
        builderOperatorIds: ["b1"], haulerOperatorId: "h1", surveyorOperatorId: null,
        blockedReason: null
      }]
    });
    step(sim);
    expect(sim.extractionJobs[0]!.phase).toBe("mining"); // 1 点 < 2 点，未采出
    step(sim);
    expect(sim.extractionJobs[0]!.phase).toBe("hauling"); // 第 2 分钟采出
    step(sim);
    expect(sim.extractionJobs[0]!.status).toBe("completed");
  });
});

describe("P05 功耗账本与策略", () => {
  it("每分钟能量守恒：发电+放电=负载+储能增量（无溢出时）", () => {
    const sim = simulate({
      power: power({ solarWPeak: 4000, chargeLimitW: 2000, storageWm: 0 }),
      robots: [robot("h1", "landing-hauler", 60)],
      slots: [{ id: "slot-1", siteId: "processing", slotIndex: 0, batchesSinceMaintenance: 0, maintenanceBlocked: false }],
      manufacturingJobs: [{
        id: "job-1", status: "active", blockedReason: null, productionSiteId: "processing", slotId: "slot-1",
        energyWmPerBatch: 2000, currentBatchEnergyWm: 0,
        outputsPlanned: 1, outputsDone: 0, ratedW: 2000, countsSlotMaintenance: true
      }]
    });
    const before = sim.power.storageWm;
    const result = step(sim);
    const generation = 1000 + 4000; // 应急 + 太阳能（晴、无尘）
    const storageGain = result.power.storageWm - before;
    // generation = served(load) + storageGain（本例无容量溢出）。
    expect(result.power.lastLoadW + storageGain).toBe(generation);
  });

  it("夜间无太阳能：靠应急 1000（基础 200 + 加工 800 W·min/分钟），加工按比例慢速推进", () => {
    const sim = simulate({
      power: power({ solarWPeak: 4000, chargeLimitW: 2000, storageWm: 0 }),
      slots: [{ id: "slot-1", siteId: "processing", slotIndex: 0, batchesSinceMaintenance: 0, maintenanceBlocked: false }],
      manufacturingJobs: [{
        id: "job-1", status: "active", blockedReason: null, productionSiteId: "processing", slotId: "slot-1",
        energyWmPerBatch: 2000, currentBatchEnergyWm: 0,
        outputsPlanned: 1, outputsDone: 0, ratedW: 2000, countsSlotMaintenance: true
      }]
    });
    // 从 18:00（夜间）开始；储能为空 → 加工只靠应急 1000 − 基础 200 = 800 W·min/分钟。
    sim.minute = 10 * 60;
    const job = sim.manufacturingJobs[0]!;
    step(sim, 0.25);
    expect(job.status).toBe("active");
    expect(job.currentBatchEnergyWm).toBe(800); // 一批 2000 需 3 个夜间分钟
    step(sim, 0.25);
    step(sim, 0.25);
    expect(job.status).toBe("completed");
    expect(job.outputsDone).toBe(1);
  });

  it("充电优先策略：充电先吃预算，加工转慢", () => {
    function run(policy: "production" | "charging") {
      const sim = simulate({
        power: power({ emergencyW: 600, solarWPeak: 0, chargeLimitW: 400, storageWm: 0, policy }),
        robots: [robot("h1", "landing-hauler", 0)],
        slots: [{ id: "slot-1", siteId: "processing", slotIndex: 0, batchesSinceMaintenance: 0, maintenanceBlocked: false }],
        manufacturingJobs: [{
          id: "job-1", status: "active", blockedReason: null, productionSiteId: "processing", slotId: "slot-1",
          energyWmPerBatch: 2000, currentBatchEnergyWm: 0,
          outputsPlanned: 1, outputsDone: 0, ratedW: 2000, countsSlotMaintenance: true
        }]
      });
      step(sim);
      return {
        charged: sim.robots[0]!.batteryWh,
        jobEnergy: sim.manufacturingJobs[0]!.currentBatchEnergyWm
      };
    }
    const chargingFirst = run("charging");
    const productionFirst = run("production");
    // 充电优先：驮运先拿到 400 W·min（6 Wh），加工只剩 600−200=400 之外……应急 600 − 基础 200 = 400
    // 充电优先时充电吃 400，加工 0；生产优先时加工吃 400，充电 0。
    // 应急 600 − 基础 200 = 400 W·min 可分配；充电一台吃 360（6 Wh，整 Wh 截断）。
    expect(chargingFirst.charged).toBe(6);
    expect(chargingFirst.jobEnergy).toBe(40); // 充电剩下的 40 W·min 给加工
    expect(productionFirst.charged).toBe(0);
    expect(productionFirst.jobEnergy).toBe(400);
  });

  it("储能扩容不发电：扩容后 solarWPeak 不变，仅容量上升（facility-effects 语义在集成测试）", () => {
    const sim = simulate({ power: power({ solarWPeak: 0 }) });
    const result = step(sim);
    // 着陆器 1000 − 基础 200 = 800 盈余入储能。
    expect(result.power.storageWm).toBe(60_000 + 800);
  });
});

describe("P05b 实际供电投影（快照同源公式）", () => {
  it("昼间晴/无尘：太阳能=峰值，应急恒定", async () => {

    const day = projectLandingSupplyW({
      simTime: new Date(Date.UTC(2026, 8, 26, 10, 0, 0)),
      solarWPeak: 4000, weatherLight: 1, dustLevel: 0, emergencyW: 1000
    });
    expect(day).toMatchObject({ solarW: 4000, emergencyW: 1000, totalW: 5000, isDaylight: true });
  });
  it("夜间：太阳能 0，应急仍 1 kW；积尘按比例衰减", async () => {

    const night = projectLandingSupplyW({
      simTime: new Date(Date.UTC(2026, 8, 26, 20, 0, 0)),
      solarWPeak: 4000, weatherLight: 1, dustLevel: 0, emergencyW: 1000
    });
    expect(night).toMatchObject({ solarW: 0, emergencyW: 1000, totalW: 1000, isDaylight: false });
    const dusty = projectLandingSupplyW({
      simTime: new Date(Date.UTC(2026, 8, 26, 10, 0, 0)),
      solarWPeak: 4000, weatherLight: 1, dustLevel: 100, emergencyW: 1000
    });
    expect(dusty.solarW).toBe(2000); // 1 − 100/200
  });
});
