// R1 industry：base_extraction_jobs / base_extraction_outputs 唯一写者
// （03-domain-contracts.md §3/§4）。矿量只经 world 端口、库存只经 assets 端口、
// 设备只经 npc 端口——本仓库不触那些表。必须在调用方事务内执行。
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { baseExtractionJobs, baseExtractionOutputs } from "../../db/schema.js";

export type ExtractionTx = Pick<Db, "delete" | "insert" | "select" | "update">;

export type ExtractionJobKind = "survey" | "mine";
export type ExtractionJobStatus = "active" | "paused" | "stopping" | "completed" | "cancelled";

export interface ExtractionJobRecord {
  id: string;
  baseId: string;
  nodeId: string;
  kind: ExtractionJobKind;
  status: ExtractionJobStatus;
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

export interface ExtractionOutputRecord {
  id: string;
  jobId: string;
  ordinal: number;
  itemId: string;
  quantity: number;
  status: "extracted" | "delivered";
}

export interface InsertExtractionJobInput {
  baseId: string;
  nodeId: string;
  kind: ExtractionJobKind;
  batchesPlanned: number;
  phase: "mining" | "hauling" | null;
  builderOperatorIds: string[];
  haulerOperatorId: string | null;
  surveyorOperatorId: string | null;
}

export class ExtractionRepository {
  constructor(private readonly db: ExtractionTx) {}

  async insertJob(tx: ExtractionTx, input: InsertExtractionJobInput): Promise<{ jobId: string }> {
    const inserted = await tx
      .insert(baseExtractionJobs)
      .values({
        baseId: input.baseId,
        nodeId: input.nodeId,
        kind: input.kind,
        status: "active",
        batchesPlanned: input.batchesPlanned,
        phase: input.phase,
        phaseWorkDone: 0,
        builderOperatorIds: input.builderOperatorIds,
        haulerOperatorId: input.haulerOperatorId,
        surveyorOperatorId: input.surveyorOperatorId
      })
      .returning({ id: baseExtractionJobs.id });
    const row = inserted[0];
    if (!row) throw new Error("base_extraction_jobs insert returned no row");
    return { jobId: row.id };
  }

