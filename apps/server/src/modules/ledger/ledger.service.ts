import { formatMoney } from "@ai-mud/game-rules";
import type {
  AssetLedgerBucket,
  AssetLedgerBucketSnapshotDto,
  AssetLedgerHealthDto
} from "@ai-mud/shared";
import type {
  CreateCopperLedgerEntryInput,
  CurrentCopperBalancesRecord,
  LedgerBucketTotalRecord
} from "./ledger.repository.js";

const MATERIAL_BUCKETS = ["player", "npc", "municipal", "escrow"] as const;
const REPORT_BUCKETS: AssetLedgerBucket[] = [
  "player",
  "npc",
  "municipal",
  "escrow",
  "system_source",
  "system_sink"
];

export type CopperLedgerOperation =
  | "migration_baseline"
  | "world_seed"
  | "task_escrow"
  | "task_reward"
  | "task_refund"
  | "dialogue_gift"
  | "npc_wage"
  | "market_buy"
  | "market_sell"
  | "equipment_repair";

export interface CopperLedgerWriter {
  recordCopperTransfer(input: {
    operation: CopperLedgerOperation;
    fromBucket: AssetLedgerBucket | null;
    fromEntityId?: string | null;
    toBucket: AssetLedgerBucket | null;
    toEntityId?: string | null;
    amountCopper: number;
    reason: string;
    metadata?: Record<string, unknown>;
    createdAt?: Date;
  }): Promise<void>;
}

export interface LedgerRepositoryPort {
  createCopperEntry(input: CreateCopperLedgerEntryInput): Promise<void>;
  getLedgerBucketTotals(): Promise<LedgerBucketTotalRecord[]>;
  getCurrentCopperBalances(): Promise<CurrentCopperBalancesRecord>;
}

export class LedgerService implements CopperLedgerWriter {
  constructor(private readonly repo: LedgerRepositoryPort) {}

  async recordCopperTransfer(input: Parameters<CopperLedgerWriter["recordCopperTransfer"]>[0]) {
    const amountCopper = Math.floor(input.amountCopper);
    if (!Number.isFinite(amountCopper) || amountCopper <= 0) return;

    const entry: CreateCopperLedgerEntryInput = {
      operation: input.operation,
      fromBucket: input.fromBucket,
      fromEntityId: input.fromEntityId ?? null,
      toBucket: input.toBucket,
      toEntityId: input.toEntityId ?? null,
      amountCopper,
      reason: input.reason,
      metadata: input.metadata ?? {},
      ...(input.createdAt ? { createdAt: input.createdAt } : {})
    };
    await this.repo.createCopperEntry(entry);
  }

  async getHealth(now = new Date()): Promise<AssetLedgerHealthDto> {
    const [ledgerTotals, actual] = await Promise.all([
      this.repo.getLedgerBucketTotals(),
      this.repo.getCurrentCopperBalances()
    ]);
    const totals = new Map(
      ledgerTotals.map((entry) => [entry.bucket, entry.inboundCopper - entry.outboundCopper])
    );
    const actualByBucket: Record<(typeof MATERIAL_BUCKETS)[number], number> = {
      player: actual.playerCopper,
      npc: actual.npcCopper,
      municipal: actual.municipalCopper,
      escrow: actual.escrowCopper
    };

    const buckets: AssetLedgerBucketSnapshotDto[] = REPORT_BUCKETS.map((bucket) => {
      const expectedCopper = totals.get(bucket) ?? 0;
      if (!MATERIAL_BUCKETS.includes(bucket as (typeof MATERIAL_BUCKETS)[number])) {
        return {
          bucket,
          expectedCopper: formatMoney(Math.abs(expectedCopper)),
          actualCopper: null,
          driftCopper: null
        };
      }

      const actualCopper = actualByBucket[bucket as (typeof MATERIAL_BUCKETS)[number]];
      const driftCopper = actualCopper - expectedCopper;
      return {
        bucket,
        expectedCopper: formatMoney(Math.max(0, expectedCopper)),
        actualCopper: formatMoney(actualCopper),
        driftCopper: formatMoney(Math.abs(driftCopper))
      };
    });

    const totalDriftCopper = buckets.reduce(
      (sum, bucket) => sum + (bucket.driftCopper?.totalCopper ?? 0),
      0
    );

    return {
      generatedAt: now.toISOString(),
      status: totalDriftCopper === 0 ? "ok" : "drift_detected",
      totalDrift: formatMoney(totalDriftCopper),
      buckets
    };
  }
}
