// M16-B 采购创建/到货结算业务（m16-p-contract.md §1/§3）。
// 采购（同事务）：价目经 shared PURCHASE_CATALOG 查价（未知 itemId → CONTENT_INCOMPATIBLE）
//   → credits 条件扣减（不足 RESOURCE_INSUFFICIENT，不产生在途行）→ 插 in_transit
//   （arrivesAtSim = 基地 simTime + PURCHASE_TRANSIT_SIM_HOURS）→ 回执落结果；
//   重放一致 → 原结果（duplicate:true），不一致 → IDEMPOTENCY_CONFLICT。
// 到货（tick 消费，BOUNDARY-03：基地 tick 统一结算，付款≠到货）：in_transit 且
//   arrivesAtSim<=sim → 逐单 inventory upsert 入库 + delivered（同事务）。
// 回据：actorScope=base:{baseId}，kind=base.purchase。一切失败发生在 claim 回据之后：
// 调用方 db.transaction 捕获异常整体回滚（含 claim），失败不残留收据、无部分提交。
import { PURCHASE_CATALOG, PURCHASE_TRANSIT_SIM_HOURS } from "@ai-mud/shared";
import {
  hashRequest,
  type AssetMutationPort,
  type CommandReceipt
} from "../ledger/asset-mutation.service.js";
import {
  BaseOperationError,
  addSimHours,
  type EconomyClockPort,
  type EconomyLookupPort,
  type EconomyPrincipal,
  type EconomyReceiptsPort,
  type EconomyTx
} from "./order.service.js";
import type { BasePurchaseRecord } from "./purchase.repository.js";

export { BaseOperationError };
export type { EconomyTx };

// ---------- 结构端口（composition 绑定；实现为 economy 自有持久面） ----------

// bases.credits 条件扣减写口（PurchaseRepository 账款访问面实现）。
export interface PurchaseCreditsPort {
  debitBaseCreditsIfAvailable(tx: EconomyTx, baseId: string, amount: number): Promise<boolean>;
}

// 到货入库写口（PurchaseRepository 的 base_inventory upsert 实现；M16-P BOUNDARY-03）。
export interface PurchaseInventoryPort {
  creditBaseInventoryFromPurchase(
    tx: EconomyTx,
    baseId: string,
    itemId: string,
    quantity: number
  ): Promise<void>;
}

export interface PurchaseStore {
  insertPurchaseInTransit(
    tx: EconomyTx,
    input: {
      baseId: string;
      itemId: string;
      quantity: number;
      costCredits: number;
      arrivesAtSim: Date;
    }
  ): Promise<{ purchaseId: string }>;
  listArrivedInTransit(tx: EconomyTx, baseId: string, sim: Date): Promise<BasePurchaseRecord[]>;
  markPurchaseDelivered(tx: EconomyTx, purchaseId: string): Promise<void>;
}

export interface PurchaseServiceDeps {
  lookup: EconomyLookupPort;
  clock: EconomyClockPort;
  credits: PurchaseCreditsPort;
  inventory: PurchaseInventoryPort;
  store: PurchaseStore;
  // 生产绑定：(tx) => new AssetMutationService(tx)。测试注入内存替身。
  receipts: (tx: EconomyTx) => EconomyReceiptsPort;
}

const PURCHASE_COMMAND_KIND = "base.purchase";

// 采购批量上限（M16-P §2：quantity 1..50）；transport zod 同界，这里兜底防端口直调。
export const PURCHASE_MAX_QUANTITY = 50;

export interface CreatePurchaseResultPayload {
  purchaseId: string;
  itemId: string;
  quantity: number;
  costCredits: number;
  // 到货时间（基地模拟时间，ISO 字符串——回据 result 为 jsonb，须可序列化）。
  arrivesAtSim: string;
  duplicate: boolean;
}

export interface SettlePurchasesResult {
  delivered: number;
}

function isCreatePurchaseResultPayload(value: unknown): value is CreatePurchaseResultPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CreatePurchaseResultPayload).purchaseId === "string" &&
    typeof (value as CreatePurchaseResultPayload).duplicate === "boolean"
  );
}

export class PurchaseService {
  constructor(private readonly deps: PurchaseServiceDeps) {}

