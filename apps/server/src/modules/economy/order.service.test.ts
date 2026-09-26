// M16-A 接单/交付/刷新业务测试（全部内存假端口，无真库、无真事务，同
// manufacturing.service.test.ts 模式）。回执 requestHash 由被测服务内部计算；失败路径中
// 收据 claim 的回滚由真事务保证，内存假件不模拟（断言只针对业务状态与回执结果）。
// 订单模板 fixture = m16-p-contract.md §4 首批三单（stableId 为测试自拟）。
// 注：DefinitionRefDto 无 "order" kind 成员（契约疑问，见交付报告），fixture 以 "project" 占位。
import { describe, expect, it } from "vitest";
import type { OrderTemplateDto } from "@ai-mud/shared";
import {
  BaseOperationError,
  OrderService,
  ORDER_OPEN_TARGET,
  type EconomyClockPort,
  type EconomyInventoryPort,
  type EconomyLookupPort,
  type EconomyReceiptsPort,
  type OrderCreditsPort,
  type OrderServiceDeps,
  type OrderStore,
  type EconomyTx
} from "./order.service.js";
import type { BaseOrderRecord } from "./order.repository.js";

const SIM_NOW = new Date("2026-03-01T00:00:00.000Z");

function makeTemplate(stableId: string, itemId: string, quantity: number, rewardCredits: number, deadlineSimHours: number): OrderTemplateDto {
  return {
    ref: { kind: "project", stableId, revision: 1 },
    name: `订单 ${stableId}`,
    description: "M16-P §4 fixture",
    requiredItemId: itemId,
    quantity,
    rewardCredits,
    deadlineSimHours
  };
}

const TEMPLATE_A = makeTemplate("order-solar-panels", "solar_panel_set", 4, 700, 48);
const TEMPLATE_B = makeTemplate("order-support-frames", "support_frame", 6, 500, 48);
const TEMPLATE_C = makeTemplate("order-spare-parts", "spare_parts", 10, 450, 72);
const ALL_TEMPLATES = [TEMPLATE_A, TEMPLATE_B, TEMPLATE_C];

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

class FakeCatalog {
  templates = new Map<string, OrderTemplateDto | null>();
  constructor(seed: OrderTemplateDto[]) {
    for (const template of seed) this.templates.set(template.ref.stableId, template);
  }
  getOrderTemplate(stableId: string): OrderTemplateDto | null {
    return this.templates.get(stableId) ?? null;
  }
  listOrderTemplates(): OrderTemplateDto[] {
    // 仅返回显式登记且非 null 的模板（get 返回 undefined = 未登记）。
    const available: OrderTemplateDto[] = [];
    for (const template of ALL_TEMPLATES) {
      const entry = this.templates.get(template.ref.stableId) ?? null;
      if (entry) available.push(entry);
    }
    return available;
  }
}

class FakeInventory implements EconomyInventoryPort {
  stock = new Map<string, number>();
  constructor(seed: Record<string, number> = {}) {
    for (const [itemId, quantity] of Object.entries(seed)) this.stock.set(itemId, quantity);
  }
  async consumeBaseInventoryIfAvailable(
    _tx: EconomyTx,
    _baseId: string,
    itemId: string,
    quantity: number
  ): Promise<boolean> {
    const current = this.stock.get(itemId) ?? 0;
    if (current < quantity) return false;
    this.stock.set(itemId, current - quantity);
    return true;
  }
}

class FakeCredits implements OrderCreditsPort {
  balances = new Map<string, number>([["base-1", 100]]);
  async creditBaseCredits(_tx: EconomyTx, baseId: string, amount: number): Promise<void> {
    this.balances.set(baseId, (this.balances.get(baseId) ?? 0) + amount);
  }
}

class FakeOrderStore implements OrderStore {
  orders = new Map<string, BaseOrderRecord>();
  private sequence = 0;

  async findOrderForUpdate(_tx: EconomyTx, baseId: string, orderId: string): Promise<BaseOrderRecord | null> {
    const order = this.orders.get(orderId);
    if (!order || order.baseId !== baseId) return null;
    return order;
  }

  async saveOrderAccepted(_tx: EconomyTx, orderId: string, acceptedAtSim: Date, deadlineSim: Date): Promise<void> {
    const order = this.orders.get(orderId);
    if (!order) return;
    order.status = "accepted";
    order.acceptedAtSim = acceptedAtSim;
    order.deadlineSim = deadlineSim;
  }

  async saveOrderDelivered(_tx: EconomyTx, orderId: string, resolvedAtSim: Date): Promise<void> {
    const order = this.orders.get(orderId);
    if (!order) return;
    order.status = "delivered";
    order.resolvedAt = resolvedAtSim;
  }

