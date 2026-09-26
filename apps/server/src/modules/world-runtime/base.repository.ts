import { createHash } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { BaseTimeMode } from "@ai-mud/shared";
import { BASE_MAX_CATCHUP_MS } from "@ai-mud/shared";
import type { Db } from "../../db/client.js";
import { baseControlLeases, baseSites, bases, commandReceipts } from "../../db/schema.js";

// M12-A：world 基地子域持久层（bases / base_sites / base_control_leases + 账号作用域命令回执）。
// 透传模式与 world-runtime.repository.ts 相同：构造函数收 Db 或 tx，方法必须在
// 调用方事务内执行；repo 自身绝不开启或提交事务。
//
// 本文件与 application/base/ports.ts 的 BaseClockStorePort / BaseSiteStorePort /
// BaseLookupPort 结构等价（world 不可反向 import application，故在此镜像形状，
// 由 application 薄壳用例的编译期断言防漂移）。基地行变更一律 base_revision 自增
// （乐观守卫）；物料/设备/作业者行绝不由此直写，只经 assets/npc 参与端口。

export type BaseRepoTx = Pick<Db, "delete" | "insert" | "select" | "update">;
export type BaseDb = BaseRepoTx & { transaction?: Db["transaction"] };

export interface BaseRecord {
  id: string;
  accountId: string;
  name: string;
  timeMode: BaseTimeMode;
  speed: number;
  simTime: Date;
  lastAdvancedAt: Date;
  epoch: number;
  baseRevision: number;
  contentRelease: string;
  createdAt: Date;
}

export interface BaseSiteRecord {
  id: string;
  siteKey: string;
  state: "free" | "reserved" | "built";
  builtFacilityRef: string | null;
}

export interface ControlLeaseRecord {
  baseId: string;
  leaseToken: string;
  leaseUntil: Date;
  updatedAt: Date;
}

// 与 ports.ts AdvanceableBaseDto 同形状。
export interface AdvanceableBaseRecord {
  baseId: string;
  simTime: Date;
  speed: number;
  deltaSimMs: number;
  nextLastAdvancedAt: Date;
}

export interface BaseCommandReceipt {
  actorScope: string;
  commandKind: string;
  commandId: string;
  worldEpoch: number;
  requestHash: string;
  result: unknown;
}

export const BASE_PROVISION_COMMAND_KIND = "base.provision";

// ---------- 逐基地 tick 事务作用域（第 0 阶段车道 C4，评审 ARCH-domain-03） ----------
// 世界 tick 为每个到期基地开一个独立事务，并先把该事务句柄绑定到这个基地：此后经这个句柄调用的
// lockAdvanceableBases 只锁定/返回该基地。这样 BaseSettlementService.settleBases(tx, now)
// 的签名不必改动，一个基地抛错只回滚它自己的事务。
// 以事务对象为键（WeakMap）：绑定随事务句柄一起失效，其他事务与请求路径的调用不受影响。
// Directive: 这是跨车道的过渡接缝——settleBases 有了显式的按基地入参后应删除本机制，改为显式传参。
const tickScopeByTransaction = new WeakMap<object, string>();

export function scopeTickTransactionToBase(tx: BaseRepoTx, baseId: string): void {
  tickScopeByTransaction.set(tx, baseId);
}

export function hashRequestPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex");
}

function mapBaseRow(row: {
  id: string;
  accountId: string;
  name: string;
  timeMode: BaseTimeMode;
  speed: number;
  simTime: Date;
  lastAdvancedAt: Date;
  epoch: number;
  baseRevision: number;
  contentRelease: string;
  createdAt: Date;
}): BaseRecord {
  return { ...row };
}

export class BaseRepository {
  // wallClock：基地推进以真实墙钟为唯一时间基准，世界 tick 追补（历史补算）不得拖拽基地超速。
  constructor(
    private readonly db: BaseDb,
    private readonly wallClock: { now(): Date } = { now: () => new Date() }
  ) {}

  // 事务内构造 tx 绑定实例（透传模式）。
  forTransaction(tx: BaseRepoTx): BaseRepository {
    return new BaseRepository(tx, this.wallClock);
  }

  // ---------- 命令回执（账号作用域，A0-04 附注 i） ----------

