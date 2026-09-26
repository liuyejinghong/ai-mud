// M14-B cooperation_requests 访问（m14-p-contract.md §2/§3；industry 唯一写者）。
// 协作请求是 industry 的真实调度事实（跨组支援）；首次真实缺工由玩家决策。
// 必须在调用方事务内执行（tx 透传构造 + 方法透传），本类永不自开或提交事务。
// 状态迁移一律带条件写（B005）：只有打开（pending/accepted）的请求能被接受/结案，
// 并发事务先结案的请求不会被后到的写复活。
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { CooperationResolutionReason, CooperationStatus } from "@ai-mud/shared";
import type { Db } from "../../db/client.js";
import { baseProjectSteps, baseProjects, cooperationRequests } from "../../db/schema.js";

export type CooperationTx = Pick<Db, "delete" | "insert" | "select" | "update">;

const OPEN_STATUSES = ["pending", "accepted"] as const;

// B005 非完成结案的原因（项目取消 / 项目失败 / 步骤失败 / 内容缺失）。
export type CooperationCloseReason =
  | "project_cancelled"
  | "project_failed"
  | "step_failed"
  | "content_missing"
  | "no_longer_needed";

// 协作请求所指步骤的当前事实（base_projects × base_project_steps；stepIndex 为 null 表示步骤行缺失）。
export interface CooperationStepState {
  projectId: string;
  projectStatus: string;
  stepIndex: number | null;
  stepStatus: string | null;
  blockedReason: string | null;
}

export interface CooperationRequestRecord {
  requestId: string;
  baseId: string;
  projectId: string;
  stepIndex: number;
  fromGroupId: string;
  helperGroupId: string;
  status: CooperationStatus;
  resolutionReason: CooperationResolutionReason | "no_longer_needed" | null;
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
  findOpenByStep(
    tx: CooperationTx,
    baseId: string,
    projectId: string,
    stepIndex: number
  ): Promise<CooperationRequestRecord | null>;
  findByIdForUpdate(tx: CooperationTx, baseId: string, requestId: string): Promise<CooperationRequestRecord | null>;
  // 只接受仍 pending 的请求；返回是否真正接受（false = 已被并发结案/接受）。
  accept(
    tx: CooperationTx,
    requestId: string,
    helperOperatorId: string,
    helperGroupId: string,
    decisionId: string
  ): Promise<boolean>;
  decline(tx: CooperationTx, requestId: string, decisionId: string, resolvedAt: Date): Promise<boolean>;
  expire(tx: CooperationTx, requestId: string): Promise<void>;
  // B005：结案单条打开的请求；返回是否真正结案。
  closeOpen(tx: CooperationTx, requestId: string, reason: CooperationCloseReason): Promise<boolean>;
  // B005：结案某项目下全部打开的请求（取消项目同事务调用）；返回结案条数。
  closeOpenByProject(
    tx: CooperationTx,
    baseId: string,
    projectId: string,
    reason: CooperationCloseReason
  ): Promise<number>;
  // B005：读请求所指项目/步骤的当前事实（只返回本基地项目）。
  listStepStates(tx: CooperationTx, baseId: string, projectIds: string[]): Promise<CooperationStepState[]>;
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
    resolutionReason: row.resolutionReason as CooperationRequestRecord["resolutionReason"],
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

