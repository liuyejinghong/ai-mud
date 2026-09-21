// M13-C 制造工单创建/取消业务（m13-p-contract.md §3—§4）。
// 创建（同事务）：inputs × outputsPlanned 全额预留（任一不足整体回滚 RESOURCE_INSUFFICIENT）
//   → 插 active 工单（reserved_inputs = totalInputs）→ 回执落结果 {jobId, duplicate:false}；
//   重放一致 → 原结果（duplicate:true），不一致 → IDEMPOTENCY_CONFLICT。
// 取消：非终态（active/paused/blocked）→ 释放全部剩余预留（reserved_inputs 逐台递减后的
//   剩余值）→ cancelled → {cancelled:true, releasedInputs}；completed/cancelled → CONFLICT。
// 事实只经端口写：assets（物料预留/释放）、world（账号→基地）、application 收据端口由
// composition 以 (tx) => AssetMutationService(tx) 形式注入（industry→assets 边允许，
// 与 construction.service 同模式）。
import type {
  CancelManufacturingJobResultDto,
  CreateManufacturingJobInputDto,
  CreateManufacturingJobResultDto,
  ErrorCode,
  RecipeTemplateDto
} from "@ai-mud/shared";
import { MANUFACTURING_MAX_OUTPUTS } from "@ai-mud/shared";
import {
  hashRequest,
  type AssetMutationPort,
  type CommandReceipt
} from "../ledger/asset-mutation.service.js";
import type {
  ManufacturingJobStore,
  ManufacturingTx
} from "./manufacturing.repository.js";
import { BaseOperationError } from "./construction.service.js";

// transport（base-manufacturing.routes）仅可 import application，错误经 application/manufacturing
// 薄用例再导出，与 construction→create-project.ts 同模式。
export { BaseOperationError };

// 工单 tx 形状（与 industry.repository 的 IndustryTx 同一结构，见 manufacturing.repository）。
export type { ManufacturingTx };

// ---------- 结构端口（composition 绑定；不 import application/base/ports.ts） ----------

export interface ManufacturingLookupPort {
  findBaseIdByAccount(tx: ManufacturingTx, accountId: string): Promise<string | null>;
}

export interface ManufacturingAssetPort {
  reserveBaseInventoryIfAvailable(
    tx: ManufacturingTx,
    baseId: string,
    itemId: string,
    quantity: number
  ): Promise<boolean>;
  releaseReservedBaseInventory(
    tx: ManufacturingTx,
    baseId: string,
    itemId: string,
    quantity: number
  ): Promise<void>;
}

export interface ManufacturingCatalogPort {
  getRecipeTemplate(stableId: string): RecipeTemplateDto | null;
}

export type ManufacturingReceiptsPort = Pick<
  AssetMutationPort,
  "findReceiptForUpdate" | "claimReceipt" | "saveReceiptResult"
>;

export interface ManufacturingServiceDeps {
  lookup: ManufacturingLookupPort;
  assets: ManufacturingAssetPort;
  catalog: ManufacturingCatalogPort;
  store: ManufacturingJobStore;
  // 生产绑定：(tx) => new AssetMutationService(tx)。测试注入内存替身。
  receipts: (tx: ManufacturingTx) => ManufacturingReceiptsPort;
}

export interface ManufacturingPrincipal {
  accountId: string;
}

const CREATE_COMMAND_KIND = "base.createManufacturingJob";
const CANCEL_COMMAND_KIND = "base.cancelManufacturingJob";
const TERMINAL_JOB_STATUSES: ReadonlySet<string> = new Set(["completed", "cancelled"]);

interface CreateResultPayload {
  jobId: string;
  duplicate: boolean;
}

interface CancelResultPayload {
  cancelled: boolean;
  duplicate: boolean;
  releasedInputs: Array<{ itemId: string; quantity: number }>;
}

