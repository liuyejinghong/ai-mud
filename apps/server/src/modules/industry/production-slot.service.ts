// R1 industry：加工槽维护命令 + 电力策略命令（03-domain-contracts.md §4）。
// 维护：合法窗口（第 8–10 批起）内消耗 1 备件 → 计数清零、停机解除；不自动扣料。
// 电力策略：更新加工/充电优先级；旧策略时段由 world tick 在下一基地分钟结清
// （请求路径不做结算，B008 Directive）。必须在调用方事务内执行。
import { hashRequest, type AssetMutationPort } from "../ledger/asset-mutation.service.js";
import { BaseOperationError } from "./construction.service.js";
import {
  LANDING_SLOT_EARLY_MAINTENANCE_FROM,
  LANDING_SLOT_MAINTENANCE_BATCHES
} from "./landing-rules.js";
import type { ProductionSlotRecord, ProductionSlotTx } from "./production-slot.repository.js";

const MAINTAIN_COMMAND_KIND = "base.maintainSlot";
const POWER_POLICY_COMMAND_KIND = "base.setPowerPolicy";

export interface LandingCommandLookupPort {
  findBaseIdByAccount(tx: ProductionSlotTx, accountId: string): Promise<string | null>;
  getBaseForUpdate(
    tx: ProductionSlotTx,
    baseId: string
  ): Promise<{ id: string; baseRevision: number } | null>;
}

export interface LandingCommandCatalogPort {
  rulesProfile(): "legacy" | "landing-v1";
}

export interface MaintainDeps {
  lookup: LandingCommandLookupPort;
  slots: {
    listForSite(tx: ProductionSlotTx, baseId: string, siteId: string): Promise<ProductionSlotRecord[]>;
    saveSlot(tx: ProductionSlotTx, patch: {
      slotId: string;
      batchesSinceMaintenance?: number;
      maintenanceBlocked?: boolean;
    }): Promise<void>;
  };
  // 条件消耗可用库存（quantity - reserved ≥ n 才扣；assets 唯一写者）。
  assets: {
    consumeBaseInventoryIfAvailable(
      tx: ProductionSlotTx,
      baseId: string,
      itemId: string,
      quantity: number
    ): Promise<boolean>;
  };
  capabilities: { hasCapability(tx: ProductionSlotTx, baseId: string, capability: string): Promise<boolean> };
  catalogResolver: { forBase(tx: ProductionSlotTx, baseId: string): Promise<LandingCommandCatalogPort> };
  receipts: (tx: ProductionSlotTx) => Pick<AssetMutationPort, "findReceiptForUpdate" | "claimReceipt" | "saveReceiptResult">;
}

export interface MaintainResult {
  slotId: string;
  batchesSinceMaintenance: number;
  duplicate: boolean;
}

export class ProductionSlotService {
  constructor(private readonly deps: MaintainDeps) {}

  async maintain(
    tx: ProductionSlotTx,
    principal: { accountId: string },
    input: { siteId: string; commandId: string; expectedBaseRevision?: number; controlToken?: string | null }
  ): Promise<MaintainResult> {
    const baseId = await this.requireLandingBase(tx, principal.accountId);
    const requestHash = hashRequest({ siteId: input.siteId, action: "maintain" });
    const replay = await this.claimAndReplay(tx, baseId, MAINTAIN_COMMAND_KIND, input.commandId, requestHash);
    if (replay) return { ...(replay as MaintainResult), duplicate: true };
    const base = await this.deps.lookup.getBaseForUpdate(tx, baseId);
    this.ensureRevision(base!.baseRevision, input.expectedBaseRevision);

    if (!(await this.deps.capabilities.hasCapability(tx, baseId, "maintenance"))) {
      throw new BaseOperationError(409, "REQUIREMENTS_NOT_MET", "需要先建成维护工位。");
    }
    const slots = await this.deps.slots.listForSite(tx, baseId, input.siteId);
    if (slots.length === 0) {
      throw new BaseOperationError(403, "BASE_SCOPE_INVALID", "该站点没有加工槽。");
    }
    // 站点多槽（扩建各 +1）时维护最早的停机/最先到窗的槽；单槽站点即本槽。
    const target =
      slots.find((slot) => slot.maintenanceBlocked) ??
      slots.reduce((earliest, slot) =>
        slot.batchesSinceMaintenance > earliest.batchesSinceMaintenance ? slot : earliest
      );
    if (target.batchesSinceMaintenance < LANDING_SLOT_EARLY_MAINTENANCE_FROM) {
      throw new BaseOperationError(
        409,
        "CONFLICT",
        `第 ${target.batchesSinceMaintenance} 批尚未进入维护窗口（第 8–10 批起可维护）。`
      );
    }
    if (target.batchesSinceMaintenance > LANDING_SLOT_MAINTENANCE_BATCHES) {
      throw new BaseOperationError(409, "CONFLICT", "槽位计数异常。");
    }
    const consumed = await this.deps.assets.consumeBaseInventoryIfAvailable(
      tx,
      baseId,
      "spare_part",
      1
    );
    if (!consumed) {
      throw new BaseOperationError(409, "RESOURCE_INSUFFICIENT", "备件不足（可用 0）。");
    }
    await this.deps.slots.saveSlot(tx, {
      slotId: target.id,
      batchesSinceMaintenance: 0,
      maintenanceBlocked: false
    });
    const result: MaintainResult = { slotId: target.id, batchesSinceMaintenance: 0, duplicate: false };
    await this.saveReceipt(tx, baseId, MAINTAIN_COMMAND_KIND, input.commandId, result);
    return result;
  }

