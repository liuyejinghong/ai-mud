// M12-B 纯规则测试（内存对象，无 IO）。
import { describe, expect, it } from "vitest";
import type { ProjectTemplateDto, RobotTemplateDto } from "@ai-mud/shared";
import {
  computeBaseTick,
  POWER_BLOCK_REASON,
  type BasePowerRecord,
  type BaseProjectRecord,
  type BaseRobotRecord,
  type BaseStepRecord,
  type ComputeBaseTickInput
} from "./industry.pure.js";

const DAY = new Date("2026-06-01T10:00:00.000Z"); // UTC 10 时：昼间
const NIGHT = new Date("2026-06-01T22:00:00.000Z"); // UTC 22 时：夜间
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
  description: "首工程",
  steps: [],
  inputs: [],
  outputFacility: {
    ref: { kind: "facility", stableId: "solar_array_unit", revision: 1 },
    name: "光伏阵列单元",
    generationWPeak: 5_000
  }
};

function makePower(overrides: Partial<BasePowerRecord> = {}): BasePowerRecord {
  return {
    generationWPeak: 15_000,
    storageWh: 100_000,
    storageCapacityWh: 200_000,
    lastLoadW: 0,
    ...overrides
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
    reservedInputs: [],
    ...overrides
  };
}

function makeStep(overrides: Partial<BaseStepRecord> = {}): BaseStepRecord {
  return {
    projectId: "p1",
    stepIndex: 0,
    kind: "installation",
    groupId: "engineering",
    status: "running",
    workRequired: 80,
    workDone: 10,
    blockedReason: null,
    ...overrides
  };
}

function makeRobot(overrides: Partial<BaseRobotRecord> = {}): BaseRobotRecord {
  return {
    operatorId: "op-1",
    deviceId: "dev-1",
    deviceDefId: "yd-e1",
    groupId: "engineering",
    batteryWh: 30_000,
    batteryCapacityWh: 30_000,
    status: "working",
    currentProjectId: "p1",
    currentStepIndex: 0,
    ...overrides
  };
}

function makeInput(overrides: Partial<ComputeBaseTickInput> = {}): ComputeBaseTickInput {
  return {
    simTime: DAY,
    deltaSimMs: TICK_MS,
    power: makePower(),
    projects: [],
    steps: [],
    robots: [],
    templates: {
      robotByStableId: new Map([
        ["yd-e1", ENGINEERING_TEMPLATE],
        ["yd-s1", SURVEY_TEMPLATE]
      ]),
      projectByStableId: new Map([["install_solar_array", PROJECT_TEMPLATE]])
    },
    ...overrides
  };
}

