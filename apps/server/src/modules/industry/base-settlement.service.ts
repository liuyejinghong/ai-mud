// M12-B 基地 tick 参与者（m12-p-contract.md §3.1—§3.4）。
// 由 I 注册进 world 每分钟 tick 参与者数组：settleBases(tx, now) 在 world tick 事务内执行，
// 本服务永不自开/提交事务。流程（逐基地）：
//   clock.lockAdvanceableBases（只取已确认前台时段，单次 10 分钟上限）→ 读电力/项目/步骤/
//   作业者与内容模板 → industry.pure.computeBaseTick → 落盘 power/step/project 更新 →
//   robotRuntime.applyRobotUpdates → 完成项目：消耗全部预留物料 + 站点 built（facilityRef =
//   kind:stableId@revision）+ completedAt → clock.saveSimAdvance(simTime+Δsim, confirmedEnd)。
// 内容修订不一致：该项目步骤全 blocked 'content_missing'（不抛，时钟照常推进）。
// 制造（2026-09-25 B001）：只对当前被推进的基地测量需求→同一电力池供能→按基地结算，
// 暂停基地不在推进集合里；租约失效前已确认的时段仍须结清。
// 第 0 阶段 B008：供电、施工、制造、充电与天气都按绝对基地分钟边界结算；
// 不足一分钟的余量留在 simTime，下次跨界时再结算，调用频率不改变产出。
import type { ProjectStatus, ProjectTemplateDto, RobotTemplateDto } from "@ai-mud/shared";
import { definitionRefKey } from "@ai-mud/shared";
import {
  CONTENT_BLOCK_REASON,
  computeBaseTick,
  MANUFACTURING_LOAD_W,
  ROBOT_WORK_DRAIN_WH,
  WORK_MINUTE_MS,
  type BaseProjectRecord,
  type BaseRobotRecord,
  type BaseStepRecord,
  type BaseTickRobotUpdate,
  type BaseTickStepUpdate
} from "./industry.pure.js";
import type {
  IndustryReadPort,
  IndustrySettlementWriter,
  IndustryTx,
  ProjectRecordPatch
} from "./industry.repository.js";

// ---------- 结构端口（与 application/base/ports.ts 冻结面一致；composition 绑定） ----------

export interface SettlementClockPort {
  lockAdvanceableBases(
    tx: IndustryTx,
    now: Date
  ): Promise<
    Array<{
      baseId: string;
      simTime: Date;
      speed: number;
      deltaSimMs: number;
      nextLastAdvancedAt: Date;
    }>
  >;
  saveSimAdvance(tx: IndustryTx, baseId: string, simTime: Date, lastAdvancedAt: Date): Promise<void>;
}

export interface SettlementSitePort {
  markSiteBuilt(tx: IndustryTx, siteId: string, facilityRef: string): Promise<void>;
}

export interface SettlementAssetPort {
  consumeReservedBaseInventory(
    tx: IndustryTx,
    baseId: string,
    itemId: string,
    quantity: number
  ): Promise<void>;
}

export interface SettlementCatalogPort {
  getRobotTemplate(stableId: string): RobotTemplateDto | null;
  getProjectTemplate(stableId: string): ProjectTemplateDto | null;
}

// 作业者读 + 状态写（npc 唯一写者 robot-runtime 的结构面）
export interface SettlementRobotPort {
  listOperators(baseId: string): Promise<BaseRobotRecord[]>;
  applyRobotUpdates(tx: IndustryTx, updates: BaseTickRobotUpdate[]): Promise<void>;
}

