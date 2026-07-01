import Fastify from "fastify";
import type { EconomySnapshotDto } from "@ai-mud/shared";
import { describe, expect, it } from "vitest";
import { registerAdminRoutes, type AdminRouteDependencies } from "./admin.routes.js";

const economySnapshot: EconomySnapshotDto = {
  settlementId: "blackpine_outpost",
  settlementName: "黑松哨站市政集市",
  generatedAt: "2026-07-01T12:00:00.000Z",
  taxSummary: {
    transactionCount: 1,
    grossCopper: 18,
    taxCopper: 1,
    buyTaxCopper: 0,
    sellTaxCopper: 1,
    netCopper: 17
  },
  marketItems: [
    {
      itemId: "wild_berry",
      name: "野莓",
      category: "food",
      itemLevel: 1,
      stockQuantity: 12,
      targetQuantity: 20,
      baseBuyPrice: { gold: 0, silver: 0, copper: 6, totalCopper: 6 },
      baseSellPrice: { gold: 0, silver: 0, copper: 10, totalCopper: 10 }
    }
  ],
  recentTransactions: [
    {
      id: "tx-1",
      settlementId: "blackpine_outpost",
      actorId: "character-1",
      actorType: "player",
      actorName: "测试角色",
      characterId: "character-1",
      transactionType: "sell",
      itemId: "wild_berry",
      itemName: "野莓",
      quantity: 3,
      unitPrice: { gold: 0, silver: 0, copper: 6, totalCopper: 6 },
      gross: { gold: 0, silver: 0, copper: 18, totalCopper: 18 },
      tax: { gold: 0, silver: 0, copper: 1, totalCopper: 1 },
      net: { gold: 0, silver: 0, copper: 17, totalCopper: 17 },
      createdAt: "2026-07-01T12:00:00.000Z"
    }
  ]
};

function buildAdminRouteTestApp(deps: Partial<AdminRouteDependencies>) {
  const app = Fastify();
  const baseDeps: AdminRouteDependencies = {
    getCurrentAdmin: async () => null,
    verifyAdminMutation: async () => false,
    listActivationCodes: async () => [],
    createActivationCodeWithAudit: async () => {
      throw new Error("not used");
    },
    writeAudit: async () => {
      throw new Error("not used");
    },
    getEconomySnapshot: async () => economySnapshot,
    now: () => new Date("2026-07-01T00:00:00.000Z")
  };
  void registerAdminRoutes(app, { ...baseDeps, ...deps });
  return app;
}