  async createPurchase(
    tx: EconomyTx,
    principal: EconomyPrincipal,
    input: { itemId: string; quantity: number; commandId: string }
  ): Promise<CreatePurchaseResultPayload> {
    if (
      !Number.isInteger(input.quantity) ||
      input.quantity < 1 ||
      input.quantity > PURCHASE_MAX_QUANTITY ||
      typeof input.itemId !== "string" ||
      input.itemId.length === 0
    ) {
      throw new BaseOperationError(
        400,
        "VALIDATION_ERROR",
        `quantity 必须为 1..${PURCHASE_MAX_QUANTITY} 的整数且 itemId 非空。`
      );
    }

    const baseId = await this.requireBaseId(tx, principal);
    const actorScope = `base:${baseId}`;
    const requestHash = hashRequest({ itemId: input.itemId, quantity: input.quantity });
    const receipts = this.deps.receipts(tx);

    const existing = await receipts.findReceiptForUpdate(actorScope, PURCHASE_COMMAND_KIND, input.commandId);
    if (existing) return this.replayPurchase(existing, requestHash);

    const claimed = await receipts.claimReceipt({
      actorScope,
      commandKind: PURCHASE_COMMAND_KIND,
      commandId: input.commandId,
      requestHash
    });
    if (!claimed) {
      const raced = await receipts.findReceiptForUpdate(actorScope, PURCHASE_COMMAND_KIND, input.commandId);
      if (raced) return this.replayPurchase(raced, requestHash);
      throw new BaseOperationError(409, "CONFLICT", "命令幂等登记冲突，请重试。");
    }

    // 固定价目（shared PURCHASE_CATALOG 单价 × 数量）；未知 itemId → CONTENT_INCOMPATIBLE。
    const entry = PURCHASE_CATALOG.find((item) => item.itemId === input.itemId);
    if (!entry) {
      throw new BaseOperationError(409, "CONTENT_INCOMPATIBLE", "未知物资，不在采购价目内。");
    }
    const costCredits = entry.unitCostCredits * input.quantity;

    // 命令时间取基地 simTime（独立基地时钟）；到货 = sim + PURCHASE_TRANSIT_SIM_HOURS。
    const base = await this.requireBase(tx, baseId);
    const sim = base.simTime;

    // 条件扣减不足 → RESOURCE_INSUFFICIENT：在途行尚未插入，调用方事务回滚（含 claim）。
    const debited = await this.deps.credits.debitBaseCreditsIfAvailable(tx, baseId, costCredits);
    if (!debited) {
      throw new BaseOperationError(409, "RESOURCE_INSUFFICIENT", "credits 不足，无法采购。");
    }

    const arrivesAtSim = addSimHours(sim, PURCHASE_TRANSIT_SIM_HOURS);
    const { purchaseId } = await this.deps.store.insertPurchaseInTransit(tx, {
      baseId,
      itemId: input.itemId,
      quantity: input.quantity,
      costCredits,
      arrivesAtSim
    });

    const result: CreatePurchaseResultPayload = {
      purchaseId,
      itemId: input.itemId,
      quantity: input.quantity,
      costCredits,
      arrivesAtSim: arrivesAtSim.toISOString(),
      duplicate: false
    };
    await receipts.saveReceiptResult({
      actorScope,
      commandKind: PURCHASE_COMMAND_KIND,
      commandId: input.commandId,
      result
    });
    return result;
  }

  // 到货结算（基地 tick 消费）：in_transit 且 arrivesAtSim<=sim → 逐单入库 + delivered。
  // 调用方保证在基地 tick 事务内执行；入库与状态同事务，崩溃回滚不丢货。
  async settlePurchases(tx: EconomyTx, baseId: string, sim: Date): Promise<SettlePurchasesResult> {
    const arrived = await this.deps.store.listArrivedInTransit(tx, baseId, sim);
    let delivered = 0;
    for (const purchase of arrived) {
      await this.deps.inventory.creditBaseInventoryFromPurchase(
        tx,
        baseId,
        purchase.itemId,
        purchase.quantity
      );
      await this.deps.store.markPurchaseDelivered(tx, purchase.id);
      delivered += 1;
    }
    return { delivered };
  }

  // ---------- 内部 ----------

  private async requireBaseId(tx: EconomyTx, principal: EconomyPrincipal): Promise<string> {
    const baseId = await this.deps.lookup.findBaseIdByAccount(tx, principal.accountId);
    if (!baseId) {
      throw new BaseOperationError(403, "BASE_SCOPE_INVALID", "账号没有可操作的基地。");
    }
    return baseId;
  }

  private async requireBase(tx: EconomyTx, baseId: string): Promise<{ simTime: Date }> {
    const base = await this.deps.clock.getBaseForUpdate(tx, baseId);
    if (!base) {
      throw new BaseOperationError(403, "BASE_SCOPE_INVALID", "基地不存在。");
    }
    return base;
  }

  // 重放一致 → 原结果（duplicate 标记重放）；不一致 → IDEMPOTENCY_CONFLICT。
  private replayPurchase(
    receipt: CommandReceipt,
    requestHash: string
  ): CreatePurchaseResultPayload {
    if (receipt.requestHash !== requestHash) {
      throw new BaseOperationError(409, "IDEMPOTENCY_CONFLICT", "相同命令 ID 但请求不一致。");
    }
    if (!isCreatePurchaseResultPayload(receipt.result)) {
      throw new BaseOperationError(409, "IDEMPOTENCY_CONFLICT", "采购命令收据损坏。");
    }
    return { ...receipt.result, duplicate: true };
  }
}