  async findJob(tx: ExtractionTx, baseId: string, jobId: string): Promise<ExtractionJobRecord | null> {
    const [row] = await tx
      .select()
      .from(baseExtractionJobs)
      .where(and(eq(baseExtractionJobs.baseId, baseId), eq(baseExtractionJobs.id, jobId)))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async listForBase(tx: ExtractionTx, baseId: string): Promise<ExtractionJobRecord[]> {
    const rows = await tx
      .select()
      .from(baseExtractionJobs)
      .where(eq(baseExtractionJobs.baseId, baseId))
      .orderBy(asc(baseExtractionJobs.createdAt), asc(baseExtractionJobs.id));
    return rows.map(toRecord);
  }

  async listSettleable(tx: ExtractionTx, baseId: string): Promise<ExtractionJobRecord[]> {
    const rows = await tx
      .select()
      .from(baseExtractionJobs)
      .where(and(
        eq(baseExtractionJobs.baseId, baseId),
        inArray(baseExtractionJobs.status, ["active", "stopping"])
      ))
      .orderBy(asc(baseExtractionJobs.createdAt), asc(baseExtractionJobs.id));
    return rows.map(toRecord);
  }

  async countActiveMineJobs(tx: ExtractionTx, baseId: string): Promise<number> {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(baseExtractionJobs)
      .where(and(
        eq(baseExtractionJobs.baseId, baseId),
        eq(baseExtractionJobs.kind, "mine"),
        inArray(baseExtractionJobs.status, ["active", "paused", "stopping"])
      ));
    return row?.count ?? 0;
  }

  async saveJob(tx: ExtractionTx, patch: {
    jobId: string;
    status?: ExtractionJobStatus;
    phase?: "mining" | "hauling" | null;
    phaseWorkDone?: number;
    batchesExtracted?: number;
    batchesDelivered?: number;
    builderOperatorIds?: string[];
    haulerOperatorId?: string | null;
    blockedReason?: string | null;
  }): Promise<void> {
    await tx
      .update(baseExtractionJobs)
      .set({
        status: patch.status ?? sql`${baseExtractionJobs.status}`,
        phase: patch.phase ?? sql`${baseExtractionJobs.phase}`,
        phaseWorkDone: patch.phaseWorkDone ?? sql`${baseExtractionJobs.phaseWorkDone}`,
        batchesExtracted: patch.batchesExtracted ?? sql`${baseExtractionJobs.batchesExtracted}`,
        batchesDelivered: patch.batchesDelivered ?? sql`${baseExtractionJobs.batchesDelivered}`,
        builderOperatorIds: patch.builderOperatorIds ?? sql`${baseExtractionJobs.builderOperatorIds}`,
        haulerOperatorId: patch.haulerOperatorId ?? sql`${baseExtractionJobs.haulerOperatorId}`,
        blockedReason: patch.blockedReason ?? sql`${baseExtractionJobs.blockedReason}`,
        updatedAt: new Date()
      })
      .where(eq(baseExtractionJobs.id, patch.jobId));
  }

  // 现场货物：一批采出写唯一 (job_id, ordinal)；冲突吞掉（重放不产第二份）。
  async insertOutput(
    tx: ExtractionTx,
    input: { jobId: string; ordinal: number; itemId: string; quantity: number }
  ): Promise<{ duplicate: boolean }> {
    const inserted = await tx
      .insert(baseExtractionOutputs)
      .values({
        jobId: input.jobId,
        ordinal: input.ordinal,
        itemId: input.itemId,
        quantity: input.quantity,
        status: "extracted"
      })
      .onConflictDoNothing({ target: [baseExtractionOutputs.jobId, baseExtractionOutputs.ordinal] })
      .returning({ id: baseExtractionOutputs.id });
    if (inserted.length > 0) return { duplicate: false };
    return { duplicate: true };
  }

  async findOutput(
    tx: ExtractionTx,
    jobId: string,
    ordinal: number
  ): Promise<ExtractionOutputRecord | null> {
    const [row] = await tx
      .select()
      .from(baseExtractionOutputs)
      .where(and(eq(baseExtractionOutputs.jobId, jobId), eq(baseExtractionOutputs.ordinal, ordinal)))
      .limit(1);
    return row ? toOutputRecord(row) : null;
  }

  // 送达：同 ordinal 只能 extracted → delivered 一次；返回 false = 已送达或不存在。
  async markOutputDelivered(
    tx: ExtractionTx,
    jobId: string,
    ordinal: number
  ): Promise<boolean> {
    const rows = await tx
      .update(baseExtractionOutputs)
      .set({ status: "delivered" })
      .where(and(
        eq(baseExtractionOutputs.jobId, jobId),
        eq(baseExtractionOutputs.ordinal, ordinal),
        eq(baseExtractionOutputs.status, "extracted")
      ))
      .returning({ id: baseExtractionOutputs.id });
    return rows.length > 0;
  }

  async listOutputsForJob(tx: ExtractionTx, jobId: string): Promise<ExtractionOutputRecord[]> {
    const rows = await tx
      .select()
      .from(baseExtractionOutputs)
      .where(eq(baseExtractionOutputs.jobId, jobId))
      .orderBy(asc(baseExtractionOutputs.ordinal));
    return rows.map(toOutputRecord);
  }
}

function toOutputRecord(row: typeof baseExtractionOutputs.$inferSelect): ExtractionOutputRecord {
  return {
    id: row.id,
    jobId: row.jobId,
    ordinal: row.ordinal,
    itemId: row.itemId,
    quantity: row.quantity,
    status: row.status as "extracted" | "delivered"
  };
}

function toRecord(row: typeof baseExtractionJobs.$inferSelect): ExtractionJobRecord {
  return {
    id: row.id,
    baseId: row.baseId,
    nodeId: row.nodeId,
    kind: row.kind as ExtractionJobKind,
    status: row.status as ExtractionJobStatus,
    batchesPlanned: row.batchesPlanned,
    batchesExtracted: row.batchesExtracted,
    batchesDelivered: row.batchesDelivered,
    phase: (row.phase as "mining" | "hauling" | null) ?? null,
    phaseWorkDone: row.phaseWorkDone,
    builderOperatorIds: Array.isArray(row.builderOperatorIds) ? row.builderOperatorIds : [],
    haulerOperatorId: row.haulerOperatorId,
    surveyorOperatorId: row.surveyorOperatorId,
    blockedReason: row.blockedReason
  };
}
