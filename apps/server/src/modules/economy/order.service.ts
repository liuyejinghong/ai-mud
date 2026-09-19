// M16-A 订单接单/交付/刷新业务（m16-p-contract.md §1/§3）。
// 接单（同事务）：订单行 FOR UPDATE，归属 + status==='open' 校验（否则 CONFLICT）
//   → accepted（acceptedAtSim=基地 simTime，deadlineSim=sim+deadlineSimHours，模板经
//   catalog 端口 getOrderTemplate 提供）→ 回执落结果 {orderId, duplicate:false}；
//   重放一致 → 原结果（duplicate:true），不一致 → IDEMPOTENCY_CONFLICT。
// 交付（同事务）：锁定订单行 → accepted 且 deadlineSim>=sim 校验（过期先标 failed 再抛
//   REQUIREMENTS_NOT_MET）→ 库存条件扣减（真消耗；不足 RESOURCE_INSUFFICIENT）
//   → credits += reward → delivered → saveReceiptResult。
// 回据：actorScope=base:{baseId}，kind=base.acceptOrder / base.deliverOrder。
// 一切失败发生在 claim 回据之后：调用方 db.transaction 捕获异常整体回滚（含 claim），
// 失败不残留收据、不产生任何部分提交（同 manufacturing.service 模式）。
// 事实只经端口写：world（账号→基地/基地时钟）、catalog（订单模板）、economy 持久面
// （订单行/base_inventory 消耗）、credits 账款面、application 收据端口由 composition
// 以 (tx) => AssetMutationService(tx) 形式注入。
import type { OrderTemplateDto } from "@ai-mud/shared";
import {
  hashRequest,
  type AssetMutationPort,
  type CommandReceipt
} from "../ledger/asset-mutation.service.js";
import type { BaseOrderRecord, EconomyTx } from "./order.repository.js";
import { BaseOperationError } from "../industry/construction.service.js";

// transport（base-economy.routes）仅可 import application，错误经 application/economy
// 薄用例再导出，与 construction→create-project.ts 同模式。
export { BaseOperationError };
export type { EconomyTx };

// ---------- 结构端口（composition 绑定；不 import application/base/ports.ts） ----------

export interface EconomyLookupPort {
  findBaseIdByAccount(tx: EconomyTx, accountId: string): Promise<string | null>;
}

// 基地时钟读口：命令时间取基地独立 simTime（与墙钟分离；前端轮询不决定收益）。
// 结构镜像 BaseRepository.getBaseForUpdate（顺带行锁，串行化账款与时钟推进）。
export interface EconomyClockPort {
  getBaseForUpdate(tx: EconomyTx, baseId: string): Promise<{ simTime: Date } | null>;
}

// catalog 订单模板端口（结构镜像）：M16-A/B 不接 content-catalog（该文件不在本线
// 白名单），占位实现恒 null/[]；I 合并 release payload 的 order_templates 时注入真实现。
export interface EconomyCatalogPort {
  getOrderTemplate(stableId: string): OrderTemplateDto | null;
  listOrderTemplates(): OrderTemplateDto[];
}

// base_inventory 交付消耗写口（economy OrderRepository 实现；见 order.repository 文件头裁决注释）。
export interface EconomyInventoryPort {
  consumeBaseInventoryIfAvailable(
    tx: EconomyTx,
    baseId: string,
    itemId: string,
    quantity: number
  ): Promise<boolean>;
}

// bases.credits 奖励入账写口（economy PurchaseRepository 实现，账款访问面集中在该文件）。
export interface OrderCreditsPort {
  creditBaseCredits(tx: EconomyTx, baseId: string, amount: number): Promise<void>;
}

export interface OrderStore {
  findOrderForUpdate(
    tx: EconomyTx,
    baseId: string,
    orderId: string
  ): Promise<BaseOrderRecord | null>;
  saveOrderAccepted(tx: EconomyTx, orderId: string, acceptedAtSim: Date, deadlineSim: Date): Promise<void>;
  saveOrderDelivered(tx: EconomyTx, orderId: string, resolvedAtSim: Date): Promise<void>;
  saveOrderFailed(tx: EconomyTx, orderId: string, resolvedAtSim: Date): Promise<void>;
  countOpenOrders(tx: EconomyTx, baseId: string): Promise<number>;
  listOpenOrderDefIds(tx: EconomyTx, baseId: string): Promise<string[]>;
  insertOpenOrder(tx: EconomyTx, baseId: string, template: OrderTemplateDto): Promise<{ orderId: string }>;
}

export type EconomyReceiptsPort = Pick<
  AssetMutationPort,
  "findReceiptForUpdate" | "claimReceipt" | "saveReceiptResult"
>;

