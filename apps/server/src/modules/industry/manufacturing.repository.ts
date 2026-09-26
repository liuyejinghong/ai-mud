// M13-C base_manufacturing_jobs / base_manufacturing_outputs 访问（industry 唯一写者，
// m13-p-contract.md §2）。结构性暴露两个消费面（composition 按结构绑定；industry 不 import
// application）：
//   - ManufacturingJobStore：创建/取消工单的持久化面（manufacturing.service 消费）
//   - ManufacturingSettlementRepo：基地 tick 结算的读+写面（manufacturing.settlement 消费）
// 所有方法必须在调用方事务内执行，本类永不开启或提交事务。
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { ManufacturingJobStatus } from "@ai-mud/shared";
import type { Db } from "../../db/client.js";
import { baseManufacturingJobs, baseManufacturingOutputs } from "../../db/schema.js";

export type ManufacturingTx = Pick<Db, "delete" | "insert" | "select" | "update">;

export interface ManufacturingJobRecord {
  id: string;
  baseId: string;
  recipeDefId: string;
  recipeRevision: number;
  status: ManufacturingJobStatus;
  outputsPlanned: number;
  outputsDone: number;
  currentUnitWorkDone: number;
  // 剩余预留（结算逐台产出时按该台份额递减；取消时按此值整体释放）
  reservedInputs: Array<{ itemId: string; quantity: number }>;
  blockedReason: string | null;
}

export interface InsertManufacturingJobInput {
  baseId: string;
  recipeDefId: string;
  recipeRevision: number;
  outputsPlanned: number;
  reservedInputs: Array<{ itemId: string; quantity: number }>;
}

export interface JobProgressPatch {
  jobId: string;
  status: ManufacturingJobStatus;
  outputsDone: number;
  currentUnitWorkDone: number;
  blockedReason: string | null;
  reservedInputs: Array<{ itemId: string; quantity: number }>;
  completedAt: Date | null;
}

export interface ManufacturingOutputRow {
  ordinal: number;
  deviceId: string;
  operatorId: string;
}

export interface ManufacturingJobStore {
  insertJob(
    tx: ManufacturingTx,
    input: InsertManufacturingJobInput
  ): Promise<{ jobId: string }>;
  findJob(
    tx: ManufacturingTx,
    baseId: string,
    jobId: string
  ): Promise<ManufacturingJobRecord | null>;
  updateJobStatus(
    tx: ManufacturingTx,
    jobId: string,
    status: ManufacturingJobStatus
  ): Promise<void>;
}

