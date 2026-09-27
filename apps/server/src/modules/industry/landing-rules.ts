// R1 landing-v1 纯规则（01-product-and-balance.md §1—§6 / 03-domain-contracts.md §5 冻结语义）。
// 零 IO：不触库、不取时间、不改入参；所有决策只依赖入参。单位合同：
//   功率 W、电量 Wh 整数；站内能量一律 W·min（1/60 Wh）整数定点，storageWh×60+storageExcessWm
//   合成精确存量；发电端小数 W·min 经 genRemainderWm 结转，不丢能量。
// 每个整基地分钟执行一次 computeLandingMinute：
//   1 发电（应急 + 太阳能×日照×(1-积尘/200)，仅昼间）→ 2 基础负载 → 3 施工现场负载
//   → 4 施工/勘探/采矿工序（机器人自身电池耗电，与站内池无关）→ 5 加工/充电按
//   玩家优先级供能（不足按比例分摊）→ 6 盈余入储能（封顶）。
//   施工与采矿互斥（currentExtractionJobId 与项目分配分离）；暂停任务不占出工名额；
//   满电设备不占充电预算；活动工序所需低电机器人优先充电；普通充电稳定轮转。
import { SIM_DAYLIGHT_END_HOUR, SIM_DAYLIGHT_START_HOUR } from "@ai-mud/shared";

// landing 常量（01 合同）：安装现场负载、每批矿量、工序工作点、维护窗口。
export const LANDING_SITE_LOAD_W = 200;
export const LANDING_ORE_PER_BATCH = 4;
export const LANDING_MINING_POINTS_PER_BATCH = 2;
export const LANDING_HAULING_POINTS_PER_BATCH = 1;
export const LANDING_SURVEY_POINTS = 2;
export const LANDING_SLOT_MAINTENANCE_BATCHES = 10;
export const LANDING_SLOT_EARLY_MAINTENANCE_FROM = 8;

export const LANDING_POWER_BLOCK = "insufficient_power";
export const LANDING_BATTERY_BLOCK = "device_low_battery";
export const LANDING_DEVICE_BLOCK = "device_unavailable";
export const LANDING_MAINTENANCE_BLOCK = "maintenance_required";
export const LANDING_CONTENT_BLOCK = "content_missing";

export interface LandingRobotRecord {
  operatorId: string;
  deviceDefId: string;
  groupId: string;
  batteryWh: number;
  batteryCapacityWh: number;
  status: "idle" | "charging" | "working" | "offline";
  currentProjectId: string | null;
  currentStepIndex: number | null;
  currentExtractionJobId: string | null;
}

export interface LandingRobotParams {
  workRate: number;
  workDrainWh: number;
  chargeRateW: number;
}

export interface LandingPowerRecord {
  solarWPeak: number;
  emergencyW: number;
  baseLoadW: number;
  chargeLimitW: number | null;
  // 精确存量（W·min）。
  storageWm: number;
  storageCapacityWm: number;
  dustLevel: number;
  genRemainderWm: number;
  policy: "production" | "charging";
}

export interface LandingStepRecord {
  projectId: string;
  stepIndex: number;
  kind: string;
  groupId: string;
  status: "pending" | "ready" | "running" | "blocked" | "completed" | "failed";
  workRequired: number;
  workDone: number;
  blockedReason: string | null;
}

export interface LandingProjectRecord {
  id: string;
  status: string;
  siteId: string;
}

export interface LandingExtractionJobRecord {
  id: string;
  kind: "survey" | "mine";
  status: "active" | "paused" | "stopping" | "completed" | "cancelled";
  nodeId: string;
  batchesPlanned: number;
  batchesExtracted: number;
  batchesDelivered: number;
  phase: "mining" | "hauling" | null;
  phaseWorkDone: number;
  builderOperatorIds: string[];
  haulerOperatorId: string | null;
  surveyorOperatorId: string | null;
  blockedReason: string | null;
}

