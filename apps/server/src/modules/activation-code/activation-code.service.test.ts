import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { ActivationCodeService } from "./activation-code.service.js";

function hashCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

describe("ActivationCodeService", () => {
  let records: Array<{
    id: string;
    codeHash: string;
    status: "unused" | "used" | "expired" | "revoked";
    usedByAccountId: string | null;
    expiresAt: Date | null;
  }>;

  beforeEach(() => {
    records = [];
  });

  it("creates one-time plaintext codes and stores only hashes", async () => {
    const service = new ActivationCodeService({
      insert: async (record) => {
        records.push(record);
      },
      findByHash: async (codeHash) => records.find((record) => record.codeHash === codeHash) ?? null,
      markUsed: async () => undefined
    });

    const created = await service.create({ note: "test", createdByAdminId: "admin-1" });

    expect(created.code).toHaveLength(24);
    expect(records[0]!.codeHash).toBe(hashCode(created.code));
    expect(records[0]!.codeHash).not.toBe(created.code);
  });

  it("consumes an unused activation code once", async () => {
    const code = "ABCDEFGH12345678ABCDEFGH";
    records.push({
      id: "code-1",
      codeHash: hashCode(code),
      status: "unused",
      usedByAccountId: null,
      expiresAt: null
    });

    const service = new ActivationCodeService({
      insert: async (record) => {
        records.push(record);
      },
      findByHash: async (codeHash) => records.find((record) => record.codeHash === codeHash) ?? null,
      markUsed: async (id, accountId) => {
        const record = records.find((candidate) => candidate.id === id)!;
        record.status = "used";
        record.usedByAccountId = accountId;
      }
    });

    const consumed = await service.consume(code, "account-1");
    expect(consumed.ok).toBe(true);

    const second = await service.consume(code, "account-2");
    expect(second).toEqual({ ok: false, reason: "ACTIVATION_CODE_USED" });
  });

  it("rejects invalid, revoked, and expired activation codes without marking them used", async () => {
    const revokedCode = "REVOKEDCODE123456789012";
    const expiredStatusCode = "EXPIREDSTATUS123456789";
    const expiredTimeCode = "EXPIREDTIME12345678901";
    const markedUsed: Array<{ id: string; accountId: string }> = [];

    records.push(
      {
        id: "revoked-code",
        codeHash: hashCode(revokedCode),
        status: "revoked",
        usedByAccountId: null,
        expiresAt: null
      },
      {
        id: "expired-status-code",
        codeHash: hashCode(expiredStatusCode),
        status: "expired",
        usedByAccountId: null,
        expiresAt: null
      },
      {
        id: "expired-time-code",
        codeHash: hashCode(expiredTimeCode),
        status: "unused",
        usedByAccountId: null,
        expiresAt: new Date(Date.now() - 1000)
      }
    );

    const service = new ActivationCodeService({
      insert: async (record) => {
        records.push(record);
      },
      findByHash: async (codeHash) => records.find((record) => record.codeHash === codeHash) ?? null,
      markUsed: async (id, accountId) => {
        markedUsed.push({ id, accountId });
      }
    });

    await expect(service.consume("missing-code", "account-1")).resolves.toEqual({
      ok: false,
      reason: "ACTIVATION_CODE_INVALID"
    });
    await expect(service.consume(revokedCode, "account-1")).resolves.toEqual({
      ok: false,
      reason: "ACTIVATION_CODE_INVALID"
    });
    await expect(service.consume(expiredStatusCode, "account-1")).resolves.toEqual({
      ok: false,
      reason: "ACTIVATION_CODE_EXPIRED"
    });
    await expect(service.consume(expiredTimeCode, "account-1")).resolves.toEqual({
      ok: false,
      reason: "ACTIVATION_CODE_EXPIRED"
    });
    expect(markedUsed).toEqual([]);
  });
});
