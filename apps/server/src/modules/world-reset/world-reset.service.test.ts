import { describe, expect, it } from "vitest";
import { WorldResetService } from "./world-reset.service.js";

describe("WorldResetService", () => {
  it("rejects reset without exact confirmation text", async () => {
    const service = new WorldResetService();
    const result = await service.requestSoftReset({
      actorAccountId: "admin-1",
      confirmationText: "reset",
      reason: "testing"
    });

    expect(result).toEqual({ ok: false, reason: "CONFIRMATION_REQUIRED" });
  });

  it("rejects reset without a meaningful reason", async () => {
    const service = new WorldResetService();
    const result = await service.requestSoftReset({
      actorAccountId: "admin-1",
      confirmationText: "RESET WORLD",
      reason: "bug"
    });

    expect(result).toEqual({ ok: false, reason: "REASON_REQUIRED" });
  });

  it("accepts reset request shape without deleting data in v0.1", async () => {
    const service = new WorldResetService();
    const result = await service.requestSoftReset({
      actorAccountId: "admin-1",
      confirmationText: "RESET WORLD",
      reason: "economy test reset"
    });

    expect(result).toEqual({
      ok: true,
      mode: "dry_run",
      message: "Soft Reset is acknowledged but not destructive in v0.1"
    });
  });
});
