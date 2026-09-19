// M12-B 基地结算纯规则（m12-p-contract.md §3.2—§3.3 冻结语义）。零 IO：不触库、
// 不取系统时间、不改入参；所有决策只依赖入参。
//
// 供能（每 tick，Δh = Δsim/3600）：
//   昼间（simTime UTC 小时 ∈ [6,18)）发电 = generationWPeak × ARRAY_DUST_FACTOR，夜间 0。
//   负载优先级：基础 BASE_LOAD_W < 施工 CONSTRUCTION_LOAD_W（存在 running 或缺电阻塞的
//   site_clearing/installation 步骤时）< 充电（idle/charging 机器人，每台
//   min(chargeRateW, 容量-电量)）。盈余入储能（效率 1.0、容量封顶），不足放储能。
//   基础负荷优先于一切且永不 clamp 进度——进度只受施工负荷是否被满足影响。
//   储能尽 → running 施工步骤 blocked 'insufficient_power'（workDone 不动，绝不 clamp 完成），
//   其 working 机器人转 charging 原地等待（保留分配）；恢复供电后步骤回 ready 重新开工。
// 工作量：working 机器人每 tick 给所属 running 步骤加 workRatePerTick、耗
//   ROBOT_WORK_DRAIN_WH（tick 开始时电池不足 → 转 idle 本 tick 不出工，下一 tick 充电）。
//   步骤 workDone ≥ workRequired → completed，下一步 pending → ready；步骤链全完成 →
//   项目 completed（触发 projectCompletions）。验收(commissioning) 是链条末步时由此自然完成。
//
// 记录类型与 application/base/ports.ts 冻结 DTO 结构一致（industry 不得 import application，
// 见 module-catalog.json 允许边）；composition 按结构绑定。
import type {
  ProjectTemplateDto,
  RobotStatus,
  RobotTemplateDto,
  StepStatus
} from "@ai-mud/shared";
import { SIM_DAYLIGHT_END_HOUR, SIM_DAYLIGHT_START_HOUR } from "@ai-mud/shared";

export const ARRAY_DUST_FACTOR = 0.9;
export const BASE_LOAD_W = 1000;
export const CONSTRUCTION_LOAD_W = 2000;
export const ROBOT_WORK_DRAIN_WH = 500;
export const POWER_BLOCK_REASON = "insufficient_power";
export const CONTENT_BLOCK_REASON = "content_missing";

const CONSTRUCTION_STEP_KINDS = new Set<string>(["site_clearing", "installation"]);
const ENERGY_EPS = 1e-6;

// ---------- 记录型输入（结构对应冻结端口 DTO） ----------

export interface BasePowerRecord {
  generationWPeak: number;
  storageWh: number;
  storageCapacityWh: number;
  lastLoadW: number;
}

export interface BaseProjectRecord {
  id: string;
  projectDefId: string;
  templateRevision: number;
  status: string;
  currentStepIndex: number;
  siteId: string;
  reservedInputs: Array<{ itemId: string; quantity: number }>;
}

export interface BaseStepRecord {
  projectId: string;
  stepIndex: number;
  kind: string;
  groupId: string;
  status: string;
  workRequired: number;
  workDone: number;
  blockedReason: string | null;
}

export interface BaseRobotRecord {
  operatorId: string;
  deviceId: string;
  deviceDefId: string;
  groupId: string;
  batteryWh: number;
  batteryCapacityWh: number;
  status: string;
  currentProjectId: string | null;
  currentStepIndex: number | null;
}

// ---------- 输出 ----------

export interface BaseTickRobotUpdate {
  operatorId: string;
  batteryWh: number;
  status: RobotStatus;
  currentProjectId: string | null;
  currentStepIndex: number | null;
}

export interface BaseTickStepUpdate {
  projectId: string;
  stepIndex: number;
  workDone: number;
  status: StepStatus;
  blockedReason: string | null;
}

export interface BaseTickProjectCompletion {
  projectId: string;
  siteId: string;
}

