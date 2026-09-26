// M16-B 采购创建/到货结算业务测试（全部内存假端口，无真库、无真事务，同
// manufacturing.service.test.ts 模式）。失败路径中收据 claim 的回滚由真事务保证，
// 内存假件不模拟（断言只针对业务状态与回执结果）。
// 价目/在途延迟 fixture = shared economy.ts（PURCHASE_CATALOG / PURCHASE_TRANSIT_SIM_MINUTES）。
import { describe, expect, it } from "vitest";
import {
  BaseOperationError,
  PurchaseService,
  PURCHASE_MAX_QUANTITY,
  type PurchaseCreditsPort,
  type PurchaseInventoryPort,
  type PurchaseServiceDeps,
  type PurchaseStore
} from "./purchase.service.js";
import type {
  EconomyClockPort,
  EconomyLookupPort,
  EconomyReceiptsPort,
  EconomyTx
} from "./order.service.js";
import type { BasePurchaseRecord } from "./purchase.repository.js";

const SIM_NOW = new Date("2026-03-01T00:00:00.000Z");

class FakeLookup implements EconomyLookupPort {
  constructor(private readonly baseByAccount: Map<string, string>) {}
  async findBaseIdByAccount(_tx: EconomyTx, accountId: string): Promise<string | null> {
    return this.baseByAccount.get(accountId) ?? null;
  }
}

class FakeClock implements EconomyClockPort {
  simTime = SIM_NOW;
  async getBaseForUpdate(_tx: EconomyTx, _baseId: string): Promise<{ simTime: Date }> {
    return { simTime: this.simTime };
  }
}

class FakeCredits implements PurchaseCreditsPort {
  balances = new Map<string, number>([["base-1", 500]]);
  debited: number[] = [];
  async debitBaseCreditsIfAvailable(_tx: EconomyTx, baseId: string, amount: number): Promise<boolean> {
    const current = this.balances.get(baseId) ?? 0;
    if (current < amount) return false;
    this.balances.set(baseId, current - amount);
    this.debited.push(amount);
    return true;
  }
}

class FakeInventory implements PurchaseInventoryPort {
  stock = new Map<string, number>();
  credits: Array<{ itemId: string; quantity: number }> = [];
  async creditBaseInventoryFromPurchase(
    _tx: EconomyTx,
    _baseId: string,
    itemId: string,
    quantity: number
  ): Promise<void> {
    this.stock.set(itemId, (this.stock.get(itemId) ?? 0) + quantity);
    this.credits.push({ itemId, quantity });
  }
}

class FakePurchaseStore implements PurchaseStore {
  purchases = new Map<string, BasePurchaseRecord>();
  private sequence = 0;

  async insertPurchaseInTransit(
    _tx: EconomyTx,
    input: { baseId: string; itemId: string; quantity: number; costCredits: number; arrivesAtSim: Date }
  ): Promise<{ purchaseId: string }> {
    this.sequence += 1;
    const purchaseId = `purchase-${this.sequence}`;
    this.purchases.set(purchaseId, {
      id: purchaseId,
      baseId: input.baseId,
      itemId: input.itemId,
      quantity: input.quantity,
      costCredits: input.costCredits,
      status: "in_transit",
      arrivesAtSim: input.arrivesAtSim,
      createdAt: SIM_NOW
    });
    return { purchaseId };
  }

  async listArrivedInTransit(_tx: EconomyTx, baseId: string, sim: Date): Promise<BasePurchaseRecord[]> {
    const rows: BasePurchaseRecord[] = [];
    for (const purchase of this.purchases.values()) {
      if (
        purchase.baseId === baseId &&
        purchase.status === "in_transit" &&
        purchase.arrivesAtSim.getTime() <= sim.getTime()
      ) {
        rows.push(purchase);
      }
    }
    return rows;
  }

  async markPurchaseDelivered(_tx: EconomyTx, purchaseId: string): Promise<void> {
    const purchase = this.purchases.get(purchaseId);
    if (!purchase || purchase.status !== "in_transit") return;
    purchase.status = "delivered";
  }
}

interface ReceiptRow {
  actorScope: string;
  commandKind: string;
  commandId: string;
  worldEpoch: number;
  requestHash: string;
  result: unknown;
}