  async findOpenByStep(
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
          inArray(cooperationRequests.status, [...OPEN_STATUSES])
        )
      )
      // 旧数据若同时有 pending/accepted，先返回 accepted，避免重复决策。
      .orderBy(asc(cooperationRequests.status))
      .limit(1);
    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  async findByIdForUpdate(
    _tx: CooperationTx,
    baseId: string,
    requestId: string
  ): Promise<CooperationRequestRecord | null> {
    const rows = await this.db
      .select()
      .from(cooperationRequests)
      .where(and(eq(cooperationRequests.baseId, baseId), eq(cooperationRequests.id, requestId)))
      .for("update");
    return rows[0] ? toRecord(rows[0]) : null;
  }

  // 决策接受：记 helper_operator_id 与 decision_id（决策审计 ↔ 调度事实的连接键）。
  // 条件写：请求在决策期间被取消事务结案时不复活（READ COMMITTED 下 UPDATE 重评 WHERE）。
  async accept(
    _tx: CooperationTx,
    requestId: string,
    helperOperatorId: string,
    helperGroupId: string,
    decisionId: string
  ): Promise<boolean> {
    const updated = await this.db
      .update(cooperationRequests)
      .set({ status: "accepted", helperOperatorId, helperGroupId, decisionId })
      .where(and(eq(cooperationRequests.id, requestId), eq(cooperationRequests.status, "pending")))
      .returning({ id: cooperationRequests.id });
    return updated.length > 0;
  }

  async decline(
    _tx: CooperationTx,
    requestId: string,
    decisionId: string,
    resolvedAt: Date
  ): Promise<boolean> {
    const updated = await this.db
      .update(cooperationRequests)
      .set({ status: "declined", decisionId, resolvedAt })
      .where(and(eq(cooperationRequests.id, requestId), eq(cooperationRequests.status, "pending")))
      .returning({ id: cooperationRequests.id });
    return updated.length > 0;
  }

  // TTL 只作用于 pending（合同 §3.2）。
  async expire(_tx: CooperationTx, requestId: string): Promise<void> {
    await this.db
      .update(cooperationRequests)
      .set({ status: "expired", resolutionReason: "ttl_expired", resolvedAt: new Date() })
      .where(and(eq(cooperationRequests.id, requestId), eq(cooperationRequests.status, "pending")));
  }

  async closeOpen(
    _tx: CooperationTx,
    requestId: string,
    reason: CooperationCloseReason
  ): Promise<boolean> {
    const updated = await this.db
      .update(cooperationRequests)
      .set({ status: "expired", resolutionReason: reason, resolvedAt: new Date() })
      .where(
        and(eq(cooperationRequests.id, requestId), inArray(cooperationRequests.status, [...OPEN_STATUSES]))
      )
      .returning({ id: cooperationRequests.id });
    return updated.length > 0;
  }

  async closeOpenByProject(
    _tx: CooperationTx,
    baseId: string,
    projectId: string,
    reason: CooperationCloseReason
  ): Promise<number> {
    const updated = await this.db
      .update(cooperationRequests)
      .set({ status: "expired", resolutionReason: reason, resolvedAt: new Date() })
      .where(
        and(
          eq(cooperationRequests.baseId, baseId),
          eq(cooperationRequests.projectId, projectId),
          inArray(cooperationRequests.status, [...OPEN_STATUSES])
        )
      )
      .returning({ id: cooperationRequests.id });
    return updated.length;
  }

  // 只读本基地项目（baseId 过滤防跨基地外泄）；步骤行左连接，缺失时步骤字段为 null。
  async listStepStates(
    _tx: CooperationTx,
    baseId: string,
    projectIds: string[]
  ): Promise<CooperationStepState[]> {
    if (projectIds.length === 0) return [];
    const rows = await this.db
      .select({
        projectId: baseProjects.id,
        projectStatus: baseProjects.status,
        stepIndex: baseProjectSteps.stepIndex,
        stepStatus: baseProjectSteps.status,
        blockedReason: baseProjectSteps.blockedReason
      })
      .from(baseProjects)
      .leftJoin(baseProjectSteps, eq(baseProjectSteps.projectId, baseProjects.id))
      .where(and(eq(baseProjects.baseId, baseId), inArray(baseProjects.id, projectIds)));
    return rows.map((row) => ({
      projectId: row.projectId,
      projectStatus: row.projectStatus,
      stepIndex: row.stepIndex,
      stepStatus: row.stepStatus,
      blockedReason: row.blockedReason
    }));
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
          inArray(cooperationRequests.status, [...OPEN_STATUSES])
        )
      );
  }
}