export interface BaseSettlementDeps {
  clock: SettlementClockPort;
  catalogResolver?: { forBase(tx: IndustryTx, baseId: string): Promise<SettlementCatalogPort> };
  // M13-C 制造结算（可选：未绑定时跳过，v0.12 行为不变）。
  manufacturing?: BaseManufacturingSettlePort;
  // M16 订单/采购 tick（可选：未绑定时跳过）。
  economy?: {
    markExpiredAndRefresh(tx: IndustryTx, baseId: string, sim: Date): Promise<unknown>;
    settlePurchases(tx: IndustryTx, baseId: string, sim: Date): Promise<unknown>;
  };
  // M14 协作（可选：未绑定时跳过）。
  cooperation?: {
    listOpenRequests(
      tx: IndustryTx,
      baseId: string
    ): Promise<Array<{
      status: "pending" | "accepted";
      operatorId: string | null;
      projectId: string;
      stepIndex: number;
    }>>;
    // 检测缺工步骤→发起/决策协作请求→接受 helper 绑定（M14-B 服务）。
    detectAndResolve(
      tx: IndustryTx,
      baseId: string,
      needySteps: Array<{
        projectId: string;
        projectName: string;
        stepIndex: number;
        groupId: string;
      }>,
      meta: { baseRevision: number; epoch: number; clock: { now(): Date }; deferFirstCreation: boolean }
    ): Promise<unknown>;
    // accepted helper 转入 working。
    applyAcceptedHelpers(
      tx: IndustryTx,
      baseId: string,
      runnableSteps: Array<{ projectId: string; stepIndex: number }>
    ): Promise<unknown>;
    // 步骤完成时标记相关协作 fulfilled。
    markFulfilledByStep(tx: IndustryTx, baseId: string, projectId: string, stepIndex: number): Promise<unknown>;
  };
  sites: SettlementSitePort;
  assets: SettlementAssetPort;
  catalog: SettlementCatalogPort;
  // 生产绑定：(tx) => new IndustryRepository(tx)
  openIndustry: (tx: IndustryTx) => IndustryReadPort & IndustrySettlementWriter;
  // 生产绑定：(tx) => new RobotRuntimeService(tx)
  openRobots: (tx: IndustryTx) => SettlementRobotPort;
  // M15 天气光照（可选：未绑定时 1.0）。
  weather?: {
    current(baseId: string, simTime: Date): Promise<{ lightFactor: number }>;
  };
}

// 制造结算端口：一律按基地（B001）。先 measure 给电力池报需求，再用电力池实际分给制造的能量 settle。
export interface BaseManufacturingSettlePort {
  measure(
    tx: IndustryTx,
    baseId: string
  ): Promise<{ settleableJobs: number; pendingWorkWh: number }>;
  settle(
    tx: IndustryTx,
    baseId: string,
    simTime: Date,
    input: { availableEnergyWh: number; powerW: number; deltaSimMs: number }
  ): Promise<{ unitsProduced: number; jobsCompleted: number }>;
}

export class BaseSettlementService {
  constructor(private readonly deps: BaseSettlementDeps) {}

  // 返回处理的基地数；无基地可推进时 0。
  async settleBases(tx: IndustryTx, now: Date): Promise<number> {
    const bases = await this.deps.clock.lockAdvanceableBases(tx, now);
    for (const base of bases) {
      const nextSimTime = new Date(base.simTime.getTime() + base.deltaSimMs);
      const catalog = this.deps.catalogResolver
        ? await this.deps.catalogResolver.forBase(tx, base.baseId)
        : this.deps.catalog;
      const startMs = base.simTime.getTime();
      for (
        let boundary = (Math.floor(startMs / WORK_MINUTE_MS) + 1) * WORK_MINUTE_MS;
        boundary <= nextSimTime.getTime();
        boundary += WORK_MINUTE_MS
      ) {
        await this.settleBase(
          tx,
          base.baseId,
          new Date(boundary - WORK_MINUTE_MS),
          WORK_MINUTE_MS,
          new Date(boundary),
          catalog,
          boundary + WORK_MINUTE_MS <= nextSimTime.getTime()
        );
      }
      await this.deps.clock.saveSimAdvance(tx, base.baseId, nextSimTime, base.nextLastAdvancedAt);
    }
    return bases.length;
  }