export interface ComputeBaseTickInput {
  simTime: Date;
  deltaSimMs: number;
  power: BasePowerRecord;
  projects: BaseProjectRecord[];
  steps: BaseStepRecord[];
  robots: BaseRobotRecord[];
  templates: {
    robotByStableId: Map<string, RobotTemplateDto>;
    projectByStableId: Map<string, ProjectTemplateDto>;
  };
}

export interface BaseTickResult {
  storageWh: number;
  lastLoadW: number;
  robotUpdates: BaseTickRobotUpdate[];
  stepUpdates: BaseTickStepUpdate[];
  projectCompletions: BaseTickProjectCompletion[];
}

interface RobotState {
  record: BaseRobotRecord;
  battery: number;
  status: RobotStatus;
  projectId: string | null;
  stepIndex: number | null;
  chargeRateW: number;
  workRate: number;
  hasWorkTemplate: boolean;
  wasWorkingAtStart: boolean;
  workedThisTick: boolean;
}

interface StepState {
  record: BaseStepRecord;
  status: StepStatus;
  workDone: number;
  blockedReason: string | null;
  powerBlockedThisTick: boolean;
}

function stepKey(projectId: string, stepIndex: number): string {
  return `${projectId}#${stepIndex}`;
}

function clampWh(value: number, capacity: number): number {
  return Math.max(0, Math.min(capacity, Math.round(value)));
}

// 从 generation 剩余 → 储能 的顺序供给一段需求；返回实际供给量。
function serveDemand(
  demandWh: number,
  energy: { value: number },
  storage: { value: number }
): number {
  const fromGeneration = Math.min(energy.value, demandWh);
  energy.value -= fromGeneration;
  let rest = demandWh - fromGeneration;
  let served = fromGeneration;
  if (rest > ENERGY_EPS) {
    const fromStorage = Math.min(storage.value, rest);
    storage.value -= fromStorage;
    served += fromStorage;
    rest -= fromStorage;
  }
  return served;
}

