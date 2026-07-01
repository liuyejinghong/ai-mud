import Fastify from "fastify";
import type {
  AiCallLogDto,
  EconomySnapshotDto,
  NpcSimulationReportDto,
  NpcSummaryDto,
  WorldRuntimeStatusDto
} from "@ai-mud/shared";
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

const npcSummaries: NpcSummaryDto[] = [
  {
    id: "actor-farmer",
    actorType: "npc",
    npcKey: "blackpine_farmer_mara",
    name: "玛拉",
    profession: "farmer",
    currentLocation: "corrupt_forest",
    position: { x: 1, y: 3 },
    money: { gold: 0, silver: 1, copper: 25, totalCopper: 125 },
    hunger: {
      current: 4,
      max: 5,
      status: "fed",
      nextMealAt: "2026-07-01T18:00:00.000Z"
    },
    currentAction: { actionType: "gathering", description: "正在采集" },
    inventory: [{ itemId: "wild_berry", name: "野莓", quantity: 2 }],
    recentEvents: [
      {
        id: "event-1",
        message: "玛拉开始采集野莓。",
        createdAt: "2026-07-01T09:00:00.000Z"
      }
    ]
  }
];

const npcSimulationReport: NpcSimulationReportDto = {
  startedAt: "2026-07-01T00:00:00.000Z",
  endedAt: "2026-07-02T00:00:00.000Z",
  days: 1,
  settlementId: "blackpine_outpost",
  treasury: { gold: 0, silver: 99, copper: 75, totalCopper: 9975 },
  npcCount: 4,
  actionCount: 12,
  marketTransactionCount: 3,
  resourceSnapshots: [
    {
      resourceId: "forest_berry_patch_01",
      name: "野莓灌木",
      remainingCharges: 2
    }
  ],
  health: { ok: true, issues: [] }
};

const worldRuntimeStatus: WorldRuntimeStatusDto = {
  key: "npc_world",
  generatedAt: "2026-07-01T12:00:00.000Z",
  lastSettledAt: "2026-07-01T11:59:00.000Z",
  nextTickAt: "2026-07-01T12:00:00.000Z",
  leaseOwner: null,
  leaseUntil: null
};

const aiCallLogs: AiCallLogDto[] = [
  {
    id: "ai-call-1",
    purpose: "npc_dialogue",
    status: "success",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    promptVersion: 2,
    accountId: "account-1",
    characterId: "character-1",
    npcActorId: "npc-blacksmith",
    inputSummary: "最近缺什么？",
    outputSummary: "基础铁矿石快见底了。",
    latencyMs: 240,
    inputTokens: 120,
    outputTokens: 36,
    errorCode: null,
    createdAt: "2026-07-01T12:00:00.000Z"
  }
];

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
    getNpcSnapshot: async () => ({
      generatedAt: "2026-07-01T00:00:00.000Z",
      settlementId: "blackpine_outpost",
      treasury: { gold: 0, silver: 100, copper: 0, totalCopper: 10000 },
      npcs: npcSummaries
    }),
    getWorldRuntimeStatus: async () => worldRuntimeStatus,
    listAiCallLogs: async () => aiCallLogs,
    settleNpcWorld: async () => ({
      generatedAt: "2026-07-01T00:00:00.000Z",
      settlementId: "blackpine_outpost",
      treasury: { gold: 0, silver: 100, copper: 0, totalCopper: 10000 },
      npcs: npcSummaries
    }),
    runNpcSimulation: async () => npcSimulationReport,
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

  it("guards the NPC snapshot behind an admin session", async () => {
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => null
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/npcs"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Admin session required" }
    });
  });

  it("returns NPC economy state for admins", async () => {
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      })
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/npcs"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      generatedAt: "2026-07-01T00:00:00.000Z",
      settlementId: "blackpine_outpost",
      treasury: { gold: 0, silver: 100, copper: 0, totalCopper: 10000 },
      npcs: npcSummaries
    });
  });

  it("returns world runtime status for admins", async () => {
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      getWorldRuntimeStatus: async () => worldRuntimeStatus
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/world-runtime"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(worldRuntimeStatus);
  });

  it("guards AI call logs behind an admin session", async () => {
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => null
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/ai-calls"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Admin session required" }
    });
  });

  it("returns recent AI call logs for admins", async () => {
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      listAiCallLogs: async () => aiCallLogs,
      now: () => new Date("2026-07-01T12:05:00.000Z")
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/ai-calls"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      generatedAt: "2026-07-01T12:05:00.000Z",
      aiCalls: aiCallLogs
    });
  });

  it("settles NPC world only for admins with a mutation token", async () => {
    const settleCalls: string[] = [];
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      verifyAdminMutation: async () => true,
      settleNpcWorld: async () => {
        settleCalls.push("settle");
        return {
          generatedAt: "2026-07-01T00:00:00.000Z",
          settlementId: "blackpine_outpost",
          treasury: { gold: 0, silver: 100, copper: 0, totalCopper: 10000 },
          npcs: npcSummaries
        };
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/npcs/settle"
    });

    expect(response.statusCode).toBe(200);
    expect(settleCalls).toEqual(["settle"]);
    expect(response.json().npcs).toEqual(npcSummaries);
  });

  it("rejects NPC settlement without a mutation token", async () => {
    const settleCalls: string[] = [];
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      verifyAdminMutation: async () => false,
      settleNpcWorld: async () => {
        settleCalls.push("settle");
        throw new Error("not used");
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/npcs/settle"
    });

    expect(response.statusCode).toBe(403);
    expect(settleCalls).toEqual([]);
  });

  it("runs a bounded NPC simulation report for admins", async () => {
    const simulateCalls: Array<{ days: number; startAt: Date }> = [];
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      verifyAdminMutation: async () => true,
      runNpcSimulation: async (input) => {
        simulateCalls.push(input);
        return npcSimulationReport;
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/npcs/simulate",
      payload: { days: 1, startAt: "2026-07-01T00:00:00.000Z" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(npcSimulationReport);
    expect(simulateCalls).toEqual([
      { days: 1, startAt: new Date("2026-07-01T00:00:00.000Z") }
    ]);
  });
});