  private async requireLandingBase(
    tx: ProductionSlotTx,
    accountId: string
  ): Promise<string> {
    const baseId = await this.deps.lookup.findBaseIdByAccount(tx, accountId);
    if (!baseId) throw new BaseOperationError(403, "BASE_SCOPE_INVALID", "账号没有可操作的基地。");
    const base = await this.deps.lookup.getBaseForUpdate(tx, baseId);
    if (!base) throw new BaseOperationError(403, "BASE_SCOPE_INVALID", "账号没有可操作的基地。");
    const catalog = await this.deps.catalogResolver.forBase(tx, baseId);
    if (catalog.rulesProfile() !== "landing-v1") {
      throw new BaseOperationError(409, "CAPABILITY_UNAVAILABLE", "当前存档不支持加工槽维护。");
    }
    return baseId;
  }

  // 幂等重放不受其后 revision 变化影响；revision 只校验新命令。
  private ensureRevision(baseRevision: number, expected?: number): void {
    if (expected !== undefined && expected !== baseRevision) {
      throw new BaseOperationError(409, "REVISION_EXPIRED", "基地状态已变化，请刷新后重试。");
    }
  }

  private async claimAndReplay(
    tx: ProductionSlotTx,
    baseId: string,
    commandKind: string,
    commandId: string,
    requestHash: string
  ): Promise<unknown | null> {
    const actorScope = `base:${baseId}`;
    const receipts = this.deps.receipts(tx);
    const existing = await receipts.findReceiptForUpdate(actorScope, commandKind, commandId);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new BaseOperationError(409, "IDEMPOTENCY_CONFLICT", "相同命令 ID 但请求不一致。");
      }
      return existing.result;
    }
    const claimed = await receipts.claimReceipt({ actorScope, commandKind, commandId, requestHash });
    if (!claimed) {
      const raced = await receipts.findReceiptForUpdate(actorScope, commandKind, commandId);
      if (raced) {
        if (raced.requestHash !== requestHash) {
          throw new BaseOperationError(409, "IDEMPOTENCY_CONFLICT", "相同命令 ID 但请求不一致。");
        }
        return raced.result;
      }
      throw new BaseOperationError(409, "CONFLICT", "命令幂等登记冲突，请重试。");
    }
    return null;
  }

  private async saveReceipt(
    tx: ProductionSlotTx,
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

export interface PowerPolicyDeps {
  lookup: LandingCommandLookupPort;
  // base_power_state 唯一写者（industry repository 的结构子面）。
  power: { savePowerPolicy(tx: ProductionSlotTx, baseId: string, priority: "production" | "charging"): Promise<void> };
  catalogResolver: { forBase(tx: ProductionSlotTx, baseId: string): Promise<LandingCommandCatalogPort> };
  receipts: (tx: ProductionSlotTx) => Pick<AssetMutationPort, "findReceiptForUpdate" | "claimReceipt" | "saveReceiptResult">;
  // 03 §4：切换前先按旧策略结清本基地已确认时段（B008 禁止的是请求路径任意推动全服，
  // 不是禁止合法的本基地已确认边界结清——与 heartbeat/settleConfirmedThrough 同一参与能力）。
  settleConfirmedThrough?: (tx: ProductionSlotTx, baseId: string, at: Date) => Promise<void>;
}

export class PowerPolicyService {
  constructor(private readonly deps: PowerPolicyDeps) {}

  async setPolicy(
    tx: ProductionSlotTx,
    principal: { accountId: string },
    input: { priority: "production" | "charging"; commandId: string; expectedBaseRevision?: number; controlToken?: string | null }
  ): Promise<{ priority: "production" | "charging"; duplicate: boolean }> {
    if (input.priority !== "production" && input.priority !== "charging") {
      throw new BaseOperationError(400, "VALIDATION_ERROR", "priority 必须为 production 或 charging。");
    }
    const baseId = await this.requireLandingBase(tx, principal.accountId);
    const requestHash = hashRequest({ priority: input.priority });
    const actorScope = `base:${baseId}`;
    const receipts = this.deps.receipts(tx);
    const existing = await receipts.findReceiptForUpdate(actorScope, POWER_POLICY_COMMAND_KIND, input.commandId);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new BaseOperationError(409, "IDEMPOTENCY_CONFLICT", "相同命令 ID 但请求不一致。");
      }
      return { ...(existing.result as { priority: "production" | "charging"; duplicate: boolean }), duplicate: true };
    }
    const baseForPolicy = await this.deps.lookup.getBaseForUpdate(tx, baseId);
    this.ensureRevision(baseForPolicy!.baseRevision, input.expectedBaseRevision);
    // 先按旧策略结清已确认时段，再落新策略（不追溯重算旧时段）。
    if (this.deps.settleConfirmedThrough) {
      await this.deps.settleConfirmedThrough(tx, baseId, new Date());
    }
    const claimed = await receipts.claimReceipt({
      actorScope,
      commandKind: POWER_POLICY_COMMAND_KIND,
      commandId: input.commandId,
      requestHash
    });
    if (!claimed) {
      const raced = await receipts.findReceiptForUpdate(actorScope, POWER_POLICY_COMMAND_KIND, input.commandId);
      if (raced && raced.requestHash === requestHash) {
        return { ...(raced.result as { priority: "production" | "charging"; duplicate: boolean }), duplicate: true };
      }
      throw new BaseOperationError(409, "CONFLICT", "命令幂等登记冲突，请重试。");
    }
    await this.deps.power.savePowerPolicy(tx, baseId, input.priority);
    const result = { priority: input.priority, duplicate: false };
    await receipts.saveReceiptResult({
      actorScope,
      commandKind: POWER_POLICY_COMMAND_KIND,
      commandId: input.commandId,
      result
    });
    return result;
  }

  private async requireLandingBase(
    tx: ProductionSlotTx,
    accountId: string,
    expectedBaseRevision?: number
  ): Promise<string> {
    const baseId = await this.deps.lookup.findBaseIdByAccount(tx, accountId);
    if (!baseId) throw new BaseOperationError(403, "BASE_SCOPE_INVALID", "账号没有可操作的基地。");
    const base = await this.deps.lookup.getBaseForUpdate(tx, baseId);
    if (!base) throw new BaseOperationError(403, "BASE_SCOPE_INVALID", "账号没有可操作的基地。");
    if (expectedBaseRevision !== undefined && expectedBaseRevision !== base.baseRevision) {
      throw new BaseOperationError(409, "REVISION_EXPIRED", "基地状态已变化，请刷新后重试。");
    }
    const catalog = await this.deps.catalogResolver.forBase(tx, baseId);
    if (catalog.rulesProfile() !== "landing-v1") {
      throw new BaseOperationError(409, "CAPABILITY_UNAVAILABLE", "当前存档不支持电力策略。");
    }
    return baseId;
  }

  private ensureRevision(baseRevision: number, expected?: number): void {
    if (expected !== undefined && expected !== baseRevision) {
      throw new BaseOperationError(409, "REVISION_EXPIRED", "基地状态已变化，请刷新后重试。");
    }
  }
}
