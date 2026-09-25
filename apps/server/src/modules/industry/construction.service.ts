// M12-B 项目创建/取消业务（m12-p-contract.md §3.4—§3.5）。
// 同事务：物料全额预留（任一不足整体回滚 RESOURCE_INSUFFICIENT）→ 插项目+步骤 →
// 站点 reserved → 回执落结果；重放一致 → 原结果，不一致 → IDEMPOTENCY_CONFLICT。
// 取消：非终态项目 → 释放全部未消耗预留 → cancelled → 释放站点 → 结案本项目打开的协作请求（B005）。
// 事实只经端口写：assets（物料预留/释放）、world（站点）、application 收据端口由
// composition 以 (tx) => AssetMutationService(tx) 形式注入（industry→assets 边允许）。
import type {
  CreateProjectInputDto,
  CreateProjectResultDto,
  ErrorCode,
  ProjectStatus,
  ProjectTemplateDto
} from "@ai-mud/shared";
import {
  hashRequest,
  type AssetMutationPort,
  type CommandReceipt
} from "../ledger/asset-mutation.service.js";
import {
  CooperationRepository,
  type CooperationRequestStore
} from "./cooperation.repository.js";
import type {
  IndustryProjectStore,
  IndustryTx
} from "./industry.repository.js";

export type ConstructionTx = IndustryTx;

// 路由层经 application/base/create-project.ts 的再导出使用本错误（transport 不直接 import industry）。
export class BaseOperationError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string
  ) {
    super(message);
    this.name = "BaseOperationError";
  }
}

// ---------- 结构端口（与 application/base/ports.ts 冻结面一致） ----------

export interface ConstructionLookupPort {
  findBaseIdByAccount(tx: ConstructionTx, accountId: string): Promise<string | null>;
  getBaseForUpdate(tx: ConstructionTx, baseId: string): Promise<{ id: string } | null>;
}

export interface ConstructionAssetPort {
  reserveBaseInventoryIfAvailable(
    tx: ConstructionTx,
    baseId: string,
    itemId: string,
    quantity: number
  ): Promise<boolean>;
  releaseReservedBaseInventory(
    tx: ConstructionTx,
    baseId: string,
    itemId: string,
    quantity: number
  ): Promise<void>;
}

export interface ConstructionSitePort {
  getSite(
    tx: ConstructionTx,
    baseId: string,
    siteId: string
  ): Promise<{ id: string; state: "free" | "reserved" | "built" } | null>;
  markSiteReserved(tx: ConstructionTx, siteId: string): Promise<void>;
  releaseSite(tx: ConstructionTx, siteId: string): Promise<void>;
}

export interface ConstructionCatalogPort {
  getProjectTemplate(stableId: string): ProjectTemplateDto | null;
}

export type ConstructionReceiptsPort = Pick<
  AssetMutationPort,
  "findReceiptForUpdate" | "claimReceipt" | "saveReceiptResult"
>;

// 同模块协作请求写面（industry 是 cooperation_requests 唯一写者）。
export type ConstructionCooperationPort = Pick<CooperationRequestStore, "closeOpenByProject">;

export interface ConstructionServiceDeps {
  lookup: ConstructionLookupPort;
  assets: ConstructionAssetPort;
  sites: ConstructionSitePort;
  catalog: ConstructionCatalogPort;
  store: IndustryProjectStore;
  // 生产绑定：(tx) => new AssetMutationService(tx)。测试注入内存替身。
  receipts: (tx: ConstructionTx) => ConstructionReceiptsPort;
  // B005 取消项目同事务结案协作请求。缺省 = (tx) => new CooperationRepository(tx)（同模块仓库，
  // composition 未显式绑定时生产路径也生效）；测试注入内存替身。
  cooperation?: (tx: ConstructionTx) => ConstructionCooperationPort;
}

export interface ConstructionPrincipal {
  accountId: string;
}

// 结构对应 application/base/ports.ts 的 CancelProjectResultDto。
export interface ConstructionCancelResult {
  cancelled: boolean;
  duplicate: boolean;
  completed: boolean;
  releasedInputs: Array<{ itemId: string; quantity: number }>;
}

const CREATE_COMMAND_KIND = "base.createProject";
const CANCEL_COMMAND_KIND = "base.cancelProject";
const TERMINAL_PROJECT_STATUSES: ReadonlySet<string> = new Set(["completed", "cancelled", "failed"]);

interface CreateResultPayload {
  projectId: string;
  duplicate: boolean;
}

interface CancelResultPayload {
  cancelled: boolean;
  duplicate: boolean;
  completed: boolean;
  releasedInputs: Array<{ itemId: string; quantity: number }>;
}

function isCreateResultPayload(value: unknown): value is CreateResultPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CreateResultPayload).projectId === "string"
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

export class ConstructionService {
  private readonly openCooperation: (tx: ConstructionTx) => ConstructionCooperationPort;

  constructor(private readonly deps: ConstructionServiceDeps) {
    this.openCooperation = deps.cooperation ?? ((tx) => new CooperationRepository(tx));
  }

