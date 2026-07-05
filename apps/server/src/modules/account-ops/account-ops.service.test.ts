import { describe, expect, it, vi } from "vitest";
import { AccountOpsService } from "./account-ops.service.js";

const activeAccount = {
  id: "account-1",
  email: "player@example.com",
  role: "player" as const,
  status: "active" as const,
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  lastLoginAt: null
};

describe("AccountOpsService", () => {
  it("disables an account, revokes active sessions, and writes an audit record", async () => {
    const calls: unknown[] = [];
    const service = new AccountOpsService({
      repository: {
        listAccounts: vi.fn(),
        disableAccount: vi.fn(async (accountId) => {
          calls.push({ type: "disable", accountId });
          return { ...activeAccount, status: "disabled" as const };
        }),
        restoreAccount: vi.fn(),
        revokeActiveSessions: vi.fn(async (accountId) => {
          calls.push({ type: "sessions", accountId });
          return 2;
        }),
        findAccountById: vi.fn()
      },
      audit: {
        write: vi.fn(async (input) => {
          calls.push({ type: "audit", input });
        })
      }
    });

    const result = await service.disableAccount({
      actorAccountId: "admin-1",
      targetAccountId: "account-1",
      reason: "closed beta abuse report"
    });

    expect(result.account.status).toBe("disabled");
    expect(result.revokedSessionCount).toBe(2);
    expect(calls).toEqual([
      { type: "disable", accountId: "account-1" },
      { type: "sessions", accountId: "account-1" },
      expect.objectContaining({
        type: "audit",
        input: expect.objectContaining({
          actorAccountId: "admin-1",
          action: "account.disable",
          targetType: "account",
          targetId: "account-1",
          reason: "closed beta abuse report",
          metadata: { revokedSessionCount: 2 }
        })
      })
    ]);
  });

  it("does not allow an admin to disable themselves", async () => {
    const service = new AccountOpsService({
      repository: {
        listAccounts: vi.fn(),
        disableAccount: vi.fn(),
        restoreAccount: vi.fn(),
        revokeActiveSessions: vi.fn(),
        findAccountById: vi.fn()
      },
      audit: { write: vi.fn() }
    });

    await expect(
      service.disableAccount({
        actorAccountId: "admin-1",
        targetAccountId: "admin-1",
        reason: "mistake"
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("revokes sessions without changing account status", async () => {
    const auditCalls: unknown[] = [];
    const service = new AccountOpsService({
      repository: {
        listAccounts: vi.fn(),
        disableAccount: vi.fn(),
        restoreAccount: vi.fn(),
        revokeActiveSessions: vi.fn(async () => 3),
        findAccountById: vi.fn(async () => activeAccount)
      },
      audit: {
        write: vi.fn(async (input) => {
          auditCalls.push(input);
        })
      }
    });

    const result = await service.revokeSessions({
      actorAccountId: "admin-1",
      targetAccountId: "account-1",
      reason: "force relogin"
    });

    expect(result).toEqual({ accountId: "account-1", revokedSessionCount: 3 });
    expect(auditCalls).toEqual([
      expect.objectContaining({
        action: "account.sessions.revoke",
        targetId: "account-1",
        metadata: { revokedSessionCount: 3 }
      })
    ]);
  });
});