  // FOR UPDATE：并发同命令事务在此阻塞，首个提交后其余重放其保存的结果。
  async findReceiptForUpdate(
    tx: BaseRepoTx,
    actorScope: string,
    commandKind: string,
    commandId: string
  ): Promise<BaseCommandReceipt | null> {
    const [row] = await tx
      .select({
        actorScope: commandReceipts.actorScope,
        commandKind: commandReceipts.commandKind,
        commandId: commandReceipts.commandId,
        worldEpoch: commandReceipts.worldEpoch,
        requestHash: commandReceipts.requestHash,
        result: commandReceipts.result
      })
      .from(commandReceipts)
      .where(
        and(
          eq(commandReceipts.actorScope, actorScope),
          eq(commandReceipts.commandKind, commandKind),
          eq(commandReceipts.commandId, commandId),
          eq(commandReceipts.worldEpoch, 1)
        )
      )
      .limit(1)
      .for("update");
    return row ?? null;
  }

  // 在调用方事务内认领命令 id；返回 false 表示已被认领（调用方须重放或冲突）。
  async claimReceipt(tx: BaseRepoTx, input: {
    actorScope: string;
    commandKind: string;
    commandId: string;
    requestHash: string;
  }): Promise<boolean> {
    const rows = await tx
      .insert(commandReceipts)
      .values({
        actorScope: input.actorScope,
        commandKind: input.commandKind,
        commandId: input.commandId,
        worldEpoch: 1,
        requestHash: input.requestHash,
        result: { status: "pending" }
      })
      .onConflictDoNothing({
        target: [
          commandReceipts.actorScope,
          commandReceipts.commandKind,
          commandReceipts.commandId,
          commandReceipts.worldEpoch
        ]
      })
      .returning({ id: commandReceipts.id });
    return rows.length > 0;
  }

  async saveReceiptResult(tx: BaseRepoTx, input: {
    actorScope: string;
    commandKind: string;
    commandId: string;
    result: unknown;
  }): Promise<void> {
    await tx
      .update(commandReceipts)
      .set({ result: input.result })
      .where(
        and(
          eq(commandReceipts.actorScope, input.actorScope),
          eq(commandReceipts.commandKind, input.commandKind),
          eq(commandReceipts.commandId, input.commandId),
          eq(commandReceipts.worldEpoch, 1)
        )
      );
  }

  // ---------- 基地行（BaseLookupPort + 快照/时钟读取） ----------

  async findBaseIdByAccount(tx: BaseRepoTx, accountId: string): Promise<string | null> {
    const [row] = await tx
      .select({ id: bases.id })
      .from(bases)
      .where(eq(bases.accountId, accountId))
      .limit(1);
    return row?.id ?? null;
  }

  async getBaseByAccount(tx: BaseRepoTx, accountId: string): Promise<BaseRecord | null> {
    const [row] = await tx
      .select({
        id: bases.id,
        accountId: bases.accountId,
        name: bases.name,
        timeMode: bases.timeMode,
        speed: bases.speed,
        simTime: bases.simTime,
        lastAdvancedAt: bases.lastAdvancedAt,
        epoch: bases.epoch,
        baseRevision: bases.baseRevision,
        contentRelease: bases.contentRelease,
        createdAt: bases.createdAt
      })
      .from(bases)
      .where(eq(bases.accountId, accountId))
      .limit(1);
    return row ? mapBaseRow(row) : null;
  }

  async getContentRelease(tx: BaseRepoTx, baseId: string): Promise<string | null> {
    const [row] = await tx
      .select({ contentRelease: bases.contentRelease })
      .from(bases)
      .where(eq(bases.id, baseId))
      .limit(1);
    return row?.contentRelease ?? null;
  }

  // 非主键更新锁与 tick/取消互斥，同时不挡住新项目/工单的外键检查。
  async getBaseForUpdate(tx: BaseRepoTx, baseId: string): Promise<BaseRecord | null> {
    const [row] = await tx
      .select({
        id: bases.id,
        accountId: bases.accountId,
        name: bases.name,
        timeMode: bases.timeMode,
        speed: bases.speed,
        simTime: bases.simTime,
        lastAdvancedAt: bases.lastAdvancedAt,
        epoch: bases.epoch,
        baseRevision: bases.baseRevision,
        contentRelease: bases.contentRelease,
        createdAt: bases.createdAt
      })
      .from(bases)
      .where(eq(bases.id, baseId))
      .limit(1)
      .for("no key update");
    return row ? mapBaseRow(row) : null;
  }

