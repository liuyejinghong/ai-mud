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
  getBaseForUpdate(
    tx: ManufacturingTx,
    baseId: string
  ): Promise<{ id: string; baseRevision: number } | null>;
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
  getRecipeTemplate(stableId: string, revision?: number): RecipeTemplateDto | null;
  rulesProfile(): "legacy" | "landing-v1";
  listTemplates(): { projects: Array<{
    ref: { stableId: string };
    outputFacility: { ref: { stableId: string }; effects?: { processingSlots?: number } };
  }> };
}

// R1 landing：站点与槽位读面（槽位绑定由 world 站点 + industry 槽行推导）。
export interface ManufacturingSitePort {
  listSites(
    tx: ManufacturingTx,
    baseId: string
  ): Promise<Array<{ id: string; siteKey: string; state: string; builtFacilityRef: string | null }>>;
}

export interface ManufacturingSlotPort {
  countSlotsForSite(tx: ManufacturingTx, siteId: string): Promise<number>;
  listSlotsForSite(
    tx: ManufacturingTx,
    baseId: string,
    siteId: string
  ): Promise<Array<{ id: string; slotIndex: number; maintenanceBlocked: boolean }>>;
}

export type ManufacturingReceiptsPort = Pick<
  AssetMutationPort,
  "findReceiptForUpdate" | "claimReceipt" | "saveReceiptResult"
>;

export interface ManufacturingServiceDeps {
  lookup: ManufacturingLookupPort;
  assets: ManufacturingAssetPort;
  catalog: ManufacturingCatalogPort;
  catalogResolver?: { forBase(tx: ManufacturingTx, baseId: string): Promise<ManufacturingCatalogPort> };
  store: ManufacturingJobStore;
  // 生产绑定：(tx) => new AssetMutationService(tx)。测试注入内存替身。
  receipts: (tx: ManufacturingTx) => ManufacturingReceiptsPort;
  // R1 landing（缺省 = 旧路径，不带槽位绑定）。
  sites?: ManufacturingSitePort;
  slots?: ManufacturingSlotPort;
  // 站点占用查询（自动选最早空闲槽）。
  boundSites?: {
    listBoundSiteJobs(
      tx: ManufacturingTx,
      baseId: string,
      siteId: string
    ): Promise<Array<{ id: string }>>;
  };
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
    if (!(await this.deps.lookup.getBaseForUpdate(tx, baseId))) {
      throw new BaseOperationError(403, "BASE_SCOPE_INVALID", "账号没有可操作的基地。");
    }
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

    const catalog = await this.catalogForBase(tx, baseId);
    const recipe = catalog.getRecipeTemplate(input.recipeRef.stableId);
    if (!recipe || recipe.ref.revision !== input.recipeRef.revision) {
      // 旧 revision 不 fallback latest（同项目 S4 语义）
      throw new BaseOperationError(409, "CONTENT_INCOMPATIBLE", "配方不存在或修订不匹配。");
    }

    // R1 landing：入队制（03 §4 FIFO）——加工单创建只验证能力存在并冻结每批能量；
    // productionSiteId 留空进入本基地 FIFO 队列，由结算按“最早空闲槽”逐分钟绑定。
    // 手工配方固定着陆器工位（同工位同时只允许一单在制）。
    const isLanding = catalog.rulesProfile() === "landing-v1";
    let productionSiteId: string | null = null;
    let energyWmPerBatch: number | null = null;
    if (isLanding) {
      const requiredCapability = recipe.requiredCapability;
      if (!requiredCapability || recipe.ratedW === undefined || recipe.workMinutesPerBatch === undefined) {
        throw new BaseOperationError(
          409,
          "CONTENT_INCOMPATIBLE",
          "该配方缺少 landing 运行参数（额定功率/工作分钟/所需能力）。"
        );
      }
      energyWmPerBatch = recipe.ratedW * recipe.workMinutesPerBatch;
      productionSiteId = await this.resolveProductionSite(
        tx,
        baseId,
        catalog,
        requiredCapability
      );
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
      reservedInputs: totalInputs,
      productionSiteId,
      energyWmPerBatch
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
    // 与基地 tick 共用 bases 行锁，避免取消按旧预留释放后被制造结算写回 active。
    if (!(await this.deps.lookup.getBaseForUpdate(tx, baseId))) {
      throw new BaseOperationError(403, "BASE_SCOPE_INVALID", "账号没有可操作的基地。");
    }
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

  // R1 landing：暂停当前单（释放槽位给下一单；材料预留保留，进度保留）。
  async pause(
    tx: ManufacturingTx,
    principal: ManufacturingPrincipal,
    input: { jobId: string; commandId: string; expectedBaseRevision?: number; controlToken?: string | null }
  ): Promise<{ jobId: string; status: "paused"; duplicate: boolean }> {
    const baseId = await this.requireLandingBase(tx, principal);
    const requestHash = hashRequest({ jobId: input.jobId, action: "pause" });
    const receipts = this.deps.receipts(tx);
    const actorScope = `base:${baseId}`;
    const existing = await receipts.findReceiptForUpdate(actorScope, "base.pauseManufacturingJob", input.commandId);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new BaseOperationError(409, "IDEMPOTENCY_CONFLICT", "相同命令 ID 但请求不一致。");
      }
      return existing.result as { jobId: string; status: "paused"; duplicate: boolean };
    }
    const baseForPause = await this.deps.lookup.getBaseForUpdate(tx, baseId);
    this.ensureRevision(baseForPause!.baseRevision, input.expectedBaseRevision);