export interface LandingManufacturingJobRecord {
  id: string;
  status: "active" | "paused" | "blocked" | "completed" | "cancelled";
  blockedReason?: string | null;
  productionSiteId: string | null;
  // 结算层绑定：本分钟占用的加工槽（多槽站点按 FIFO 依序分配）；手工单为 null。
  slotId: string | null;
  energyWmPerBatch: number | null;
  currentBatchEnergyWm: number;
  outputsPlanned: number;
  outputsDone: number;
  ratedW: number;
  countsSlotMaintenance: boolean;
}

export interface LandingSlotRecord {
  id: string;
  siteId: string;
  slotIndex: number;
  batchesSinceMaintenance: number;
  maintenanceBlocked: boolean;
}

export interface ComputeLandingMinuteInput {
  simTime: Date;
  power: LandingPowerRecord;
  weatherLight: number;
  robots: LandingRobotRecord[];
  robotParams: Map<string, LandingRobotParams>;
  projects: LandingProjectRecord[];
  steps: LandingStepRecord[];
  extractionJobs: LandingExtractionJobRecord[];
  manufacturingJobs: LandingManufacturingJobRecord[];
  slots: LandingSlotRecord[];
}

export interface LandingRobotUpdate {
  operatorId: string;
  batteryWh: number;
  status: LandingRobotRecord["status"];
  currentProjectId: string | null;
  currentStepIndex: number | null;
  currentExtractionJobId: string | null;
}

export interface LandingStepUpdate {
  projectId: string;
  stepIndex: number;
  workDone: number;
  status: LandingStepRecord["status"];
  blockedReason: string | null;
}

export interface LandingProjectCompletion {
  projectId: string;
  siteId: string;
}

export interface LandingExtractionUpdate {
  jobId: string;
  status: LandingExtractionJobRecord["status"];
  phase: "mining" | "hauling" | null;
  phaseWorkDone: number;
  batchesExtracted: number;
  batchesDelivered: number;
  blockedReason: string | null;
  // 本分钟新采出的批次（现场货物；itemId 由结算层从节点行取）。
  extractedOrdinals: number[];
  // 本分钟送达入库的批次。
  deliveredOrdinals: number[];
  // 终态时释放的机器人。
  releaseOperators: string[];
}

export interface LandingNodeUpdate {
  nodeId: string;
  // 本分钟采出量（remaining 与 reserved 同步扣减）。
  extractedQuantity: number;
  discovered: boolean;
}

export interface LandingProductionUpdate {
  jobId: string;
  status: LandingManufacturingJobRecord["status"];
  currentBatchEnergyWm: number;
  outputsDone: number;
  blockedReason: string | null;
  // 本分钟完成的批次数（ordinal 连续；产出内容与消耗由结算层按冻结配方落盘）。
  batchesCompleted: number;
  slotId: string | null;
}

export interface LandingSlotUpdate {
  slotId: string;
  batchesSinceMaintenance: number;
  maintenanceBlocked: boolean;
}

export interface ComputeLandingMinuteResult {
  power: {
    storageWm: number;
    genRemainderWm: number;
    lastLoadW: number;
    dustLevel: number;
  };
  robotUpdates: LandingRobotUpdate[];
  stepUpdates: LandingStepUpdate[];
  projectCompletions: LandingProjectCompletion[];
  extractionUpdates: LandingExtractionUpdate[];
  nodeUpdates: LandingNodeUpdate[];
  productionUpdates: LandingProductionUpdate[];
  slotUpdates: LandingSlotUpdate[];
}

interface RobotState {
  record: LandingRobotRecord;
  battery: number;
  status: LandingRobotRecord["status"];
  projectId: string | null;
  stepIndex: number | null;
  extractionJobId: string | null;
  params: LandingRobotParams | undefined;
}

interface StepState {
  record: LandingStepRecord;
  status: LandingStepRecord["status"];
  workDone: number;
  blockedReason: string | null;
}