  async saveOrderFailed(_tx: EconomyTx, orderId: string, resolvedAtSim: Date): Promise<void> {
    const order = this.orders.get(orderId);
    if (!order) return;
    order.status = "failed";
    order.resolvedAt = resolvedAtSim;
  }

  async listOrdersForBase(_tx: EconomyTx, baseId: string): Promise<BaseOrderRecord[]> {
    return [...this.orders.values()].filter((order) => order.baseId === baseId);
  }

  async insertOpenOrder(_tx: EconomyTx, baseId: string, template: OrderTemplateDto): Promise<{ orderId: string }> {
    this.sequence += 1;
    const orderId = `order-${this.sequence}`;
    this.orders.set(orderId, {
      id: orderId,
      baseId,
      orderDefId: template.ref.stableId,
      orderRevision: template.ref.revision,
      status: "open",
      requiredItemId: template.requiredItemId,
      quantity: template.quantity,
      rewardCredits: template.rewardCredits,
      deadlineSim: null,
      acceptedAtSim: null,
      createdAt: SIM_NOW,
      resolvedAt: null
    });
    return { orderId };
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

function makeService(overrides: {
  baseByAccount?: Map<string, string>;
  catalogTemplates?: OrderTemplateDto[];
  stock?: Record<string, number>;
} = {}) {
  const lookup = new FakeLookup(overrides.baseByAccount ?? new Map([["account-1", "base-1"]]));
  const clock = new FakeClock();
  const catalog = new FakeCatalog(overrides.catalogTemplates ?? ALL_TEMPLATES);
  const assets = new FakeInventory(overrides.stock);
  const credits = new FakeCredits();
  const store = new FakeOrderStore();
  const receipts = new FakeReceipts();
  const deps: OrderServiceDeps = {
    lookup,
    clock,
    catalog,
    assets,
    store,
    credits,
    receipts: () => receipts
  };
  return { service: new OrderService(deps), clock, catalog, assets, credits, store, receipts };
}

const tx = {} as EconomyTx;
const principal = { accountId: "account-1" };

async function seedOpenOrder(store: FakeOrderStore, template: OrderTemplateDto): Promise<string> {
  const { orderId } = await store.insertOpenOrder(tx, "base-1", template);
  return orderId;
}

describe("OrderService.acceptOrder", () => {
  it("接单 happy path：open→accepted，deadline=sim+48h，回执落结果 duplicate:false", async () => {
    const { service, store, receipts } = makeService();
    const orderId = await seedOpenOrder(store, TEMPLATE_A);

    const result = await service.acceptOrder(tx, principal, { orderId, commandId: "cmd-accept-1" });

    expect(result).toEqual({ orderId, duplicate: false });
    const order = store.orders.get(orderId);
    expect(order?.status).toBe("accepted");
    expect(order?.acceptedAtSim).toEqual(SIM_NOW);
    expect(order?.deadlineSim).toEqual(new Date(SIM_NOW.getTime() + 48 * 3_600_000));
    expect(receipts.savedResults.at(-1)).toEqual({ orderId, duplicate: false });
  });

  it("重复 commandId 且请求一致 → 重放 duplicate=true，不二次改单", async () => {
    const { service, store, receipts } = makeService();
    const orderId = await seedOpenOrder(store, TEMPLATE_A);
    const first = await service.acceptOrder(tx, principal, { orderId, commandId: "cmd-accept-1" });

    const replay = await service.acceptOrder(tx, principal, { orderId, commandId: "cmd-accept-1" });

    expect(first.duplicate).toBe(false);
    expect(replay).toEqual({ orderId, duplicate: true });
    expect(receipts.rows.size).toBe(1); // 不新增收据
    const order = store.orders.get(orderId);
    expect(order?.status).toBe("accepted");
    expect(order?.deadlineSim).toEqual(new Date(SIM_NOW.getTime() + 48 * 3_600_000));
  });

  it("同一订单已被接（不同 commandId）→ CONFLICT", async () => {
    const { service, store } = makeService();
    const orderId = await seedOpenOrder(store, TEMPLATE_A);
    await service.acceptOrder(tx, principal, { orderId, commandId: "cmd-accept-1" });

    const second = service.acceptOrder(tx, principal, { orderId, commandId: "cmd-accept-2" });

    await expect(second).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });
  });

  it("订单不存在或属于他基地 → CONFLICT；账号无基地 → BASE_SCOPE_INVALID（403）", async () => {
    const { service } = makeService();
    await expect(
      service.acceptOrder(tx, principal, { orderId: "no-such", commandId: "cmd-x" })
    ).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });

    const noBase = makeService({ baseByAccount: new Map() });
    await expect(
      noBase.service.acceptOrder(tx, principal, { orderId: "no-such", commandId: "cmd-y" })
    ).rejects.toMatchObject({ code: "BASE_SCOPE_INVALID", statusCode: 403 });
  });

  it("订单模板缺失（内容下线）→ CONTENT_INCOMPATIBLE，订单保持 open", async () => {
    const { service, catalog, store } = makeService({ catalogTemplates: [] });
    catalog.templates.clear();
    const orderId = await seedOpenOrder(store, TEMPLATE_A);

    const failure = service.acceptOrder(tx, principal, { orderId, commandId: "cmd-accept-1" });

    await expect(failure).rejects.toMatchObject({ code: "CONTENT_INCOMPATIBLE", statusCode: 409 });
    expect(store.orders.get(orderId)?.status).toBe("open");
  });

  it("相同 commandId 但 orderId 不一致 → IDEMPOTENCY_CONFLICT", async () => {
    const { service, store } = makeService();
    const orderId = await seedOpenOrder(store, TEMPLATE_A);
    const otherOrderId = await seedOpenOrder(store, TEMPLATE_B);
    await service.acceptOrder(tx, principal, { orderId, commandId: "cmd-accept-1" });

    const conflict = service.acceptOrder(tx, principal, { orderId: otherOrderId, commandId: "cmd-accept-1" });

    await expect(conflict).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", statusCode: 409 });
  });
});

