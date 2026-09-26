// R1 industry：base_production_slots 唯一写者。加工槽是建成设施的运行状态，
// 创建槽与设施完成同事务（facility-effects 调 insertSlots）；本仓库不重复维护
// 设施建成事实。必须在调用方事务内执行。
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { baseProductionSlots } from "../../db/schema.js";

export type ProductionSlotTx = Pick<Db, "delete" | "insert" | "select" | "update">;

export interface ProductionSlotRecord {
  id: string;
  baseId: string;
  siteId: string;
  slotIndex: number;
  batchesSinceMaintenance: number;
  maintenanceBlocked: boolean;
}

export class ProductionSlotRepository {
  constructor(private readonly db: ProductionSlotTx) {}

  async insertSlots(
    tx: ProductionSlotTx,
    baseId: string,
    siteId: string,
    count: number
  ): Promise<void> {
    if (count <= 0) return;
    // 幂等：该站点已有槽行时按 (site_id, slot_index) 冲突跳过，重复完工不重复建槽。
    await tx
      .insert(baseProductionSlots)
      .values(
        Array.from({ length: count }, (_, index) => ({
          baseId,
          siteId,
          slotIndex: index
        }))
      )
      .onConflictDoNothing({
        target: [baseProductionSlots.baseId, baseProductionSlots.siteId, baseProductionSlots.slotIndex]
      });
  }

  async listForBase(tx: ProductionSlotTx, baseId: string): Promise<ProductionSlotRecord[]> {
    const rows = await tx
      .select()
      .from(baseProductionSlots)
      .where(eq(baseProductionSlots.baseId, baseId))
      .orderBy(asc(baseProductionSlots.siteId), asc(baseProductionSlots.slotIndex));
    return rows.map((row) => ({
      id: row.id,
      baseId: row.baseId,
      siteId: row.siteId,
      slotIndex: row.slotIndex,
      batchesSinceMaintenance: row.batchesSinceMaintenance,
      maintenanceBlocked: row.maintenanceBlocked
    }));
  }

  async listForSite(
    tx: ProductionSlotTx,
    baseId: string,
    siteId: string
  ): Promise<ProductionSlotRecord[]> {
    const rows = await tx
      .select()
      .from(baseProductionSlots)
      .where(and(eq(baseProductionSlots.baseId, baseId), eq(baseProductionSlots.siteId, siteId)))
      .orderBy(asc(baseProductionSlots.slotIndex));
    return rows.map((row) => ({
      id: row.id,
      baseId: row.baseId,
      siteId: row.siteId,
      slotIndex: row.slotIndex,
      batchesSinceMaintenance: row.batchesSinceMaintenance,
      maintenanceBlocked: row.maintenanceBlocked
    }));
  }

  async findSlot(
    tx: ProductionSlotTx,
    baseId: string,
    slotId: string
  ): Promise<ProductionSlotRecord | null> {
    const [row] = await tx
      .select()
      .from(baseProductionSlots)
      .where(and(eq(baseProductionSlots.baseId, baseId), eq(baseProductionSlots.id, slotId)))
      .limit(1);
    return row ?? null;
  }

  async saveSlot(
    tx: ProductionSlotTx,
    patch: {
      slotId: string;
      batchesSinceMaintenance?: number;
      maintenanceBlocked?: boolean;
    }
  ): Promise<void> {
    await tx
      .update(baseProductionSlots)
      .set({
        batchesSinceMaintenance: patch.batchesSinceMaintenance ?? sql`${baseProductionSlots.batchesSinceMaintenance}`,
        maintenanceBlocked: patch.maintenanceBlocked ?? sql`${baseProductionSlots.maintenanceBlocked}`,
        updatedAt: new Date()
      })
      .where(eq(baseProductionSlots.id, patch.slotId));
  }

  async countSlotsForSite(tx: ProductionSlotTx, siteId: string): Promise<number> {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(baseProductionSlots)
      .where(eq(baseProductionSlots.siteId, siteId));
    return row?.count ?? 0;
  }
}