function isCreateResultPayload(value: unknown): value is CreateResultPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CreateResultPayload).jobId === "string"
  );
}

function isCancelResultPayload(value: unknown): value is CancelResultPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CancelResultPayload).cancelled === "boolean" &&
    Array.isArray((value as CancelResultPayload).releasedInputs)
  );
}

export class ManufacturingService {
  constructor(private readonly deps: ManufacturingServiceDeps) {}

  async create(
    tx: ManufacturingTx,
    principal: ManufacturingPrincipal,
    input: CreateManufacturingJobInputDto
  ): Promise<CreateManufacturingJobResultDto> {
    // 批量上限（P fixture 1..20）；transport zod 同界，这里兜底防端口直调。
    if (
      !Number.isInteger(input.outputsPlanned) ||
      input.outputsPlanned < 1 ||
      input.outputsPlanned > MANUFACTURING_MAX_OUTPUTS
    ) {
      throw new BaseOperationError(
        400,
        "VALIDATION_ERROR",
        `outputsPlanned 必须为 1..${MANUFACTURING_MAX_OUTPUTS} 的整数。`
      );
    }

    const baseId = await this.requireBaseId(tx, principal);
    const actorScope = `base:${baseId}`;
    const requestHash = hashRequest({
      recipeRef: {
        kind: input.recipeRef.kind,
        stableId: input.recipeRef.stableId,
        revision: input.recipeRef.revision
      },
      outputsPlanned: input.outputsPlanned
    });
    const receipts = this.deps.receipts(tx);

    const existing = await receipts.findReceiptForUpdate(
      actorScope,
      CREATE_COMMAND_KIND,
      input.commandId
    );
    if (existing) return this.replayCreate(existing, requestHash);

    const claimed = await receipts.claimReceipt({
      actorScope,
      commandKind: CREATE_COMMAND_KIND,
      commandId: input.commandId,
      requestHash
    });
    if (!claimed) {
      const raced = await receipts.findReceiptForUpdate(
        actorScope,
        CREATE_COMMAND_KIND,
        input.commandId
      );
      if (raced) return this.replayCreate(raced, requestHash);
      throw new BaseOperationError(409, "CONFLICT", "命令幂等登记冲突，请重试。");
    }

    const recipe = this.deps.catalog.getRecipeTemplate(input.recipeRef.stableId);
    if (!recipe || recipe.ref.revision !== input.recipeRef.revision) {
      // 旧 revision 不 fallback latest（同项目 S4 语义）
      throw new BaseOperationError(409, "CONTENT_INCOMPATIBLE", "配方不存在或修订不匹配。");
    }

    // 全额预留：inputs × outputsPlanned，任一不足 → 抛出走调用方事务整体回滚，无悬挂预留。
    const totalInputs = recipe.inputs.map((item) => ({
      itemId: item.itemId,
      quantity: item.quantity * input.outputsPlanned
    }));
    for (const required of totalInputs) {
      const reserved = await this.deps.assets.reserveBaseInventoryIfAvailable(
        tx,
        baseId,
        required.itemId,
        required.quantity
      );
      if (!reserved) {
        throw new BaseOperationError(409, "RESOURCE_INSUFFICIENT", "物资不足，无法下单。");
      }
    }

    const { jobId } = await this.deps.store.insertJob(tx, {
      baseId,
      recipeDefId: recipe.ref.stableId,
      recipeRevision: recipe.ref.revision,
      outputsPlanned: input.outputsPlanned,
      reservedInputs: totalInputs
    });

    const result: CreateResultPayload = { jobId, duplicate: false };
    await receipts.saveReceiptResult({
      actorScope,
      commandKind: CREATE_COMMAND_KIND,
      commandId: input.commandId,
      result
    });
    return { jobId, duplicate: false };
  }

