// R1 industry：勘探/采矿单命令业务（03-domain-contracts.md §4）。
// 下单（同事务）：节点/设施/设备/上限校验 → 预留矿量（world 端口）→ 认领设备
// （npc 端口）→ 写工单与回执；任一失败整体回滚。暂停释放设备、保留矿量义务；
// 取消释放未采预留，已采现场货物送完最后一趟再结案（stopping）。
// 矿量只经 world 端口、设备只经 npc 端口、回执经 application 注入；本服务不写越界表。
import type { ErrorCode } from "@ai-mud/shared";
import { hashRequest, type AssetMutationPort, type CommandReceipt } from "../ledger/asset-mutation.service.js";
import { BaseOperationError } from "./construction.service.js";
import { LANDING_ORE_PER_BATCH } from "./landing-rules.js";
import type { ExtractionJobRecord, ExtractionJobStatus, ExtractionTx } from "./extraction.repository.js";

const SURVEY_COMMAND_KIND = "base.surveyNode";
const CREATE_COMMAND_KIND = "base.createExtractionJob";
const PAUSE_COMMAND_KIND = "base.pauseExtractionJob";
const RESUME_COMMAND_KIND = "base.resumeExtractionJob";
const CANCEL_COMMAND_KIND = "base.cancelExtractionJob";

export const EXTRACTION_MAX_MINE_JOBS_PER_BASE = 2;
export const EXTRACTION_MAX_BATCHES = 10;

export interface ExtractionLookupPort {
  findBaseIdByAccount(tx: ExtractionTx, accountId: string): Promise<string | null>;
  getBaseForUpdate(tx: ExtractionTx, baseId: string): Promise<{ id: string; baseRevision: number } | null>;
}

// 节点结构值类型（industry 自有形状；不 import world 持久层类型——peer persistence 禁止）。
export interface ExtractionNodeView {
  id: string;
  itemId: string;
  discovered: boolean;
  remainingQuantity: number;
  reservedQuantity: number;
}

export interface ExtractionNodePort {
  findNode(tx: ExtractionTx, baseId: string, nodeId: string): Promise<ExtractionNodeView | null>;
  reserveNode(tx: ExtractionTx, baseId: string, nodeId: string, quantity: number): Promise<boolean>;
  releaseReservation(tx: ExtractionTx, baseId: string, nodeId: string, quantity: number): Promise<boolean>;
}

export interface ExtractionRobotPort {
  listOperators(baseId: string): Promise<Array<{
    operatorId: string;
    deviceDefId: string;
    groupId: string;
    batteryWh: number;
    status: string;
    currentProjectId: string | null;
    currentExtractionJobId: string | null;
  }>>;
  claimOperatorForExtraction(
    tx: ExtractionTx,
    baseId: string,
    operatorId: string,
    extractionJobId: string,
    minBatteryWh: number
  ): Promise<boolean>;
  releaseExtractionAssignments(tx: ExtractionTx, baseId: string, extractionJobId: string): Promise<void>;
}

export interface ExtractionStorePort {
  insertJob(tx: ExtractionTx, input: {
    baseId: string;
    nodeId: string;
    kind: "survey" | "mine";
    batchesPlanned: number;
    phase: "mining" | "hauling" | null;
    builderOperatorIds: string[];
    haulerOperatorId: string | null;
    surveyorOperatorId: string | null;
  }): Promise<{ jobId: string }>;
  findJob(tx: ExtractionTx, baseId: string, jobId: string): Promise<ExtractionJobRecord | null>;
  countActiveMineJobs(tx: ExtractionTx, baseId: string): Promise<number>;
  saveJob(tx: ExtractionTx, patch: {
    jobId: string;
    status?: ExtractionJobStatus;
    phase?: "mining" | "hauling" | null;
    phaseWorkDone?: number;
    batchesExtracted?: number;
    batchesDelivered?: number;
    builderOperatorIds?: string[];
    haulerOperatorId?: string | null;
    blockedReason?: string | null;
  }): Promise<void>;
}

