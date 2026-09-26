// M12-B base_power_state / base_projects / base_project_steps 访问（industry 唯一写者）。
// 结构性实现 application/base/ports.ts 冻结的 BaseIndustryInitPort / BaseIndustryReadPort
// 以及基地 tick 的落盘写面；composition 按结构绑定，industry 不 import application。
// 所有方法必须在调用方事务内执行，本类永不开启或提交事务。
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { BaseRobotGroupId, ProjectStatus, StepKind } from "@ai-mud/shared";
import type { Db } from "../../db/client.js";
import { basePowerState, baseProjectSteps, baseProjects } from "../../db/schema.js";
import type {
  BasePowerRecord,
  BaseProjectRecord,
  BaseStepRecord,
  BaseTickStepUpdate
} from "./industry.pure.js";

export type IndustryTx = Pick<Db, "delete" | "insert" | "select" | "update">;

// ---------- 读端口（A 线快照消费的结构面） ----------

export interface IndustryReadPort {
  getPowerState(baseId: string): Promise<BasePowerRecord | null>;
  listProjects(baseId: string): Promise<BaseProjectRecord[]>;
  listSteps(projectIds: string[]): Promise<BaseStepRecord[]>;
}

// ---------- 电力行种子（A 线 provision 消费的结构面） ----------

export interface PowerStateSeed {
  generationWPeak: number;
  storageCapacityWh: number;
  initialStorageWh: number;
  // R1 landing（缺省 = 旧行为）；基础负载是 release 规则参数，不落库。
  emergencyGenerationW?: number;
  chargeLimitW?: number | null;
  initialDustLevel?: number;
}

export interface IndustryInitPort {
  ensurePowerState(tx: IndustryTx, baseId: string, seed: PowerStateSeed): Promise<void>;
}

// ---------- 基地 tick 落盘写面 ----------

export interface ProjectRecordPatch {
  projectId: string;
  status: ProjectStatus;
  currentStepIndex: number;
  completedAt: Date | null;
}

export interface IndustrySettlementWriter {
  savePowerState(
    tx: IndustryTx,
    baseId: string,
    patch: { storageWh: number; lastLoadW: number; dustLevel?: number }
  ): Promise<void>;
  saveStepUpdates(tx: IndustryTx, updates: BaseTickStepUpdate[]): Promise<void>;
  saveProjectUpdates(tx: IndustryTx, updates: ProjectRecordPatch[]): Promise<void>;
  addGenerationWPeak(tx: IndustryTx, baseId: string, deltaW: number): Promise<void>;
}

// ---------- 创建/取消项目的持久化面 ----------

export interface ProjectStepSeed {
  kind: StepKind;
  groupId: BaseRobotGroupId;
  workRequired: number;
}

export interface InsertProjectInput {
  baseId: string;
  siteId: string;
  projectDefId: string;
  templateRevision: number;
  reservedInputs: Array<{ itemId: string; quantity: number }>;
  steps: ProjectStepSeed[];
}

export interface IndustryProjectStore {
  hasLiveOrCompletedProject(tx: IndustryTx, baseId: string, projectDefId: string): Promise<boolean>;
  insertProjectWithSteps(
    tx: IndustryTx,
    input: InsertProjectInput
  ): Promise<{ projectId: string }>;
  findProject(tx: IndustryTx, baseId: string, projectId: string): Promise<BaseProjectRecord | null>;
  updateProjectStatus(tx: IndustryTx, projectId: string, status: ProjectStatus): Promise<void>;
}

function parseReservedInputs(value: unknown): Array<{ itemId: string; quantity: number }> {
  if (!Array.isArray(value)) return [];
  const inputs: Array<{ itemId: string; quantity: number }> = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as { itemId?: unknown; quantity?: unknown };
    if (typeof record.itemId !== "string" || typeof record.quantity !== "number") continue;
    inputs.push({ itemId: record.itemId, quantity: record.quantity });
  }
  return inputs;
}