export function computeBaseTick(input: ComputeBaseTickInput): BaseTickResult {
  const dh = Math.max(0, input.deltaSimMs) / 3_600_000;
  const hour = input.simTime.getUTCHours();
  const isDaylight = hour >= SIM_DAYLIGHT_START_HOUR && hour < SIM_DAYLIGHT_END_HOUR;
  const generationW = isDaylight ? input.power.generationWPeak * ARRAY_DUST_FACTOR : 0;
  const capacity = input.power.storageCapacityWh;

  const energy = { value: generationW * dh };
  const storage = { value: input.power.storageWh };
  let servedEnergy = 0;

  // ---------- 活动项目与步骤状态 ----------
  const activeProjects = input.projects.filter((project) => project.status === "active");
  const activeById = new Map(activeProjects.map((project) => [project.id, project]));

  const stepStates = new Map<string, StepState>();
  const stepsByProject = new Map<string, StepState[]>();
  for (const record of input.steps) {
    if (!activeById.has(record.projectId)) continue;
    const state: StepState = {
      record,
      status: record.status as StepStatus,
      workDone: record.workDone,
      blockedReason: record.blockedReason,
      powerBlockedThisTick: false
    };
    stepStates.set(stepKey(record.projectId, record.stepIndex), state);
    const list = stepsByProject.get(record.projectId);
    if (list) list.push(state);
    else stepsByProject.set(record.projectId, [state]);
  }
  for (const list of stepsByProject.values()) {
    list.sort((a, b) => a.record.stepIndex - b.record.stepIndex);
  }

  // ---------- 机器人状态 ----------
  const robotStates: RobotState[] = input.robots.map((record) => {
    const template = input.templates.robotByStableId.get(record.deviceDefId) ?? null;
    return {
      record,
      battery: record.batteryWh,
      status: record.status as RobotStatus,
      projectId: record.currentProjectId,
      stepIndex: record.currentStepIndex,
      chargeRateW: template?.chargeRateW ?? 0,
      workRate: template?.workRatePerTick ?? 0,
      hasWorkTemplate: template !== null && template.workRatePerTick > 0,
      wasWorkingAtStart: record.status === "working",
      workedThisTick: false
    };
  });

  // ---------- 1) 基础负荷：优先于一切，缺口无额外惩罚（永不 clamp 进度） ----------
  if (dh > 0) {
    servedEnergy += serveDemand(BASE_LOAD_W * dh, energy, storage);
  }

  // ---------- 2) 施工负荷：running / 缺电阻塞 的 site_clearing|installation 步骤存在时 ----------
  let constructionDemand = false;
  for (const list of stepsByProject.values()) {
    for (const step of list) {
      if (!CONSTRUCTION_STEP_KINDS.has(step.record.kind)) continue;
      if (
        step.status === "running" ||
        (step.status === "blocked" && step.blockedReason === POWER_BLOCK_REASON)
      ) {
        constructionDemand = true;
      }
    }
  }
  let constructionPowered = true;
  if (constructionDemand && dh > 0) {
    const served = serveDemand(CONSTRUCTION_LOAD_W * dh, energy, storage);
    servedEnergy += served;
    if (served + ENERGY_EPS < CONSTRUCTION_LOAD_W * dh) constructionPowered = false;
  }

  // 缺电：本 tick 开工中的施工步骤全部阻塞；恢复供电：阻塞步骤回 ready（可被本 tick 分配）。
  for (const step of stepStates.values()) {
    if (!CONSTRUCTION_STEP_KINDS.has(step.record.kind)) continue;
    if (step.powerBlockedThisTick) continue;
    if (step.status === "running" && !constructionPowered) {
      step.powerBlockedThisTick = true;
    } else if (step.status === "blocked" && step.blockedReason === POWER_BLOCK_REASON) {
      if (constructionPowered) {
        step.status = "ready";
        step.blockedReason = null;
      }
      // 仍缺电：维持阻塞，无变化
    }
  }

  // ---------- 3) working 机器人出工资格校验 ----------
  for (const robot of robotStates) {
    if (robot.status !== "working") continue;
    const target =
      robot.projectId !== null && robot.stepIndex !== null
        ? stepStates.get(stepKey(robot.projectId, robot.stepIndex))
        : undefined;
    const assignable =
      target !== undefined &&
      robot.hasWorkTemplate &&
      robot.record.groupId === target.record.groupId &&
      (target.status === "running" || target.status === "ready") &&
      !target.powerBlockedThisTick &&
      robot.battery >= ROBOT_WORK_DRAIN_WH;
    if (target && assignable) {
      robot.workedThisTick = true;
    } else if (target && target.powerBlockedThisTick) {
      // 缺电阻塞：转 charging 原地等待，保留分配以便复电即复工
      robot.status = "charging";
    } else {
      // 电池不足 / 分配失效：转 idle 并解除分配
      robot.status = "idle";
      robot.projectId = null;
      robot.stepIndex = null;
    }
  }

  // ---------- 4) 空闲/充电机器人按项目与步骤顺序补位 ----------
  for (const list of stepsByProject.values()) {
    for (const step of list) {
      if (step.powerBlockedThisTick) continue;
      if (step.status !== "ready" && step.status !== "running") continue;
      if (CONSTRUCTION_STEP_KINDS.has(step.record.kind) && !constructionPowered) {
        // 施工负荷无供给时不新开工地类步骤（非工地类步骤靠机器人自身电池，可继续）
        continue;
      }
      for (const robot of robotStates) {
        if (robot.wasWorkingAtStart) continue;
        if (robot.status !== "idle" && robot.status !== "charging") continue;
        if (!robot.hasWorkTemplate) continue;
        if (robot.record.groupId !== step.record.groupId) continue;
        if (robot.battery < ROBOT_WORK_DRAIN_WH) continue;
        robot.status = "working";
        robot.projectId = step.record.projectId;
        robot.stepIndex = step.record.stepIndex;
        robot.workedThisTick = true;
      }
    }
  }

  // ready 步骤有了出工机器人 → running
  for (const step of stepStates.values()) {
    if (step.status !== "ready" || step.powerBlockedThisTick) continue;
    const hasWorker = robotStates.some(
      (robot) =>
        robot.workedThisTick &&
        robot.projectId === step.record.projectId &&
        robot.stepIndex === step.record.stepIndex
    );
    if (hasWorker) step.status = "running";
  }

  // ---------- 5) 充电：idle/charging 机器人（working 不充） ----------
  if (dh > 0) {
    for (const robot of robotStates) {
      if (robot.status !== "idle" && robot.status !== "charging") continue;
      if (robot.chargeRateW <= 0) continue;
      const room = robot.record.batteryCapacityWh - robot.battery;
      if (room <= ENERGY_EPS) continue;
      const demand = Math.min(robot.chargeRateW * dh, room);
      const served = serveDemand(demand, energy, storage);
      servedEnergy += served;
      robot.battery = Math.min(robot.record.batteryCapacityWh, robot.battery + served);
    }
  }

  // ---------- 6) 工作量推进与完成 ----------
  const projectCompletions: BaseTickProjectCompletion[] = [];
  for (const [projectId, list] of stepsByProject) {
    const project = activeById.get(projectId);
    if (!project) continue;
    for (const step of list) {
      if (step.powerBlockedThisTick) continue; // workDone 不动，阻塞在步骤 7 统一落状态
      if (step.status !== "running") continue;
      let contribution = 0;
      for (const robot of robotStates) {
        if (!robot.workedThisTick) continue;
        if (robot.projectId !== step.record.projectId) continue;
        if (robot.stepIndex !== step.record.stepIndex) continue;
        if (robot.record.groupId !== step.record.groupId) continue;
        contribution += robot.workRate;
      }
      if (contribution <= 0) continue;
      step.workDone = Math.min(step.record.workRequired, step.workDone + contribution);
      if (step.workDone >= step.record.workRequired) {
        step.status = "completed";
        step.blockedReason = null;
        for (const robot of robotStates) {
          if (robot.projectId !== step.record.projectId) continue;
          if (robot.stepIndex !== step.record.stepIndex) continue;
          robot.status = "idle";
          robot.projectId = null;
          robot.stepIndex = null;
        }
        const index = list.indexOf(step);
        const next = index >= 0 ? list[index + 1] : undefined;
        if (next) {
          if (next.status === "pending") next.status = "ready";
        } else {
          projectCompletions.push({ projectId, siteId: project.siteId });
        }
      }
    }
  }

  // 缺电阻塞步骤落 blocked 状态（工作量不动，绝不 clamp 完成）
  for (const step of stepStates.values()) {
    if (!step.powerBlockedThisTick) continue;
    step.status = "blocked";
    step.blockedReason = POWER_BLOCK_REASON;
  }

  // ---------- 7) working 机器人耗电 ----------
  for (const robot of robotStates) {
    if (robot.workedThisTick) robot.battery -= ROBOT_WORK_DRAIN_WH;
  }

  // ---------- 8) 盈余入储能（封顶）与输出 ----------
  storage.value = Math.min(capacity, storage.value + energy.value);
  const robotUpdates: BaseTickRobotUpdate[] = [];
  for (const robot of robotStates) {
    const batteryWh = clampWh(robot.battery, robot.record.batteryCapacityWh);
    if (
      batteryWh !== robot.record.batteryWh ||
      robot.status !== robot.record.status ||
      robot.projectId !== robot.record.currentProjectId ||
      robot.stepIndex !== robot.record.currentStepIndex
    ) {
      robotUpdates.push({
        operatorId: robot.record.operatorId,
        batteryWh,
        status: robot.status,
        currentProjectId: robot.projectId,
        currentStepIndex: robot.stepIndex
      });
    }
  }
  const stepUpdates: BaseTickStepUpdate[] = [];
  for (const step of stepStates.values()) {
    if (
      step.workDone !== step.record.workDone ||
      step.status !== (step.record.status as StepStatus) ||
      step.blockedReason !== step.record.blockedReason
    ) {
      stepUpdates.push({
        projectId: step.record.projectId,
        stepIndex: step.record.stepIndex,
        workDone: step.workDone,
        status: step.status,
        blockedReason: step.blockedReason
      });
    }
  }

  return {
    storageWh: clampWh(storage.value, capacity),
    lastLoadW: dh > 0 ? Math.round(servedEnergy / dh) : 0,
    robotUpdates,
    stepUpdates,
    projectCompletions
  };
}
