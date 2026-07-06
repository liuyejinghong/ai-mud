import type { AssetLedgerBucket } from "@ai-mud/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { assetLedger, characters, municipalTreasury, npcTasks, worldActors } from "../../db/schema.js";

type LedgerDb = Pick<Db, "insert" | "select">;

export interface CreateCopperLedgerEntryInput {
  operation: string;
  fromBucket: AssetLedgerBucket | null;
  fromEntityId: string | null;
  toBucket: AssetLedgerBucket | null;
  toEntityId: string | null;
  amountCopper: number;
  reason: string;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}

export interface LedgerBucketTotalRecord {
  bucket: AssetLedgerBucket;
  inboundCopper: number;
  outboundCopper: number;
}

export interface CurrentCopperBalancesRecord {
  playerCopper: number;
  npcCopper: number;
  municipalCopper: number;
  escrowCopper: number;
}

const COPPER_SQL = sql<number>`coalesce(sum(${assetLedger.amountCopper}), 0)::int`;

function normalizeNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseInt(value, 10) || 0;
  return 0;
}

export class LedgerRepository {
  constructor(private readonly db: LedgerDb) {}

  async createCopperEntry(input: CreateCopperLedgerEntryInput): Promise<void> {
    await this.db.insert(assetLedger).values({
      assetType: "copper",
      operation: input.operation,
      fromBucket: input.fromBucket,
      fromEntityId: input.fromEntityId,
      toBucket: input.toBucket,
      toEntityId: input.toEntityId,
      amountCopper: input.amountCopper,
      reason: input.reason,
      metadata: input.metadata ?? {},
      ...(input.createdAt ? { createdAt: input.createdAt } : {})
    });
  }

  async getLedgerBucketTotals(): Promise<LedgerBucketTotalRecord[]> {
    const inboundRows = await this.db
      .select({
        bucket: assetLedger.toBucket,
        totalCopper: COPPER_SQL
      })
      .from(assetLedger)
      .where(eq(assetLedger.assetType, "copper"))
      .groupBy(assetLedger.toBucket);

    const outboundRows = await this.db
      .select({
        bucket: assetLedger.fromBucket,
        totalCopper: COPPER_SQL
      })
      .from(assetLedger)
      .where(eq(assetLedger.assetType, "copper"))
      .groupBy(assetLedger.fromBucket);

    const buckets = new Map<AssetLedgerBucket, LedgerBucketTotalRecord>();
    const ensure = (bucket: AssetLedgerBucket) => {
      const existing = buckets.get(bucket);
      if (existing) return existing;
      const record = { bucket, inboundCopper: 0, outboundCopper: 0 };
      buckets.set(bucket, record);
      return record;
    };

    for (const row of inboundRows) {
      if (!row.bucket) continue;
      ensure(row.bucket as AssetLedgerBucket).inboundCopper = normalizeNumber(row.totalCopper);
    }
    for (const row of outboundRows) {
      if (!row.bucket) continue;
      ensure(row.bucket as AssetLedgerBucket).outboundCopper = normalizeNumber(row.totalCopper);
    }

    return Array.from(buckets.values());
  }

  async getCurrentCopperBalances(): Promise<CurrentCopperBalancesRecord> {
    const [[players], [npcs], [treasury], [escrow]] = await Promise.all([
      this.db.select({ totalCopper: sql<number>`coalesce(sum(${characters.copperBalance}), 0)::int` }).from(characters),
      this.db
        .select({ totalCopper: sql<number>`coalesce(sum(${worldActors.copperBalance}), 0)::int` })
        .from(worldActors)
        .where(and(eq(worldActors.actorType, "npc"), eq(worldActors.status, "active"))),
      this.db
        .select({ totalCopper: sql<number>`coalesce(sum(${municipalTreasury.copperBalance}), 0)::int` })
        .from(municipalTreasury),
      this.db
        .select({ totalCopper: sql<number>`coalesce(sum(${npcTasks.escrowCopper}), 0)::int` })
        .from(npcTasks)
        .where(inArray(npcTasks.status, ["open", "accepted"]))
    ]);

    return {
      playerCopper: normalizeNumber(players?.totalCopper),
      npcCopper: normalizeNumber(npcs?.totalCopper),
      municipalCopper: normalizeNumber(treasury?.totalCopper),
      escrowCopper: normalizeNumber(escrow?.totalCopper)
    };
  }
}
