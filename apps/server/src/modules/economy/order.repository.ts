import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { OrderStatus, OrderTemplateDto } from "@ai-mud/shared";
import type { Db } from "../../db/client.js";
import { baseInventory, baseOrders } from "../../db/schema.js";

// M16-A 订单持久层（m16-p-contract.md §1/§3；台账登记为 economy 模块）。
// base_orders 表 economy 唯一写者；透传模式同 manufacturing.repository：构造函数收
// Db 或 tx，所有方法必须在调用方事务内执行，本类永不开启或提交事务。
//
// M16-P 裁决（账款/库存操作经端口）：本文件同时持有 base_inventory 的「交付真消耗」
// 条件写路径 consumeBaseInventoryIfAvailable——交付是非预留的全额消耗，assets 模块的
// reserve/consume-reserved 语义不适用；该写路径由 M16-P 归入 economy（合同 §3）。
// bases.credits 的写路径不在本文件（集中见 purchase.repository 账款访问面注释）。

export type EconomyTx = Pick<Db, "delete" | "insert" | "select" | "update">;

export interface BaseOrderRecord {
  id: string;
  baseId: string;
  orderDefId: string;
  orderRevision: number;
  status: OrderStatus;
  requiredItemId: string;
  quantity: number;
  rewardCredits: number;
  deadlineSim: Date | null;
  acceptedAtSim: Date | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

function toRecord(row: {
  id: string;
  baseId: string;
  orderDefId: string;
  orderRevision: number;
  status: string;
  requiredItemId: string;
  quantity: number;
  rewardCredits: number;
  deadlineSim: Date | null;
  acceptedAtSim: Date | null;
  createdAt: Date;
  resolvedAt: Date | null;
}): BaseOrderRecord {
  return {
    id: row.id,
    baseId: row.baseId,
    orderDefId: row.orderDefId,
    orderRevision: row.orderRevision,
    status: row.status as OrderStatus,
    requiredItemId: row.requiredItemId,
    quantity: row.quantity,
    rewardCredits: row.rewardCredits,
    deadlineSim: row.deadlineSim,
    acceptedAtSim: row.acceptedAtSim,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt
  };
}

export class OrderRepository {
  constructor(private readonly db: EconomyTx) {}

  // ---------- 订单命令面（order.service 消费） ----------

  // FOR UPDATE：并发同订单事务在此阻塞，防止同一订单行被双重接单/交付。
  async findOrderForUpdate(tx: EconomyTx, baseId: string, orderId: string): Promise<BaseOrderRecord | null> {
    const [row] = await tx
      .select({
        id: baseOrders.id,
        baseId: baseOrders.baseId,
        orderDefId: baseOrders.orderDefId,
        orderRevision: baseOrders.orderRevision,
        status: baseOrders.status,
        requiredItemId: baseOrders.requiredItemId,
        quantity: baseOrders.quantity,
        rewardCredits: baseOrders.rewardCredits,
        deadlineSim: baseOrders.deadlineSim,
        acceptedAtSim: baseOrders.acceptedAtSim,
        createdAt: baseOrders.createdAt,
        resolvedAt: baseOrders.resolvedAt
      })
      .from(baseOrders)
      .where(and(eq(baseOrders.baseId, baseId), eq(baseOrders.id, orderId)))
      .limit(1)
      .for("update");
    return row ? toRecord(row) : null;
  }

  async saveOrderAccepted(
    tx: EconomyTx,
    orderId: string,
    acceptedAtSim: Date,
    deadlineSim: Date
  ): Promise<void> {
    await tx
      .update(baseOrders)
      .set({ status: "accepted", acceptedAtSim, deadlineSim })
      .where(eq(baseOrders.id, orderId));
  }

  async saveOrderDelivered(tx: EconomyTx, orderId: string, resolvedAtSim: Date): Promise<void> {
    await tx
      .update(baseOrders)
      .set({ status: "delivered", resolvedAt: resolvedAtSim })
      .where(eq(baseOrders.id, orderId));
  }

  async saveOrderFailed(tx: EconomyTx, orderId: string, resolvedAtSim: Date): Promise<void> {
    await tx
      .update(baseOrders)
      .set({ status: "failed", resolvedAt: resolvedAtSim })
      .where(eq(baseOrders.id, orderId));
  }

