// R1 landing 基地结算（03-domain-contracts.md §5「landing-v1 同模块纯计算入口 +
// 共用受控读写参与者」）。由 BaseSettlementService 按 rulesProfile 分流调用；
// 每个整基地分钟执行一次 computeLandingMinute 并把结果原子落盘：
//   电力（W·min 定点）→ 机器人 → 步骤/项目（完工走 facility-effects：发电/容量/
//   充电上限/加工槽 + 消耗预留）→ 资源节点（采出扣减/揭示）→ 采矿单与现场货物
//   （送达入库经 assets 端口）→ 制造（逐批消耗预留、item/robot 原子产出、槽计数）。
// 本模块永不自开/提交事务；矿量只经 world 端口、库存/设备资产只经 assets/npc 端口。
import type { ProjectStatus, RecipeTemplateDto, RobotTemplateDto } from "@ai-mud/shared";
import { definitionRefKey } from "@ai-mud/shared";
import { applyProjectCompletionEffects } from "./facility-effects.js";
import {
  computeLandingMinute,
  LANDING_CONTENT_BLOCK,
  LANDING_ORE_PER_BATCH,
  type ComputeLandingMinuteInput,
  type ComputeLandingMinuteResult,
  type LandingExtractionJobRecord,
  type LandingManufacturingJobRecord,
  type LandingRobotParams,
  type LandingSlotRecord
} from "./landing-rules.js";
import type { ManufacturingJobRecord } from "./manufacturing.repository.js";
import type { ExtractionTx } from "./extraction.repository.js";
import type { BaseRobotRecord } from "./industry.pure.js";

export interface LandingSettlementCatalogPort {
  rulesProfile(): "legacy" | "landing-v1";
  getRobotTemplate(stableId: string): RobotTemplateDto | null;
  getProjectTemplate(stableId: string): {
    ref: { kind: "project"; stableId: string; revision: number };
    name: string;
    outputFacility: {
      ref: { kind: "facility"; stableId: string; revision: number };
      generationWPeak?: number;
      effects?: {
        storageCapacityWh?: number;
        chargeLimitW?: number;
        processingSlots?: number;
        capabilities?: string[];
      };
    };
  } | null;
  getRecipeTemplate(stableId: string, revision?: number): RecipeTemplateDto | null;
  // D013 事件文案用（可选：缺省退回 itemId）。
  getItemInfo?(): Record<string, { name: string; description: string }>;
  getProvisionSeed(): {
    power: { baseLoadW?: number };
    sites: Array<{ siteKey: string }>;
  };
  listTemplates(): { projects: Array<{ ref: { stableId: string }; outputFacility: { ref: { stableId: string } } }> };
}

