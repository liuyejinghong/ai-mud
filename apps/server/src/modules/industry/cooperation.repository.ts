// M14-B cooperation_requests 访问（m14-p-contract.md §2/§3；industry 唯一写者）。
// 协作请求是 industry 的真实调度事实（跨组支援）：不支持玩家创建/取消（合同 §3.4）。
// 必须在调用方事务内执行（tx 透传构造 + 方法透传），本类永不自开或提交事务。
import { and, desc, eq, inArray } from "drizzle-orm";
import type { CooperationStatus } from "@ai-mud/shared";
import type { Db } from "../../db/client.js";
import { cooperationRequests } from "../../db/schema.js";

export type CooperationTx = Pick<Db, "delete" | "insert" | "select" | "update">;

export interface CooperationRequestRecord {
  requestId: string;
  baseId: string;
  projectId: string;
  stepIndex: number;
  fromGroupId: string;
  helperGroupId: string;
  status: CooperationStatus;
  helperOperatorId: string | null;
  decisionId: string | null;
  question: string;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface CreateCooperationRequestInput {
  baseId: string;
  projectId: string;
  stepIndex: number;
  fromGroupId: string;
  helperGroupId: string;
  question: string;
  // 由 service 的 clock 提供（TTL 判定的唯一时间源）；生产列 defaultNow 只是兜底。
  createdAt: Date;
}

// service 依赖的结构面（生产绑定：new CooperationRepository(tx)，按结构兼容）。
export interface CooperationRequestStore {
  create(tx: CooperationTx, input: CreateCooperationRequestInput): Promise<{ requestId: string }>;
  listByBase(tx: CooperationTx, baseId: string): Promise<CooperationRequestRecord[]>;
  findPendingByStep(
    tx: CooperationTx,
    baseId: string,
    projectId: string,
    stepIndex: number
  ): Promise<CooperationRequestRecord | null>;
  accept(tx: CooperationTx, requestId: string, helperOperatorId: string, decisionId: string): Promise<void>;
  expire(tx: CooperationTx, requestId: string): Promise<void>;
  markFulfilled(tx: CooperationTx, requestId: string): Promise<void>;
  markFulfilledByStep(
    tx: CooperationTx,
    baseId: string,
    projectId: string,
    stepIndex: number
  ): Promise<void>;
}

function toRecord(row: typeof cooperationRequests.$inferSelect): CooperationRequestRecord {
  return {
    requestId: row.id,
    baseId: row.baseId,
    projectId: row.projectId,
    stepIndex: row.stepIndex,
    fromGroupId: row.fromGroupId,
    helperGroupId: row.helperGroupId,
    status: row.status as CooperationStatus,
    helperOperatorId: row.helperOperatorId,
    decisionId: row.decisionId,
    question: row.question,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt
  };
}

export class CooperationRepository implements CooperationRequestStore {
  constructor(private readonly db: CooperationTx) {}

  async create(
    _tx: CooperationTx,
    input: CreateCooperationRequestInput
  ): Promise<{ requestId: string }> {
    const inserted = await this.db
      .insert(cooperationRequests)
      .values({
        baseId: input.baseId,
        projectId: input.projectId,
        stepIndex: input.stepIndex,
        fromGroupId: input.fromGroupId,
        helperGroupId: input.helperGroupId,
        status: "pending",
        question: input.question,
        createdAt: input.createdAt
      })
      .returning({ id: cooperationRequests.id });
    const row = inserted[0];
    if (!row) throw new Error("cooperation_requests insert returned no row");
    return { requestId: row.id };
  }

  // 快照消费（BaseSnapshotDto.cooperationRequests：本基地全部，新→旧）。
  async listByBase(_tx: CooperationTx, baseId: string): Promise<CooperationRequestRecord[]> {
    const rows = await this.db
      .select()
      .from(cooperationRequests)
      .where(eq(cooperationRequests.baseId, baseId))
      .orderBy(desc(cooperationRequests.createdAt));
    return rows.map(toRecord);
  }

  async findPendingByStep(
    _tx: CooperationTx,
    baseId: string,
    projectId: string,
    stepIndex: number
  ): Promise<CooperationRequestRecord | null> {
    const rows = await this.db
      .select()
      .from(cooperationRequests)
      .where(
        and(
          eq(cooperationRequests.baseId, baseId),
          eq(cooperationRequests.projectId, projectId),
          eq(cooperationRequests.stepIndex, stepIndex),
          eq(cooperationRequests.status, "pending")
        )
      )
      .limit(1);
    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  // 决策接受：记 helper_operator_id 与 decision_id（决策审计 ↔ 调度事实的连接键）。
  async accept(
    _tx: CooperationTx,
    requestId: string,
    helperOperatorId: string,
    decisionId: string
  ): Promise<void> {
    await this.db
      .update(cooperationRequests)
      .set({ status: "accepted", helperOperatorId, decisionId })
      .where(eq(cooperationRequests.id, requestId));
  }

  async expire(_tx: CooperationTx, requestId: string): Promise<void> {
    await this.db
      .update(cooperationRequests)
      .set({ status: "expired", resolvedAt: new Date() })
      .where(eq(cooperationRequests.id, requestId));
  }

  async markFulfilled(_tx: CooperationTx, requestId: string): Promise<void> {
    await this.db
      .update(cooperationRequests)
      .set({ status: "fulfilled", resolvedAt: new Date() })
      .where(eq(cooperationRequests.id, requestId));
  }

  // I 结算钩子：步骤 completed → 该步骤仍打开（pending/accepted）的请求全部 fulfilled。
  // 已 fulfilled/expired/declined 的历史请求不动。
  async markFulfilledByStep(
    _tx: CooperationTx,
    baseId: string,
    projectId: string,
    stepIndex: number
  ): Promise<void> {
    await this.db
      .update(cooperationRequests)
      .set({ status: "fulfilled", resolvedAt: new Date() })
      .where(
        and(
          eq(cooperationRequests.baseId, baseId),
          eq(cooperationRequests.projectId, projectId),
          eq(cooperationRequests.stepIndex, stepIndex),
          inArray(cooperationRequests.status, ["pending", "accepted"])
        )
      );
  }
}