export interface ExtractionCatalogPort {
  rulesProfile(): "legacy" | "landing-v1";
  getRobotTemplate(stableId: string): {
    groupId: string;
    workDrainWhPerTick?: number;
  } | null;
}

export interface ExtractionCapabilityPort {
  // 组合根从 base_sites+目录派生的能力位（warehouse 等）。
  hasCapability(tx: ExtractionTx, baseId: string, capability: string): Promise<boolean>;
}

export type ExtractionReceiptsPort = Pick<
  AssetMutationPort,
  "findReceiptForUpdate" | "claimReceipt" | "saveReceiptResult"
>;

export interface ExtractionServiceDeps {
  lookup: ExtractionLookupPort;
  nodes: ExtractionNodePort;
  robots: ExtractionRobotPort;
  store: ExtractionStorePort;
  catalogResolver: { forBase(tx: ExtractionTx, baseId: string): Promise<ExtractionCatalogPort> };
  capabilities: ExtractionCapabilityPort;
  receipts: (tx: ExtractionTx) => ExtractionReceiptsPort;
}

export interface ExtractionPrincipal {
  accountId: string;
}

export interface SurveyResultPayload {
  jobId: string;
  duplicate: boolean;
}

export interface CreateResultPayload {
  jobId: string;
  status: ExtractionJobStatus;
  reservedOre: number;
  duplicate: boolean;
}

export interface ActionResultPayload {
  jobId: string;
  status: ExtractionJobStatus;
  duplicate: boolean;
  releasedOre: number;
}

export class ExtractionService {
  constructor(private readonly deps: ExtractionServiceDeps) {}

  async survey(
    tx: ExtractionTx,
    principal: ExtractionPrincipal,
    input: { nodeId: string; operatorId: string; commandId: string; expectedBaseRevision?: number ; controlToken?: string | null }
  ): Promise<SurveyResultPayload> {
    const { baseId, catalog } = await this.requireLandingBase(tx, principal);
    const requestHash = hashRequest({ nodeId: input.nodeId, operatorId: input.operatorId });
    const receipt = await this.claim(tx, baseId, SURVEY_COMMAND_KIND, input.commandId, requestHash);
    if (receipt?.existing) return { ...(receipt.existing as SurveyResultPayload), duplicate: true };
    const base = await this.deps.lookup.getBaseForUpdate(tx, baseId);
    this.ensureRevision(base!.baseRevision, input.expectedBaseRevision);

    const node = await this.requireNode(tx, baseId, input.nodeId);
    if (node.discovered) {
      throw new BaseOperationError(409, "CONFLICT", "该矿点已完成勘探。");
    }
    const operator = await this.requireOperator(tx, baseId, input.operatorId, "survey", catalog);
    const { jobId } = await this.deps.store.insertJob(tx, {
      baseId,
      nodeId: node.id,
      kind: "survey",
      batchesPlanned: 1,
      phase: null,
      builderOperatorIds: [],
      haulerOperatorId: null,
      surveyorOperatorId: operator.operatorId
    });
    const claimed = await this.deps.robots.claimOperatorForExtraction(
      tx, baseId, operator.operatorId, jobId, operator.drainWh
    );
    if (!claimed) {
      throw new BaseOperationError(409, "DEVICE_BUSY", "勘测设备已被占用或电量不足。");
    }
    const result: SurveyResultPayload = { jobId, duplicate: false };
    await this.save(tx, baseId, SURVEY_COMMAND_KIND, input.commandId, result);
    return result;
  }