export class IndustryRepository
  implements IndustryReadPort, IndustryInitPort, IndustrySettlementWriter, IndustryProjectStore
{
  constructor(private readonly db: IndustryTx) {}

  // ---------- 电力行 ----------

  async ensurePowerState(tx: IndustryTx, baseId: string, seed: PowerStateSeed): Promise<void> {
    const existing = await tx
      .select({ baseId: basePowerState.baseId })
      .from(basePowerState)
      .where(eq(basePowerState.baseId, baseId))
      .limit(1);
    if (existing.length > 0) return;
    await tx.insert(basePowerState).values({
      baseId,
      generationWPeak: seed.generationWPeak,
      storageWh: seed.initialStorageWh,
      storageCapacityWh: seed.storageCapacityWh,
      ...(seed.emergencyGenerationW !== undefined
        ? { emergencyGenerationW: seed.emergencyGenerationW }
        : {}),
      ...(seed.chargeLimitW !== undefined ? { chargeLimitW: seed.chargeLimitW } : {}),
      ...(seed.initialDustLevel !== undefined ? { dustLevel: seed.initialDustLevel } : {})
    });
  }

  // ---------- R1 landing 电力读写（W·min 定点；本模块仍是 base_power_state 唯一写者） ----------

  async getLandingPower(baseId: string): Promise<{
    solarWPeak: number;
    emergencyW: number;
    chargeLimitW: number | null;
    storageWm: number;
    storageCapacityWm: number;
    dustLevel: number;
    genRemainderWm: number;
    policy: "production" | "charging";
  } | null> {
    const [row] = await this.db
      .select()
      .from(basePowerState)
      .where(eq(basePowerState.baseId, baseId))
      .limit(1);
    if (!row) return null;
    return {
      solarWPeak: row.generationWPeak,
      emergencyW: row.emergencyGenerationW,
      chargeLimitW: row.chargeLimitW,
      storageWm: row.storageWh * 60 + row.storageExcessWm,
      storageCapacityWm: row.storageCapacityWh * 60,
      dustLevel: row.dustLevel,
      genRemainderWm: row.genRemainderWm,
      policy: row.powerPolicy as "production" | "charging"
    };
  }

  async saveLandingPower(
    tx: IndustryTx,
    baseId: string,
    patch: { storageWm: number; genRemainderWm: number; lastLoadW: number; dustLevel: number }
  ): Promise<void> {
    const storageWh = Math.floor(patch.storageWm / 60);
    const storageExcessWm = patch.storageWm - storageWh * 60;
    await tx
      .update(basePowerState)
      .set({
        storageWh,
        storageExcessWm,
        genRemainderWm: patch.genRemainderWm,
        lastLoadW: patch.lastLoadW,
        dustLevel: patch.dustLevel,
        updatedAt: new Date()
      })
      .where(eq(basePowerState.baseId, baseId));
  }

  async addStorageCapacityWh(tx: IndustryTx, baseId: string, deltaWh: number): Promise<void> {
    await tx
      .update(basePowerState)
      .set({
        storageCapacityWh: sql`${basePowerState.storageCapacityWh} + ${deltaWh}`,
        updatedAt: new Date()
      })
      .where(eq(basePowerState.baseId, baseId));
  }

  async addChargeLimitW(tx: IndustryTx, baseId: string, deltaW: number): Promise<void> {
    // landing 行必有 charge_limit_w；NULL（旧档误用）按 0 起算，不改变旧行为面。
    await tx
      .update(basePowerState)
      .set({
        chargeLimitW: sql`COALESCE(${basePowerState.chargeLimitW}, 0) + ${deltaW}`,
        updatedAt: new Date()
      })
      .where(eq(basePowerState.baseId, baseId));
  }

  async savePowerPolicy(
    tx: IndustryTx,
    baseId: string,
    priority: "production" | "charging"
  ): Promise<void> {
    await tx
      .update(basePowerState)
      .set({ powerPolicy: priority, updatedAt: new Date() })
      .where(eq(basePowerState.baseId, baseId));
  }

  async getPowerPolicy(baseId: string): Promise<"production" | "charging" | null> {
    const [row] = await this.db
      .select({ policy: basePowerState.powerPolicy })
      .from(basePowerState)
      .where(eq(basePowerState.baseId, baseId))
      .limit(1);
    return row ? (row.policy as "production" | "charging") : null;
  }

  async getPowerState(baseId: string): Promise<BasePowerRecord | null> {
    const [row] = await this.db
      .select()
      .from(basePowerState)
      .where(eq(basePowerState.baseId, baseId))
      .limit(1);
    return row
      ? {
          generationWPeak: row.generationWPeak,
          storageWh: row.storageWh,
          storageCapacityWh: row.storageCapacityWh,
          lastLoadW: row.lastLoadW,
          dustLevel: row.dustLevel,
          emergencyGenerationW: row.emergencyGenerationW,
          chargeLimitW: row.chargeLimitW,
          powerPolicy: row.powerPolicy as "production" | "charging"
        }
      : null;
  }

  async savePowerState(
    tx: IndustryTx,
    baseId: string,
    patch: { storageWh: number; lastLoadW: number; dustLevel?: number }
  ): Promise<void> {
    await tx
      .update(basePowerState)
      .set({
        storageWh: patch.storageWh,
        lastLoadW: patch.lastLoadW,
        dustLevel: patch.dustLevel ?? sql`${basePowerState.dustLevel}`,
        updatedAt: new Date() })
      .where(eq(basePowerState.baseId, baseId));
  }

  // ---------- 项目 ----------

  async listProjects(baseId: string): Promise<BaseProjectRecord[]> {
    const rows = await this.db.select().from(baseProjects).where(eq(baseProjects.baseId, baseId));
    return rows.map((row) => ({
      id: row.id,
      projectDefId: row.projectDefId,
      templateRevision: row.templateRevision,
      status: row.status,
      currentStepIndex: row.currentStepIndex,
      siteId: row.siteId,
      reservedInputs: parseReservedInputs(row.reservedInputs)
    }));
  }

  async findProject(
    tx: IndustryTx,
    baseId: string,
    projectId: string
  ): Promise<BaseProjectRecord | null> {
    const [row] = await tx
      .select()
      .from(baseProjects)
      .where(and(eq(baseProjects.baseId, baseId), eq(baseProjects.id, projectId)))
      .limit(1);
    return row
      ? {
          id: row.id,
          projectDefId: row.projectDefId,
          templateRevision: row.templateRevision,
          status: row.status,
          currentStepIndex: row.currentStepIndex,
          siteId: row.siteId,
          reservedInputs: parseReservedInputs(row.reservedInputs)
        }
      : null;
  }

  // R1 landing：非取消扩建工程计数（四种套件安装一次、扩建模板共享 4 个扩建位配额）。
  async countExpansionProjects(tx: IndustryTx, baseId: string, projectDefIds: string[]): Promise<number> {
    if (projectDefIds.length === 0) return 0;
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(baseProjects)
      .where(and(
        eq(baseProjects.baseId, baseId),
        inArray(baseProjects.projectDefId, projectDefIds),
        notInArray(baseProjects.status, ["cancelled"])
      ));
    return row?.count ?? 0;
  }

  async hasLiveOrCompletedProject(tx: IndustryTx, baseId: string, projectDefId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: baseProjects.id })
      .from(baseProjects)
      .where(and(
        eq(baseProjects.baseId, baseId),
        eq(baseProjects.projectDefId, projectDefId),
        notInArray(baseProjects.status, ["cancelled", "failed"])
      ))
      .limit(1);
    return row !== undefined;
  }

  async insertProjectWithSteps(
    tx: IndustryTx,
    input: InsertProjectInput
  ): Promise<{ projectId: string }> {
    const inserted = await tx
      .insert(baseProjects)
      .values({
        baseId: input.baseId,
        siteId: input.siteId,
        projectDefId: input.projectDefId,
        templateRevision: input.templateRevision,
        status: "active",
        currentStepIndex: 0,
        reservedInputs: input.reservedInputs.map((item) => ({
          itemId: item.itemId,
          quantity: item.quantity
        }))
      })
      .returning({ id: baseProjects.id });
    const project = inserted[0];
    if (!project) throw new Error("base_projects insert returned no row");
    if (input.steps.length > 0) {
      await tx.insert(baseProjectSteps).values(
        input.steps.map((step, index) => ({
          projectId: project.id,
          stepIndex: index,
          kind: step.kind,
          groupId: step.groupId,
          status: index === 0 ? "ready" : "pending",
          workRequired: step.workRequired,
          workDone: 0,
          blockedReason: null
        }))
      );
    }
    return { projectId: project.id };
  }

  async updateProjectStatus(
    tx: IndustryTx,
    projectId: string,
    status: ProjectStatus
  ): Promise<void> {
    await tx.update(baseProjects).set({ status }).where(eq(baseProjects.id, projectId));
  }

  async addGenerationWPeak(tx: IndustryTx, baseId: string, deltaW: number): Promise<void> {
    await tx
      .update(basePowerState)
      .set({
        generationWPeak: sql`${basePowerState.generationWPeak} + ${deltaW}`,
        updatedAt: new Date()
      })
      .where(eq(basePowerState.baseId, baseId));
  }

  async saveProjectUpdates(tx: IndustryTx, updates: ProjectRecordPatch[]): Promise<void> {
    for (const patch of updates) {
      await tx
        .update(baseProjects)
        .set({
          status: patch.status,
          currentStepIndex: patch.currentStepIndex,
          completedAt: patch.completedAt
        })
        .where(eq(baseProjects.id, patch.projectId));
    }
  }

  // ---------- 步骤 ----------

  async listSteps(projectIds: string[]): Promise<BaseStepRecord[]> {
    if (projectIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(baseProjectSteps)
      .where(inArray(baseProjectSteps.projectId, projectIds));
    return rows.map((row) => ({
      projectId: row.projectId,
      stepIndex: row.stepIndex,
      kind: row.kind,
      groupId: row.groupId,
      status: row.status,
      workRequired: row.workRequired,
      workDone: row.workDone,
      blockedReason: row.blockedReason
    }));
  }

  async saveStepUpdates(tx: IndustryTx, updates: BaseTickStepUpdate[]): Promise<void> {
    for (const update of updates) {
      await tx
        .update(baseProjectSteps)
        .set({
          workDone: update.workDone,
          status: update.status,
          blockedReason: update.blockedReason,
          updatedAt: new Date()
        })
        .where(
          and(
            eq(baseProjectSteps.projectId, update.projectId),
            eq(baseProjectSteps.stepIndex, update.stepIndex)
          )
        );
    }
  }
}