  async insertBase(tx: BaseRepoTx, input: {
    accountId: string;
    name: string;
    contentRelease: string;
    timeMode: BaseTimeMode;
    speed: number;
    simTime: Date;
    lastAdvancedAt: Date;
  }): Promise<string> {
    const [row] = await tx
      .insert(bases)
      .values({
        accountId: input.accountId,
        name: input.name,
        contentRelease: input.contentRelease,
        timeMode: input.timeMode,
        speed: input.speed,
        simTime: input.simTime,
        lastAdvancedAt: input.lastAdvancedAt
      })
      .returning({ id: bases.id });
    if (!row) throw new Error("bases insert returned no row");
    return row.id;
  }

  // 悲观行锁 + base_revision 乐观守卫双保险；守卫失败（false）抛 REVISION_EXPIRED。
  async updateBaseClock(tx: BaseRepoTx, input: {
    baseId: string;
    expectedBaseRevision: number;
    timeMode: BaseTimeMode;
    speed: number;
    lastAdvancedAt: Date;
  }): Promise<boolean> {
    const result = await tx
      .update(bases)
      .set({
        timeMode: input.timeMode,
        speed: input.speed,
        lastAdvancedAt: input.lastAdvancedAt,
        baseRevision: sql`${bases.baseRevision} + 1`
      })
      .where(
        and(
          eq(bases.id, input.baseId),
          eq(bases.baseRevision, input.expectedBaseRevision)
        )
      );
    return (result.rowCount ?? 0) > 0;
  }

  // ---------- 控制租约（事实唯一写者 = world.base，A0-04 附注 ii） ----------

  async upsertControlLease(tx: BaseRepoTx, input: {
    baseId: string;
    leaseToken: string;
    leaseUntil: Date;
    updatedAt: Date;
  }): Promise<void> {
    await tx
      .insert(baseControlLeases)
      .values({
        baseId: input.baseId,
        leaseToken: input.leaseToken,
        leaseUntil: input.leaseUntil,
        updatedAt: input.updatedAt
      })
      .onConflictDoUpdate({
        target: baseControlLeases.baseId,
        set: {
          leaseToken: input.leaseToken,
          leaseUntil: input.leaseUntil,
          updatedAt: input.updatedAt
        }
      });
  }

  async getControlLease(tx: BaseRepoTx, baseId: string): Promise<ControlLeaseRecord | null> {
    const [row] = await tx
      .select({
        baseId: baseControlLeases.baseId,
        leaseToken: baseControlLeases.leaseToken,
        leaseUntil: baseControlLeases.leaseUntil,
        updatedAt: baseControlLeases.updatedAt
      })
      .from(baseControlLeases)
      .where(eq(baseControlLeases.baseId, baseId))
      .limit(1);
    return row ?? null;
  }

  async clearControlLease(tx: BaseRepoTx, baseId: string, leaseToken: string): Promise<void> {
    await tx.delete(baseControlLeases).where(and(
      eq(baseControlLeases.baseId, baseId),
      eq(baseControlLeases.leaseToken, leaseToken)
    ));
  }

  // ---------- BaseClockStorePort：只结算已确认的前台时段 ----------

  // SELECT … FOR NO KEY UPDATE SKIP LOCKED 锁住 running 基地行（按 id 排序，锁序确定），逐行联
  // base_control_leases.updatedAt 是最后确认点；租约过期仍结清此前已确认的时段。
  // 被别的事务（玩家命令/心跳）持锁的基地本次跳过而不排队：lastAdvancedAt 不动，下个 tick
  // 按已确认时段补上；单次上限只推进游标到本次结算终点，不丢剩余时长。
  // 事务句柄经 scopeTickTransactionToBase 绑定过基地时，只锁定/返回那一个基地。
  // deltaSimMs = clamp(min(tickAt, updatedAt, wallNow) - lastAdvancedAt, 0, 上限) × speed。
  async lockAdvanceableBases(tx: BaseRepoTx, now: Date): Promise<AdvanceableBaseRecord[]> {
    const wallNow = this.wallClock.now();
    const scopedBaseId = tickScopeByTransaction.get(tx);
    const rows = await tx
      .select({
        id: bases.id,
        simTime: bases.simTime,
        speed: bases.speed,
        lastAdvancedAt: bases.lastAdvancedAt
      })
      .from(bases)
      .where(
        scopedBaseId === undefined
          ? eq(bases.timeMode, "running")
          : and(eq(bases.timeMode, "running"), eq(bases.id, scopedBaseId))
      )
      .orderBy(asc(bases.id))
      .for("no key update", { skipLocked: true });

    const advanceable: AdvanceableBaseRecord[] = [];
    for (const row of rows) {
      const lease = await this.getControlLease(tx, row.id);
      if (!lease) continue;

      const confirmedEndMs = Math.min(now.getTime(), lease.updatedAt.getTime(), wallNow.getTime());
      const deltaWallMs = Math.min(
        Math.max(confirmedEndMs - row.lastAdvancedAt.getTime(), 0),
        BASE_MAX_CATCHUP_MS
      );
      if (deltaWallMs <= 0) continue;
      advanceable.push({
        baseId: row.id,
        simTime: row.simTime,
        speed: row.speed,
        deltaSimMs: deltaWallMs * row.speed,
        nextLastAdvancedAt: new Date(row.lastAdvancedAt.getTime() + deltaWallMs)
      });
    }
    return advanceable;
  }