  async createMining(
    tx: ExtractionTx,
    principal: ExtractionPrincipal,
    input: {
      nodeId: string;
      batches: number;
      builderOperatorIds: string[];
      haulerOperatorId: string;
      commandId: string;
      expectedBaseRevision?: number;
      controlToken?: string | null;
    }
  ): Promise<CreateResultPayload> {
    if (
      !Number.isInteger(input.batches) ||
      input.batches < 1 ||
      input.batches > EXTRACTION_MAX_BATCHES
    ) {
      throw new BaseOperationError(400, "VALIDATION_ERROR", "批数必须为 1..10 的整数。");
    }
    if (
      !Array.isArray(input.builderOperatorIds) ||
      input.builderOperatorIds.length < 1 ||
      input.builderOperatorIds.length > 2 ||
      new Set(input.builderOperatorIds).size !== input.builderOperatorIds.length
    ) {
      throw new BaseOperationError(400, "VALIDATION_ERROR", "开采设备必须为 1–2 台不重复的筑垒。");
    }
    const { baseId, catalog } = await this.requireLandingBase(tx, principal);
    const requestHash = hashRequest({
      nodeId: input.nodeId,
      batches: input.batches,
      builderOperatorIds: [...input.builderOperatorIds].sort(),
      haulerOperatorId: input.haulerOperatorId
    });
    const receipt = await this.claim(tx, baseId, CREATE_COMMAND_KIND, input.commandId, requestHash);
    if (receipt?.existing) return { ...(receipt.existing as CreateResultPayload), duplicate: true };
    const base = await this.deps.lookup.getBaseForUpdate(tx, baseId);
    this.ensureRevision(base!.baseRevision, input.expectedBaseRevision);

    const node = await this.requireNode(tx, baseId, input.nodeId);
    if (!node.discovered) {
      throw new BaseOperationError(409, "REQUIREMENTS_NOT_MET", "矿点尚未勘探，先派望山完成勘探。");
    }
    if (!(await this.deps.capabilities.hasCapability(tx, baseId, "warehouse"))) {
      throw new BaseOperationError(409, "REQUIREMENTS_NOT_MET", "需要先建成仓储棚，矿石才能入库。");
    }
    const reservedOre = input.batches * LANDING_ORE_PER_BATCH;
    if (node.remainingQuantity - node.reservedQuantity < reservedOre) {
      throw new BaseOperationError(409, "RESOURCE_INSUFFICIENT", "矿点可用储量不足本单批数。");
    }
    if ((await this.deps.store.countActiveMineJobs(tx, baseId)) >= EXTRACTION_MAX_MINE_JOBS_PER_BASE) {
      throw new BaseOperationError(409, "CONFLICT", "每基地至多两条活动采矿单。");
    }

    const builders = await Promise.all(
      input.builderOperatorIds.map((operatorId) =>
        this.requireOperator(tx, baseId, operatorId, "engineering", catalog)
      )
    );
    const hauler = await this.requireOperator(tx, baseId, input.haulerOperatorId, "transport", catalog);

    const reserved = await this.deps.nodes.reserveNode(tx, baseId, node.id, reservedOre);
    if (!reserved) {
      throw new BaseOperationError(409, "RESOURCE_INSUFFICIENT", "矿点可用储量不足（并发预留失败）。");
    }

    const { jobId } = await this.deps.store.insertJob(tx, {
      baseId,
      nodeId: node.id,
      kind: "mine",
      batchesPlanned: input.batches,
      phase: "mining",
      builderOperatorIds: builders.map((builder) => builder.operatorId),
      haulerOperatorId: hauler.operatorId,
      surveyorOperatorId: null
    });
    for (const builder of builders) {
      const claimed = await this.deps.robots.claimOperatorForExtraction(
        tx, baseId, builder.operatorId, jobId, builder.drainWh
      );
      if (!claimed) {
        throw new BaseOperationError(409, "DEVICE_BUSY", `筑垒 ${builder.operatorId} 已被占用或电量不足。`);
      }
    }
    const haulerClaimed = await this.deps.robots.claimOperatorForExtraction(
      tx, baseId, hauler.operatorId, jobId, hauler.drainWh
    );
    if (!haulerClaimed) {
      throw new BaseOperationError(409, "DEVICE_BUSY", `驮运 ${hauler.operatorId} 已被占用或电量不足。`);
    }

    const result: CreateResultPayload = { jobId, status: "active", reservedOre, duplicate: false };
    await this.save(tx, baseId, CREATE_COMMAND_KIND, input.commandId, result);
    return result;
  }