export interface OrderServiceDeps {
  lookup: EconomyLookupPort;
  clock: EconomyClockPort;
  catalog: EconomyCatalogPort;
  assets: EconomyInventoryPort;
  store: OrderStore;
  credits: OrderCreditsPort;
  // 生产绑定：(tx) => new AssetMutationService(tx)。测试注入内存替身。
  receipts: (tx: EconomyTx) => EconomyReceiptsPort;
}

export interface EconomyPrincipal {
  accountId: string;
}

const ACCEPT_COMMAND_KIND = "base.acceptOrder";
const DELIVER_COMMAND_KIND = "base.deliverOrder";

// 开单上限（M16-P §4 fixture：每基地补足至 3 个 open；简化为 tick 内每次补足）。
export const ORDER_OPEN_TARGET = 3;

const SIM_MS_PER_HOUR = 3_600_000;

export function addSimHours(from: Date, hours: number): Date {
  return new Date(from.getTime() + hours * SIM_MS_PER_HOUR);
}

export interface AcceptOrderResultPayload {
  orderId: string;
  duplicate: boolean;
}

export interface DeliverOrderResultPayload {
  orderId: string;
  rewardCredits: number;
  duplicate: boolean;
}

export interface EnsureOrdersResult {
  created: number;
}

function isAcceptResultPayload(value: unknown): value is AcceptOrderResultPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AcceptOrderResultPayload).orderId === "string" &&
    typeof (value as AcceptOrderResultPayload).duplicate === "boolean"
  );
}

function isDeliverResultPayload(value: unknown): value is DeliverOrderResultPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as DeliverOrderResultPayload).orderId === "string" &&
    typeof (value as DeliverOrderResultPayload).rewardCredits === "number" &&
    typeof (value as DeliverOrderResultPayload).duplicate === "boolean"
  );
}

export class OrderService {
  constructor(private readonly deps: OrderServiceDeps) {}

  async acceptOrder(
    tx: EconomyTx,
    principal: EconomyPrincipal,
    input: { orderId: string; commandId: string }
  ): Promise<AcceptOrderResultPayload> {
    const baseId = await this.requireBaseId(tx, principal);
    const actorScope = `base:${baseId}`;
    const requestHash = hashRequest({ orderId: input.orderId });
    const receipts = this.deps.receipts(tx);

    const existing = await receipts.findReceiptForUpdate(actorScope, ACCEPT_COMMAND_KIND, input.commandId);
    if (existing) return this.replayAccept(existing, requestHash);

    const claimed = await receipts.claimReceipt({
      actorScope,
      commandKind: ACCEPT_COMMAND_KIND,
      commandId: input.commandId,
      requestHash
    });
    if (!claimed) {
      const raced = await receipts.findReceiptForUpdate(actorScope, ACCEPT_COMMAND_KIND, input.commandId);
      if (raced) return this.replayAccept(raced, requestHash);
      throw new BaseOperationError(409, "CONFLICT", "命令幂等登记冲突，请重试。");
    }

    // 基地行锁：命令时间取基地 simTime（独立基地时钟，与墙钟分离）。
    const base = await this.requireBase(tx, baseId);
    const sim = base.simTime;

    const order = await this.deps.store.findOrderForUpdate(tx, baseId, input.orderId);
    if (!order || order.status !== "open") {
      // 不存在/他基地/非 open 一律 CONFLICT（合同 §3：归属 + status 校验）。
      throw new BaseOperationError(409, "CONFLICT", "订单不存在、不属于该基地或不可接单。");
    }

    // deadline 从订单定义取（模板由 catalog 端口提供）。定义缺失 → CONTENT_INCOMPATIBLE；
    // 修订漂移刻意容忍（在途 open 行不因内容停用而失败，deadline 取当前定义）。
    const template = this.deps.catalog.getOrderTemplate(order.orderDefId);
    if (!template) {
      throw new BaseOperationError(409, "CONTENT_INCOMPATIBLE", "订单定义不存在或已下线。");
    }

    await this.deps.store.saveOrderAccepted(tx, order.id, sim, addSimHours(sim, template.deadlineSimHours));

    const result: AcceptOrderResultPayload = { orderId: order.id, duplicate: false };
    await receipts.saveReceiptResult({
      actorScope,
      commandKind: ACCEPT_COMMAND_KIND,
      commandId: input.commandId,
      result
    });
    return result;
  }