export interface LandingSettlementDeps {
  catalogResolver: { forBase(tx: ExtractionTx, baseId: string): Promise<LandingSettlementCatalogPort> };
  industry: {
    listProjects(tx: ExtractionTx, baseId: string): Promise<Array<{
      id: string; projectDefId: string; templateRevision: number; status: string;
      currentStepIndex: number; siteId: string; builderCount?: number | null;
      reservedInputs: Array<{ itemId: string; quantity: number }>;
    }>>;
    listSteps(tx: ExtractionTx, projectIds: string[]): Promise<Array<{
      projectId: string; stepIndex: number; kind: string; groupId: string; status: string;
      workRequired: number; workDone: number; blockedReason: string | null;
    }>>;
    saveStepUpdates(tx: ExtractionTx, updates: Array<{
      projectId: string; stepIndex: number; workDone: number; status: string; blockedReason: string | null;
    }>): Promise<void>;
    saveProjectUpdates(tx: ExtractionTx, updates: Array<{
      projectId: string; status: ProjectStatus; currentStepIndex: number; completedAt: Date | null;
    }>): Promise<void>;
    getLandingPower(tx: ExtractionTx, baseId: string): Promise<{
      solarWPeak: number; emergencyW: number; chargeLimitW: number | null;
      storageWm: number; storageCapacityWm: number; dustLevel: number;
      genRemainderWm: number; policy: "production" | "charging";
    } | null>;
    saveLandingPower(tx: ExtractionTx, baseId: string, patch: {
      storageWm: number; genRemainderWm: number; lastLoadW: number; dustLevel: number;
    }): Promise<void>;
    markSiteBuilt(tx: ExtractionTx, siteId: string, facilityRef: string): Promise<void>;
    addGenerationWPeak(tx: ExtractionTx, baseId: string, deltaW: number): Promise<void>;
    addStorageCapacityWh(tx: ExtractionTx, baseId: string, deltaWh: number): Promise<void>;
    addChargeLimitW(tx: ExtractionTx, baseId: string, deltaW: number): Promise<void>;
    insertProductionSlots(tx: ExtractionTx, baseId: string, siteId: string, count: number): Promise<void>;
  };
  slots: {
    listForBase(tx: ExtractionTx, baseId: string): Promise<LandingSlotRecord[]>;
    saveSlot(tx: ExtractionTx, patch: {
      slotId: string; batchesSinceMaintenance?: number; maintenanceBlocked?: boolean;
    }): Promise<void>;
  };
  nodes: {
    findNode(tx: ExtractionTx, baseId: string, nodeId: string): Promise<{
      id: string; itemId: string; remainingQuantity: number; reservedQuantity: number;
    } | null>;
    debitReserved(tx: ExtractionTx, baseId: string, nodeId: string, quantity: number): Promise<boolean>;
    revealNode(tx: ExtractionTx, baseId: string, nodeId: string): Promise<void>;
  };
  extraction: {
    listSettleable(tx: ExtractionTx, baseId: string): Promise<LandingExtractionJobRecord[]>;
    saveJob(tx: ExtractionTx, patch: {
      jobId: string; status?: LandingExtractionJobRecord["status"];
      phase?: "mining" | "hauling" | null; phaseWorkDone?: number;
      batchesExtracted?: number; batchesDelivered?: number; blockedReason?: string | null;
    }): Promise<void>;
    insertOutput(tx: ExtractionTx, input: {
      jobId: string; ordinal: number; itemId: string; quantity: number;
    }): Promise<{ duplicate: boolean }>;
    markOutputDelivered(tx: ExtractionTx, jobId: string, ordinal: number): Promise<boolean>;
  };
  manufacturing: {
    listLandingJobs(tx: ExtractionTx, baseId: string): Promise<ManufacturingJobRecord[]>;
    findLandingOutputByOrdinal?: (tx: ExtractionTx, jobId: string, ordinal: number) => Promise<unknown | null>;
    saveLandingBinding(tx: ExtractionTx, patch: {
      jobId: string; status?: ManufacturingJobRecord["status"]; productionSiteId: string | null;
    }): Promise<void>;
    saveLandingProgress(tx: ExtractionTx, patch: {
      jobId: string; status: ManufacturingJobRecord["status"];
      outputsDone: number; currentBatchEnergyWm: number; blockedReason: string | null;
      reservedInputs: Array<{ itemId: string; quantity: number }>; completedAt: Date | null;
    }): Promise<void>;
    insertLandingOutput(tx: ExtractionTx, input: {
      jobId: string; ordinal: number; outputKind: "robot" | "item";
      deviceId?: string; operatorId?: string; itemId?: string; quantity?: number;
    }): Promise<{ duplicate: boolean }>;
  };
  robots: {
    listOperators(tx: ExtractionTx, baseId: string): Promise<Array<BaseRobotRecord & { currentExtractionJobId?: string | null }>>;
    applyRobotUpdates(tx: ExtractionTx, updates: Array<{
      operatorId: string; batteryWh: number; status: string;
      currentProjectId: string | null; currentStepIndex: number | null;
      currentExtractionJobId: string | null;
    }>): Promise<void>;
  };
  assets: {
    consumeReservedBaseInventory(
      tx: ExtractionTx, baseId: string, itemId: string, quantity: number
    ): Promise<void>;
    creditBaseInventory(tx: ExtractionTx, baseId: string, itemId: string, quantity: number): Promise<void>;
    createDeviceAsset(tx: ExtractionTx, input: {
      baseId: string; deviceDefId: string; templateRevision: number; sourceOperation: string;
    }): Promise<{ deviceId: string }>;
  };
  robotFactory: {
    initializeOperator(tx: ExtractionTx, input: {
      deviceId: string; baseId: string; groupId: string;
      batteryCapacityWh: number; initialBatteryWh: number;
    }): Promise<{ operatorId: string }>;
  };
  sites: {
    listSites(tx: ExtractionTx, baseId: string): Promise<Array<{
      id: string; siteKey: string; state: string; builtFacilityRef: string | null;
    }>>;
  };
  weather?: { current(baseId: string, simTime: Date): Promise<{ lightFactor: number }> };
  // D013 事件历史：结算点同事务追加（composition 绑定 world/base-event 唯一写者，
  // 与 receipts 的 (tx) => 写口 模式一致）。可选：未绑定时静默跳过（事件不是事实前提）。
  events?: (tx: ExtractionTx) => {
    append(input: {
      baseId: string;
      type: string;
      title: string;
      detail: string;
      simTime: Date;
    }): Promise<void>;
  };
}