  async pause(
    tx: ExtractionTx,
    principal: ExtractionPrincipal,
    input: { jobId: string; commandId: string; expectedBaseRevision?: number ; controlToken?: string | null }
  ): Promise<ActionResultPayload> {
    const { baseId } = await this.requireLandingBase(tx, principal);
    const requestHash = hashRequest({ jobId: input.jobId, action: "pause" });
    const receipt = await this.claim(tx, baseId, PAUSE_COMMAND_KIND, input.commandId, requestHash);
    if (receipt?.existing) return { ...(receipt.existing as ActionResultPayload), duplicate: true };
    const baseForPause = await this.deps.lookup.getBaseForUpdate(tx, baseId);
    this.ensureRevision(baseForPause!.baseRevision, input.expectedBaseRevision);

    const job = await this.requireJob(tx, baseId, input.jobId);
    if (job.status !== "active") {
      throw new BaseOperationError(409, "CONFLICT", "只有进行中的作业可以暂停。");
    }
    await this.deps.robots.releaseExtractionAssignments(tx, baseId, job.id);
    await this.deps.store.saveJob(tx, { jobId: job.id, status: "paused", blockedReason: null });
    const result: ActionResultPayload = { jobId: job.id, status: "paused", duplicate: false, releasedOre: 0 };
    await this.save(tx, baseId, PAUSE_COMMAND_KIND, input.commandId, result);
    return result;
  }

  async resume(
    tx: ExtractionTx,
    principal: ExtractionPrincipal,
    input: {
      jobId: string;
      commandId: string;
      expectedBaseRevision?: number;
      builderOperatorIds?: string[];
      haulerOperatorId?: string;
      controlToken?: string | null;
    }
  ): Promise<ActionResultPayload> {
    const { baseId, catalog } = await this.requireLandingBase(tx, principal);
    const requestHash = hashRequest({
      jobId: input.jobId,
      action: "resume",
      builderOperatorIds: input.builderOperatorIds ? [...input.builderOperatorIds].sort() : undefined,
      haulerOperatorId: input.haulerOperatorId
    });
    const receipt = await this.claim(tx, baseId, RESUME_COMMAND_KIND, input.commandId, requestHash);
    if (receipt?.existing) return { ...(receipt.existing as ActionResultPayload), duplicate: true };
    const baseForResume = await this.deps.lookup.getBaseForUpdate(tx, baseId);
    this.ensureRevision(baseForResume!.baseRevision, input.expectedBaseRevision);

    const job = await this.requireJob(tx, baseId, input.jobId);
    if (job.status !== "paused") {
      throw new BaseOperationError(409, "CONFLICT", "只有已暂停的作业可以恢复。");
    }
    if (job.kind === "survey") {
      const operatorId = job.surveyorOperatorId!;
      const operator = await this.requireOperator(tx, baseId, operatorId, "survey", catalog);
      const claimed = await this.deps.robots.claimOperatorForExtraction(
        tx, baseId, operator.operatorId, job.id, operator.drainWh
      );
      if (!claimed) {
        throw new BaseOperationError(409, "DEVICE_BUSY", "原勘测设备不可用（被占用或电量不足），可换设备后恢复。");
      }
    } else {
      const builderIds = input.builderOperatorIds ?? job.builderOperatorIds;
      const haulerId = input.haulerOperatorId ?? job.haulerOperatorId!;
      if (
        !Array.isArray(builderIds) ||
        builderIds.length < 1 ||
        builderIds.length > 2 ||
        new Set(builderIds).size !== builderIds.length
      ) {
        throw new BaseOperationError(400, "VALIDATION_ERROR", "开采设备必须为 1–2 台不重复的筑垒。");
      }
      const builders = await Promise.all(
        builderIds.map((operatorId) =>
          this.requireOperator(tx, baseId, operatorId, "engineering", catalog)
        )
      );
      const hauler = await this.requireOperator(tx, baseId, haulerId, "transport", catalog);
      for (const builder of builders) {
        const claimed = await this.deps.robots.claimOperatorForExtraction(
          tx, baseId, builder.operatorId, job.id, builder.drainWh
        );
        if (!claimed) {
          throw new BaseOperationError(409, "DEVICE_BUSY", `筑垒 ${builder.operatorId} 已被占用或电量不足。`);
        }
      }
      const haulerClaimed = await this.deps.robots.claimOperatorForExtraction(
        tx, baseId, hauler.operatorId, job.id, hauler.drainWh
      );
      if (!haulerClaimed) {
        throw new BaseOperationError(409, "DEVICE_BUSY", `驮运 ${hauler.operatorId} 已被占用或电量不足。`);
      }
      await this.deps.store.saveJob(tx, {
        jobId: job.id,
        builderOperatorIds: builders.map((builder) => builder.operatorId),
        haulerOperatorId: hauler.operatorId
      });
    }
    await this.deps.store.saveJob(tx, { jobId: job.id, status: "active", blockedReason: null });
    const result: ActionResultPayload = { jobId: job.id, status: "active", duplicate: false, releasedOre: 0 };
    await this.save(tx, baseId, RESUME_COMMAND_KIND, input.commandId, result);
    return result;
  }

