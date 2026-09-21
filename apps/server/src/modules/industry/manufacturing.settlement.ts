// M13-C 制造结算（m13-p-contract.md §4 冻结语义）。由 I 注册进基地 tick（项目结算之后），
// 必须在调用方事务内执行，本函数永不自开/提交事务。
//
// 电力边界：耗电本身不在此处扣 base_power_state——由调用方（I 集成）统一结算电力；本函数
// 只推进工作量与产出。本 tick 制造可用能 = min(powerW × Δh, availableEnergyWh)，能效 1:1
// 折算为工作点（无每 tick 生产上限）；Δh = deltaSimMs / 3_600_000。
//
// 每基地（FIFO 按 created_at）每工单：
//   workPoints = 本 tick 可用能 → current_unit_work_done += workPoints；
//   达到 workPerUnit → 单台产出（同一事务内原子）：
//     消耗该台材料份额（job.reserved_inputs 同步递减）→ createDeviceAsset
//     （sourceOperation=job:{jobId}:{ordinal}）→ initializeOperator → 写 outputs(jobId, ordinal)
//     → outputs_done++ / current_unit_work_done 清零重计（余量保留给下一台）。
//   多台同 tick 连续产出允许（循环）。
//   可用能为 0 → 工单 blocked 'insufficient_power'（工作量不动）；复电回 active。
//   配方修订不一致/产出模板缺失 → blocked 'content_missing'（不抛，同项目结算语义，G06）。
//   outputs (job_id, ordinal) 唯一索引兜底重复 ordinal：吞掉返回已有，不重复消耗/登记。
import type { RecipeTemplateDto, RobotTemplateDto } from "@ai-mud/shared";
import { CONTENT_BLOCK_REASON, POWER_BLOCK_REASON } from "./industry.pure.js";
import type {
  JobProgressPatch,
  ManufacturingJobRecord,
  ManufacturingSettlementRepo,
  ManufacturingTx
} from "./manufacturing.repository.js";

// ---------- 结构端口（composition 绑定；不 import application/base/ports.ts） ----------

export interface ManufacturingSettlementCatalogPort {
  getRecipeTemplate(stableId: string): RecipeTemplateDto | null;
  getRobotTemplate(stableId: string): RobotTemplateDto | null;
}

// assets 模块的产出事务面（生产绑定 BaseAssetService 的结构子面）。
export interface ManufacturingSettleAssetsPort {
  consumeReservedBaseInventory(
    tx: ManufacturingTx,
    baseId: string,
    itemId: string,
    quantity: number
  ): Promise<void>;
  createDeviceAsset(
    tx: ManufacturingTx,
    input: {
      baseId: string;
      deviceDefId: string;
      templateRevision: number;
      sourceOperation: string;
    }
  ): Promise<{ deviceId: string }>;
}

// npc 模块的作业者登记面（生产绑定 RobotFactory 的结构子面）。
export interface ManufacturingSettleRobotsPort {
  initializeOperator(
    tx: ManufacturingTx,
    input: {
      deviceId: string;
      baseId: string;
      groupId: string;
      batteryCapacityWh: number;
      initialBatteryWh: number;
    }
  ): Promise<{ operatorId: string }>;
}

export interface ManufacturingSettlementDeps {
  // 本 tick 分配给制造的床位能量预算（Wh）；I 集成时从 pure 电力分配结果取。
  availableEnergyWh: number;
  // 制造负载功率（W，P fixture 1500W）。
  powerW: number;
  // 本 tick 模拟时长（ms）：Δh = deltaSimMs / 3_600_000，需求侧 = powerW × Δh。
  deltaSimMs: number;
  catalog: ManufacturingSettlementCatalogPort;
  settleAssets: ManufacturingSettleAssetsPort;
  settleRobots: ManufacturingSettleRobotsPort;
  // 生产绑定：(tx) => new ManufacturingRepository(tx)
  openManufacturing: (tx: ManufacturingTx) => ManufacturingSettlementRepo;
}

export interface ManufacturingSettlementResult {
  basesSettled: number;
  unitsProduced: number;
  jobsCompleted: number;
  jobsBlocked: number;
}

const ENERGY_EPS = 1e-6;

export async function settleManufacturing(
  tx: ManufacturingTx,
  now: Date,
  deps: ManufacturingSettlementDeps
): Promise<ManufacturingSettlementResult> {
  const repo = deps.openManufacturing(tx);
  const dh = Math.max(0, deps.deltaSimMs) / 3_600_000;
  // 本 tick 可用能：负载需求 powerW×Δh 与分配预算取小（能效 1:1 → 即工作点数）。
  const workPoints = Math.min(deps.powerW * dh, Math.max(0, deps.availableEnergyWh));

  const result: ManufacturingSettlementResult = {
    basesSettled: 0,
    unitsProduced: 0,
    jobsCompleted: 0,
    jobsBlocked: 0
  };

  const baseIds = await repo.listBasesWithSettleableJobs(tx);
  for (const baseId of baseIds) {
    result.basesSettled += 1;
    const jobs = await repo.listSettleableJobs(tx, baseId);
    for (const job of jobs) {
      await settleJob(tx, now, deps, repo, baseId, job, workPoints, result);
    }
  }
  return result;
}

