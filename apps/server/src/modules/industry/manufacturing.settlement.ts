// M13-C 制造结算（m13-p-contract.md §4 冻结语义）。由基地 tick 按基地调用（项目结算之后），
// 必须在调用方事务内执行，本函数永不自开/提交事务。
//
// 基地隔离（2026-09-25 B001 / ARCH-domain-01）：只结算 deps.baseId 这一个基地的工单。
// 暂停、离线、租约失效的基地不在推进集合里，其工单在任何其他基地结算时都不推进、不扣料、不产出。
//
// 电力边界：制造负载由调用方在同一电力池里先行供给（industry.pure.computeBaseTick：基础 < 施工
// < 制造 < 充电），本函数不写 base_power_state；availableEnergyWh = 电力池本子 tick 实际分给制造
// 的能量。本子 tick 预算 = min(powerW × Δh, availableEnergyWh)，能效 1:1 折算为工作点；
// Δh = deltaSimMs / 3_600_000。需求侧由 measureManufacturingDemand 给出（剩余工作量）。
//
// 本基地工单按 FIFO（created_at）分摊预算（m13-p-contract §4.1/§4.3）：
//   每单拿 min(剩余预算, 该单剩余工作量) → current_unit_work_done += 份额；前单用满后后单排队
//   （保持 active，本子 tick 不推进）；合计不超过预算。
//   达到 workPerUnit → 单台产出（同一事务内原子）：
//     消耗该台材料份额（job.reserved_inputs 同步递减）→ createDeviceAsset
//     （sourceOperation=job:{jobId}:{ordinal}）→ initializeOperator → 写 outputs(jobId, ordinal)
//     → outputs_done++ / current_unit_work_done 清零重计（余量保留给下一台）。
//   多台同 tick 连续产出允许（循环）。
//   预算为 0（电力池没给制造任何能量）→ 工单 blocked 'insufficient_power'（工作量不动）；复电回 active。
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
  getRecipeTemplate(stableId: string, revision?: number): RecipeTemplateDto | null;
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

// 需求测量只需要目录与仓储读面。
export interface ManufacturingDemandDeps {
  catalog: ManufacturingSettlementCatalogPort;
  openManufacturing: (tx: ManufacturingTx) => ManufacturingSettlementRepo;
}

export interface ManufacturingDemand {
  // 本基地可结算（active/blocked）工单数；0 时调用方可跳过结算。
  settleableJobs: number;
  // 内容有效工单的剩余工作量合计（Wh，能效 1:1；未按功率封顶）。
  pendingWorkWh: number;
}

export interface ManufacturingSettlementDeps extends ManufacturingDemandDeps {
  // 只结算这个基地的工单（B001：禁止遍历全服）。
  baseId: string;
  // 电力池本子 tick 实际分给制造的能量（Wh）；由 computeBaseTick.manufacturingEnergyWh 提供。
  availableEnergyWh: number;
  // 制造负载功率（W，P fixture 1500W）。
  powerW: number;
  // 本 tick 模拟时长（ms）：Δh = deltaSimMs / 3_600_000，需求侧 = powerW × Δh。
  deltaSimMs: number;
  settleAssets: ManufacturingSettleAssetsPort;
  settleRobots: ManufacturingSettleRobotsPort;
}

export interface ManufacturingSettlementResult {
  unitsProduced: number;
  jobsCompleted: number;
  jobsBlocked: number;
  // 本子 tick 实际折算为工作点的能量（≤ 预算）。
  energyUsedWh: number;
}

const ENERGY_EPS = 1e-6;

type ResolvedRecipe = { recipe: RecipeTemplateDto; robotTemplate: RobotTemplateDto };

// 内容闸门：配方缺失/修订不一致/产出模板缺失 → null（调用方阻塞为 content_missing）。
function resolveRecipe(
  catalog: ManufacturingSettlementCatalogPort,
  job: ManufacturingJobRecord
): ResolvedRecipe | null {
  const recipe = catalog.getRecipeTemplate(job.recipeDefId, job.recipeRevision);
  if (!recipe || recipe.ref.revision !== job.recipeRevision || !(recipe.workPerUnit > 0)) return null;
  const robotTemplate = catalog.getRobotTemplate(recipe.output.templateStableId);
  if (!robotTemplate) return null;
  return { recipe, robotTemplate };
}

