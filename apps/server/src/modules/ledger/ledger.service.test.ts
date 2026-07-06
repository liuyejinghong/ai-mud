import { describe, expect, it, vi } from "vitest";
import { LedgerService } from "./ledger.service.js";

describe("LedgerService", () => {
  it("reports ok when material buckets match ledger net totals", async () => {
    const repo = {
      createCopperEntry: vi.fn(),
      getLedgerBucketTotals: vi.fn(async () => [
        { bucket: "system_source" as const, inboundCopper: 0, outboundCopper: 175 },
        { bucket: "player" as const, inboundCopper: 100, outboundCopper: 25 },
        { bucket: "npc" as const, inboundCopper: 50, outboundCopper: 0 },
        { bucket: "municipal" as const, inboundCopper: 25, outboundCopper: 0 }
      ]),
      getCurrentCopperBalances: vi.fn(async () => ({
        playerCopper: 75,
        npcCopper: 50,
        municipalCopper: 25,
        escrowCopper: 0
      }))
    };
    const service = new LedgerService(repo);

    const health = await service.getHealth(new Date("2026-07-06T00:00:00.000Z"));

    expect(health.status).toBe("ok");
    expect(health.totalDrift.totalCopper).toBe(0);
    expect(health.buckets.find((bucket) => bucket.bucket === "player")?.actualCopper).toEqual({
      gold: 0,
      silver: 0,
      copper: 75,
      totalCopper: 75
    });
  });

  it("reports drift when actual copper differs from ledger net totals", async () => {
    const repo = {
      createCopperEntry: vi.fn(),
      getLedgerBucketTotals: vi.fn(async () => [
        { bucket: "player" as const, inboundCopper: 100, outboundCopper: 0 }
      ]),
      getCurrentCopperBalances: vi.fn(async () => ({
        playerCopper: 80,
        npcCopper: 0,
        municipalCopper: 0,
        escrowCopper: 0
      }))
    };
    const service = new LedgerService(repo);

    const health = await service.getHealth(new Date("2026-07-06T00:00:00.000Z"));

    expect(health.status).toBe("drift_detected");
    expect(health.totalDrift.totalCopper).toBe(20);
    expect(health.buckets.find((bucket) => bucket.bucket === "player")?.driftCopper).toEqual({
      gold: 0,
      silver: 0,
      copper: 20,
      totalCopper: 20
    });
  });

  it("records positive copper transfers and ignores zero amounts", async () => {
    const repo = {
      createCopperEntry: vi.fn(),
      getLedgerBucketTotals: vi.fn(),
      getCurrentCopperBalances: vi.fn()
    };
    const service = new LedgerService(repo);

    await service.recordCopperTransfer({
      operation: "npc_wage",
      fromBucket: "municipal",
      toBucket: "npc",
      amountCopper: 25,
      reason: "npc.wage"
    });
    await service.recordCopperTransfer({
      operation: "npc_wage",
      fromBucket: "municipal",
      toBucket: "npc",
      amountCopper: 0,
      reason: "npc.wage"
    });

    expect(repo.createCopperEntry).toHaveBeenCalledTimes(1);
    expect(repo.createCopperEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "npc_wage",
        fromBucket: "municipal",
        toBucket: "npc",
        amountCopper: 25
      })
    );
  });
});