async function settleJob(
  tx: ManufacturingTx,
  now: Date,
  deps: ManufacturingSettlementDeps,
  repo: ManufacturingSettlementRepo,
  baseId: string,
  job: ManufacturingJobRecord,
  workPoints: number,
  result: ManufacturingSettlementResult
): Promise<void> {
  // ---------- 内容闸门：配方缺失/修订不一致 → blocked（工作量不动，不抛） ----------
  const recipe = deps.catalog.getRecipeTemplate(job.recipeDefId);
  if (!recipe || recipe.ref.revision !== job.recipeRevision || !(recipe.workPerUnit > 0)) {
    await blockJob(tx, repo, job, CONTENT_BLOCK_REASON);
    result.jobsBlocked += 1;
    return;
  }
  const robotTemplate = deps.catalog.getRobotTemplate(recipe.output.templateStableId);
  if (!robotTemplate) {
    await blockJob(tx, repo, job, CONTENT_BLOCK_REASON);
    result.jobsBlocked += 1;
    return;
  }

  // ---------- 电力闸门：本 tick 无可用能 → blocked 'insufficient_power'（工作量不动） ----------
  if (workPoints <= ENERGY_EPS) {
    await blockJob(tx, repo, job, POWER_BLOCK_REASON);
    result.jobsBlocked += 1;
    return;
  }

  // ---------- 工作量推进 + 逐台产出（循环允许同 tick 连续多台） ----------
  let outputsDone = job.outputsDone;
  let currentUnitWorkDone = job.currentUnitWorkDone + workPoints;
  let reservedInputs = job.reservedInputs.map((item) => ({ ...item }));
  let produced = 0;

  while (outputsDone < job.outputsPlanned && currentUnitWorkDone + ENERGY_EPS >= recipe.workPerUnit) {
    const ordinal = outputsDone + 1;
    const existing = await repo.findOutputByOrdinal(tx, job.id, ordinal);
    if (!existing) {
      // 单台产出原子段（同一 tick 事务内；中途故障整体回滚，零部分提交 G04）。
      for (const item of recipe.inputs) {
        // 该台份额 = inputs 原始量
        await deps.settleAssets.consumeReservedBaseInventory(tx, baseId, item.itemId, item.quantity);
        reservedInputs = decrementReserved(reservedInputs, item.itemId, item.quantity);
      }
      const device = await deps.settleAssets.createDeviceAsset(tx, {
        baseId,
        deviceDefId: recipe.output.templateStableId,
        templateRevision: robotTemplate.ref.revision,
        sourceOperation: `job:${job.id}:${ordinal}`
      });
      const operator = await deps.settleRobots.initializeOperator(tx, {
        deviceId: device.deviceId,
        baseId,
        groupId: robotTemplate.groupId,
        batteryCapacityWh: robotTemplate.batteryCapacityWh,
        initialBatteryWh: recipe.output.initialBatteryWh
      });
      // (job_id, ordinal) 唯一索引冲突 → 吞掉返回已有（重复 ordinal 幂等 G03）。
      await repo.insertOutput(tx, {
        jobId: job.id,
        ordinal,
        deviceId: device.deviceId,
        operatorId: operator.operatorId
      });
    }
    outputsDone += 1;
    // 清零重计：扣除该台工作量，余量留给下一台（多台同 tick 连续产出）。
    currentUnitWorkDone -= recipe.workPerUnit;
    produced += 1;
    if (currentUnitWorkDone < 0) currentUnitWorkDone = 0;
  }

  const completed = outputsDone >= job.outputsPlanned;
  const patch: JobProgressPatch = {
    jobId: job.id,
    status: completed ? "completed" : "active", // 复电/内容恢复：blocked 回 active
    outputsDone,
    currentUnitWorkDone,
    blockedReason: null,
    reservedInputs,
    completedAt: completed ? now : null
  };
  await repo.saveJobProgress(tx, patch);
  result.unitsProduced += produced;
  if (completed) result.jobsCompleted += 1;
}

async function blockJob(
  tx: ManufacturingTx,
  repo: ManufacturingSettlementRepo,
  job: ManufacturingJobRecord,
  reason: string
): Promise<void> {
  if (job.status === "blocked" && job.blockedReason === reason) return; // 已是同因阻塞：无变化
  await repo.saveJobProgress(tx, {
    jobId: job.id,
    status: "blocked",
    outputsDone: job.outputsDone,
    currentUnitWorkDone: job.currentUnitWorkDone,
    blockedReason: reason,
    reservedInputs: job.reservedInputs,
    completedAt: null
  });
}

function decrementReserved(
  reservedInputs: Array<{ itemId: string; quantity: number }>,
  itemId: string,
  quantity: number
): Array<{ itemId: string; quantity: number }> {
  return reservedInputs.map((item) =>
    item.itemId === itemId ? { itemId: item.itemId, quantity: item.quantity - quantity } : item
  );
}