// 一个基地分钟的 landing 结算。返回是否处理（电力行缺失 = provision 未完成 → false）。
export async function settleLandingBaseMinute(
  tx: ExtractionTx,
  input: { baseId: string; simTime: Date },
  deps: LandingSettlementDeps
): Promise<boolean> {
  const { baseId, simTime } = input;
  const catalog = await deps.catalogResolver.forBase(tx, baseId);
  if (catalog.rulesProfile() !== "landing-v1") return false;

  const power = await deps.industry.getLandingPower(tx, baseId);
  if (!power) return false;

  const siteRecords = await deps.sites.listSites(tx, baseId);
  const landerSite = siteRecords.find((site) => site.siteKey === "lander") ?? null;

  const projectRecords = await deps.industry.listProjects(tx, baseId);
  const activeProjects = projectRecords.filter((project) => project.status === "active");
  const steps = await deps.industry.listSteps(tx, projectRecords.map((project) => project.id));

  const robotRecords = await deps.robots.listOperators(tx, baseId);
  const robotParams = new Map<string, LandingRobotParams>();
  for (const robot of robotRecords) {
    if (robotParams.has(robot.deviceDefId)) continue;
    const template = catalog.getRobotTemplate(robot.deviceDefId);
    if (template) {
      robotParams.set(robot.deviceDefId, {
        workRate: template.workRatePerTick,
        workDrainWh: template.workDrainWhPerTick ?? 500,
        chargeRateW: template.chargeRateW
      });
    }
  }

  const extractionJobs = await deps.extraction.listSettleable(tx, baseId);
  const manufacturingJobs = await deps.manufacturing.listLandingJobs(tx, baseId);
  const slotRecords = await deps.slots.listForBase(tx, baseId);

  // FIFO 槽位分配（03 §4）：已绑定的 live 单保留其站点槽位；未绑定的 live 单
  // （新下单/恢复入队）按全局 FIFO（createdAt, id）填入各站点剩余空闲槽；
  // 手工单只占着陆器虚拟工位（创建时已绑定）。新绑定持久化到 production_site_id，
  // 暂停单不占槽（pause 已清绑定）。
  const slotIdByJobId = new Map<string, string | null>();
  const slotsBySite = new Map<string, LandingSlotRecord[]>();
  for (const slot of slotRecords) {
    const list = slotsBySite.get(slot.siteId);
    if (list) list.push(slot);
    else slotsBySite.set(slot.siteId, [slot]);
  }
  for (const list of slotsBySite.values()) {
    list.sort((left, right) => left.slotIndex - right.slotIndex);
  }
  const liveJobs = manufacturingJobs
    .filter((job) => job.productionSiteId !== null && job.status !== "paused" && job.status !== "completed" && job.status !== "cancelled")
    .sort((left, right) => (left.createdAt?.getTime() ?? 0) - (right.createdAt?.getTime() ?? 0) || left.id.localeCompare(right.id));
  const siteOrder = [...slotsBySite.keys()].sort((left, right) => left.localeCompare(right));
  const occupied = new Map<string, number>(); // siteId → 已占槽数
  for (const siteId of siteOrder) occupied.set(siteId, 0);
  // 1) 已绑定单保槽（同站点 FIFO 对齐槽序）。
  for (const job of liveJobs) {
    const siteId = job.productionSiteId!;
    const slots = slotsBySite.get(siteId);
    if (!slots) continue; // 着陆器虚拟工位：无槽行
    const index = occupied.get(siteId) ?? 0;
    if (index < slots.length) {
      slotIdByJobId.set(job.id, slots[index]!.id);
      occupied.set(siteId, index + 1);
    } else {
      slotIdByJobId.set(job.id, null); // 异常超绑：按未绑处理
    }
  }
  // 2) 未绑定 live 单（active、productionSiteId null）按全局 FIFO 填空闲槽并持久化绑定。
  const queuedJobs = manufacturingJobs
    .filter((job) => job.productionSiteId === null && job.status === "active")
    .sort((left, right) => (left.createdAt?.getTime() ?? 0) - (right.createdAt?.getTime() ?? 0) || left.id.localeCompare(right.id));
  for (const job of queuedJobs) {
    let placed = false;
    for (const siteId of siteOrder) {
      const slots = slotsBySite.get(siteId)!;
      const index = occupied.get(siteId) ?? 0;
      if (index < slots.length) {
        slotIdByJobId.set(job.id, slots[index]!.id);
        occupied.set(siteId, index + 1);
        await deps.manufacturing.saveLandingBinding(tx, { jobId: job.id, productionSiteId: siteId });
        job.productionSiteId = siteId;
        placed = true;
        break;
      }
    }
    if (!placed) slotIdByJobId.set(job.id, null); // 队列满：等待（不占能量）
  }
  // 手工单（绑着陆器）无槽行：slotId null，加工能力路径单独判定。
  for (const job of liveJobs) {
    if (job.productionSiteId === landerSite?.id && !slotsBySite.has(job.productionSiteId)) {
      slotIdByJobId.set(job.id, null);
    }
  }
  // 结算输入的 landing 单视图（带本分钟绑定结果）。
  const landingJobs: LandingManufacturingJobRecord[] = manufacturingJobs
    .filter((job) => job.energyWmPerBatch !== null)
    .map((job) => ({
      id: job.id,
      status: job.status,
      productionSiteId: job.productionSiteId,
      slotId: slotIdByJobId.get(job.id) ?? null,
      energyWmPerBatch: job.energyWmPerBatch,
      currentBatchEnergyWm: job.currentBatchEnergyWm,
      outputsPlanned: job.outputsPlanned,
      outputsDone: job.outputsDone,
      ratedW: catalog.getRecipeTemplate(job.recipeDefId, job.recipeRevision)?.ratedW ?? 0,
      countsSlotMaintenance:
        catalog.getRecipeTemplate(job.recipeDefId, job.recipeRevision)?.countsSlotMaintenance ?? true
    }));

  const seedBaseLoad = catalog.getProvisionSeed().power.baseLoadW ?? 200;
  const weatherLight = deps.weather
    ? (await deps.weather.current(baseId, simTime)).lightFactor
    : 1;

  const minuteInput: ComputeLandingMinuteInput = {
    simTime,
    power: {
      solarWPeak: power.solarWPeak,
      emergencyW: power.emergencyW,
      baseLoadW: seedBaseLoad,
      chargeLimitW: power.chargeLimitW,
      storageWm: power.storageWm,
      storageCapacityWm: power.storageCapacityWm,
      dustLevel: power.dustLevel,
      genRemainderWm: power.genRemainderWm,
      policy: power.policy
    },
    weatherLight,
    robots: robotRecords.map((robot) => ({
      operatorId: robot.operatorId,
      deviceDefId: robot.deviceDefId,
      groupId: robot.groupId,
      batteryWh: robot.batteryWh,
      batteryCapacityWh: robot.batteryCapacityWh,
      status: robot.status as "idle" | "charging" | "working" | "offline",
      currentProjectId: robot.currentProjectId,
      currentStepIndex: robot.currentStepIndex,
      currentExtractionJobId: robot.currentExtractionJobId ?? null
    })),
    robotParams,
    projects: activeProjects.map((project) => ({ id: project.id, status: project.status, siteId: project.siteId, ...(project.builderCount !== undefined ? { builderCount: project.builderCount } : {}) })),
    steps: steps.map((step) => ({
      projectId: step.projectId,
      stepIndex: step.stepIndex,
      kind: step.kind,
      groupId: step.groupId,
      status: step.status as "pending" | "ready" | "running" | "blocked" | "completed" | "failed",
      workRequired: step.workRequired,
      workDone: step.workDone,
      blockedReason: step.blockedReason
    })),
    extractionJobs,
    manufacturingJobs: landingJobs,
    slots: slotRecords
  };

  const result = computeLandingMinute(minuteInput);
  await persistLandingMinute(tx, baseId, simTime, result, deps, {
    catalog,
    projectRecords,
    steps,
    extractionJobs,
    manufacturingJobs,
    robotFactory: deps.robotFactory,
    assets: deps.assets
  });
  return true;
}