describe("OrderService.deliverOrder", () => {
  it("交付 happy path：真消耗 4 件库存 + credits +700 + delivered + 回执", async () => {
    const { service, store, assets, credits, receipts } = makeService({ stock: { solar_panel_set: 10 } });
    const orderId = await seedOpenOrder(store, TEMPLATE_A);
    await service.acceptOrder(tx, principal, { orderId, commandId: "cmd-accept-1" });

    const result = await service.deliverOrder(tx, principal, { orderId, commandId: "cmd-deliver-1" });

    expect(result).toEqual({ orderId, rewardCredits: 700, duplicate: false });
    expect(assets.stock.get("solar_panel_set")).toBe(6);
    expect(credits.balances.get("base-1")).toBe(800);
    const order = store.orders.get(orderId);
    expect(order?.status).toBe("delivered");
    expect(order?.resolvedAt).toEqual(SIM_NOW);
    expect(receipts.savedResults.at(-1)).toEqual({ orderId, rewardCredits: 700, duplicate: false });
  });

  it("库存不足 → RESOURCE_INSUFFICIENT，无部分提交（库存/credits/订单状态不变）", async () => {
    const { service, store, assets, credits, receipts } = makeService({ stock: { solar_panel_set: 3 } });
    const orderId = await seedOpenOrder(store, TEMPLATE_A);
    await service.acceptOrder(tx, principal, { orderId, commandId: "cmd-accept-1" });
    const savedBefore = receipts.savedResults.length; // 接单落过 1 条结果

    const failure = service.deliverOrder(tx, principal, { orderId, commandId: "cmd-deliver-1" });

    await expect(failure).rejects.toMatchObject({ code: "RESOURCE_INSUFFICIENT", statusCode: 409 });
    expect(assets.stock.get("solar_panel_set")).toBe(3);
    expect(credits.balances.get("base-1")).toBe(100);
    expect(store.orders.get(orderId)?.status).toBe("accepted");
    // 交付命令未落任何收据结果（真事务会连同 claim 一并回滚；假件断言无新增结果即可）。
    expect(receipts.savedResults).toHaveLength(savedBefore);
  });

  it("过期交付：deadline<sim → 先标 failed 再抛 REQUIREMENTS_NOT_MET，库存/credits 不变", async () => {
    const { service, clock, store, assets, credits } = makeService({ stock: { solar_panel_set: 10 } });
    const orderId = await seedOpenOrder(store, TEMPLATE_A);
    await service.acceptOrder(tx, principal, { orderId, commandId: "cmd-accept-1" });
    clock.simTime = new Date(SIM_NOW.getTime() + 49 * 3_600_000); // 48h 期限已过 1h

    const failure = service.deliverOrder(tx, principal, { orderId, commandId: "cmd-deliver-1" });

    await expect(failure).rejects.toMatchObject({ code: "REQUIREMENTS_NOT_MET", statusCode: 409 });
    const order = store.orders.get(orderId);
    expect(order?.status).toBe("failed");
    expect(order?.resolvedAt).toEqual(clock.simTime);
    expect(assets.stock.get("solar_panel_set")).toBe(10);
    expect(credits.balances.get("base-1")).toBe(100);
  });

  it("交付重放：重复 commandId → duplicate=true，不重复扣库存/加钱", async () => {
    const { service, store, assets, credits } = makeService({ stock: { solar_panel_set: 10 } });
    const orderId = await seedOpenOrder(store, TEMPLATE_A);
    await service.acceptOrder(tx, principal, { orderId, commandId: "cmd-accept-1" });
    await service.deliverOrder(tx, principal, { orderId, commandId: "cmd-deliver-1" });

    const replay = await service.deliverOrder(tx, principal, { orderId, commandId: "cmd-deliver-1" });

    expect(replay).toEqual({ orderId, rewardCredits: 700, duplicate: true });
    expect(assets.stock.get("solar_panel_set")).toBe(6);
    expect(credits.balances.get("base-1")).toBe(800);
  });

  it("非 accepted 状态（open）→ CONFLICT", async () => {
    const { service, store } = makeService({ stock: { solar_panel_set: 10 } });
    const orderId = await seedOpenOrder(store, TEMPLATE_A);

    const failure = service.deliverOrder(tx, principal, { orderId, commandId: "cmd-deliver-1" });

    await expect(failure).rejects.toMatchObject({ code: "CONFLICT", statusCode: 409 });
  });
});