  private async settleBase(
    tx: IndustryTx,
    baseId: string,
    simTime: Date,
    deltaSimMs: number,
    nextSimTime: Date,
    catalog: SettlementCatalogPort,
    deferFirstCreation: boolean
  ): Promise<void> {
    // ---------- M16 经济 tick：过期订单→failed、补单、采购到货入库 ----------
    if (this.deps.economy) {
      await this.deps.economy.markExpiredAndRefresh(tx, baseId, simTime);
      await this.deps.economy.settlePurchases(tx, baseId, simTime);
    }

    const industry = this.deps.openIndustry(tx);
    const robots = this.deps.openRobots(tx);
    const power = await industry.getPowerState(baseId);
    if (!power) return; // 电力行缺失（provision 未完成）：不结算，仅由调用方推进时钟

    const projects = await industry.listProjects(baseId);
    const activeProjects = projects.filter((project) => project.status === "active");

    // ---------- 模板解析：revision 不一致 → 该项目步骤全 blocked，不抛 ----------
    const matchedProjects: BaseProjectRecord[] = [];
    const matchedTemplates = new Map<string, ProjectTemplateDto>();
    const missingProjects: BaseProjectRecord[] = [];
    const projectByStableId = new Map<string, ProjectTemplateDto>();
    for (const project of activeProjects) {
      const template = catalog.getProjectTemplate(project.projectDefId);
      if (!template || template.ref.revision !== project.templateRevision) {
        missingProjects.push(project);
        continue;
      }
      matchedProjects.push(project);
      matchedTemplates.set(project.id, template);
      projectByStableId.set(project.projectDefId, template);
    }

    const robotRecords = await robots.listOperators(baseId);
    const robotByStableId = new Map<string, RobotTemplateDto>();
    for (const robot of robotRecords) {
      if (robotByStableId.has(robot.deviceDefId)) continue;
      const template = catalog.getRobotTemplate(robot.deviceDefId);
      if (template) robotByStableId.set(robot.deviceDefId, template);
    }

    const steps = await industry.listSteps(matchedProjects.map((project) => project.id));

    const openRequests = this.deps.cooperation
      ? await this.deps.cooperation.listOpenRequests(tx, baseId)
      : [];
    const helperOperatorIds = new Set(
      robotRecords
        .filter((robot) => openRequests.some((helper) =>
          helper.status === "accepted" &&
          helper.operatorId === robot.operatorId &&
          helper.projectId === robot.currentProjectId &&
          helper.stepIndex === robot.currentStepIndex &&
          robot.status === "working"
        ))
        .map((robot) => robot.operatorId)
    );

    const weatherLight = this.deps.weather
      ? (await this.deps.weather.current(baseId, simTime)).lightFactor
      : 1;
    // 制造需求（只读、只看本基地）：电力池在施工之后、充电之前为制造供能（m13-p-contract §4.2）。
    const manufacturingDemand = this.deps.manufacturing
      ? await this.deps.manufacturing.measure(tx, baseId)
      : null;
    const result = computeBaseTick({
      simTime,
      deltaSimMs,
      power,
      weatherLight,
      manufacturingWorkWh: manufacturingDemand?.pendingWorkWh ?? 0,
      projects: matchedProjects,
      steps,
      robots: robotRecords,
      helperOperatorIds,
      templates: { robotByStableId, projectByStableId }
    });

    // ---------- 落盘：电力（含 M15 积尘演化：尘暴 +8/h，晴 -1/h，工程清洁归零） ----------
    const dustDelta =
      (weatherLight <= 0.3 ? 8 : weatherLight <= 0.8 ? 2 : -1) * (deltaSimMs / 3_600_000);
    const dustLevel = Math.min(
      100,
      Math.max(0, (power.dustLevel ?? 30) + dustDelta)
    );
    await industry.savePowerState(tx, baseId, {
      storageWh: result.storageWh,
      lastLoadW: result.lastLoadW,
      dustLevel
    });

    // ---------- 制造结算（M13-C）：只结算本基地，用电力池本子 tick 实际分给制造的能量 ----------
    // Directive：不得改回“遍历全服工单”或“以储能余额当预算”（B001：暂停基地被推进、制造不扣电）。
    if (this.deps.manufacturing && manufacturingDemand && manufacturingDemand.settleableJobs > 0) {
      await this.deps.manufacturing.settle(tx, baseId, simTime, {
        availableEnergyWh: result.manufacturingEnergyWh,
        powerW: MANUFACTURING_LOAD_W,
        deltaSimMs
      });
    }

    // ---------- 落盘：步骤（含内容缺失项目的全量阻塞） ----------
    const stepUpdates: BaseTickStepUpdate[] = [...result.stepUpdates];
    for (const missing of missingProjects) {
      const missingSteps = await industry.listSteps([missing.id]);
      for (const step of missingSteps) {
        if (step.status === "completed") continue;
        const alreadyWritten = stepUpdates.some(
          (update) => update.projectId === step.projectId && update.stepIndex === step.stepIndex
        );
        if (alreadyWritten) continue;
        stepUpdates.push({
          projectId: step.projectId,
          stepIndex: step.stepIndex,
          workDone: step.workDone,
          status: "blocked",
          blockedReason: CONTENT_BLOCK_REASON
        });
      }
    }
    if (stepUpdates.length > 0) await industry.saveStepUpdates(tx, stepUpdates);

    // ---------- 落盘：项目（currentStepIndex = 合并后首个未完成步骤；completion 落状态） ----------
    const projectPatches: ProjectRecordPatch[] = [];
    for (const project of matchedProjects) {
      const projectSteps = steps
        .filter((step: BaseStepRecord) => step.projectId === project.id)
        .sort((a, b) => a.stepIndex - b.stepIndex);
      if (projectSteps.length === 0) continue;
      const statusByIndex = new Map<number, string>(
        projectSteps.map((step) => [step.stepIndex, step.status])
      );
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
      const completion =
        result.projectCompletions.find((entry) => entry.projectId === project.id) ?? null;
      projectPatches.push({
        projectId: project.id,
        status: (completion ? "completed" : project.status) as ProjectStatus,
        currentStepIndex: nextStepIndex,
        completedAt: completion ? nextSimTime : null
      });
    }
    if (projectPatches.length > 0) await industry.saveProjectUpdates(tx, projectPatches);

    // ---------- 落盘：作业者（npc 唯一写者） ----------
    if (result.robotUpdates.length > 0) await robots.applyRobotUpdates(tx, result.robotUpdates);

    if (this.deps.cooperation) {
      const finishedProjects = new Set(projects.filter((project) => project.status === "completed").map((project) => project.id));
      const finishedSteps = new Set(
        [...steps, ...result.stepUpdates]
          .filter((step) => step.status === "completed")
          .map((step) => `${step.projectId}:${step.stepIndex}`)
      );
      const fulfilled = new Set<string>();
      for (const request of openRequests) {
        const key = `${request.projectId}:${request.stepIndex}`;
        if (fulfilled.has(key) || (!finishedProjects.has(request.projectId) && !finishedSteps.has(key))) continue;
        await this.deps.cooperation.markFulfilledByStep(tx, baseId, request.projectId, request.stepIndex);
        fulfilled.add(key);
      }
    }

    // ---------- M14 协作：缺工步骤检测/决策/accepted helper 绑定 ----------
    if (this.deps.cooperation) {
      const stepStatus = new Map(result.stepUpdates.map((step) => [`${step.projectId}:${step.stepIndex}`, step.status]));
      const robotUpdates = new Map(result.robotUpdates.map((robot) => [robot.operatorId, robot]));
      const runnableSteps: Array<{ projectId: string; stepIndex: number }> = [];
      const needySteps: Array<{
        projectId: string;
        projectName: string;
        stepIndex: number;
        groupId: string;
      }> = [];
      for (const step of steps) {
        const status = stepStatus.get(`${step.projectId}:${step.stepIndex}`) ?? step.status;
        if (status !== "ready" && status !== "running") continue;
        const project = matchedProjects.find((entry) => entry.id === step.projectId);
        if (!project) continue;
        runnableSteps.push({ projectId: step.projectId, stepIndex: step.stepIndex });
        const ownWorker = robotRecords.some((robot) => {
          if (robot.groupId !== step.groupId) return false;
          const current = robotUpdates.get(robot.operatorId) ?? robot;
          return current.status === "working" &&
            current.currentProjectId === step.projectId &&
            current.currentStepIndex === step.stepIndex;
        });
        if (ownWorker) continue;
        if (robotRecords.some((robot) => {
          if (robot.groupId !== step.groupId) return false;
          const current = robotUpdates.get(robot.operatorId) ?? robot;
          const template = robotByStableId.get(robot.deviceDefId);
          return (current.status === "idle" || current.status === "charging") &&
            current.batteryWh >= ROBOT_WORK_DRAIN_WH &&
            (template?.workRatePerTick ?? 0) > 0;
        })) continue;
        const template = matchedTemplates.get(step.projectId);
        needySteps.push({
          projectId: step.projectId,
          projectName: template?.name ?? step.projectId,
          stepIndex: step.stepIndex,
          groupId: step.groupId
        });
      }
      await this.deps.cooperation.detectAndResolve(tx, baseId, needySteps, {
        baseRevision: 1,
        epoch: 1,
        clock: { now: () => simTime },
        deferFirstCreation
      });
      await this.deps.cooperation.applyAcceptedHelpers(tx, baseId, runnableSteps);
    }

    // ---------- 完成项目：消耗全部预留 + 站点 built（原子在同一 tick 事务内） ----------
    for (const completion of result.projectCompletions) {
      const project = matchedProjects.find((entry) => entry.id === completion.projectId);
      if (!project) continue;
      const template = matchedTemplates.get(project.id);
      if (!template) continue;
      for (const item of project.reservedInputs) {
        await this.deps.assets.consumeReservedBaseInventory(
          tx,
          baseId,
          item.itemId,
          item.quantity
        );
      }
      await this.deps.sites.markSiteBuilt(
        tx,
        project.siteId,
        definitionRefKey(template.outputFacility.ref)
      );
      // 设施投产：供能上限并入基地（m12-p-contract §3.3，G03「投产后供能改变」）。
      await industry.addGenerationWPeak(tx, baseId, template.outputFacility.generationWPeak);
    }
  }
}