function remainingWork(job: ManufacturingJobRecord, recipe: RecipeTemplateDto): number {
  const unitsLeft = Math.max(0, job.outputsPlanned - job.outputsDone);
  return Math.max(0, unitsLeft * recipe.workPerUnit - job.currentUnitWorkDone);
}

// 本基地制造需求（只读）：供电力池在施工之后、充电之前为制造留出负载。
export async function measureManufacturingDemand(
  tx: ManufacturingTx,
  baseId: string,
  deps: ManufacturingDemandDeps
): Promise<ManufacturingDemand> {
  const jobs = await deps.openManufacturing(tx).listSettleableJobs(tx, baseId);
  let pendingWorkWh = 0;
  for (const job of jobs) {
    const resolved = resolveRecipe(deps.catalog, job);
    if (resolved) pendingWorkWh += remainingWork(job, resolved.recipe);
  }
  return { settleableJobs: jobs.length, pendingWorkWh };
}

export async function settleManufacturing(
  tx: ManufacturingTx,
  now: Date,
  deps: ManufacturingSettlementDeps
): Promise<ManufacturingSettlementResult> {
  const repo = deps.openManufacturing(tx);
  const dh = Math.max(0, deps.deltaSimMs) / 3_600_000;
  // 本子 tick 预算：负载上限 powerW×Δh 与电力池实际分配取小（能效 1:1 → 即工作点数）。
  const budget = Math.min(deps.powerW * dh, Math.max(0, deps.availableEnergyWh));
  let remainingBudget = budget;

  const result: ManufacturingSettlementResult = {
    unitsProduced: 0,
    jobsCompleted: 0,
    jobsBlocked: 0,
    energyUsedWh: 0
  };

  const jobs = await repo.listSettleableJobs(tx, deps.baseId);
  for (const job of jobs) {
    const resolved = resolveRecipe(deps.catalog, job);
    if (!resolved) {
      await blockJob(tx, repo, job, CONTENT_BLOCK_REASON);
      result.jobsBlocked += 1;
      continue;
    }
    const need = remainingWork(job, resolved.recipe);
    // ---------- 电力闸门：电力池本子 tick 没给制造任何能量 → blocked（工作量不动） ----------
    // 工作量已够的单台（need≈0）不再需要电，照常落产出，避免卡在阻塞里。
    if (budget <= ENERGY_EPS && need > ENERGY_EPS) {
      await blockJob(tx, repo, job, POWER_BLOCK_REASON);
      result.jobsBlocked += 1;
      continue;
    }
    const share = Math.min(remainingBudget, need);
    if (share <= ENERGY_EPS && need > ENERGY_EPS) {
      // 排队：制造线本子 tick 已被更早的工单用满。制造线有电，解除残留的缺电阻塞。
      if (job.status === "blocked" && job.blockedReason === POWER_BLOCK_REASON) {
        await repo.saveJobProgress(tx, {
          jobId: job.id,
          status: "active",
          outputsDone: job.outputsDone,
          currentUnitWorkDone: job.currentUnitWorkDone,
          blockedReason: null,
          reservedInputs: job.reservedInputs,
          completedAt: null
        });
      }
      continue;
    }
    remainingBudget -= share;
    result.energyUsedWh += share;
    await settleJob(tx, now, deps, repo, job, resolved, share, result);
  }
  return result;
}

async function settleJob(
  tx: ManufacturingTx,
  now: Date,
  deps: ManufacturingSettlementDeps,
  repo: ManufacturingSettlementRepo,
  job: ManufacturingJobRecord,
  resolved: ResolvedRecipe,
  workPoints: number,
  result: ManufacturingSettlementResult
): Promise<void> {
  const { recipe, robotTemplate } = resolved;
  const baseId = deps.baseId;

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
