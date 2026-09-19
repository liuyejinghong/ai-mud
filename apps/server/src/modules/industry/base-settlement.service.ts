// M12-B 基地 tick 参与者（m12-p-contract.md §3.1—§3.4）。
// 由 I 注册进 world 每分钟 tick 参与者数组：settleBases(tx, now) 在 world tick 事务内执行，
// 本服务永不自开/提交事务。流程（逐基地）：
//   clock.lockAdvanceableBases（running+租约+追补上限政策在 world 实现内）→ 读电力/项目/步骤/
//   作业者与内容模板 → industry.pure.computeBaseTick → 落盘 power/step/project 更新 →
//   robotRuntime.applyRobotUpdates → 完成项目：消耗全部预留物料 + 站点 built（facilityRef =
//   kind:stableId@revision）+ completedAt → clock.saveSimAdvance(simTime+Δsim, now)。
// 内容修订不一致：该项目步骤全 blocked 'content_missing'（不抛，时钟照常推进）。
import type { ProjectStatus, ProjectTemplateDto, RobotTemplateDto } from "@ai-mud/shared";
import { definitionRefKey } from "@ai-mud/shared";
import {
  CONTENT_BLOCK_REASON,
  computeBaseTick,
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
      catchUp: boolean;
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
  // M13-C 制造结算（可选：未绑定时跳过，v0.12 行为不变）。
  manufacturing?: BaseManufacturingSettlePort;
  // M14 协作（可选：未绑定时跳过）。
  cooperation?: {
    // 检测缺工步骤→发起/决策协作请求→接受 helper 绑定（M14-B 服务）。
    detectAndResolve(
      tx: IndustryTx,
      baseId: string,
      runningSteps: Array<{
        projectId: string;
        projectName: string;
        stepIndex: number;
        groupId: string;
      }>,
      meta: { baseRevision: number; epoch: number; clock: { now(): Date } }
    ): Promise<unknown>;
    // accepted helper 转入 working。
    applyAcceptedHelpers(tx: IndustryTx, baseId: string, clock: { now(): Date }): Promise<unknown>;
    // 项目完成时标记相关协作 fulfilled。
    markFulfilledByProject(tx: IndustryTx, baseId: string, projectId: string): Promise<unknown>;
  };
  sites: SettlementSitePort;
  assets: SettlementAssetPort;
  catalog: SettlementCatalogPort;
  // 生产绑定：(tx) => new IndustryRepository(tx)
  openIndustry: (tx: IndustryTx) => IndustryReadPort & IndustrySettlementWriter;
  // 生产绑定：(tx) => new RobotRuntimeService(tx)
  openRobots: (tx: IndustryTx) => SettlementRobotPort;
}

// 基地结算的最小模拟步长（与 world tick 同粒度）。
const BASE_SUB_TICK_MS = 60_000;

// 制造负载功率（M13-P fixture §5）。
export const MANUFACTURING_POWER_W = 1500;

export interface BaseManufacturingSettlePort {
  settle(
    tx: IndustryTx,
    now: Date,
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
      if (base.catchUp) {
        // 世界 tick 追补步：只推基地时钟，不生产/不耗能（不把停服时间当生产时间）。
        await this.deps.clock.saveSimAdvance(tx, base.baseId, nextSimTime, base.nextLastAdvancedAt);
        continue;
      }
      // 按模拟时长拆子 tick：工作量/能耗与 simTime 同比例推进（×4 速度 = 4 倍产出与能耗）。
      const subTicks = Math.max(1, Math.min(10, Math.round(base.deltaSimMs / BASE_SUB_TICK_MS)));
      const subDelta = Math.round(base.deltaSimMs / subTicks);
      for (let i = 0; i < subTicks; i += 1) {
        const from = new Date(base.simTime.getTime() + subDelta * i);
        const to = new Date(base.simTime.getTime() + subDelta * (i + 1));
        await this.settleBase(tx, base.baseId, from, to.getTime() - from.getTime(), to);
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
    nextSimTime: Date
  ): Promise<void> {
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
      const template = this.deps.catalog.getProjectTemplate(project.projectDefId);
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
      const template = this.deps.catalog.getRobotTemplate(robot.deviceDefId);
      if (template) robotByStableId.set(robot.deviceDefId, template);
    }

    const steps = await industry.listSteps(matchedProjects.map((project) => project.id));

    const result = computeBaseTick({
      simTime,
      deltaSimMs,
      power,
      projects: matchedProjects,
      steps,
      robots: robotRecords,
      templates: { robotByStableId, projectByStableId }
    });

    // ---------- 落盘：电力 ----------
    await industry.savePowerState(tx, baseId, {
      storageWh: result.storageWh,
      lastLoadW: result.lastLoadW
    });

    // ---------- 制造结算（M13-C）：电力池扣减后按剩余能推进工单 ----------
    if (this.deps.manufacturing) {
      const availableEnergyWh = Math.max(0, result.storageWh);
      await this.deps.manufacturing.settle(tx, simTime, {
        availableEnergyWh,
        powerW: MANUFACTURING_POWER_W,
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

    // ---------- M14 协作：缺工步骤检测/决策/accepted helper 绑定 ----------
    if (this.deps.cooperation) {
      // 缺工步骤 = 本 tick 后仍 running 的步骤；组信息从持久化步骤读。
      const runningStepUpdates = result.stepUpdates.filter((step) => step.status === "running");
      const runningSteps: Array<{
        projectId: string;
        projectName: string;
        stepIndex: number;
        groupId: string;
      }> = [];
      for (const step of runningStepUpdates) {
        const project = matchedProjects.find((entry) => entry.id === step.projectId);
        if (!project) continue;
        const template = matchedTemplates.get(step.projectId);
        const stepRecord = (await industry.listSteps([project.id])).find(
          (entry) => entry.stepIndex === step.stepIndex
        );
        runningSteps.push({
          projectId: step.projectId,
          projectName: template?.name ?? step.projectId,
          stepIndex: step.stepIndex,
          groupId: stepRecord?.groupId ?? "engineering"
        });
      }
      await this.deps.cooperation.detectAndResolve(tx, baseId, runningSteps, {
        baseRevision: 1,
        epoch: 1,
        clock: { now: () => simTime }
      });
      await this.deps.cooperation.applyAcceptedHelpers(tx, baseId, { now: () => simTime });
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
      if (this.deps.cooperation) {
        await this.deps.cooperation.markFulfilledByProject(tx, baseId, project.id);
      }
    }
  }
}