describe("computeBaseTick", () => {
  it("昼间按积尘系数发电并推进 running 施工步骤，盈余入储能", () => {
    const result = computeBaseTick(
      makeInput({
        projects: [makeProject()],
        steps: [makeStep()],
        robots: [makeRobot()]
      })
    );

    // 发电 13500W×(1/60)h=225Wh；基础 1000W + 施工 2000W → 50Wh；盈余 175Wh 入储能。
    expect(result.storageWh).toBe(100_175);
    expect(result.lastLoadW).toBe(3000);
    expect(result.stepUpdates).toEqual([
      { projectId: "p1", stepIndex: 0, workDone: 11, status: "running", blockedReason: null }
    ]);
    expect(result.robotUpdates).toEqual([
      {
        operatorId: "op-1",
        batteryWh: 29_500,
        status: "working",
        currentProjectId: "p1",
        currentStepIndex: 0
      }
    ]);
    expect(result.projectCompletions).toEqual([]);
  });

  it("夜间无发电时基础负荷由储能放电承担", () => {
    const result = computeBaseTick(makeInput({ simTime: NIGHT }));

    // 1000W×(1/60)h=16.67Wh → 100000-16.67=99983.33 → 99983。
    expect(result.storageWh).toBe(99_983);
    expect(result.lastLoadW).toBe(1000);
    expect(result.stepUpdates).toEqual([]);
    expect(result.robotUpdates).toEqual([]);
  });

  it("昼间边界：06:00 发电、18:00 停发（Q-06）", () => {
    const dawn = computeBaseTick(
      makeInput({ simTime: new Date("2026-06-01T06:00:00.000Z") })
    );
    expect(dawn.lastLoadW).toBe(1000);
    expect(dawn.storageWh).toBe(100_208); // 盈余 208.33Wh 入储能

    const dusk = computeBaseTick(
      makeInput({ simTime: new Date("2026-06-01T18:00:00.000Z") })
    );
    expect(dusk.storageWh).toBe(99_983); // 夜间规则：纯储能放电
  });

  it("储能耗尽时施工步骤阻塞且工作量不动，机器人转 charging 等待", () => {
    const result = computeBaseTick(
      makeInput({
        simTime: NIGHT,
        power: makePower({ storageWh: 0 }),
        projects: [makeProject()],
        steps: [makeStep()],
        robots: [makeRobot()]
      })
    );

    expect(result.stepUpdates).toEqual([
      {
        projectId: "p1",
        stepIndex: 0,
        workDone: 10,
        status: "blocked",
        blockedReason: POWER_BLOCK_REASON
      }
    ]);
    expect(result.robotUpdates).toEqual([
      {
        operatorId: "op-1",
        batteryWh: 30_000,
        status: "charging",
        currentProjectId: "p1",
        currentStepIndex: 0
      }
    ]);
    expect(result.lastLoadW).toBe(0);
    expect(result.storageWh).toBe(0);
  });

  it("恢复供电后阻塞步骤回 ready 并让等待机器人当 tick 复工", () => {
    const result = computeBaseTick(
      makeInput({
        simTime: NIGHT,
        power: makePower({ storageWh: 50_000 }),
        projects: [makeProject()],
        steps: [makeStep({ status: "blocked", blockedReason: POWER_BLOCK_REASON })],
        robots: [
          makeRobot({ status: "charging", batteryWh: 5_000, batteryCapacityWh: 30_000 })
        ]
      })
    );

    expect(result.stepUpdates).toEqual([
      { projectId: "p1", stepIndex: 0, workDone: 11, status: "running", blockedReason: null }
    ]);
    expect(result.robotUpdates).toEqual([
      {
        operatorId: "op-1",
        batteryWh: 4_500,
        status: "working",
        currentProjectId: "p1",
        currentStepIndex: 0
      }
    ]);
    expect(result.storageWh).toBe(49_950); // 基础 16.67 + 施工 33.33
  });

  it("充电只在盈余优先级下进行且储能溢出封顶", () => {
    const result = computeBaseTick(
      makeInput({
        power: makePower({ storageWh: 200_000 }),
        robots: [
          makeRobot({
            status: "idle",
            batteryWh: 10_000,
            currentProjectId: null,
            currentStepIndex: null
          })
        ]
      })
    );

    // 储能已满：盈余被弃，不越过容量；机器人按 chargeRate 100Wh/tick 充电。
    expect(result.storageWh).toBe(200_000);
    expect(result.lastLoadW).toBe(7000); // 基础 1000 + 充电 6000
    expect(result.robotUpdates).toEqual([
      {
        operatorId: "op-1",
        batteryWh: 10_100,
        status: "idle",
        currentProjectId: null,
        currentStepIndex: null
      }
    ]);
  });

  it("电池不足 500Wh 的 working 机器人转 idle、该 tick 不出工", () => {
    const result = computeBaseTick(
      makeInput({
        projects: [makeProject()],
        steps: [makeStep()],
        robots: [makeRobot({ batteryWh: 300 })]
      })
    );

    expect(result.stepUpdates).toEqual([]); // 工作量不动
    expect(result.robotUpdates).toEqual([
      {
        operatorId: "op-1",
        batteryWh: 400, // 转 idle 后当 tick 充电 100Wh（6000W×1/60h）
        status: "idle",
        currentProjectId: null,
        currentStepIndex: null
      }
    ]);
  });

  it("验收(commissioning)完成触发项目 completion", () => {
    const result = computeBaseTick(
      makeInput({
        projects: [makeProject()],
        steps: [
          makeStep({
            kind: "commissioning",
            groupId: "survey",
            workRequired: 20,
            workDone: 19
          })
        ],
        robots: [
          makeRobot({
            deviceDefId: "yd-s1",
            groupId: "survey",
            batteryWh: 10_000,
            batteryCapacityWh: 10_000
          })
        ]
      })
    );

    expect(result.stepUpdates).toEqual([
      { projectId: "p1", stepIndex: 0, workDone: 20, status: "completed", blockedReason: null }
    ]);
    expect(result.projectCompletions).toEqual([{ projectId: "p1", siteId: "site-1" }]);
    expect(result.robotUpdates).toEqual([
      {
        operatorId: "op-1",
        batteryWh: 9_500,
        status: "idle",
        currentProjectId: null,
        currentStepIndex: null
      }
    ]);
  });

  it("步骤完成推进链条：下一步 pending → ready，完工机器人释放", () => {
    const result = computeBaseTick(
      makeInput({
        projects: [makeProject()],
        steps: [
          makeStep({ kind: "site_clearing", workRequired: 40, workDone: 39 }),
          makeStep({
            stepIndex: 1,
            kind: "transport",
            groupId: "engineering",
            status: "pending",
            workRequired: 60,
            workDone: 0
          })
        ],
        robots: [makeRobot()]
      })
    );

    expect(result.stepUpdates).toEqual([
      { projectId: "p1", stepIndex: 0, workDone: 40, status: "completed", blockedReason: null },
      { projectId: "p1", stepIndex: 1, workDone: 0, status: "ready", blockedReason: null }
    ]);
    expect(result.projectCompletions).toEqual([]); // 链条未完
    expect(result.robotUpdates).toEqual([
      {
        operatorId: "op-1",
        batteryWh: 29_500,
        status: "idle",
        currentProjectId: null,
        currentStepIndex: null
      }
    ]);
  });

  it("施工负荷只由 site_clearing/installation 步骤引出", () => {
    const result = computeBaseTick(
      makeInput({
        projects: [makeProject()],
        steps: [makeStep({ kind: "transport", groupId: "engineering", workRequired: 60 })],
        robots: [makeRobot()]
      })
    );

    expect(result.lastLoadW).toBe(1000); // 仅基础负荷
    expect(result.storageWh).toBe(100_208);
    expect(result.stepUpdates).toEqual([
      { projectId: "p1", stepIndex: 0, workDone: 11, status: "running", blockedReason: null }
    ]);
  });
});