export function computeLandingMinute(
  input: ComputeLandingMinuteInput
): ComputeLandingMinuteResult {
  const hour = input.simTime.getUTCHours();
  const isDaylight = hour >= SIM_DAYLIGHT_START_HOUR && hour < SIM_DAYLIGHT_END_HOUR;
  const dustFactor = 1 - Math.min(100, Math.max(0, input.power.dustLevel)) / 200;
  const solarWmFrac = isDaylight
    ? input.power.solarWPeak * (input.weatherLight ?? 1) * dustFactor + input.power.genRemainderWm
    : 0;
  const solarWm = Math.floor(solarWmFrac);
  const genRemainderWm = solarWmFrac - solarWm;
  let pool = input.power.emergencyW + solarWm; // 本分钟发电量（W·min）
  let storage = input.power.storageWm;
  let servedW = 0;
  const capacity = input.power.storageCapacityWm;

  const serveFromPool = (demandWm: number): number => {
    const fromPool = Math.min(pool, demandWm);
    pool -= fromPool;
    let rest = demandWm - fromPool;
    let served = fromPool;
    if (rest > 0) {
      const fromStorage = Math.min(storage, rest);
      storage -= fromStorage;
      served += fromStorage;
    }
    servedW += served;
    return served;
  };

  // ---------- 机器人状态 ----------
  const robots: RobotState[] = input.robots.map((record) => ({
    record,
    battery: record.batteryWh,
    status: record.status,
    projectId: record.currentProjectId,
    stepIndex: record.currentStepIndex,
    extractionJobId: record.currentExtractionJobId,
    params: input.robotParams.get(record.deviceDefId)
  }));
  const robotById = new Map(robots.map((robot) => [robot.record.operatorId, robot]));
  const drainOf = (robot: RobotState): number => robot.params?.workDrainWh ?? 0;
  const workedThisMinute = new Set<string>();
  const ownsExtraction = (robot: RobotState, jobId: string): boolean =>
    robot.extractionJobId === jobId && robot.projectId === null;
  const canWorkExtraction = (robot: RobotState, jobId: string): boolean =>
    ownsExtraction(robot, jobId) &&
    robot.status !== "offline" &&
    !workedThisMinute.has(robot.record.operatorId);

  // ---------- 步骤状态（只看活动项目） ----------
  const activeProjects = input.projects.filter((project) => project.status === "active");
  const activeProjectIds = new Set(activeProjects.map((project) => project.id));
  const stepsByProject = new Map<string, StepState[]>();
  for (const record of input.steps) {
    if (!activeProjectIds.has(record.projectId)) continue;
    const state: StepState = {
      record,
      status: record.status,
      workDone: record.workDone,
      blockedReason: record.blockedReason
    };
    const list = stepsByProject.get(record.projectId);
    if (list) list.push(state);
    else stepsByProject.set(record.projectId, [state]);
  }
  for (const list of stepsByProject.values()) {
    list.sort((a, b) => a.record.stepIndex - b.record.stepIndex);
  }

  // ---------- 1) 基础负载 ----------
  serveFromPool(input.power.baseLoadW);

  // ---------- 2) 施工：复核已出工者 + 空闲补位 + 现场负载 ----------
  // 采矿单占用的机器人不参与施工（互斥第一步）。
  for (const robot of robots) {
    if (robot.status !== "working" || robot.projectId === null) continue;
    const list = stepsByProject.get(robot.projectId);
    const target =
      robot.stepIndex === null
        ? undefined
        : list?.find((step) => step.record.stepIndex === robot.stepIndex);
    const ok =
      target !== undefined &&
      (target.status === "running" || target.status === "ready") &&
      robot.battery >= drainOf(robot);
    if (ok) continue;
    robot.status = "idle";
    robot.projectId = null;
    robot.stepIndex = null;
  }

  let installationActive = false;
  for (const [projectId, list] of stepsByProject) {
    for (const step of list) {
      if (step.status !== "ready" && step.status !== "running") continue;
      const hasWorker = robots.some(
        (robot) =>
          robot.status === "working" &&
          robot.projectId === projectId &&
          robot.stepIndex === step.record.stepIndex
      );
      if (!hasWorker) {
        // 该组全部可用设备都加入本步骤（legacy 语义：2 台筑垒 = 2 点/分钟）。
        for (const robot of robots) {
          if (robot.extractionJobId !== null) continue;
          if (robot.status !== "idle" && robot.status !== "charging") continue;
          if ((robot.params?.workRate ?? 0) <= 0) continue;
          if (robot.record.groupId !== step.record.groupId) continue;
          if (robot.battery < drainOf(robot)) continue;
          robot.status = "working";
          robot.projectId = projectId;
          robot.stepIndex = step.record.stepIndex;
        }
      }
      if (
        robots.some(
          (robot) =>
            robot.status === "working" &&
            robot.projectId === projectId &&
            robot.stepIndex === step.record.stepIndex
        )
      ) {
        step.status = "running";
        if (step.record.kind === "installation") installationActive = true;
      }
    }
  }

  let sitePowered = true;
  if (installationActive) {
    const served = serveFromPool(LANDING_SITE_LOAD_W);
    if (served < LANDING_SITE_LOAD_W) sitePowered = false;
  }

  // ---------- 3) 施工工作量推进（机器人自身电池） ----------
  const projectCompletions: LandingProjectCompletion[] = [];
  const stepUpdates: LandingStepUpdate[] = [];
  for (const [projectId, list] of stepsByProject) {
    const project = activeProjects.find((entry) => entry.id === projectId);
    if (!project) continue;
    for (const step of list) {
      if (step.status === "blocked" && step.blockedReason === LANDING_POWER_BLOCK) {
        // 缺电阻塞的安装工序：复电则回 running（本分钟可出工），否则维持。
        if (sitePowered && step.record.kind === "installation") {
          step.status = "running";
          step.blockedReason = null;
          if (!installationActive) installationActive = true;
        } else {
          stepUpdates.push({
            projectId,
            stepIndex: step.record.stepIndex,
            workDone: step.workDone,
            status: "blocked",
            blockedReason: step.blockedReason
          });
          continue;
        }
      }
      if (step.status !== "running") continue;
      if (step.record.kind === "installation" && !sitePowered) {
        step.status = "blocked";
        step.blockedReason = LANDING_POWER_BLOCK;
        for (const robot of robots) {
          if (robot.projectId === projectId && robot.stepIndex === step.record.stepIndex) {
            robot.status = "charging";
          }
        }
        stepUpdates.push({
          projectId,
          stepIndex: step.record.stepIndex,
          workDone: step.workDone,
          status: "blocked",
          blockedReason: LANDING_POWER_BLOCK
        });
        continue;
      }
      const workers = robots.filter(
        (robot) =>
          robot.status === "working" &&
          robot.projectId === projectId &&
          robot.stepIndex === step.record.stepIndex &&
          robot.battery >= drainOf(robot)
      );
      if (workers.length === 0) continue;
      let contribution = 0;
      for (const robot of workers) {
        robot.battery -= drainOf(robot);
        workedThisMinute.add(robot.record.operatorId);
        contribution += robot.params?.workRate ?? 0;
      }
      step.workDone = Math.min(step.record.workRequired, step.workDone + contribution);
      if (step.workDone >= step.record.workRequired) {
        step.status = "completed";
        step.blockedReason = null;
        for (const robot of robots) {
          if (robot.projectId === projectId && robot.stepIndex === step.record.stepIndex) {
            robot.status = "idle";
            robot.projectId = null;
            robot.stepIndex = null;
          }
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

  // ---------- 4) 勘探 / 采矿工序（自身电池；分派保留：充电足够即复工） ----------
  const extractionUpdates: LandingExtractionUpdate[] = [];
  const nodeUpdates: LandingNodeUpdate[] = [];
  for (const job of input.extractionJobs) {
    if (job.status !== "active" && job.status !== "stopping") continue;
    const update: LandingExtractionUpdate = {
      jobId: job.id,
      status: job.status,
      phase: job.phase,
      phaseWorkDone: job.phaseWorkDone,
      batchesExtracted: job.batchesExtracted,
      batchesDelivered: job.batchesDelivered,
      blockedReason: null,
      extractedOrdinals: [],
      deliveredOrdinals: [],
      releaseOperators: []
    };
    const releaseAll = () => {
      for (const operatorId of [
        ...job.builderOperatorIds,
        ...(job.haulerOperatorId ? [job.haulerOperatorId] : []),
        ...(job.surveyorOperatorId ? [job.surveyorOperatorId] : [])
      ]) {
        const robot = robotById.get(operatorId);
        if (!robot || !ownsExtraction(robot, job.id)) continue;
        robot.status = "idle";
        robot.extractionJobId = null;
        update.releaseOperators.push(operatorId);
      }
    };

    if (job.kind === "survey") {
      const surveyor = job.surveyorOperatorId ? robotById.get(job.surveyorOperatorId) : undefined;
      const drain = surveyor ? drainOf(surveyor) : 0;
      if (!surveyor || !canWorkExtraction(surveyor, job.id)) {
        update.blockedReason = LANDING_DEVICE_BLOCK;
        extractionUpdates.push(update);
        continue;
      }
      if (!surveyor || drain <= 0 || surveyor.battery < drain) {
        update.blockedReason = LANDING_BATTERY_BLOCK;
        if (surveyor && surveyor.status === "working") surveyor.status = "charging";
        extractionUpdates.push(update);
        continue;
      }
      surveyor.status = "working";
      surveyor.battery -= drain;
      workedThisMinute.add(surveyor.record.operatorId);
      update.phaseWorkDone = job.phaseWorkDone + 1;
      if (update.phaseWorkDone >= LANDING_SURVEY_POINTS) {
        update.status = "completed";
        nodeUpdates.push({ nodeId: job.nodeId, extractedQuantity: 0, discovered: true });
        releaseAll();
      }
      extractionUpdates.push(update);
      continue;
    }

    // mine
    let phase = job.phase ?? "mining";
    let phaseWorkDone = job.phaseWorkDone;
    let batchesExtracted = job.batchesExtracted;
    let batchesDelivered = job.batchesDelivered;
    let blockedReason: string | null = null;
    const builders = job.builderOperatorIds
      .map((operatorId) => robotById.get(operatorId))
      .filter((robot): robot is RobotState => robot !== undefined);
    const hauler = job.haulerOperatorId ? robotById.get(job.haulerOperatorId) : undefined;

    // 暂停已释放设备；取消收尾只能重新认领空闲的原驮运，不能抢走别单设备。
    // 分配与工单进度由同一个基地事务经 npc 写入。
    if (
      job.status === "stopping" && batchesDelivered < batchesExtracted &&
      hauler && hauler.projectId === null && hauler.extractionJobId === null &&
      (hauler.status === "idle" || hauler.status === "charging") &&
      !workedThisMinute.has(hauler.record.operatorId)
    ) {
      hauler.extractionJobId = job.id;
    }

    if (phase === "mining" && job.status === "active") {
      const assigned = builders.filter((robot) => canWorkExtraction(robot, job.id));
      const ready = assigned.filter((robot) => drainOf(robot) > 0 && robot.battery >= drainOf(robot));
      if (ready.length === 0) {
        blockedReason = assigned.length > 0 ? LANDING_BATTERY_BLOCK : LANDING_DEVICE_BLOCK;
        for (const robot of assigned) {
          if (robot.status === "working") robot.status = "charging";
        }
      } else {
        for (const robot of ready) {
          robot.status = "working";
          robot.battery -= drainOf(robot);
          workedThisMinute.add(robot.record.operatorId);
          phaseWorkDone += robot.params?.workRate ?? 0;
        }
      }
    }

    // 采出即转 hauling，但本分钟不再推进运输——每分钟只走一个工序
    // （01 §2：当前批有多余工作预算也不能提前推进到下一工序）。
    if (
      blockedReason === null &&
      phase === "mining" &&
      phaseWorkDone >= LANDING_MINING_POINTS_PER_BATCH &&
      job.status === "active"
    ) {
      batchesExtracted += 1;
      update.extractedOrdinals.push(batchesExtracted);
      nodeUpdates.push({ nodeId: job.nodeId, extractedQuantity: LANDING_ORE_PER_BATCH, discovered: false });
      phase = "hauling";
      phaseWorkDone = 0;
      // 结束本分钟的采矿单推进（进入下一分钟才开始运输）。
      update.phase = phase;
      update.phaseWorkDone = phaseWorkDone;
      update.batchesExtracted = batchesExtracted;
      update.batchesDelivered = batchesDelivered;
      extractionUpdates.push(update);
      continue;
    }

    if (phase === "hauling" && blockedReason === null) {
      const drain = hauler ? drainOf(hauler) : 0;
      if (!hauler || !canWorkExtraction(hauler, job.id)) {
        blockedReason = LANDING_DEVICE_BLOCK;
      } else if (drain <= 0 || hauler.battery < drain) {
        blockedReason = LANDING_BATTERY_BLOCK;
        if (hauler.status === "working") hauler.status = "charging";
      } else {
        hauler.status = "working";
        hauler.battery -= drain;
        workedThisMinute.add(hauler.record.operatorId);
        phaseWorkDone += hauler.params?.workRate ?? 0;
        if (phaseWorkDone >= LANDING_HAULING_POINTS_PER_BATCH) {
          batchesDelivered += 1;
          update.deliveredOrdinals.push(batchesDelivered);
          phase = "mining";
          phaseWorkDone = 0;
        }
      }
    }

    if (job.status === "stopping" && batchesDelivered >= batchesExtracted) {
      update.status = "cancelled";
      releaseAll();
    } else if (batchesDelivered >= job.batchesPlanned && batchesDelivered >= batchesExtracted) {
      update.status = "completed";
      releaseAll();
    } else {
      update.blockedReason = blockedReason;
    }

    update.phase = phase;
    update.phaseWorkDone = phaseWorkDone;
    update.batchesExtracted = batchesExtracted;
    update.batchesDelivered = batchesDelivered;
    extractionUpdates.push(update);
  }

  // ---------- 5) 加工 / 充电：按玩家优先级供能 ----------
  const productionUpdates: LandingProductionUpdate[] = [];
  const slotUpdates: LandingSlotUpdate[] = [];
  const slotById = new Map(input.slots.map((slot) => [slot.id, slot]));

  // 参与供能的单：active/blocked、有能量合同、已绑站点。手工单（着陆器站点）无槽。
  // 输入由结算层按 (createdAt, id) FIFO 排序；此处再按 id 稳定排序，保证与数组顺序无关。
  const productionJobs = input.manufacturingJobs
    .filter(
      (job) =>
        (job.status === "active" || job.status === "blocked") &&
        job.energyWmPerBatch !== null &&
        job.productionSiteId !== null
    )
    .sort((left, right) => left.id.localeCompare(right.id));

  interface ProductionTarget {
    job: LandingManufacturingJobRecord;
    slotId: string | null;
    demandWm: number;
    shareWm: number;
  }
  const targets: ProductionTarget[] = [];
  for (const job of productionJobs) {
    const slot = job.slotId ? slotById.get(job.slotId) : undefined;
    if (job.slotId !== null) {
      if (!slot) continue; // 槽行缺失（异常）：跳过，不产出
      if (slot.maintenanceBlocked) {
        productionUpdates.push({
          jobId: job.id,
          status: "blocked",
          currentBatchEnergyWm: job.currentBatchEnergyWm,
          outputsDone: job.outputsDone,
          blockedReason: LANDING_MAINTENANCE_BLOCK,
          batchesCompleted: 0,
          slotId: job.slotId ?? null
        });
        continue;
      }
    }
    const perBatch = job.energyWmPerBatch ?? 0;
    const remaining = (job.outputsPlanned - job.outputsDone) * perBatch - job.currentBatchEnergyWm;
    if (remaining <= 0) continue;
    targets.push({
      job,
      slotId: job.slotId ?? null,
      demandWm: Math.min(job.ratedW, remaining),
      shareWm: 0
    });
  }
  const totalDemand = targets.reduce((sum, target) => sum + target.demandWm, 0);

  // 比例分摊（顺序无关）：按比例取整，余量按 id 稳定顺序逐 W·min 补齐。
  const allocateProduction = (budgetWm: number): void => {
    if (targets.length === 0 || budgetWm <= 0) return;
    let allocated = 0;
    for (const target of targets) {
      target.shareWm = Math.floor((target.demandWm / totalDemand) * budgetWm);
      allocated += target.shareWm;
    }
    let leftover = budgetWm - allocated;
    const ordered = [...targets].sort((left, right) => left.job.id.localeCompare(right.job.id));
    let guard = 0;
    while (leftover > 0 && guard <= ordered.length * 2 + budgetWm) {
      const target = ordered[guard % ordered.length]!;
      if (target.demandWm - target.shareWm > 0) {
        target.shareWm += 1;
        leftover -= 1;
      }
      guard += 1;
    }
  };

  // 充电一台：整 Wh 入电池，舍入剩余留回池；实际存入能量计入负载与上限。
  const chargeLimit = input.power.chargeLimitW;
  const chargeCapWm = chargeLimit === null ? Number.MAX_SAFE_INTEGER : chargeLimit;
  const chargeBudget = { usedWm: 0 };
  const chargeOne = (robot: RobotState): void => {
    if (chargeBudget.usedWm >= chargeCapWm) return;
    const chargeRateW = robot.params?.chargeRateW ?? 0;
    if (chargeRateW <= 0) return;
    const roomWh = robot.record.batteryCapacityWh - robot.battery;
    if (roomWh <= 0) return; // 满电设备不占充电预算
    const wantWm = Math.min(chargeRateW, chargeCapWm - chargeBudget.usedWm, roomWh * 60);
    if (wantWm <= 0) return;
    const fromPool = Math.min(pool, wantWm);
    pool -= fromPool;
    let rest = wantWm - fromPool;
    let fromStorage = 0;
    if (rest > 0) {
      fromStorage = Math.min(storage, rest);
      storage -= fromStorage;
    }
    const drawnWm = fromPool + fromStorage;
    const gainedWh = Math.floor(drawnWm / 60);
    pool += drawnWm - gainedWh * 60; // 舍入剩余留回站内池
    chargeBudget.usedWm += gainedWh * 60;
    servedW += gainedWh * 60;
    robot.battery += gainedWh;
  };

  // 充电顺序：活动工序所需低电设备优先；其余稳定轮转（起始游标由模拟分钟驱动）。
  const needsChargeFirst = (robot: RobotState): boolean =>
    robot.status === "charging" &&
    (robot.extractionJobId !== null || robot.projectId !== null) &&
    robot.battery < drainOf(robot);
  const chargeable = robots
    .filter(
      (robot) =>
        (robot.status === "idle" || robot.status === "charging") &&
        !workedThisMinute.has(robot.record.operatorId) &&
        (robot.params?.chargeRateW ?? 0) > 0 &&
        robot.battery < robot.record.batteryCapacityWh
    )
    .sort((left, right) => left.record.operatorId.localeCompare(right.record.operatorId));
  const minuteIndex = Math.floor(input.simTime.getTime() / 60_000);
  const rotating = chargeable.filter((robot) => !needsChargeFirst(robot));
  const rotate = rotating.length > 0 ? minuteIndex % rotating.length : 0;
  const chargeOrder = [
    ...chargeable.filter(needsChargeFirst),
    ...rotating.map((_, index) => rotating[(index + rotate) % rotating.length]!)
  ];

  const serveProductionDemand = (): void => {
    if (totalDemand <= 0) return;
    const budget = serveFromPool(Math.min(totalDemand, pool + storage));
    allocateProduction(budget);
  };
  const serveChargingDemand = (): void => {
    for (const robot of chargeOrder) chargeOne(robot);
  };

  if (input.power.policy === "production") {
    serveProductionDemand();
    serveChargingDemand();
  } else {
    serveChargingDemand();
    serveProductionDemand();
  }

  // ---------- 6) 加工推进与逐批产出（槽计数、第 10 批后维护停机） ----------
  for (const target of targets) {
    const { job } = target;
    const perBatch = job.energyWmPerBatch ?? 0;
    let currentBatch = job.currentBatchEnergyWm + target.shareWm;
    let outputsDone = job.outputsDone;
    let batchesCompleted = 0;
    let slotBatches = target.slotId
      ? slotById.get(target.slotId)?.batchesSinceMaintenance ?? 0
      : 0;
    let slotBlocked = target.slotId
      ? slotById.get(target.slotId)?.maintenanceBlocked ?? false
      : false;

    while (currentBatch >= perBatch && outputsDone < job.outputsPlanned) {
      currentBatch -= perBatch;
      outputsDone += 1;
      batchesCompleted += 1;
      if (target.slotId !== null && job.countsSlotMaintenance) {
        slotBatches += 1;
        if (slotBatches >= LANDING_SLOT_MAINTENANCE_BATCHES) {
          slotBlocked = true;
          break; // 第 10 批完成后停机等待维护，不开下一批
        }
      }
    }

    const completed = outputsDone >= job.outputsPlanned;
    let status: LandingManufacturingJobRecord["status"] = "active";
    let blockedReason: string | null = null;
    if (target.shareWm <= 0 && currentBatch < perBatch && !completed) {
      status = "blocked";
      blockedReason = LANDING_POWER_BLOCK;
    } else if (slotBlocked && !completed) {
      status = "blocked";
      blockedReason = LANDING_MAINTENANCE_BLOCK;
    } else if (completed) {
      status = "completed";
    }

    productionUpdates.push({
      jobId: job.id,
      status,
      currentBatchEnergyWm: currentBatch,
      outputsDone,
      blockedReason,
      batchesCompleted,
      slotId: target.slotId
    });
    if (target.slotId !== null && batchesCompleted > 0) {
      slotUpdates.push({
        slotId: target.slotId,
        batchesSinceMaintenance: slotBatches,
        maintenanceBlocked: slotBlocked
      });
    }
  }

  // ---------- 7) 盈余入储能（封顶）与积尘演化 ----------
  storage = Math.min(capacity, storage + pool);
  const light = input.weatherLight ?? 1;
  const dustDelta = (light <= 0.3 ? 8 : light <= 0.8 ? 2 : -1) / 60;
  const dustLevel = Math.min(100, Math.max(0, input.power.dustLevel + dustDelta));

  const robotUpdates: LandingRobotUpdate[] = [];
  for (const robot of robots) {
    if (
      robot.battery !== robot.record.batteryWh ||
      robot.status !== robot.record.status ||
      robot.projectId !== robot.record.currentProjectId ||
      robot.stepIndex !== robot.record.currentStepIndex ||
      robot.extractionJobId !== robot.record.currentExtractionJobId
    ) {
      robotUpdates.push({
        operatorId: robot.record.operatorId,
        batteryWh: Math.max(0, Math.min(robot.record.batteryCapacityWh, Math.round(robot.battery))),
        status: robot.status,
        currentProjectId: robot.projectId,
        currentStepIndex: robot.stepIndex,
        currentExtractionJobId: robot.extractionJobId
      });
    }
  }
  for (const [projectId, list] of stepsByProject) {
    for (const step of list) {
      if (
        step.workDone !== step.record.workDone ||
        step.status !== step.record.status ||
        step.blockedReason !== step.record.blockedReason
      ) {
        stepUpdates.push({
          projectId,
          stepIndex: step.record.stepIndex,
          workDone: step.workDone,
          status: step.status,
          blockedReason: step.blockedReason
        });
      }
    }
  }

  return {
    power: { storageWm: storage, genRemainderWm, lastLoadW: servedW, dustLevel },
    robotUpdates,
    stepUpdates,
    projectCompletions,
    extractionUpdates,
    nodeUpdates,
    productionUpdates,
    slotUpdates
  };
}

// landing 批次能量（W·min）= 额定 W × 每批工作分钟（开工时按配方冻结进工单行）。
export function landingEnergyWmPerBatch(ratedW: number, workMinutesPerBatch: number): number {
  return ratedW * workMinutesPerBatch;
}

// 实际当期供电投影（与 computeLandingMinute 同一公式/同源输入）：快照显示用。
// 太阳能 = 峰值 × 日照 × (1−尘/200)（仅昼间）；应急 = 恒定；二者分列不混算。
export function projectLandingSupplyW(input: {
  simTime: Date;
  solarWPeak: number;
  weatherLight: number;
  dustLevel: number;
  emergencyW: number;
}): { solarW: number; emergencyW: number; totalW: number; isDaylight: boolean } {
  const hour = input.simTime.getUTCHours();
  const isDaylight = hour >= SIM_DAYLIGHT_START_HOUR && hour < SIM_DAYLIGHT_END_HOUR;
  const dustFactor = 1 - Math.min(100, Math.max(0, input.dustLevel)) / 200;
  const solarW = isDaylight
    ? Math.round(input.solarWPeak * (input.weatherLight ?? 1) * dustFactor)
    : 0;
  return { solarW, emergencyW: input.emergencyW, totalW: solarW + input.emergencyW, isDaylight };
}
