import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { baseDevices, baseInventory } from "../../db/schema.js";

// assets 是 base_inventory（物料，含预留）与 base_devices（设备资产）的唯一写者
// （contracts.md §6）。所有方法必须在调用方事务内执行，本服务永不开/提交事务。
// 结构等价镜像 application/base/ports.ts 的 BaseAssetPort（assets 不依赖 application）。

export type BaseAssetTx = Pick<Db, "delete" | "insert" | "select" | "update">;

export class BaseAssetService {
  constructor(private readonly db: BaseAssetTx) {}

  async creditBaseInventory(
    tx: BaseAssetTx,
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

  // 预留 ≠ 消耗：可用量 = quantity - reserved_quantity；条件更新保证不超卖。
  async reserveBaseInventoryIfAvailable(
    tx: BaseAssetTx,
    baseId: string,
    itemId: string,
    quantity: number
  ): Promise<boolean> {
    const rows = await tx
      .update(baseInventory)
      .set({ reservedQuantity: sql`${baseInventory.reservedQuantity} + ${quantity}` })
      .where(
        and(
          eq(baseInventory.baseId, baseId),
          eq(baseInventory.itemId, itemId),
          sql`${baseInventory.quantity} - ${baseInventory.reservedQuantity} >= ${quantity}`
        )
      )
      .returning({ id: baseInventory.id });
    return rows.length > 0;
  }

  async consumeReservedBaseInventory(
    tx: BaseAssetTx,
    baseId: string,
    itemId: string,
    quantity: number
  ): Promise<void> {
    await tx
      .update(baseInventory)
      .set({
        quantity: sql`${baseInventory.quantity} - ${quantity}`,
        reservedQuantity: sql`${baseInventory.reservedQuantity} - ${quantity}`,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(baseInventory.baseId, baseId),
          eq(baseInventory.itemId, itemId),
          sql`${baseInventory.reservedQuantity} >= ${quantity}`
        )
      );
  }

  async releaseReservedBaseInventory(
    tx: BaseAssetTx,
    baseId: string,
    itemId: string,
    quantity: number
  ): Promise<void> {
    await tx
      .update(baseInventory)
      .set({ reservedQuantity: sql`${baseInventory.reservedQuantity} - ${quantity}` })
      .where(
        and(
          eq(baseInventory.baseId, baseId),
          eq(baseInventory.itemId, itemId),
          sql`${baseInventory.reservedQuantity} >= ${quantity}`
        )
      );
  }

  async listBaseInventory(
    tx: BaseAssetTx,
    baseId: string
  ): Promise<Array<{ itemId: string; quantity: number; reservedQuantity: number }>> {
    return tx
      .select({
        itemId: baseInventory.itemId,
        quantity: baseInventory.quantity,
        reservedQuantity: baseInventory.reservedQuantity
      })
      .from(baseInventory)
      .where(eq(baseInventory.baseId, baseId));
  }

  async createDeviceAsset(
    tx: BaseAssetTx,
    input: {
      baseId: string;
      deviceDefId: string;
      templateRevision: number;
      sourceOperation: string;
    }
  ): Promise<{ deviceId: string }> {
    const [row] = await tx
      .insert(baseDevices)
      .values({
        baseId: input.baseId,
        deviceDefId: input.deviceDefId,
        templateRevision: input.templateRevision,
        sourceOperation: input.sourceOperation
      })
      .onConflictDoNothing({
        target: [baseDevices.sourceOperation, baseDevices.deviceDefId]
      })
      .returning({ id: baseDevices.id });
    if (row) {
      return { deviceId: row.id };
    }
    const existing = await this.findDeviceAssetBySourceOperation(tx, {
      sourceOperation: input.sourceOperation,
      deviceDefId: input.deviceDefId
    });
    if (!existing) {
      throw new Error("base_devices insert conflicted but no existing device found");
    }
    return existing;
  }

  async findDeviceAssetBySourceOperation(
    tx: BaseAssetTx,
    input: { sourceOperation: string; deviceDefId: string }
  ): Promise<{ deviceId: string } | null> {
    const rows = await tx
      .select({ id: baseDevices.id })
      .from(baseDevices)
      .where(
        and(
          eq(baseDevices.sourceOperation, input.sourceOperation),
          eq(baseDevices.deviceDefId, input.deviceDefId)
        )
      )
      .limit(1);
    return rows.length > 0 ? { deviceId: rows[0]!.id } : null;
  }
}