interface PersistContext {
  catalog: LandingSettlementCatalogPort;
  projectRecords: Array<{
    id: string; projectDefId: string; templateRevision: number; status: string;
    siteId: string; builderCount?: number | null; reservedInputs: Array<{ itemId: string; quantity: number }>;
    currentStepIndex: number;
  }>;
  steps: Array<{
    projectId: string; stepIndex: number; kind: string; status: string;
    workRequired: number; workDone: number;
  }>;
  extractionJobs: LandingExtractionJobRecord[];
  manufacturingJobs: ManufacturingJobRecord[];
  robotFactory: LandingSettlementDeps["robotFactory"];
  assets: LandingSettlementDeps["assets"];
}

async function persistLandingMinute(
  tx: ExtractionTx,
  baseId: string,
  simTime: Date,
  result: ComputeLandingMinuteResult,
  deps: LandingSettlementDeps,
  context: PersistContext
): Promise<void> {
  // ---------- 电力 ----------
  await deps.industry.saveLandingPower(tx, baseId, {
    storageWm: result.power.storageWm,
    genRemainderWm: result.power.genRemainderWm,
    lastLoadW: result.power.lastLoadW,
    dustLevel: result.power.dustLevel
  });

  // ---------- 机器人 ----------
  if (result.robotUpdates.length > 0) {
    await deps.robots.applyRobotUpdates(tx, result.robotUpdates.map((update) => ({
      ...update,
      status: update.status as "idle" | "charging" | "working" | "offline"
    })));
  }

  // ---------- 步骤 / 项目 / 完工效果 ----------
  if (result.stepUpdates.length > 0) {
    await deps.industry.saveStepUpdates(tx, result.stepUpdates.map((update) => ({
      ...update,
      status: update.status as string
    })));
  }
  const completedIds = new Set(result.projectCompletions.map((completion) => completion.projectId));
  const projectPatches: Array<{ projectId: string; status: ProjectStatus; currentStepIndex: number; completedAt: Date | null }> = [];
  for (const project of context.projectRecords) {
    const projectSteps = context.steps
      .filter((step) => step.projectId === project.id)
      .sort((left, right) => left.stepIndex - right.stepIndex);
    const statusByIndex = new Map<number, string>(projectSteps.map((step) => [step.stepIndex, step.status]));
    for (const update of result.stepUpdates) {
      if (update.projectId === project.id) statusByIndex.set(update.stepIndex, update.status);
    }
    let nextStepIndex: number | null = null;
    for (const step of projectSteps) {
      if ((statusByIndex.get(step.stepIndex) ?? step.status) !== "completed") {
        nextStepIndex = step.stepIndex;
        break;
      }
    }
    if (nextStepIndex === null) {
      nextStepIndex = projectSteps[projectSteps.length - 1]?.stepIndex ?? project.currentStepIndex;
    }
    const completion = completedIds.has(project.id);
    projectPatches.push({
      projectId: project.id,
      status: (completion ? "completed" : project.status) as ProjectStatus,
      currentStepIndex: nextStepIndex,
      completedAt: completion ? simTime : null
    });
  }
  if (projectPatches.length > 0) await deps.industry.saveProjectUpdates(tx, projectPatches);

  for (const completion of result.projectCompletions) {
    const project = context.projectRecords.find((entry) => entry.id === completion.projectId);
    if (!project) continue;
    const template = context.catalog.getProjectTemplate(project.projectDefId);
    if (!template || template.ref.revision !== project.templateRevision) continue;
    await applyProjectCompletionEffects({
      tx,
      baseId,
      siteId: project.siteId,
      template: { outputFacility: template.outputFacility } as Parameters<typeof applyProjectCompletionEffects>[0]["template"],
      reservedInputs: project.reservedInputs,
      writer: {
        markSiteBuilt: deps.industry.markSiteBuilt,
        addGenerationWPeak: deps.industry.addGenerationWPeak,
        addStorageCapacityWh: deps.industry.addStorageCapacityWh,
        addChargeLimitW: deps.industry.addChargeLimitW,
        insertProductionSlots: deps.industry.insertProductionSlots
      },
      assets: deps.assets
    });
    // D013：工程完工事件（与完工事实同一事务，回滚一致）。
    await deps.events?.(tx).append({
      baseId,
      type: "project.completed",
      title: `${template.name}已完工`,
      detail: `${template.name}全部步骤完成，设施投产并接入基地。`,
      simTime
    });
  }

  // ---------- 资源节点 / 采矿单 / 现场货物 ----------
  for (const nodeUpdate of result.nodeUpdates) {
    const node = await deps.nodes.findNode(tx, baseId, nodeUpdate.nodeId);
    if (!node) continue;
    if (nodeUpdate.discovered) {
      await deps.nodes.revealNode(tx, baseId, nodeUpdate.nodeId);
    }
    if (nodeUpdate.extractedQuantity > 0) {
      // 命中行数为 0 = 条件失败：中止整个事务（矿量守恒，03 §5）。
      const debited = await deps.nodes.debitReserved(tx, baseId, nodeUpdate.nodeId, nodeUpdate.extractedQuantity);
      if (!debited) {
        throw new Error(`node ${nodeUpdate.nodeId} reserved debit failed (conservation violation)`);
      }
    }
  }

  for (const update of result.extractionUpdates) {
    const job = context.extractionJobs.find((entry) => entry.id === update.jobId);
    if (!job) continue;
    for (const ordinal of update.extractedOrdinals) {
      const node = await deps.nodes.findNode(tx, baseId, job.nodeId);
      if (!node) continue;
      await deps.extraction.insertOutput(tx, {
        jobId: job.id,
        ordinal,
        itemId: node.itemId,
        quantity: LANDING_ORE_PER_BATCH
      });
    }
    for (const ordinal of update.deliveredOrdinals) {
      const node = await deps.nodes.findNode(tx, baseId, job.nodeId);
      if (!node) continue;
      const marked = await deps.extraction.markOutputDelivered(tx, job.id, ordinal);
      if (!marked) continue; // 已送达（重放）：不重复入库
      await deps.assets.creditBaseInventory(tx, baseId, node.itemId, LANDING_ORE_PER_BATCH);
      // D013：采矿送达事件（送达标记 + 入库 + 事件同一事务；重放不再触发）。
      const itemName =
        context.catalog.getItemInfo?.()[node.itemId]?.name ?? node.itemId;
      await deps.events?.(tx).append({
        baseId,
        type: "extraction.delivered",
        title: `${itemName}运抵仓库`,
        detail: `采矿第 ${ordinal} 批送达，+${LANDING_ORE_PER_BATCH} ${itemName} 入库。`,
        simTime
      });
    }
    await deps.extraction.saveJob(tx, {
      jobId: job.id,
      status: update.status,
      phase: update.phase,
      phaseWorkDone: update.phaseWorkDone,
      batchesExtracted: update.batchesExtracted,
      batchesDelivered: update.batchesDelivered,
      blockedReason: update.blockedReason
    });
  }

  // ---------- 加工槽 ----------
  for (const slotUpdate of result.slotUpdates) {
    await deps.slots.saveSlot(tx, slotUpdate);
  }

  // ---------- 制造：逐批消耗预留 + item/robot 原子产出 ----------
  for (const production of result.productionUpdates) {
    const job = context.manufacturingJobs.find((entry) => entry.id === production.jobId);
    if (!job) continue;
    const recipe = context.catalog.getRecipeTemplate(job.recipeDefId, job.recipeRevision);
    if (!recipe) {
      await deps.manufacturing.saveLandingProgress(tx, {
        jobId: job.id,
        status: "blocked",
        outputsDone: job.outputsDone,
        currentBatchEnergyWm: job.currentBatchEnergyWm,
        blockedReason: LANDING_CONTENT_BLOCK,
        reservedInputs: job.reservedInputs,
        completedAt: null
      });
      continue;
    }
    let reservedInputs = job.reservedInputs.map((item) => ({ ...item }));
    const outputsDone = production.outputsDone;
    for (let batch = job.outputsDone + 1; batch <= outputsDone; batch += 1) {
      const already = await deps.manufacturing.findLandingOutputByOrdinal?.(tx, job.id, batch);
      if (already) continue; // 重放：该批已登记，不重复消耗/产出
      for (const item of recipe.inputs) {
        await deps.assets.consumeReservedBaseInventory(tx, baseId, item.itemId, item.quantity);
        reservedInputs = reservedInputs.map((entry) =>
          entry.itemId === item.itemId
            ? { itemId: entry.itemId, quantity: entry.quantity - item.quantity }
            : entry
        );
      }
      if (recipe.output.kind === "item") {
        await deps.assets.creditBaseInventory(tx, baseId, recipe.output.itemId, recipe.output.quantity);
        await deps.manufacturing.insertLandingOutput(tx, {
          jobId: job.id, ordinal: batch, outputKind: "item",
          itemId: recipe.output.itemId, quantity: recipe.output.quantity
        });
      } else {
        const robotTemplate = context.catalog.getRobotTemplate(recipe.output.templateStableId);
        if (!robotTemplate) {
          throw new Error(`robot template ${recipe.output.templateStableId} missing for job ${job.id}`);
        }
        // 先建设备与作业者（robot 输出行的外键非空），再写唯一 ordinal。
        // 新造设备初始电量 = 配方声明（landing 组装为 0，需真实充电）。
        const device = await deps.assets.createDeviceAsset(tx, {
          baseId,
          deviceDefId: recipe.output.templateStableId,
          templateRevision: robotTemplate.ref.revision,
          sourceOperation: `job:${job.id}:${batch}`
        });
        const operator = await context.robotFactory.initializeOperator(tx, {
          deviceId: device.deviceId,
          baseId,
          groupId: robotTemplate.groupId,
          batteryCapacityWh: robotTemplate.batteryCapacityWh,
          initialBatteryWh: recipe.output.initialBatteryWh
        });
        await deps.manufacturing.insertLandingOutput(tx, {
          jobId: job.id, ordinal: batch, outputKind: "robot",
          deviceId: device.deviceId, operatorId: operator.operatorId
        });
      }
    }
    await deps.manufacturing.saveLandingProgress(tx, {
      jobId: job.id,
      status: production.status,
      outputsDone,
      currentBatchEnergyWm: production.currentBatchEnergyWm,
      blockedReason: production.blockedReason,
      reservedInputs,
      completedAt: production.status === "completed" ? simTime : null
    });
    // D013：制造工单完工事件（与完工状态同一事务；重放不触发——完成后不再进 live 集）。
    if (production.status === "completed") {
      const itemInfo = context.catalog.getItemInfo?.();
      const outputLabel =
        recipe.output.kind === "item"
          ? `${recipe.output.quantity} × ${itemInfo?.[recipe.output.itemId]?.name ?? recipe.output.itemId}`
          : `${context.catalog.getRobotTemplate(recipe.output.templateStableId)?.name ?? recipe.output.templateStableId}`;
      await deps.events?.(tx).append({
        baseId,
        type: "manufacturing.completed",
        title: `${recipe.name}制造完成`,
        detail: `工单 ${job.id.slice(0, 8)} 产出 ${outputLabel}（共 ${outputsDone} 件）。`,
        simTime
      });
    }
  }
}

// 供 settlement 分流：目录解析后判断 profile。
export function isLandingProfile(profile: "legacy" | "landing-v1"): boolean {
  return profile === "landing-v1";
}

export { definitionRefKey };