describe("OrderService.ensureOrders", () => {
  it("空基地按 catalog 顺序补足至 3 个 open", async () => {
    const { service, store } = makeService();

    const result = await service.ensureOrders(tx, "base-1", SIM_NOW);

    expect(result).toEqual({ created: 3 });
    expect(store.orders.size).toBe(ORDER_OPEN_TARGET);
    const defIds = [...store.orders.values()].map((order) => order.orderDefId);
    expect(defIds).toEqual([TEMPLATE_A.ref.stableId, TEMPLATE_B.ref.stableId, TEMPLATE_C.ref.stableId]);
  });

  it("已有同模板 open 不重复开，缺口补足至 3", async () => {
    const { service, store } = makeService();
    await store.insertOpenOrder(tx, "base-1", TEMPLATE_B); // 已有模板 B 的 open 行

    const result = await service.ensureOrders(tx, "base-1", SIM_NOW);

    expect(result).toEqual({ created: 2 });
    const defIds = [...store.orders.values()].map((order) => order.orderDefId);
    expect(defIds.filter((id) => id === TEMPLATE_B.ref.stableId)).toHaveLength(1);
    expect(defIds).toContain(TEMPLATE_A.ref.stableId);
    expect(defIds).toContain(TEMPLATE_C.ref.stableId);
  });

  it("已达 3 个 open → 不再开单；catalog 模板耗尽时只开到可用数", async () => {
    const { service, store } = makeService();
    for (const template of ALL_TEMPLATES) await store.insertOpenOrder(tx, "base-1", template);
    expect(await service.ensureOrders(tx, "base-1", SIM_NOW)).toEqual({ created: 0 });

    const limited = makeService({ catalogTemplates: [TEMPLATE_A] });
    const created = await limited.service.ensureOrders(tx, "base-1", SIM_NOW);
    expect(created).toEqual({ created: 1 });
    const again = await limited.service.ensureOrders(tx, "base-1", SIM_NOW);
    expect(again).toEqual({ created: 0 }); // 模板 A 已有 open，不再重复
  });

  it("接单后不补同模板，交付后按基地 simTime 等满 24 小时", async () => {
    const { service, store } = makeService();
    await service.ensureOrders(tx, "base-1", SIM_NOW);
    const order = [...store.orders.values()].find((entry) => entry.orderDefId === TEMPLATE_A.ref.stableId)!;
    order.status = "accepted";
    expect(await service.ensureOrders(tx, "base-1", SIM_NOW)).toEqual({ created: 0 });

    order.status = "delivered";
    order.resolvedAt = SIM_NOW;
    expect(await service.ensureOrders(tx, "base-1", new Date(SIM_NOW.getTime() + 23 * 3_600_000))).toEqual({ created: 0 });
    expect(await service.ensureOrders(tx, "base-1", new Date(SIM_NOW.getTime() + 24 * 3_600_000))).toEqual({ created: 1 });
    expect([...store.orders.values()].filter((entry) => entry.orderDefId === TEMPLATE_A.ref.stableId)).toHaveLength(2);
  });

  it("历史结案订单缺 resolvedAt 时不自动补单", async () => {
    const { service, store } = makeService({ catalogTemplates: [TEMPLATE_A] });
    const orderId = await seedOpenOrder(store, TEMPLATE_A);
    const order = store.orders.get(orderId)!;
    order.status = "failed";
    order.resolvedAt = null;
    expect(await service.ensureOrders(tx, "base-1", new Date(SIM_NOW.getTime() + 10 * 24 * 3_600_000))).toEqual({ created: 0 });
  });
});