  async create(
    tx: ConstructionTx,
    principal: ConstructionPrincipal,
    input: CreateProjectInputDto
  ): Promise<CreateProjectResultDto> {
    const baseId = await this.requireBaseId(tx, principal);
    const actorScope = `base:${baseId}`;
    const requestHash = hashRequest({
      definitionRef: {
        kind: input.definitionRef.kind,
        stableId: input.definitionRef.stableId,
        revision: input.definitionRef.revision
      },
      siteId: input.siteId
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

    const template = this.deps.catalog.getProjectTemplate(input.definitionRef.stableId);
    if (!template || template.ref.revision !== input.definitionRef.revision) {
      // 旧 revision 不 fallback latest（S4）
      throw new BaseOperationError(409, "CONTENT_INCOMPATIBLE", "项目模板不存在或修订不匹配。");
    }

    const site = await this.deps.sites.getSite(tx, baseId, input.siteId);
    if (!site) {
      throw new BaseOperationError(400, "VALIDATION_ERROR", "建设位不存在。");
    }
    if (site.state !== "free") {
      throw new BaseOperationError(409, "SITE_OCCUPIED", "建设位已被占用。");
    }

    for (const required of template.inputs) {
      const reserved = await this.deps.assets.reserveBaseInventoryIfAvailable(
        tx,
        baseId,
        required.itemId,
        required.quantity
      );
      if (!reserved) {
        // 抛出走调用方事务整体回滚，无悬挂预留（S3）
        throw new BaseOperationError(409, "RESOURCE_INSUFFICIENT", "物资不足，无法开工。");
      }
    }

    const { projectId } = await this.deps.store.insertProjectWithSteps(tx, {
      baseId,
      siteId: site.id,
      projectDefId: template.ref.stableId,
      templateRevision: template.ref.revision,
      reservedInputs: template.inputs.map((item) => ({
        itemId: item.itemId,
        quantity: item.quantity
      })),
      steps: template.steps.map((step) => ({
        kind: step.kind,
        groupId: step.groupId,
        workRequired: step.workRequired
      }))
    });
    await this.deps.sites.markSiteReserved(tx, site.id);

    const result: CreateResultPayload = { projectId, duplicate: false };
    await receipts.saveReceiptResult({
      actorScope,
      commandKind: CREATE_COMMAND_KIND,
      commandId: input.commandId,
      result
    });
    return { projectId, duplicate: false };
  }

  async cancel(
    tx: ConstructionTx,
    principal: ConstructionPrincipal,
    input: { projectId: string; commandId: string }
  ): Promise<ConstructionCancelResult> {
    const baseId = await this.requireBaseId(tx, principal);
    // 与基地 tick 共用 bases 行锁：取消读取的预留、项目状态和协作事实必须来自结算提交后的同一状态。
    if (!(await this.deps.lookup.getBaseForUpdate(tx, baseId))) {
      throw new BaseOperationError(403, "BASE_SCOPE_INVALID", "账号没有可操作的基地。");
    }
    const actorScope = `base:${baseId}`;
    const requestHash = hashRequest({ projectId: input.projectId });
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

    const project = await this.deps.store.findProject(tx, baseId, input.projectId);
    if (!project) {
      // 不存在的项目按作用域无效 403 返回，防跨基地探测
      throw new BaseOperationError(403, "BASE_SCOPE_INVALID", "项目不存在或不属于该基地。");
    }
    if (TERMINAL_PROJECT_STATUSES.has(project.status)) {
      throw new BaseOperationError(409, "CONFLICT", "项目已结束，无法取消。");
    }

    const releasedInputs = project.reservedInputs.map((item) => ({
      itemId: item.itemId,
      quantity: item.quantity
    }));
    for (const item of releasedInputs) {
      await this.deps.assets.releaseReservedBaseInventory(tx, baseId, item.itemId, item.quantity);
    }
    await this.deps.store.updateProjectStatus(tx, project.id, "cancelled" as ProjectStatus);
    await this.deps.sites.releaseSite(tx, project.siteId);
    // B005：同一事务结案本项目 pending/accepted 协作请求。否则 accepted 永不结案，helper 被
    // reservedHelpers 永久排除、主屏“查看 N 项协作”一直指向已取消项目。helper 机器人本身在下一
    // tick 由纯规则（working）或协作回收（charging 挂旧分配）释放为 idle。
    await this.openCooperation(tx).closeOpenByProject(tx, baseId, project.id, "project_cancelled");

    const result: CancelResultPayload = {
      cancelled: true,
      duplicate: false,
      completed: false,
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

  private async requireBaseId(tx: ConstructionTx, principal: ConstructionPrincipal): Promise<string> {
    const baseId = await this.deps.lookup.findBaseIdByAccount(tx, principal.accountId);
    if (!baseId) {
      throw new BaseOperationError(403, "BASE_SCOPE_INVALID", "账号没有可操作的基地。");
    }
    return baseId;
  }

  // 重放一致 → 原结果（duplicate 标记重放）；不一致 → IDEMPOTENCY_CONFLICT（S4/§3.5）。
  private replayCreate(receipt: CommandReceipt, requestHash: string): CreateProjectResultDto {
    if (receipt.requestHash !== requestHash) {
      throw new BaseOperationError(409, "IDEMPOTENCY_CONFLICT", "相同命令 ID 但请求不一致。");
    }
    if (!isCreateResultPayload(receipt.result)) {
      throw new BaseOperationError(409, "IDEMPOTENCY_CONFLICT", "创建命令收据损坏。");
    }
    return { projectId: receipt.result.projectId, duplicate: true };
  }

  private replayCancel(
    receipt: CommandReceipt,
    requestHash: string
  ): ConstructionCancelResult {
    if (receipt.requestHash !== requestHash) {
      throw new BaseOperationError(409, "IDEMPOTENCY_CONFLICT", "相同命令 ID 但请求不一致。");
    }
    if (!isCancelResultPayload(receipt.result)) {
      throw new BaseOperationError(409, "IDEMPOTENCY_CONFLICT", "取消命令收据损坏。");
    }
    return { ...receipt.result, duplicate: true };
  }
}
