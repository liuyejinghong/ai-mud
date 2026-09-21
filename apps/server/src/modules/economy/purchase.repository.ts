import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { baseInventory, basePurchases, bases } from "../../db/schema.js";
import type { EconomyTx } from "./order.repository.js";

// M16-B 采购持久层 + economy 账款访问面（m16-p-contract.md §1/§3；台账登记为 economy 模块）。
// base_purchases 表 economy 唯一写者；透传模式同 manufacturing.repository：所有方法必须在
// 调用方事务内执行，本类永不开启或提交事务。
//
// bases.credits 账款访问面（M16-P §1：credits 唯一写者 = economy，经用例）：credits 的
// 读（getCredits）、条件扣减（debitBaseCreditsIfAvailable）、奖励入账（creditBaseCredits）
// 集中在本文件单一写口——订单交付的 reward 入账也经 OrderCreditsPort 结构端口由
// composition 绑定到本类，保证 bases.credits 在 economy 内只有一个写文件。
//
// M16-P 裁决（BOUNDARY-03 采购物流简化）：到货入库的 base_inventory upsert 写路径由
// economy 持有（付款≠到货，到货由基地 tick 统一结算，无独立运输设备占用）。

export type PurchaseStatus = "in_transit" | "delivered";

export interface BasePurchaseRecord {
  id: string;
  baseId: string;
  itemId: string;
  quantity: number;
  costCredits: number;
  status: PurchaseStatus;
  arrivesAtSim: Date;
  createdAt: Date;
}

function toRecord(row: {
  id: string;
  baseId: string;
  itemId: string;
  quantity: number;
  costCredits: number;
  status: string;
  arrivesAtSim: Date;
  createdAt: Date;
}): BasePurchaseRecord {
  return {
    id: row.id,
    baseId: row.baseId,
    itemId: row.itemId,
    quantity: row.quantity,
    costCredits: row.costCredits,
    status: row.status as PurchaseStatus,
    arrivesAtSim: row.arrivesAtSim,
    createdAt: row.createdAt
  };
}

const PURCHASE_COLUMNS = {
  id: basePurchases.id,
  baseId: basePurchases.baseId,
  itemId: basePurchases.itemId,
  quantity: basePurchases.quantity,
  costCredits: basePurchases.costCredits,
  status: basePurchases.status,
  arrivesAtSim: basePurchases.arrivesAtSim,
  createdAt: basePurchases.createdAt
};

export class PurchaseRepository {
  constructor(private readonly db: EconomyTx) {}

  // ---------- bases.credits 账款访问面（economy 唯一写口，见文件头） ----------

  async getCredits(tx: EconomyTx, baseId: string): Promise<number | null> {
    const [row] = await tx
      .select({ credits: bases.credits })
      .from(bases)
      .where(eq(bases.id, baseId))
      .limit(1);
    return row?.credits ?? null;
  }

  // 条件扣减：credits >= cost 才扣（RETURNING 判定），DB 侧 bases_credits_nonnegative_check
  // 兜底非负约束；不足返回 false，不产生任何写入。
  async debitBaseCreditsIfAvailable(tx: EconomyTx, baseId: string, amount: number): Promise<boolean> {
    const rows = await tx
      .update(bases)
      .set({ credits: sql`${bases.credits} - ${amount}` })
      .where(and(eq(bases.id, baseId), sql`${bases.credits} >= ${amount}`))
      .returning({ id: bases.id });
    return rows.length > 0;
  }

  // 奖励入账：amount 恒为正，非负约束天然满足；base 行由世界模块持有，本写口不改其它列。
  async creditBaseCredits(tx: EconomyTx, baseId: string, amount: number): Promise<void> {
    await tx
      .update(bases)
      .set({ credits: sql`${bases.credits} + ${amount}` })
      .where(eq(bases.id, baseId));
  }

  // ---------- 采购命令面（purchase.service 消费） ----------

  async insertPurchaseInTransit(
    tx: EconomyTx,
    input: {
      baseId: string;
      itemId: string;
      quantity: number;
      costCredits: number;
      arrivesAtSim: Date;
    }
  ): Promise<{ purchaseId: string }> {
    const inserted = await tx
      .insert(basePurchases)
      .values({
        baseId: input.baseId,
        itemId: input.itemId,
        quantity: input.quantity,
        costCredits: input.costCredits,
        status: "in_transit",
        arrivesAtSim: input.arrivesAtSim
      })
      .returning({ id: basePurchases.id });
    const row = inserted[0];
    if (!row) throw new Error("base_purchases insert returned no row");
    return { purchaseId: row.id };
  }

  // ---------- 到货结算面（tick 消费） ----------

  async listArrivedInTransit(tx: EconomyTx, baseId: string, sim: Date): Promise<BasePurchaseRecord[]> {
    const rows = await tx
      .select(PURCHASE_COLUMNS)
      .from(basePurchases)
      .where(
        and(
          eq(basePurchases.baseId, baseId),
          eq(basePurchases.status, "in_transit"),
          lte(basePurchases.arrivesAtSim, sim)
        )
      )
      .orderBy(asc(basePurchases.createdAt), asc(basePurchases.id));
    return rows.map(toRecord);
  }

  async markPurchaseDelivered(tx: EconomyTx, purchaseId: string): Promise<void> {
    await tx
      .update(basePurchases)
      .set({ status: "delivered" })
      .where(and(eq(basePurchases.id, purchaseId), eq(basePurchases.status, "in_transit")));
  }

  // ---------- base_inventory 到货入库写路径（M16-P BOUNDARY-03，见文件头） ----------

  // creditBaseInventory 风格 upsert：(base_id, item_id) 唯一，冲突则数量累加。
  async creditBaseInventoryFromPurchase(
    tx: EconomyTx,
    baseId: string,
    itemId: string,
    quantity: number
  ): Promise<void> {
    await tx
      .insert(baseInventory)
      .values({ baseId, itemId, quantity, reservedQuantity: 0 })
      .onConflictDoUpdate({
        target: [baseInventory.baseId, baseInventory.itemId],
        set: { quantity: sql`${baseInventory.quantity} + ${quantity}`, updatedAt: new Date() }
      });
  }

  // ---------- 快照读面（供 I 的 BaseService / GET /base/snapshot 扩展） ----------

  async listPurchasesForBase(tx: EconomyTx, baseId: string): Promise<BasePurchaseRecord[]> {
    const rows = await tx
      .select(PURCHASE_COLUMNS)
      .from(basePurchases)
      .where(eq(basePurchases.baseId, baseId))
      .orderBy(desc(basePurchases.createdAt), desc(basePurchases.id));
    return rows.map(toRecord);
  }
}