  async deliverOrder(
    tx: EconomyTx,
    principal: EconomyPrincipal,
    input: { orderId: string; commandId: string }
  ): Promise<DeliverOrderResultPayload> {
    const baseId = await this.requireBaseId(tx, principal);
    const actorScope = `base:${baseId}`;
    const requestHash = hashRequest({ orderId: input.orderId });
    const receipts = this.deps.receipts(tx);

    const existing = await receipts.findReceiptForUpdate(actorScope, DELIVER_COMMAND_KIND, input.commandId);
    if (existing) return this.replayDeliver(existing, requestHash);

    const claimed = await receipts.claimReceipt({
      actorScope,
      commandKind: DELIVER_COMMAND_KIND,
      commandId: input.commandId,
      requestHash
    });
    if (!claimed) {
      const raced = await receipts.findReceiptForUpdate(actorScope, DELIVER_COMMAND_KIND, input.commandId);
      if (raced) return this.replayDeliver(raced, requestHash);
      throw new BaseOperationError(409, "CONFLICT", "命令幂等登记冲突，请重试。");
    }

    const base = await this.requireBase(tx, baseId);
    const sim = base.simTime;

    const order = await this.deps.store.findOrderForUpdate(tx, baseId, input.orderId);
    if (!order || order.status !== "accepted") {
      throw new BaseOperationError(409, "CONFLICT", "订单不存在、不属于该基地或不在交付状态。");
    }

    // 过期：accepted 且 deadlineSim<sim → 先标 failed（材料不退、账款不变）再抛。
    // deadlineSim 缺失的 accepted 行按数据异常同样走 failed（防御，不静默放行）。
    if (!order.deadlineSim || order.deadlineSim.getTime() < sim.getTime()) {
      await this.deps.store.saveOrderFailed(tx, order.id, sim);
      throw new BaseOperationError(409, "REQUIREMENTS_NOT_MET", "订单已超过交付期限，判定失败。");
    }

    // 交付真消耗（非预留）：条件扣减不足 → RESOURCE_INSUFFICIENT，后续加钱/落状态
    // 尚未发生，调用方事务回滚（含收据 claim），无部分提交。
    const consumed = await this.deps.assets.consumeBaseInventoryIfAvailable(
      tx,
      baseId,
      order.requiredItemId,
      order.quantity
    );
    if (!consumed) {
      throw new BaseOperationError(409, "RESOURCE_INSUFFICIENT", "库存不足，无法交付订单。");
    }

    await this.deps.credits.creditBaseCredits(tx, baseId, order.rewardCredits);
    await this.deps.store.saveOrderDelivered(tx, order.id, sim);

    const result: DeliverOrderResultPayload = {
      orderId: order.id,
      rewardCredits: order.rewardCredits,
      duplicate: false
    };
    await receipts.saveReceiptResult({
      actorScope,
      commandKind: DELIVER_COMMAND_KIND,
      commandId: input.commandId,
      result
    });
    return result;
  }

  // 订单刷新（tick 消费，合同 §4：简化为每次补足至 3 个 open）。按 catalog
  // listOrderTemplates 顺序补足，每模板同一基地同时最多一个 open。sim 参数为
  // 刷新节流预留位（M16-P 冻结为立即补足，当前无刷新时间戳列）。
  async ensureOrders(tx: EconomyTx, baseId: string, sim: Date): Promise<EnsureOrdersResult> {
    void sim;
    const openCount = await this.deps.store.countOpenOrders(tx, baseId);
    if (openCount >= ORDER_OPEN_TARGET) return { created: 0 };

    const openDefIds = new Set(await this.deps.store.listOpenOrderDefIds(tx, baseId));
    let created = 0;
    for (const template of this.deps.catalog.listOrderTemplates()) {
      if (openCount + created >= ORDER_OPEN_TARGET) break;
      if (openDefIds.has(template.ref.stableId)) continue;
      await this.deps.store.insertOpenOrder(tx, baseId, template);
      created += 1;
    }
    return { created };
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
  private replayAccept(receipt: CommandReceipt, requestHash: string): AcceptOrderResultPayload {
    if (receipt.requestHash !== requestHash) {
      throw new BaseOperationError(409, "IDEMPOTENCY_CONFLICT", "相同命令 ID 但请求不一致。");
    }
    if (!isAcceptResultPayload(receipt.result)) {
      throw new BaseOperationError(409, "IDEMPOTENCY_CONFLICT", "接单命令收据损坏。");
    }
    return { orderId: receipt.result.orderId, duplicate: true };
  }

  private replayDeliver(receipt: CommandReceipt, requestHash: string): DeliverOrderResultPayload {
    if (receipt.requestHash !== requestHash) {
      throw new BaseOperationError(409, "IDEMPOTENCY_CONFLICT", "相同命令 ID 但请求不一致。");
    }
    if (!isDeliverResultPayload(receipt.result)) {
      throw new BaseOperationError(409, "IDEMPOTENCY_CONFLICT", "交付命令收据损坏。");
    }
    return { ...receipt.result, duplicate: true };
  }
}