  async cancel(
    tx: ExtractionTx,
    principal: ExtractionPrincipal,
    input: { jobId: string; commandId: string; expectedBaseRevision?: number ; controlToken?: string | null }
  ): Promise<ActionResultPayload> {
    const { baseId } = await this.requireLandingBase(tx, principal);
    const requestHash = hashRequest({ jobId: input.jobId, action: "cancel" });
    const receipt = await this.claim(tx, baseId, CANCEL_COMMAND_KIND, input.commandId, requestHash);
    if (receipt?.existing) return { ...(receipt.existing as ActionResultPayload), duplicate: true };
    const baseForCancel = await this.deps.lookup.getBaseForUpdate(tx, baseId);
    this.ensureRevision(baseForCancel!.baseRevision, input.expectedBaseRevision);

    const job = await this.requireJob(tx, baseId, input.jobId);
    if (job.status === "completed" || job.status === "cancelled") {
      throw new BaseOperationError(409, "CONFLICT", "作业已结束，无法取消。");
    }

    let releasedOre = 0;
    if (job.kind === "mine") {
      // 未采部分立即释放；已采现场货物送完最后一趟再结案（stopping）。
      releasedOre = (job.batchesPlanned - job.batchesExtracted) * LANDING_ORE_PER_BATCH;
      if (releasedOre > 0) {
        await this.deps.nodes.releaseReservation(tx, baseId, job.nodeId, releasedOre);
      }
      if (job.batchesDelivered < job.batchesExtracted) {
        await this.deps.store.saveJob(tx, {
          jobId: job.id,
          status: "stopping",
          phase: "hauling",
          phaseWorkDone: 0,
          blockedReason: null
        });
        const result: ActionResultPayload = { jobId: job.id, status: "stopping", duplicate: false, releasedOre };
        await this.save(tx, baseId, CANCEL_COMMAND_KIND, input.commandId, result);
        return result;
      }
    }
    await this.deps.robots.releaseExtractionAssignments(tx, baseId, job.id);
    await this.deps.store.saveJob(tx, { jobId: job.id, status: "cancelled", blockedReason: null });
    const result: ActionResultPayload = { jobId: job.id, status: "cancelled", duplicate: false, releasedOre };
    await this.save(tx, baseId, CANCEL_COMMAND_KIND, input.commandId, result);
    return result;
  }

  // ---------- 内部 ----------

  private async requireLandingBase(
    tx: ExtractionTx,
    principal: ExtractionPrincipal
  ): Promise<{ baseId: string; catalog: ExtractionCatalogPort }> {
    const baseId = await this.deps.lookup.findBaseIdByAccount(tx, principal.accountId);
    if (!baseId) {
      throw new BaseOperationError(403, "BASE_SCOPE_INVALID", "账号没有可操作的基地。");
    }
    const base = await this.deps.lookup.getBaseForUpdate(tx, baseId);
    if (!base) {
      throw new BaseOperationError(403, "BASE_SCOPE_INVALID", "账号没有可操作的基地。");
    }
    const catalog = await this.deps.catalogResolver.forBase(tx, baseId);
    if (catalog.rulesProfile() !== "landing-v1") {
      throw new BaseOperationError(
        409,
        "CAPABILITY_UNAVAILABLE",
        "当前存档不支持勘探/采矿（需要着陆重建内容）。"
      );
    }
    return { baseId, catalog };
  }

