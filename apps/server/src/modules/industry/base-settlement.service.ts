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
  ): Promise<Array<{ baseId: string; simTime: Date; speed: number; deltaSimMs: number }>>;
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
  sites: SettlementSitePort;
  assets: SettlementAssetPort;
  catalog: SettlementCatalogPort;
  // 生产绑定：(tx) => new IndustryRepository(tx)
  openIndustry: (tx: IndustryTx) => IndustryReadPort & IndustrySettlementWriter;
  // 生产绑定：(tx) => new RobotRuntimeService(tx)
  openRobots: (tx: IndustryTx) => SettlementRobotPort;
}

export class BaseSettlementService {
  constructor(private readonly deps: BaseSettlementDeps) {}

  // 返回处理的基地数；无基地可推进时 0。
  async settleBases(tx: IndustryTx, now: Date): Promise<number> {
    const bases = await this.deps.clock.lockAdvanceableBases(tx, now);
    for (const base of bases) {
      const nextSimTime = new Date(base.simTime.getTime() + base.deltaSimMs);
      await this.settleBase(tx, base.baseId, base.simTime, base.deltaSimMs, nextSimTime);
      await this.deps.clock.saveSimAdvance(tx, base.baseId, nextSimTime, now);
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
    }
  }
}
