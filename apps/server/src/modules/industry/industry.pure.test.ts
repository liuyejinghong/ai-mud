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
    dustLevel: 0,
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

  it("充电先补当前步骤的低电工组，输入顺序不影响两分钟内复工", () => {
    const transportTemplate: RobotTemplateDto = {
      ...ENGINEERING_TEMPLATE,
      ref: { kind: "robot_template", stableId: "yd-t1", revision: 1 },
      groupId: "transport",
      chargeRateW: 6_000
    };
    const transports = Array.from({ length: 4 }, (_, index) => makeRobot({
      operatorId: `transport-${index}`,
      deviceId: `transport-device-${index}`,
      deviceDefId: "yd-t1",
      groupId: "transport",
      batteryWh: 0,
      status: "idle",
      currentProjectId: null,
      currentStepIndex: null
    }));
    const builder = makeRobot({
      operatorId: "builder",
      deviceId: "builder-device",
      batteryWh: 400,
      status: "idle",
      currentProjectId: null,
      currentStepIndex: null
    });
    const input = makeInput({
      power: makePower({ generationWPeak: 19_600, storageWh: 0 }),
      projects: [makeProject()],
      steps: [makeStep({ workDone: 22 })],
      templates: {
        robotByStableId: new Map([
          ["yd-e1", ENGINEERING_TEMPLATE],
          ["yd-t1", transportTemplate]
        ]),
        projectByStableId: new Map([["install_solar_array", PROJECT_TEMPLATE]])
      }
    });
    const firstMinute = runSlices({ ...input, robots: [...transports, builder] }, [TICK_MS]);
    const transportFirst = runSlices({ ...input, robots: [...transports, builder] }, [TICK_MS, TICK_MS]);
    const builderFirst = runSlices({ ...input, robots: [builder, ...transports] }, [TICK_MS, TICK_MS]);

    expect(firstMinute.steps[0]?.workDone).toBe(22);
    expect(firstMinute.robots.find((robot) => robot.operatorId === "builder"))
      .toMatchObject({ batteryWh: 500, status: "idle" });
    expect(firstMinute.power).toMatchObject({ storageWh: 0, lastLoadW: 17_640 });
    for (const state of [transportFirst, builderFirst]) {
      expect(state.steps[0]).toMatchObject({ workDone: 23, status: "running" });
      expect(state.robots.find((robot) => robot.operatorId === "builder")).toMatchObject({
        batteryWh: 0,
        status: "working",
        currentProjectId: "p1"
      });
    }
    expect(transportFirst.power).toEqual(builderFirst.power);
    const byId = (robots: BaseRobotRecord[]) =>
      robots.slice().sort((a, b) => a.operatorId.localeCompare(b.operatorId));
    expect(byId(transportFirst.robots)).toEqual(byId(builderFirst.robots));
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

// ---------- B008 / A5：施工工作量与机器人耗电按模拟时长计量（与子 tick 切分、调用频率无关） ----------

interface SliceState {
  power: BasePowerRecord;
  steps: BaseStepRecord[];
  robots: BaseRobotRecord[];
}

// 按给定切片序列连续调用 computeBaseTick，把每次输出回灌为下一次输入（模拟逐子 tick 落盘）。
function runSlices(
  base: ComputeBaseTickInput,
  slices: number[]
): SliceState {
  let state: SliceState = {
    power: { ...base.power },
    steps: base.steps.map((step) => ({ ...step })),
    robots: base.robots.map((robot) => ({ ...robot }))
  };
  let t = base.simTime.getTime();
  for (const ms of slices) {
    const result = computeBaseTick({
      ...base,
      simTime: new Date(t),
      deltaSimMs: ms,
      power: state.power,
      steps: state.steps,
      robots: state.robots
    });
    state = {
      power: { ...state.power, storageWh: result.storageWh, lastLoadW: result.lastLoadW },
      steps: state.steps.map((step) => {
        const update = result.stepUpdates.find(
          (entry) => entry.projectId === step.projectId && entry.stepIndex === step.stepIndex
        );
        return update
          ? { ...step, workDone: update.workDone, status: update.status, blockedReason: update.blockedReason }
          : step;
      }),
      robots: state.robots.map((robot) => {
        const update = result.robotUpdates.find((entry) => entry.operatorId === robot.operatorId);
        return update
          ? {
              ...robot,
              batteryWh: update.batteryWh,
              status: update.status,
              currentProjectId: update.currentProjectId,
              currentStepIndex: update.currentStepIndex
            }
          : robot;
      })
    };
    t += ms;
  }
  return state;
}

function threeEngineers(): BaseRobotRecord[] {
  return ["op-1", "op-2", "op-3"].map((operatorId, index) =>
    makeRobot({ operatorId, deviceId: `dev-${index + 1}` })
  );
}

describe("computeBaseTick > B008 按模拟时长计量", () => {
  const TEN_MINUTES = 10 * TICK_MS;

  it.each([
    ["1 个子 tick", [TEN_MINUTES]],
    ["4 个子 tick", [150_000, 150_000, 150_000, 150_000]],
    ["10 个子 tick", Array.from({ length: 10 }, () => TICK_MS)],
    ["不等长 6 段", [5_000, 55_000, 1_000, 179_000, 60_000, 300_000]]
  ])("同一 Δsim=10 分钟切成 %s：工作量与机器人电量完全相同", (_label, slices) => {
    const input = makeInput({
      // 故意不对齐整分钟：取整规则按“跨过的整基地分钟边界”计，与起点对齐无关。
      simTime: new Date("2026-06-01T10:00:17.250Z"),
      projects: [makeProject()],
      steps: [makeStep()],
      robots: threeEngineers()
    });

    const single = runSlices(input, [TEN_MINUTES]);
    const sliced = runSlices(input, slices);

    // 3 台 × 1 点/基地分钟 × 10 分钟 = 30 → 10 + 30 = 40。
    expect(single.steps[0]?.workDone).toBe(40);
    expect(sliced.steps[0]?.workDone).toBe(40);
    // 耗电 500Wh/基地分钟 × 10 = 5000Wh/台。
    expect(sliced.robots.map((robot) => robot.batteryWh)).toEqual([25_000, 25_000, 25_000]);
    expect(sliced.robots.map((robot) => robot.status)).toEqual(["working", "working", "working"]);
    // 储能：每次调用取整到 1Wh（明示取整规则），切分引入的偏差 ≤ 切片数 × 1Wh。
    expect(Math.abs(sliced.power.storageWh - single.power.storageWh)).toBeLessThanOrEqual(slices.length);
  });

  it("调用频率无关：60 秒一次调用 与 12 次 5 秒调用 结果相同", () => {
    const input = makeInput({
      projects: [makeProject()],
      steps: [makeStep()],
      robots: [makeRobot()]
    });

    const once = runSlices(input, [TICK_MS]);
    const frequent = runSlices(input, Array.from({ length: 12 }, () => 5_000));

    expect(once.steps[0]?.workDone).toBe(11);
    expect(frequent.steps[0]?.workDone).toBe(11);
    expect(frequent.robots[0]?.batteryWh).toBe(29_500);
    expect(frequent.robots[0]?.status).toBe("working");
  });

  it("不足一个整基地分钟的调用不记工作量、不扣工作电，余量留到跨过分钟边界的那一次", () => {
    const input = makeInput({
      projects: [makeProject()],
      steps: [makeStep()],
      robots: [makeRobot()]
    });

    // 10:00:00 → 10:00:45：未跨分钟边界。
    const partial = computeBaseTick({ ...input, deltaSimMs: 45_000 });
    expect(partial.stepUpdates).toEqual([]);
    expect(partial.robotUpdates).toEqual([]);

    // 10:00:45 → 10:01:30：跨过 10:01:00，记 1 分钟。
    const crossing = computeBaseTick({
      ...input,
      simTime: new Date(DAY.getTime() + 45_000),
      deltaSimMs: 45_000
    });
    expect(crossing.stepUpdates).toEqual([
      { projectId: "p1", stepIndex: 0, workDone: 11, status: "running", blockedReason: null }
    ]);
    expect(crossing.robotUpdates[0]?.batteryWh).toBe(29_500);
  });

  it("多分钟子 tick 中电池只够部分分钟：只记电池覆盖的分钟数，电量不为负", () => {
    const result = computeBaseTick(
      makeInput({
        deltaSimMs: 4 * TICK_MS,
        projects: [makeProject()],
        steps: [makeStep()],
        robots: [makeRobot({ batteryWh: 1_200 })]
      })
    );

    // 1200Wh 只够前 2 个工作分钟；后 2 分钟转 idle 并各充 100Wh。
    expect(result.stepUpdates[0]?.workDone).toBe(12);
    expect(result.robotUpdates[0]).toMatchObject({ batteryWh: 400, status: "idle" });
  });

  it("低电机器人耗尽、充电、复工不随 10 分钟的调用切分改变", () => {
    const input = makeInput({
      simTime: new Date("2026-06-01T10:00:17.250Z"),
      projects: [makeProject()],
      steps: [makeStep()],
      robots: [makeRobot({ batteryWh: 500 })]
    });
    const once = runSlices(input, [10 * TICK_MS]);
    const four = runSlices(input, [150_000, 150_000, 150_000, 150_000]);
    const ten = runSlices(input, Array.from({ length: 10 }, () => TICK_MS));

    expect(four.steps).toEqual(once.steps);
    expect(ten.steps).toEqual(once.steps);
    expect(four.robots).toEqual(once.robots);
    expect(ten.robots).toEqual(once.robots);
    expect(four.power.storageWh).toBe(once.power.storageWh);
    expect(ten.power.storageWh).toBe(once.power.storageWh);
  });

  it("夜间储能只够首分钟施工时，长调用与逐分钟结算得到相同阻塞和工作量", () => {
    const input = makeInput({
      simTime: NIGHT,
      power: makePower({ storageWh: 60 }),
      projects: [makeProject()],
      steps: [makeStep()],
      robots: [makeRobot()]
    });
    const once = runSlices(input, [4 * TICK_MS]);
    const minuteByMinute = runSlices(input, Array.from({ length: 4 }, () => TICK_MS));

    expect(once.steps[0]).toMatchObject({ workDone: 11, status: "blocked", blockedReason: POWER_BLOCK_REASON });
    expect(once.steps).toEqual(minuteByMinute.steps);
    expect(once.robots).toEqual(minuteByMinute.robots);
    expect(once.power.storageWh).toBe(minuteByMinute.power.storageWh);
  });

  it("ready 工地首分钟没有施工电时不能免费开工", () => {
    const result = computeBaseTick(makeInput({
      simTime: NIGHT,
      power: makePower({ storageWh: 0 }),
      projects: [makeProject()],
      steps: [makeStep({ status: "ready" })],
      robots: [makeRobot({ status: "idle", currentProjectId: null, currentStepIndex: null })]
    }));

    expect(result.stepUpdates).toEqual([]);
    expect(result.robotUpdates).toEqual([]);
    expect(result.lastLoadW).toBe(0);
  });

  it("同一机器人先被运输步骤占用时，不给后面的 ready 工地空耗施工电", () => {
    const result = computeBaseTick(makeInput({
      projects: [makeProject(), makeProject({ id: "p2", siteId: "site-2" })],
      steps: [
        makeStep({ kind: "transport", status: "ready" }),
        makeStep({ projectId: "p2", kind: "installation", status: "ready" })
      ],
      robots: [makeRobot({ status: "idle", currentProjectId: null, currentStepIndex: null })]
    }));

    expect(result.lastLoadW).toBe(1000);
    expect(result.stepUpdates).toEqual([
      { projectId: "p1", stepIndex: 0, workDone: 11, status: "running", blockedReason: null }
    ]);
  });

  it("5 秒高频调用与 60 秒调用在低电充电边界一致", () => {
    const input = makeInput({
      projects: [makeProject()],
      steps: [makeStep({ status: "ready" })],
      robots: [makeRobot({ status: "idle", batteryWh: 400, currentProjectId: null, currentStepIndex: null })]
    });
    const once = runSlices(input, [TICK_MS]);
    const frequent = runSlices(input, Array.from({ length: 12 }, () => 5_000));

    expect(once.steps).toEqual(frequent.steps);
    expect(once.robots).toEqual(frequent.robots);
    expect(once.power.storageWh).toBe(frequent.power.storageWh);
  });

  it("跨 18:00 昼夜边界时逐分钟切分与长调用供电一致", () => {
    const input = makeInput({
      simTime: new Date("2026-06-01T17:59:30.000Z"),
      power: makePower({ storageWh: 0 })
    });
    const once = runSlices(input, [2 * TICK_MS]);
    const sliced = runSlices(input, [TICK_MS, TICK_MS]);

    expect(once.power.storageWh).toBe(sliced.power.storageWh);
    expect(once.power.storageWh).toBeGreaterThan(0);
  });
});

describe("computeBaseTick > B008 多分钟子 tick 的完工边界", () => {
  it("步骤在子 tick 第 1 分钟即完工：只记 1 个工作分钟的耗电（不为完工后的分钟空耗电）", () => {
    const result = computeBaseTick(
      makeInput({
        deltaSimMs: 4 * TICK_MS,
        projects: [makeProject()],
        steps: [makeStep({ workRequired: 11, workDone: 10 })],
        robots: [makeRobot()]
      })
    );

    expect(result.stepUpdates[0]).toMatchObject({ workDone: 11, status: "completed" });
    expect(result.robotUpdates[0]).toMatchObject({ batteryWh: 29_800, status: "idle" });
  });

  it("与逐分钟切分等价：3 台完成最后 5 点——一次 4 分钟调用与 4 次 1 分钟调用的工作量、耗电一致", () => {
    const input = makeInput({
      projects: [makeProject()],
      steps: [makeStep({ workRequired: 15, workDone: 10 })],
      robots: threeEngineers()
    });

    const once = computeBaseTick({ ...input, deltaSimMs: 4 * TICK_MS });
    const sliced = runSlices(input, [TICK_MS, TICK_MS, TICK_MS, TICK_MS]);

    // 第 1 分钟 +3（13），第 2 分钟 +3 封顶 15 完工：每台 2 个工作分钟 = 1000Wh。
    expect(once.stepUpdates[0]).toMatchObject({ workDone: 15, status: "completed" });
    expect(sliced.steps[0]).toMatchObject({ workDone: 15, status: "completed" });
    expect(once.robotUpdates.map((robot) => robot.batteryWh)).toEqual(sliced.robots.map((robot) => robot.batteryWh));
  });
});

// ---------- B001 / A4：制造负载进入同一电力池（基础 < 施工 < 制造 < 充电） ----------

describe("computeBaseTick > 制造负载（m13-p-contract §4.2）", () => {
  it("昼间有待制造工作量：扣 1500W×Δh 并计入 lastLoadW", () => {
    const result = computeBaseTick(makeInput({ manufacturingWorkWh: 1_000 }));

    // 发电 13500W；负载 基础 1000 + 制造 1500 = 2500W → 盈余 11000W×(1/60)h = 183.33Wh。
    expect(result.manufacturingEnergyWh).toBeCloseTo(25, 6);
    expect(result.lastLoadW).toBe(2_500);
    expect(result.storageWh).toBe(100_183);
  });

  it("夜间制造由储能放电承担", () => {
    const result = computeBaseTick(makeInput({ simTime: NIGHT, manufacturingWorkWh: 1_000 }));

    // 100000 - 16.67 - 25 = 99958.33 → 99958。
    expect(result.manufacturingEnergyWh).toBeCloseTo(25, 6);
    expect(result.lastLoadW).toBe(2_500);
    expect(result.storageWh).toBe(99_958);
  });

  it("需求按剩余工作量封顶：只剩 10 点时只取 10Wh", () => {
    const result = computeBaseTick(makeInput({ simTime: NIGHT, manufacturingWorkWh: 10 }));

    expect(result.manufacturingEnergyWh).toBeCloseTo(10, 6);
    expect(result.lastLoadW).toBe(1_600); // 1000 + 10Wh/(1/60)h
    expect(result.storageWh).toBe(99_973);
  });

  it("无待制造工作量时不产生制造负载（旧行为不变）", () => {
    const result = computeBaseTick(makeInput({ simTime: NIGHT }));

    expect(result.manufacturingEnergyWh).toBe(0);
    expect(result.lastLoadW).toBe(1_000);
  });

  it("优先级：施工先于制造、制造先于充电（储能只剩 60Wh）", () => {
    const result = computeBaseTick(
      makeInput({
        simTime: NIGHT,
        power: makePower({ storageWh: 60 }),
        manufacturingWorkWh: 1_000,
        projects: [makeProject()],
        steps: [makeStep()],
        robots: [
          makeRobot(),
          // 望山（survey）不属于施工步骤的编组，不会被补位出工，只会排队充电。
          makeRobot({
            operatorId: "op-idle",
            deviceId: "dev-idle",
            deviceDefId: "yd-s1",
            groupId: "survey",
            status: "idle",
            batteryWh: 5_000,
            batteryCapacityWh: 10_000,
            currentProjectId: null,
            currentStepIndex: null
          })
        ]
      })
    );

    // 基础 16.67 + 施工 33.33 = 50 → 制造只拿到剩余 10Wh；充电再无可用。
    expect(result.manufacturingEnergyWh).toBeCloseTo(10, 6);
    expect(result.storageWh).toBe(0);
    expect(result.stepUpdates[0]?.workDone).toBe(11); // 施工供电满足，照常推进
    const idle = result.robotUpdates.find((robot) => robot.operatorId === "op-idle");
    expect(idle).toBeUndefined(); // 未充电，电量不变
  });
});