  async cancel(
    tx: ManufacturingTx,
    principal: ManufacturingPrincipal,
    input: { jobId: string; commandId: string }
  ): Promise<CancelManufacturingJobResultDto> {
    const baseId = await this.requireBaseId(tx, principal);
    const actorScope = `base:${baseId}`;
    const requestHash = hashRequest({ jobId: input.jobId });
    const receipts = this.deps.receipts(tx);

    const existing = await receipts.findReceiptForUpdate(
      actorScope,
      CANCEL_COMMAND_KIND,
      input.commandId
    );
    if (existing) return this.replayCancel(existing, requestHash);

    const claimed = await receipts.claimReceipt({
      actorScope,
      commandKind: CANCEL_COMMAND_KIND,
      commandId: input.commandId,
      requestHash
    });
    if (!claimed) {
      const raced = await receipts.findReceiptForUpdate(
        actorScope,
        CANCEL_COMMAND_KIND,
        input.commandId
      );
      if (raced) return this.replayCancel(raced, requestHash);
      throw new BaseOperationError(409, "CONFLICT", "命令幂等登记冲突，请重试。");
    }

    const job = await this.deps.store.findJob(tx, baseId, input.jobId);
    if (!job) {
      // 不存在的工单按作用域无效 403 返回，防跨基地探测（同项目语义）
      throw new BaseOperationError(403, "BASE_SCOPE_INVALID", "工单不存在或不属于该基地。");
    }
    if (TERMINAL_JOB_STATUSES.has(job.status)) {
      throw new BaseOperationError(409, "CONFLICT", "工单已结束，无法取消。");
    }

    // 释放全部剩余预留（结算逐台消耗后 reserved_inputs 已递减，见 settlement）。
    const releasedInputs = job.reservedInputs.map((item) => ({
      itemId: item.itemId,
      quantity: item.quantity
    }));
    for (const item of releasedInputs) {
      await this.deps.assets.releaseReservedBaseInventory(tx, baseId, item.itemId, item.quantity);
    }
    await this.deps.store.updateJobStatus(tx, job.id, "cancelled");

    const result: CancelResultPayload = {
      cancelled: true,
      duplicate: false,
      releasedInputs
    };
    await receipts.saveReceiptResult({
      actorScope,
      commandKind: CANCEL_COMMAND_KIND,
      commandId: input.commandId,
      result
    });
    return result;
  }

  // ---------- 内部 ----------

  private async requireBaseId(
    tx: ManufacturingTx,
    principal: ManufacturingPrincipal
  ): Promise<string> {
    const baseId = await this.deps.lookup.findBaseIdByAccount(tx, principal.accountId);
    if (!baseId) {
      throw new BaseOperationError(403, "BASE_SCOPE_INVALID", "账号没有可操作的基地。");
    }
    return baseId;
  }

  // 重放一致 → 原结果（duplicate 标记重放）；不一致 → IDEMPOTENCY_CONFLICT。
  private replayCreate(
    receipt: CommandReceipt,
    requestHash: string
  ): CreateManufacturingJobResultDto {
    if (receipt.requestHash !== requestHash) {
      throw new BaseOperationError(409, "IDEMPOTENCY_CONFLICT", "相同命令 ID 但请求不一致。");
    }
    if (!isCreateResultPayload(receipt.result)) {
      throw new BaseOperationError(409, "IDEMPOTENCY_CONFLICT", "创建命令收据损坏。");
    }
    return { jobId: receipt.result.jobId, duplicate: true };
  }

  private replayCancel(
    receipt: CommandReceipt,
    requestHash: string
  ): CancelManufacturingJobResultDto {
    if (receipt.requestHash !== requestHash) {
      throw new BaseOperationError(409, "IDEMPOTENCY_CONFLICT", "相同命令 ID 但请求不一致。");
    }
    if (!isCancelResultPayload(receipt.result)) {
      throw new BaseOperationError(409, "IDEMPOTENCY_CONFLICT", "取消命令收据损坏。");
    }
    return { ...receipt.result, duplicate: true };
  }
}