    const claimed = await receipts.claimReceipt({
      actorScope, commandKind: "base.pauseManufacturingJob", commandId: input.commandId, requestHash
    });
    if (!claimed) {
      const raced = await receipts.findReceiptForUpdate(actorScope, "base.pauseManufacturingJob", input.commandId);
      if (raced && raced.requestHash === requestHash) {
        return raced.result as { jobId: string; status: "paused"; duplicate: boolean };
      }
      throw new BaseOperationError(409, "CONFLICT", "命令幂等登记冲突，请重试。");
    }
    const job = await this.deps.store.findJob(tx, baseId, input.jobId);
    if (!job) {
      throw new BaseOperationError(403, "BASE_SCOPE_INVALID", "工单不存在或不属于该基地。");
    }
    if (job.status !== "active" && job.status !== "blocked") {
      throw new BaseOperationError(409, "CONFLICT", "只有进行中/受阻的工单可以暂停。");
    }
    await this.deps.store.saveLandingBinding(tx, { jobId: job.id, status: "paused", productionSiteId: null });
    const result = { jobId: job.id, status: "paused" as const, duplicate: false };
    await receipts.saveReceiptResult({ actorScope, commandKind: "base.pauseManufacturingJob", commandId: input.commandId, result });
    return result;
  }

  // R1 landing：恢复暂停单（重新绑定最早空闲槽/着陆器）。
  async resume(
    tx: ManufacturingTx,
    principal: ManufacturingPrincipal,
    input: { jobId: string; commandId: string; expectedBaseRevision?: number; controlToken?: string | null }
  ): Promise<{ jobId: string; status: "active"; duplicate: boolean }> {
    const baseId = await this.requireLandingBase(tx, principal);
    const requestHash = hashRequest({ jobId: input.jobId, action: "resume" });
    const receipts = this.deps.receipts(tx);
    const actorScope = `base:${baseId}`;
    const existing = await receipts.findReceiptForUpdate(actorScope, "base.resumeManufacturingJob", input.commandId);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new BaseOperationError(409, "IDEMPOTENCY_CONFLICT", "相同命令 ID 但请求不一致。");
      }
      return existing.result as { jobId: string; status: "active"; duplicate: boolean };
    }
    const baseForResume = await this.deps.lookup.getBaseForUpdate(tx, baseId);
    this.ensureRevision(baseForResume!.baseRevision, input.expectedBaseRevision);

    const claimed = await receipts.claimReceipt({
      actorScope, commandKind: "base.resumeManufacturingJob", commandId: input.commandId, requestHash
    });
    if (!claimed) {
      const raced = await receipts.findReceiptForUpdate(actorScope, "base.resumeManufacturingJob", input.commandId);
      if (raced && raced.requestHash === requestHash) {
        return raced.result as { jobId: string; status: "active"; duplicate: boolean };
      }
      throw new BaseOperationError(409, "CONFLICT", "命令幂等登记冲突，请重试。");
    }
    const job = await this.deps.store.findJob(tx, baseId, input.jobId);
    if (!job) {
      throw new BaseOperationError(403, "BASE_SCOPE_INVALID", "工单不存在或不属于该基地。");
    }
    if (job.status !== "paused") {
      throw new BaseOperationError(409, "CONFLICT", "只有已暂停的工单可以恢复。");
    }
    const catalog = await this.catalogForBase(tx, baseId);
    const recipe = catalog.getRecipeTemplate(job.recipeDefId, job.recipeRevision);
    if (!recipe?.requiredCapability) {
      throw new BaseOperationError(409, "CONTENT_INCOMPATIBLE", "配方缺少能力要求，无法恢复。");
    }
    // 恢复 = 重新入队（FIFO）：槽位由结算按当时空闲情况重新绑定；
    // 手工配方回着陆器工位（若已被占则拒绝，玩家可暂停占用单）。
    const siteId = recipe.requiredCapability === "lander_manual"
      ? await this.resolveProductionSite(tx, baseId, catalog, "lander_manual")
      : null;
    await this.deps.store.saveLandingBinding(tx, { jobId: job.id, status: "active", productionSiteId: siteId });
    const result = { jobId: job.id, status: "active" as const, duplicate: false };
    await receipts.saveReceiptResult({ actorScope, commandKind: "base.resumeManufacturingJob", commandId: input.commandId, result });
    return result;
  }

  // ---------- 内部 ----------

  // 能力验证：processing 需要已建成的加工设施；lander_manual 需要着陆器且其工位空闲
  //（同工位同时一单）。不在此绑定槽位——绑槽由结算按 FIFO 逐分钟完成。
  private async resolveProductionSite(
    tx: ManufacturingTx,
    baseId: string,
    catalog: ManufacturingCatalogPort,
    requiredCapability: string
  ): Promise<string | null> {
    if (!this.deps.sites || !this.deps.boundSites) {
      throw new BaseOperationError(500, "INTERNAL_ERROR", "landing 制造未绑定站点端口。");
    }
    const sites = await this.deps.sites.listSites(tx, baseId);
    const lander = sites.find((site) => site.siteKey === "lander");

    if (requiredCapability === "lander_manual") {
      if (!lander || lander.state !== "built") {
        throw new BaseOperationError(409, "REQUIREMENTS_NOT_MET", "着陆器不可用。");
      }
      const bound = await this.deps.boundSites.listBoundSiteJobs(tx, baseId, lander.id);
      if (bound.length > 0) {
        throw new BaseOperationError(409, "CONFLICT", "着陆器手工工位已有进行中的工单。");
      }
      return lander.id;
    }

    const processingFacilityIds = new Set(
      catalog
        .listTemplates()
        .projects.filter(
          (project) => (project.outputFacility.effects?.processingSlots ?? 0) > 0
        )
        .map((project) => project.outputFacility.ref.stableId)
    );
    const hasProcessing = sites.some(
      (site) =>
        site.state === "built" &&
        site.builtFacilityRef !== null &&
        processingFacilityIds.has(
          site.builtFacilityRef.split(":")[1]?.split("@")[0] ?? ""
        )
    );
    if (!hasProcessing) {
      throw new BaseOperationError(
        409,
        "REQUIREMENTS_NOT_MET",
        "需要先建成加工间才能下加工单（单据将进入 FIFO 队列）。"
      );
    }
    return null; // 入队：结算时绑最早空闲槽
  }

  private async requireLandingBase(
    tx: ManufacturingTx,
    principal: ManufacturingPrincipal
  ): Promise<string> {
    const baseId = await this.requireBaseId(tx, principal);
    const base = await this.deps.lookup.getBaseForUpdate(tx, baseId);
    if (!base) {
      throw new BaseOperationError(403, "BASE_SCOPE_INVALID", "账号没有可操作的基地。");
    }
    return baseId;
  }

  private ensureRevision(baseRevision: number, expected?: number): void {
    if (expected !== undefined && expected !== baseRevision) {
      throw new BaseOperationError(409, "REVISION_EXPIRED", "基地状态已变化，请刷新后重试。");
    }
  }

  private catalogForBase(tx: ManufacturingTx, baseId: string): Promise<ManufacturingCatalogPort> {
    return this.deps.catalogResolver?.forBase(tx, baseId) ?? Promise.resolve(this.deps.catalog);
  }

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
