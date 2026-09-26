// R1 world 子域：base_resource_nodes 唯一写者（03-domain-contracts.md §1/§3）。
// 节点事实（存在/矿量/预留/揭示）归 world；industry 的采矿单只经本仓库端口动矿量，
// 不直接写本表。所有方法必须在调用方事务内执行，本类永不开启或提交事务。
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { baseResourceNodes } from "../../db/schema.js";

export type ResourceNodeTx = Pick<Db, "delete" | "insert" | "select" | "update">;

export interface ResourceNodeRecord {
  id: string;
  baseId: string;
  nodeKey: string;
  name: string;
  itemId: string;
  discovered: boolean;
  remainingQuantity: number;
  reservedQuantity: number;
}

export interface ResourceNodeSeedInput {
  baseId: string;
  nodeKey: string;
  name: string;
  itemId: string;
  initialQuantity: number;
}

export class ResourceNodeRepository {
  constructor(private readonly db: ResourceNodeTx) {}

  async insertNode(tx: ResourceNodeTx, input: ResourceNodeSeedInput): Promise<void> {
    await tx
      .insert(baseResourceNodes)
      .values({
        baseId: input.baseId,
        nodeKey: input.nodeKey,
        name: input.name,
        itemId: input.itemId,
        discovered: false,
        remainingQuantity: input.initialQuantity,
        reservedQuantity: 0
      })
      .onConflictDoNothing({ target: [baseResourceNodes.baseId, baseResourceNodes.nodeKey] });
  }

  async listForBase(tx: ResourceNodeTx, baseId: string): Promise<ResourceNodeRecord[]> {
    const rows = await tx
      .select()
      .from(baseResourceNodes)
      .where(eq(baseResourceNodes.baseId, baseId))
      .orderBy(asc(baseResourceNodes.nodeKey));
    return rows.map((row) => ({
      id: row.id,
      baseId: row.baseId,
      nodeKey: row.nodeKey,
      name: row.name,
      itemId: row.itemId,
      discovered: row.discovered,
      remainingQuantity: row.remainingQuantity,
      reservedQuantity: row.reservedQuantity
    }));
  }

  async findNode(
    tx: ResourceNodeTx,
    baseId: string,
    nodeId: string
  ): Promise<ResourceNodeRecord | null> {
    const [row] = await tx
      .select()
      .from(baseResourceNodes)
      .where(and(eq(baseResourceNodes.baseId, baseId), eq(baseResourceNodes.id, nodeId)))
      .limit(1);
    return row
      ? {
          id: row.id,
          baseId: row.baseId,
          nodeKey: row.nodeKey,
          name: row.name,
          itemId: row.itemId,
          discovered: row.discovered,
          remainingQuantity: row.remainingQuantity,
          reservedQuantity: row.reservedQuantity
        }
      : null;
  }

  // 下单预留：可用余量（remaining - reserved）足够才 +reserved；返回 false = 不足/不存在。
  async reserveNode(
    tx: ResourceNodeTx,
    baseId: string,
    nodeId: string,
    quantity: number
  ): Promise<boolean> {
    const rows = await tx
      .update(baseResourceNodes)
      .set({
        reservedQuantity: sql`${baseResourceNodes.reservedQuantity} + ${quantity}`,
        updatedAt: new Date()
      })
      .where(and(
        eq(baseResourceNodes.baseId, baseId),
        eq(baseResourceNodes.id, nodeId),
        sql`${baseResourceNodes.remainingQuantity} - ${baseResourceNodes.reservedQuantity} >= ${quantity}`
      ))
      .returning({ id: baseResourceNodes.id });
    return rows.length > 0;
  }

  // 一批采出：remaining/reserved 同步 -quantity（行级条件保证不透支）。
  async debitReserved(
    tx: ResourceNodeTx,
    baseId: string,
    nodeId: string,
    quantity: number
  ): Promise<boolean> {
    const rows = await tx
      .update(baseResourceNodes)
      .set({
        remainingQuantity: sql`${baseResourceNodes.remainingQuantity} - ${quantity}`,
        reservedQuantity: sql`${baseResourceNodes.reservedQuantity} - ${quantity}`,
        updatedAt: new Date()
      })
      .where(and(
        eq(baseResourceNodes.baseId, baseId),
        eq(baseResourceNodes.id, nodeId),
        sql`${baseResourceNodes.reservedQuantity} >= ${quantity}`
      ))
      .returning({ id: baseResourceNodes.id });
    return rows.length > 0;
  }

  // 取消未采批次：释放尚未采出的预留。
  async releaseReservation(
    tx: ResourceNodeTx,
    baseId: string,
    nodeId: string,
    quantity: number
  ): Promise<boolean> {
    const rows = await tx
      .update(baseResourceNodes)
      .set({
        reservedQuantity: sql`${baseResourceNodes.reservedQuantity} - ${quantity}`,
        updatedAt: new Date()
      })
      .where(and(
        eq(baseResourceNodes.baseId, baseId),
        eq(baseResourceNodes.id, nodeId),
        sql`${baseResourceNodes.reservedQuantity} >= ${quantity}`
      ))
      .returning({ id: baseResourceNodes.id });
    return rows.length > 0;
  }

  // 勘探完成：揭示节点（矿种与储量此后可见）。
  async revealNode(tx: ResourceNodeTx, baseId: string, nodeId: string): Promise<void> {
    await tx
      .update(baseResourceNodes)
      .set({ discovered: true, updatedAt: new Date() })
      .where(and(eq(baseResourceNodes.baseId, baseId), eq(baseResourceNodes.id, nodeId)));
  }
}