export interface ManufacturingSettlementRepo {
  // 单基地可结算工单（active 或 blocked——blocked 需要在复电时恢复），FIFO 按 created_at（合同 §4.1）。
  // 结算只按基地读：不提供“全服有工单的基地”查询（2026-09-25 B001——全服遍历曾让暂停/离线基地
  // 被别人的 tick 推进）。
  listSettleableJobs(tx: ManufacturingTx, baseId: string): Promise<ManufacturingJobRecord[]>;
  findOutputByOrdinal(
    tx: ManufacturingTx,
    jobId: string,
    ordinal: number
  ): Promise<ManufacturingOutputRow | null>;
  // (job_id, ordinal) 唯一索引兜底：冲突时吞掉并返回已有行（duplicate=true）。
  insertOutput(
    tx: ManufacturingTx,
    input: { jobId: string; ordinal: number; deviceId: string; operatorId: string }
  ): Promise<{ duplicate: boolean }>;
  saveJobProgress(tx: ManufacturingTx, patch: JobProgressPatch): Promise<void>;
  // 快照读面（M13-I）：本基地全部工单，新→旧。
  listJobsForBase(tx: ManufacturingTx, baseId: string): Promise<ManufacturingJobRecord[]>;
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

function toRecord(row: {
  id: string;
  baseId: string;
  recipeDefId: string;
  recipeRevision: number;
  status: string;
  outputsPlanned: number;
  outputsDone: number;
  currentUnitWorkDone: number;
  reservedInputs: unknown;
  blockedReason: string | null;
}): ManufacturingJobRecord {
  return {
    id: row.id,
    baseId: row.baseId,
    recipeDefId: row.recipeDefId,
    recipeRevision: row.recipeRevision,
    status: row.status as ManufacturingJobStatus,
    outputsPlanned: row.outputsPlanned,
    outputsDone: row.outputsDone,
    currentUnitWorkDone: row.currentUnitWorkDone,
    reservedInputs: parseReservedInputs(row.reservedInputs),
    blockedReason: row.blockedReason
  };
}

const SETTLEABLE_STATUSES = ["active", "blocked"] as const;

export class ManufacturingRepository
  implements ManufacturingJobStore, ManufacturingSettlementRepo
{
  constructor(private readonly db: ManufacturingTx) {}

  // ---------- 创建/取消工单面 ----------

  async insertJob(
    tx: ManufacturingTx,
    input: InsertManufacturingJobInput
  ): Promise<{ jobId: string }> {
    const inserted = await tx
      .insert(baseManufacturingJobs)
      .values({
        baseId: input.baseId,
        recipeDefId: input.recipeDefId,
        recipeRevision: input.recipeRevision,
        status: "active",
        outputsPlanned: input.outputsPlanned,
        outputsDone: 0,
        currentUnitWorkDone: 0,
        reservedInputs: input.reservedInputs.map((item) => ({
          itemId: item.itemId,
          quantity: item.quantity
        })),
        blockedReason: null
      })
      .returning({ id: baseManufacturingJobs.id });
    const row = inserted[0];
    if (!row) throw new Error("base_manufacturing_jobs insert returned no row");
    return { jobId: row.id };
  }

  async findJob(
    tx: ManufacturingTx,
    baseId: string,
    jobId: string
  ): Promise<ManufacturingJobRecord | null> {
    const [row] = await tx
      .select()
      .from(baseManufacturingJobs)
      .where(and(eq(baseManufacturingJobs.baseId, baseId), eq(baseManufacturingJobs.id, jobId)))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async updateJobStatus(
    tx: ManufacturingTx,
    jobId: string,
    status: ManufacturingJobStatus
  ): Promise<void> {
    await tx
      .update(baseManufacturingJobs)
      .set({ status })
      .where(eq(baseManufacturingJobs.id, jobId));
  }

  // ---------- 结算读+写面 ----------

  async listSettleableJobs(
    tx: ManufacturingTx,
    baseId: string
  ): Promise<ManufacturingJobRecord[]> {
    const rows = await tx
      .select()
      .from(baseManufacturingJobs)
      .where(
        and(
          eq(baseManufacturingJobs.baseId, baseId),
          inArray(baseManufacturingJobs.status, [...SETTLEABLE_STATUSES])
        )
      )
      .orderBy(asc(baseManufacturingJobs.createdAt), asc(baseManufacturingJobs.id));
    return rows.map((row) => toRecord(row));
  }

  async listJobsForBase(tx: ManufacturingTx, baseId: string): Promise<ManufacturingJobRecord[]> {
    const rows = await tx
      .select()
      .from(baseManufacturingJobs)
      .where(eq(baseManufacturingJobs.baseId, baseId))
      .orderBy(desc(baseManufacturingJobs.createdAt));
    return rows.map((row) => toRecord(row));
  }

  async findOutputByOrdinal(
    tx: ManufacturingTx,
    jobId: string,
    ordinal: number
  ): Promise<ManufacturingOutputRow | null> {
    const [row] = await tx
      .select({
        ordinal: baseManufacturingOutputs.ordinal,
        deviceId: baseManufacturingOutputs.deviceId,
        operatorId: baseManufacturingOutputs.operatorId
      })
      .from(baseManufacturingOutputs)
      .where(
        and(
          eq(baseManufacturingOutputs.jobId, jobId),
          eq(baseManufacturingOutputs.ordinal, ordinal)
        )
      )
      .limit(1);
    return row ?? null;
  }

  async insertOutput(
    tx: ManufacturingTx,
    input: { jobId: string; ordinal: number; deviceId: string; operatorId: string }
  ): Promise<{ duplicate: boolean }> {
    const inserted = await tx
      .insert(baseManufacturingOutputs)
      .values({
        jobId: input.jobId,
        ordinal: input.ordinal,
        deviceId: input.deviceId,
        operatorId: input.operatorId
      })
      .onConflictDoNothing({
        target: [baseManufacturingOutputs.jobId, baseManufacturingOutputs.ordinal]
      })
      .returning({ id: baseManufacturingOutputs.id });
    if (inserted.length > 0) return { duplicate: false };
    // 唯一索引冲突 → 吞掉，返回已有（重复 ordinal 幂等）。
    const existing = await this.findOutputByOrdinal(tx, input.jobId, input.ordinal);
    if (!existing) throw new Error("base_manufacturing_outputs insert conflicted but no row found");
    return { duplicate: true };
  }

  async saveJobProgress(tx: ManufacturingTx, patch: JobProgressPatch): Promise<void> {
    await tx
      .update(baseManufacturingJobs)
      .set({
        status: patch.status,
        outputsDone: patch.outputsDone,
        currentUnitWorkDone: patch.currentUnitWorkDone,
        blockedReason: patch.blockedReason,
        reservedInputs: patch.reservedInputs.map((item) => ({
          itemId: item.itemId,
          quantity: item.quantity
        })),
        completedAt: patch.completedAt
      })
      .where(eq(baseManufacturingJobs.id, patch.jobId));
  }
}