class FakeReceipts implements EconomyReceiptsPort {
  rows = new Map<string, ReceiptRow>();
  savedResults: unknown[] = [];

  private key(actorScope: string, commandKind: string, commandId: string): string {
    return `${actorScope}|${commandKind}|${commandId}`;
  }

  async findReceiptForUpdate(
    actorScope: string,
    commandKind: string,
    commandId: string
  ): Promise<ReceiptRow | null> {
    return this.rows.get(this.key(actorScope, commandKind, commandId)) ?? null;
  }

  async claimReceipt(input: {
    actorScope: string;
    commandKind: string;
    commandId: string;
    requestHash: string;
  }): Promise<boolean> {
    const key = this.key(input.actorScope, input.commandKind, input.commandId);
    if (this.rows.has(key)) return false;
    this.rows.set(key, {
      actorScope: input.actorScope,
      commandKind: input.commandKind,
      commandId: input.commandId,
      worldEpoch: 1,
      requestHash: input.requestHash,
      result: { status: "pending" }
    });
    return true;
  }

  async saveReceiptResult(input: {
    actorScope: string;
    commandKind: string;
    commandId: string;
    result: unknown;
  }): Promise<void> {
    this.savedResults.push(input.result);
    const row = this.rows.get(this.key(input.actorScope, input.commandKind, input.commandId));
    if (row) row.result = input.result;
  }
}

function makeService(overrides: { baseByAccount?: Map<string, string>; creditsBase1?: number } = {}) {
  const lookup = new FakeLookup(overrides.baseByAccount ?? new Map([["account-1", "base-1"]]));
  const clock = new FakeClock();
  const credits = new FakeCredits();
  if (overrides.creditsBase1 !== undefined) credits.balances.set("base-1", overrides.creditsBase1);
  const inventory = new FakeInventory();
  const store = new FakePurchaseStore();
  const receipts = new FakeReceipts();
  const deps: PurchaseServiceDeps = {
    lookup,
    clock,
    credits,
    inventory,
    store,
    receipts: () => receipts
  };
  return { service: new PurchaseService(deps), clock, credits, inventory, store, receipts };
}

const tx = {} as EconomyTx;
const principal = { accountId: "account-1" };
const BUY_INPUT = { itemId: "solar_panel_set", quantity: 2, commandId: "cmd-buy-1" }; // 120×2 = 240