  // 幂等合同（03 §4）：同命令重放只认 requestHash，不受其后世界 revision 变化影响；
  // revision 只对「新命令」校验（回执未命中路径）。
  private ensureRevision(baseRevision: number, expectedBaseRevision?: number): void {
    if (expectedBaseRevision !== undefined && expectedBaseRevision !== baseRevision) {
      throw new BaseOperationError(409, "REVISION_EXPIRED", "基地状态已变化，请刷新后重试。");
    }
  }

  private async requireNode(tx: ExtractionTx, baseId: string, nodeId: string) {
    const node = await this.deps.nodes.findNode(tx, baseId, nodeId);
    if (!node) {
      throw new BaseOperationError(403, "BASE_SCOPE_INVALID", "矿点不存在或不属于该基地。");
    }
    return node;
  }

  private async requireJob(tx: ExtractionTx, baseId: string, jobId: string) {
    const job = await this.deps.store.findJob(tx, baseId, jobId);
    if (!job) {
      throw new BaseOperationError(403, "BASE_SCOPE_INVALID", "作业不存在或不属于该基地。");
    }
    return job;
  }

  private async requireOperator(
    tx: ExtractionTx,
    baseId: string,
    operatorId: string,
    expectedGroup: "engineering" | "transport" | "survey",
    catalog: ExtractionCatalogPort
  ): Promise<{ operatorId: string; drainWh: number }> {
    const operators = await this.deps.robots.listOperators(baseId);
    const operator = operators.find((entry) => entry.operatorId === operatorId);
    if (!operator) {
      throw new BaseOperationError(403, "BASE_SCOPE_INVALID", "设备不存在或不属于该基地。");
    }
    if (operator.groupId !== expectedGroup) {
      throw new BaseOperationError(400, "VALIDATION_ERROR", "设备编组与本工序不匹配。");
    }
    const template = catalog.getRobotTemplate(operator.deviceDefId);
    const drainWh = template?.workDrainWhPerTick ?? 0;
    if (!template || drainWh <= 0) {
      throw new BaseOperationError(409, "CONTENT_INCOMPATIBLE", "未知机器人模板。");
    }
    return { operatorId, drainWh };
  }

  private async claim(
    tx: ExtractionTx,
    baseId: string,
    commandKind: string,
    commandId: string,
    requestHash: string
  ): Promise<{ existing: unknown; raced?: boolean } | null> {
    const actorScope = `base:${baseId}`;
    const receipts = this.deps.receipts(tx);
    const existing = await receipts.findReceiptForUpdate(actorScope, commandKind, commandId);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new BaseOperationError(409, "IDEMPOTENCY_CONFLICT", "相同命令 ID 但请求不一致。");
      }
      return { existing: existing.result };
    }
    // raced 结果由各命令的 replay 返回统一标 duplicate:true。
    const claimed = await receipts.claimReceipt({ actorScope, commandKind, commandId, requestHash });
    if (!claimed) {
      const raced = await receipts.findReceiptForUpdate(actorScope, commandKind, commandId);
      if (raced) {
        if (raced.requestHash !== requestHash) {
          throw new BaseOperationError(409, "IDEMPOTENCY_CONFLICT", "相同命令 ID 但请求不一致。");
        }
        return { existing: raced.result };
      }
      throw new BaseOperationError(409, "CONFLICT", "命令幂等登记冲突，请重试。");
    }
    return null;
  }

  private async save(
    tx: ExtractionTx,
    baseId: string,
    commandKind: string,
    commandId: string,
    result: unknown
  ): Promise<void> {
    await this.deps.receipts(tx).saveReceiptResult({
      actorScope: `base:${baseId}`,
      commandKind,
      commandId,
      result
    });
  }
}

export type { CommandReceipt };
export type { ErrorCode };