  // ---------- 订单刷新面（tick 消费） ----------

  // 超时失败（合同 §1）：accepted 且 deadlineSim<sim → failed；材料不退、账款不变。
  async markExpiredOrders(tx: EconomyTx, baseId: string, sim: Date): Promise<number> {
    const rows = await tx
      .update(baseOrders)
      .set({ status: "failed", resolvedAt: sim })
      .where(
        and(
          eq(baseOrders.baseId, baseId),
          eq(baseOrders.status, "accepted"),
          lt(baseOrders.deadlineSim, sim)
        )
      )
      .returning({ id: baseOrders.id });
    return rows.length;
  }

  async countOpenOrders(tx: EconomyTx, baseId: string): Promise<number> {
    const [row] = await tx
      .select({ value: sql<number>`count(*)::int` })
      .from(baseOrders)
      .where(and(eq(baseOrders.baseId, baseId), eq(baseOrders.status, "open")));
    return row?.value ?? 0;
  }

  // 每模板同一基地同时最多一个 open（合同 §4）。
  async listOpenOrderDefIds(tx: EconomyTx, baseId: string): Promise<string[]> {
    const rows = await tx
      .select({ orderDefId: baseOrders.orderDefId })
      .from(baseOrders)
      .where(and(eq(baseOrders.baseId, baseId), eq(baseOrders.status, "open")));
    return rows.map((row) => row.orderDefId);
  }

  // 按订单模板开 open 行：运行实例固定开工修订（orderDefId + orderRevision），不静默升级。
  async insertOpenOrder(
    tx: EconomyTx,
    baseId: string,
    template: OrderTemplateDto
  ): Promise<{ orderId: string }> {
    const inserted = await tx
      .insert(baseOrders)
      .values({
        baseId,
        orderDefId: template.ref.stableId,
        orderRevision: template.ref.revision,
        status: "open",
        requiredItemId: template.requiredItemId,
        quantity: template.quantity,
        rewardCredits: template.rewardCredits
      })
      .returning({ id: baseOrders.id });
    const row = inserted[0];
    if (!row) throw new Error("base_orders insert returned no row");
    return { orderId: row.id };
  }

  // ---------- 快照读面（供 I 的 BaseService / GET /base/snapshot 扩展） ----------

  async listOrdersForBase(tx: EconomyTx, baseId: string): Promise<BaseOrderRecord[]> {
    const rows = await tx
      .select({
        id: baseOrders.id,
        baseId: baseOrders.baseId,
        orderDefId: baseOrders.orderDefId,
        orderRevision: baseOrders.orderRevision,
        status: baseOrders.status,
        requiredItemId: baseOrders.requiredItemId,
        quantity: baseOrders.quantity,
        rewardCredits: baseOrders.rewardCredits,
        deadlineSim: baseOrders.deadlineSim,
        acceptedAtSim: baseOrders.acceptedAtSim,
        createdAt: baseOrders.createdAt,
        resolvedAt: baseOrders.resolvedAt
      })
      .from(baseOrders)
      .where(eq(baseOrders.baseId, baseId))
      .orderBy(desc(baseOrders.createdAt), desc(baseOrders.id));
    return rows.map(toRecord);
  }

  // ---------- base_inventory 交付消耗写路径（M16-P 裁决，见文件头） ----------

  // 条件 UPDATE quantity >= qty → 数量减：不足返回 false 不产生任何写入（真消耗，
  // 不动 reserved_quantity——交付消耗的是自有可用库存，与预留管线无关）。
  async consumeBaseInventoryIfAvailable(
    tx: EconomyTx,
    baseId: string,
    itemId: string,
    quantity: number
  ): Promise<boolean> {
    const rows = await tx
      .update(baseInventory)
      .set({
        quantity: sql`${baseInventory.quantity} - ${quantity}`,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(baseInventory.baseId, baseId),
          eq(baseInventory.itemId, itemId),
          sql`${baseInventory.quantity} >= ${quantity}`
        )
      )
      .returning({ id: baseInventory.id });
    return rows.length > 0;
  }
}