describe("PurchaseService.createPurchase", () => {
  it("采购 happy path：扣款 240（500→260）→ in_transit（到货=sim+20m）→ 回执落结果", async () => {
    const { service, credits, store, receipts } = makeService();

    const result = await service.createPurchase(tx, principal, BUY_INPUT);

    expect(result).toEqual({
      purchaseId: "purchase-1",
      itemId: "solar_panel_set",
      quantity: 2,
      costCredits: 240,
      arrivesAtSim: new Date(SIM_NOW.getTime() + 20 * 60_000).toISOString(),
      duplicate: false
    });
    expect(credits.balances.get("base-1")).toBe(260);
    const purchase = store.purchases.get("purchase-1");
    expect(purchase?.status).toBe("in_transit");
    expect(purchase?.arrivesAtSim).toEqual(new Date(SIM_NOW.getTime() + 20 * 60_000));
    expect(receipts.savedResults.at(-1)).toEqual(result);
  });

  it("重复 commandId 且请求一致 → 重放 duplicate=true，不二次扣款/不重复开单", async () => {
    const { service, credits, store } = makeService();
    await service.createPurchase(tx, principal, BUY_INPUT);

    const replay = await service.createPurchase(tx, principal, BUY_INPUT);

    expect(replay.duplicate).toBe(true);
    expect(replay.purchaseId).toBe("purchase-1");
    expect(credits.balances.get("base-1")).toBe(260);
    expect(store.purchases.size).toBe(1);
  });

  it("未知 itemId → CONTENT_INCOMPATIBLE，不扣款、无在途行", async () => {
    const { service, credits, store } = makeService();

    const failure = service.createPurchase(tx, principal, { ...BUY_INPUT, itemId: "unobtainium" });

    await expect(failure).rejects.toMatchObject({ code: "CONTENT_INCOMPATIBLE", statusCode: 409 });
    expect(credits.balances.get("base-1")).toBe(500);
    expect(credits.debited).toHaveLength(0);
    expect(store.purchases.size).toBe(0);
  });

  it("credits 不足 → RESOURCE_INSUFFICIENT，无在途行、无回执结果（真事务回滚 claim）", async () => {
    const { service, credits, store, receipts } = makeService({ creditsBase1: 100 });

    const failure = service.createPurchase(tx, principal, BUY_INPUT);

    await expect(failure).rejects.toMatchObject({ code: "RESOURCE_INSUFFICIENT", statusCode: 409 });
    expect(credits.balances.get("base-1")).toBe(100);
    expect(store.purchases.size).toBe(0);
    expect(receipts.savedResults).toHaveLength(0);
  });

  it("quantity 越界（0 / 51）与空 itemId → VALIDATION_ERROR；账号无基地 → BASE_SCOPE_INVALID", async () => {
    const { service } = makeService();
    await expect(
      service.createPurchase(tx, principal, { ...BUY_INPUT, quantity: 0 })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400 });
    await expect(
      service.createPurchase(tx, principal, { ...BUY_INPUT, quantity: PURCHASE_MAX_QUANTITY + 1 })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      service.createPurchase(tx, principal, { ...BUY_INPUT, itemId: "" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const noBase = makeService({ baseByAccount: new Map() });
    await expect(
      noBase.service.createPurchase(tx, principal, BUY_INPUT)
    ).rejects.toMatchObject({ code: "BASE_SCOPE_INVALID", statusCode: 403 });
  });

  it("相同 commandId 但请求不一致（换数量）→ IDEMPOTENCY_CONFLICT", async () => {
    const { service } = makeService();
    await service.createPurchase(tx, principal, BUY_INPUT);

    const conflict = service.createPurchase(tx, principal, { ...BUY_INPUT, quantity: 3 });

    await expect(conflict).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", statusCode: 409 });
  });
});

describe("PurchaseService.settlePurchases", () => {
  it("到货结算：到期 in_transit 入库 + delivered；未到期保持 in_transit", async () => {
    const { service, clock, inventory, store } = makeService();
    await service.createPurchase(tx, principal, BUY_INPUT); // 到货 = sim+20m
    await service.createPurchase(tx, principal, {
      itemId: "cable",
      quantity: 5,
      commandId: "cmd-buy-2"
    }); // 同一 sim 开单，同样 sim+20m 到货——用时钟区分到期与否

    // 推进 19 分钟：两单都未到期
    clock.simTime = new Date(SIM_NOW.getTime() + 19 * 60_000);
    expect(await service.settlePurchases(tx, "base-1", clock.simTime)).toEqual({ delivered: 0 });
    expect(inventory.credits).toHaveLength(0);
    expect([...store.purchases.values()].every((purchase) => purchase.status === "in_transit")).toBe(true);

    // 推进到 20 分钟：两单到期 → 全部入库 + delivered
    clock.simTime = new Date(SIM_NOW.getTime() + 20 * 60_000);
    expect(await service.settlePurchases(tx, "base-1", clock.simTime)).toEqual({ delivered: 2 });
    expect(inventory.stock.get("solar_panel_set")).toBe(2);
    expect(inventory.stock.get("cable")).toBe(5);
    expect([...store.purchases.values()].every((purchase) => purchase.status === "delivered")).toBe(true);
  });

  it("到货入库为 upsert 累加：已有库存 5 + 到货 2 = 7", async () => {
    const { service, clock, inventory, store } = makeService();
    inventory.stock.set("solar_panel_set", 5);
    await service.createPurchase(tx, principal, BUY_INPUT);
    clock.simTime = new Date(SIM_NOW.getTime() + 20 * 60_000);

    await service.settlePurchases(tx, "base-1", clock.simTime);

    expect(inventory.stock.get("solar_panel_set")).toBe(7);
    expect(store.purchases.get("purchase-1")?.status).toBe("delivered");
  });

  it("无到期在途行 → delivered 0，不做任何入库", async () => {
    const { service, inventory } = makeService();

    const result = await service.settlePurchases(tx, "base-1", SIM_NOW);

    expect(result).toEqual({ delivered: 0 });
    expect(inventory.credits).toHaveLength(0);
  });
});