describe("registerAdminRoutes", () => {
  it("rejects activation-code creation without an admin session", async () => {
    const createCalls: unknown[] = [];
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => null,
      verifyAdminMutation: async () => false,
      listActivationCodes: async () => [],
      createActivationCodeWithAudit: async (input) => {
        createCalls.push(input);
        return {
          code: "SHOULD-NOT-CREATE",
          activationCode: {
            id: "code-1",
            status: "unused",
            note: null,
            usedByAccountId: null,
            expiresAt: null,
            createdAt: "2026-07-01T00:00:00.000Z",
            usedAt: null,
            revokedAt: null
          }
        };
      },
      writeAudit: async () => {
        throw new Error("not used");
      },
      now: () => new Date("2026-07-01T00:00:00.000Z")
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/activation-codes",
      payload: { note: "friend invite" }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Admin session required" }
    });
    expect(createCalls).toEqual([]);
  });

  it("creates an activation code for admins through one atomic audited operation", async () => {
    const createCalls: unknown[] = [];
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      verifyAdminMutation: async () => true,
      listActivationCodes: async () => [],
      createActivationCodeWithAudit: async (input) => {
        createCalls.push(input);
        return {
          code: "INVITE-CODE-123",
          activationCode: {
            id: "code-1",
            status: "unused",
            note: "friend invite",
            usedByAccountId: null,
            expiresAt: "2026-07-08T00:00:00.000Z",
            createdAt: "2026-07-01T00:00:00.000Z",
            usedAt: null,
            revokedAt: null
          }
        };
      },
      writeAudit: async () => {
        throw new Error("not used");
      },
      now: () => new Date("2026-07-01T00:00:00.000Z")
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/activation-codes",
      payload: {
        note: "friend invite",
        expiresAt: "2026-07-08T00:00:00.000Z"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      code: "INVITE-CODE-123",
      activationCode: {
        id: "code-1",
        status: "unused",
        note: "friend invite",
        usedByAccountId: null,
        expiresAt: "2026-07-08T00:00:00.000Z",
        createdAt: "2026-07-01T00:00:00.000Z",
        usedAt: null,
        revokedAt: null
      }
    });
    expect(createCalls).toEqual([
      {
        note: "friend invite",
        createdByAdminId: "admin-1",
        expiresAt: new Date("2026-07-08T00:00:00.000Z"),
        metadata: { expiresAt: "2026-07-08T00:00:00.000Z" }
      }
    ]);
  });

  it("rejects activation-code creation without an admin mutation token", async () => {
    const createCalls: unknown[] = [];
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      verifyAdminMutation: async () => false,
      listActivationCodes: async () => [],
      createActivationCodeWithAudit: async (input) => {
        createCalls.push(input);
        throw new Error("not used");
      },
      writeAudit: async () => {
        throw new Error("not used");
      },
      now: () => new Date("2026-07-01T00:00:00.000Z")
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/activation-codes",
      payload: { note: "friend invite" }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: { code: "FORBIDDEN", message: "Admin mutation token required" }
    });
    expect(createCalls).toEqual([]);
  });

  it("does not return a generated code if the atomic audited operation fails", async () => {
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      verifyAdminMutation: async () => true,
      listActivationCodes: async () => [],
      createActivationCodeWithAudit: async () => {
        throw new Error("audit insert failed");
      },
      writeAudit: async () => {
        throw new Error("not used");
      },
      now: () => new Date("2026-07-01T00:00:00.000Z")
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/activation-codes",
      payload: { note: "friend invite" }
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("INVITE-CODE");
  });

  it("guards the soft reset route behind an admin session", async () => {
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => null,
      verifyAdminMutation: async () => false,
      listActivationCodes: async () => [],
      createActivationCodeWithAudit: async () => {
        throw new Error("not used");
      },
      writeAudit: async () => {
        throw new Error("not used");
      },
      now: () => new Date("2026-07-01T00:00:00.000Z")
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/world-reset/soft",
      payload: {
        confirmationText: "RESET WORLD",
        reason: "economy test reset"
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Admin session required" }
    });
  });

  it("accepts a non-destructive soft reset request from an admin", async () => {
    const auditCalls: unknown[] = [];
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      verifyAdminMutation: async () => true,
      listActivationCodes: async () => [],
      createActivationCodeWithAudit: async () => {
        throw new Error("not used");
      },
      writeAudit: async (input) => {
        auditCalls.push(input);
      },
      now: () => new Date("2026-07-01T00:00:00.000Z")
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/world-reset/soft",
      payload: {
        confirmationText: "RESET WORLD",
        reason: "economy test reset"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      mode: "dry_run",
      message: "Soft Reset is acknowledged but not destructive in v0.1"
    });
    expect(auditCalls).toEqual([
      {
        actorAccountId: "admin-1",
        action: "world_reset.soft.request",
        targetType: "world",
        targetId: null,
        reason: "economy test reset",
        metadata: { mode: "dry_run" }
      }
    ]);
  });

  it("does not accept a soft reset when audit logging fails", async () => {
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      verifyAdminMutation: async () => true,
      listActivationCodes: async () => [],
      createActivationCodeWithAudit: async () => {
        throw new Error("not used");
      },
      writeAudit: async () => {
        throw new Error("audit insert failed");
      },
      now: () => new Date("2026-07-01T00:00:00.000Z")
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/world-reset/soft",
      payload: {
        confirmationText: "RESET WORLD",
        reason: "economy test reset"
      }
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("dry_run");
  });

  it("guards the economy snapshot behind an admin session", async () => {
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => null
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/economy"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Admin session required" }
    });
  });

  it("returns the economy snapshot for admins", async () => {
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      getEconomySnapshot: async () => economySnapshot
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/economy"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(economySnapshot);
  });
});