  // 逐基地 tick 的到期清单：running 且有尚未结清的确认时段；过期租约也可能到期。
  // 不加锁——每个基地随后在自己的事务里重新锁定并复核时间游标。
  async listAdvanceableBaseIds(tx: BaseRepoTx): Promise<string[]> {
    const rows = await tx
      .select({ id: bases.id })
      .from(bases)
      .innerJoin(baseControlLeases, eq(baseControlLeases.baseId, bases.id))
      .where(and(eq(bases.timeMode, "running"), gt(baseControlLeases.updatedAt, bases.lastAdvancedAt)))
      .orderBy(asc(bases.id));
    return rows.map((row) => row.id);
  }

  // 推进后 base_revision 自增（基地行变更守卫）。
  async saveSimAdvance(tx: BaseRepoTx, baseId: string, simTime: Date, lastAdvancedAt: Date): Promise<void> {
    await tx
      .update(bases)
      .set({
        simTime,
        lastAdvancedAt,
        baseRevision: sql`${bases.baseRevision} + 1`
      })
      .where(eq(bases.id, baseId));
  }

  // ---------- BaseSiteStorePort：建设位 ----------

  async insertSite(tx: BaseRepoTx, input: {
    baseId: string;
    siteKey: string;
    state: "free" | "reserved" | "built";
    builtFacilityRef: string | null;
  }): Promise<string> {
    const [row] = await tx
      .insert(baseSites)
      .values({
        baseId: input.baseId,
        siteKey: input.siteKey,
        state: input.state,
        builtFacilityRef: input.builtFacilityRef
      })
      .returning({ id: baseSites.id });
    if (!row) throw new Error("base_sites insert returned no row");
    return row.id;
  }

  async getSite(tx: BaseRepoTx, baseId: string, siteId: string): Promise<BaseSiteRecord | null> {
    const [row] = await tx
      .select({
        id: baseSites.id,
        siteKey: baseSites.siteKey,
        state: sql<BaseSiteRecord["state"]>`${baseSites.state}`,
        builtFacilityRef: baseSites.builtFacilityRef
      })
      .from(baseSites)
      .where(and(eq(baseSites.baseId, baseId), eq(baseSites.id, siteId)))
      .limit(1);
    return row ?? null;
  }

  async listSites(tx: BaseRepoTx, baseId: string): Promise<BaseSiteRecord[]> {
    return tx
      .select({
        id: baseSites.id,
        siteKey: baseSites.siteKey,
        state: sql<BaseSiteRecord["state"]>`${baseSites.state}`,
        builtFacilityRef: baseSites.builtFacilityRef
      })
      .from(baseSites)
      .where(eq(baseSites.baseId, baseId))
      .orderBy(asc(baseSites.siteKey));
  }

  async markSiteReserved(tx: BaseRepoTx, siteId: string): Promise<void> {
    await tx.update(baseSites).set({ state: "reserved" }).where(eq(baseSites.id, siteId));
  }

  async markSiteBuilt(tx: BaseRepoTx, siteId: string, facilityRef: string): Promise<void> {
    await tx
      .update(baseSites)
      .set({ state: "built", builtFacilityRef: facilityRef })
      .where(eq(baseSites.id, siteId));
  }

  async releaseSite(tx: BaseRepoTx, siteId: string): Promise<void> {
    await tx
      .update(baseSites)
      .set({ state: "free", builtFacilityRef: null })
      .where(eq(baseSites.id, siteId));
  }
}
