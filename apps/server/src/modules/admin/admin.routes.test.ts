import Fastify from "fastify";
import type {
  AdminAccountDto,
  AssetLedgerHealthDto,
  AiCallLogDto,
  AiLayerStatusDto,
  ChatMessageDto,
  EconomySnapshotDto,
  NpcMemoryEntryDto,
  NpcMemoryFragmentDto,
  NpcSimulationReportDto,
  NpcSummaryDto,
  WorldResetResponseDto,
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

const assetLedgerHealth: AssetLedgerHealthDto = {
  generatedAt: "2026-07-01T12:00:00.000Z",
  status: "ok",
  totalDrift: { gold: 0, silver: 0, copper: 0, totalCopper: 0 },
  buckets: [
    {
      bucket: "player",
      expectedCopper: { gold: 0, silver: 1, copper: 25, totalCopper: 125 },
      actualCopper: { gold: 0, silver: 1, copper: 25, totalCopper: 125 },
      driftCopper: { gold: 0, silver: 0, copper: 0, totalCopper: 0 }
    },
    {
      bucket: "system_source",
      expectedCopper: { gold: 0, silver: 1, copper: 25, totalCopper: 125 },
      actualCopper: null,
      driftCopper: null
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
  metrics: {
    minNpcHunger: 4,
    hungryNpcCount: 0,
    starvingNpcCount: 0,
    totalNpcCopper: 410,
    marketStockQuantity: 18,
    activeActionCount: 1,
    completedActionCount: 11
  },
  resourceSnapshots: [
    {
      zoneId: "corrupt_forest",
      resourceId: "forest_berry_patch_01",
      name: "野莓灌木",
      remainingCharges: 2
    }
  ],
  mapResourceSnapshots: [
    {
      zoneId: "old_mine",
      resourceCount: 2,
      depletedResourceCount: 0,
      refreshedAt: "2026-07-02T00:00:00.000Z"
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

const aiLayerStatus: AiLayerStatusDto = {
  providerEnabled: true,
  providerName: "deepseek",
  model: "deepseek-v4-flash",
  promptVersion: 8,
  budget: {
    dailyTokenBudget: 1000,
    usedTokens24h: 156,
    remainingTokens24h: 844,
    fallbackCount24h: 0,
    latestFailureReason: null,
    exhausted: false
  },
  purposes: [
    {
      purpose: "npc_dialogue",
      authorityClass: "presentation",
      enabled: true,
      mutatesWorldState: false,
      maxOutputTokens: 180,
      cooldownMs: 5000,
      fallbackRequired: true,
      promptVersion: 1,
      callCount24h: 2,
      successCount24h: 1,
      fallbackCount24h: 0,
      rejectedCount24h: 0,
      errorCount24h: 0,
      disabledCount24h: 1,
      totalInputTokens24h: 120,
      totalOutputTokens24h: 36,
      averageLatencyMs24h: 240,
      latestStatus: "disabled",
      latestAt: "2026-07-01T12:04:00.000Z"
    }
  ]
};

const npcMemoryEntries: NpcMemoryEntryDto[] = [
  {
    id: "mem-1",
    npcActorId: "npc-blacksmith",
    characterId: "character-1",
    sourceType: "dialogue",
    memoryKind: "conversation",
    evidenceLevel: "dialogue_claim",
    sourceIds: ["msg-1", "msg-2"],
    importance: 1,
    summary: "Zichen 询问伯林最近缺什么。",
    occurredAt: "2026-07-01T12:00:00.000Z",
    compressedAt: null
  }
];

const npcMemoryFragments: NpcMemoryFragmentDto[] = [
  {
    id: "frag-1",
    npcActorId: "npc-blacksmith",
    characterId: "character-1",
    memoryKind: "conversation",
    evidenceLevel: "dialogue_claim",
    importance: 1,
    summary: "Zichen 多次询问基础铁矿石。",
    firstOccurredAt: "2026-07-01T12:00:00.000Z",
    lastOccurredAt: "2026-07-02T12:00:00.000Z",
    sourceEntryIds: ["mem-1"],
    compressionLevel: 1
  }
];

const systemAnnouncement: ChatMessageDto = {
  id: "announcement-1",
  characterId: "system",
  characterName: "系统公告",
  kind: "system",
  channel: "lobby",
  body: "今晚 22:00 将进行世界重置演练。",
  createdAt: "2026-07-01T12:00:00.000Z"
};

const adminAccountRows: AdminAccountDto[] = [
  {
    id: "account-1",
    email: "player@example.com",
    role: "player",
    status: "active",
    createdAt: "2026-07-01T00:00:00.000Z",
    lastLoginAt: null
  }
];

const worldResetResponse: WorldResetResponseDto = {
  ok: true,
  mode: "world_reset",
  resetAt: "2026-07-05T12:00:00.000Z",
  clearedTables: ["characters", "world_actors"],
  message: "世界已重置并完成基础初始化。"
};

function buildAdminRouteTestApp(deps: Partial<AdminRouteDependencies>) {
  const app = Fastify();
  const baseDeps: AdminRouteDependencies = {
    getCurrentAdmin: async () => null,
    verifyAdminMutation: async () => false,
    listActivationCodes: async () => [],
    revokeActivationCodeWithAudit: async () => {
      throw new Error("not used");
    },
    resetWorld: async () => {
      throw new Error("not used");
    },
    createActivationCodeWithAudit: async () => {
      throw new Error("not used");
    },
    writeAudit: async () => {
      throw new Error("not used");
    },
    getEconomySnapshot: async () => economySnapshot,
    getAssetLedgerHealth: async () => assetLedgerHealth,
    getNpcSnapshot: async () => ({
      generatedAt: "2026-07-01T00:00:00.000Z",
      settlementId: "blackpine_outpost",
      treasury: { gold: 0, silver: 100, copper: 0, totalCopper: 10000 },
      npcs: npcSummaries
    }),
    getWorldRuntimeStatus: async () => worldRuntimeStatus,
    listAiCallLogs: async () => aiCallLogs,
    getAiLayerStatus: async () => aiLayerStatus,
    listAccounts: async () => adminAccountRows,
    disableAccount: async () => {
      throw new Error("not used");
    },
    restoreAccount: async () => {
      throw new Error("not used");
    },
    revokeAccountSessions: async () => {
      throw new Error("not used");
    },
    listNpcMemory: async () => ({
      entries: npcMemoryEntries,
      fragments: npcMemoryFragments
    }),
    settleNpcWorld: async () => ({
      generatedAt: "2026-07-01T00:00:00.000Z",
      settlementId: "blackpine_outpost",
      treasury: { gold: 0, silver: 100, copper: 0, totalCopper: 10000 },
      npcs: npcSummaries
    }),
    runNpcSimulation: async () => npcSimulationReport,
    publishSystemAnnouncement: async () => {
      throw new Error("not used");
    },
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

  it("guards system announcements behind an admin session", async () => {
    const publishCalls: unknown[] = [];
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => null,
      verifyAdminMutation: async () => false,
      publishSystemAnnouncement: async (input) => {
        publishCalls.push(input);
        return systemAnnouncement;
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/announcements",
      payload: { body: "今晚 22:00 将进行世界重置演练。" }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Admin session required" }
    });
    expect(publishCalls).toEqual([]);
  });

  it("rejects system announcements without an admin mutation token", async () => {
    const publishCalls: unknown[] = [];
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      verifyAdminMutation: async () => false,
      publishSystemAnnouncement: async (input) => {
        publishCalls.push(input);
        return systemAnnouncement;
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/announcements",
      payload: { body: "今晚 22:00 将进行世界重置演练。" }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: { code: "FORBIDDEN", message: "Admin mutation token required" }
    });
    expect(publishCalls).toEqual([]);
  });

  it("publishes a system announcement for admins", async () => {
    const publishCalls: unknown[] = [];
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      verifyAdminMutation: async () => true,
      publishSystemAnnouncement: async (input) => {
        publishCalls.push(input);
        return systemAnnouncement;
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/announcements",
      payload: { body: "  今晚 22:00 将进行世界重置演练。  " }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(systemAnnouncement);
    expect(publishCalls).toEqual([
      {
        adminAccountId: "admin-1",
        body: "今晚 22:00 将进行世界重置演练。"
      }
    ]);
  });

  it("rejects overlong system announcements", async () => {
    const publishCalls: unknown[] = [];
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      verifyAdminMutation: async () => true,
      publishSystemAnnouncement: async (input) => {
        publishCalls.push(input);
        return systemAnnouncement;
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/announcements",
      payload: { body: "长".repeat(241) }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: "VALIDATION_ERROR", message: "Invalid announcement input" }
    });
    expect(publishCalls).toEqual([]);
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

  it("revokes an unused activation code for admins", async () => {
    const revokeCalls: unknown[] = [];
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      verifyAdminMutation: async () => true,
      revokeActivationCodeWithAudit: async (input) => {
        revokeCalls.push(input);
        return { activationCodeId: "code-1", status: "revoked" };
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/activation-codes/code-1/revoke",
      payload: { reason: "内测名额回收" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ activationCodeId: "code-1", status: "revoked" });
    expect(revokeCalls).toEqual([
      {
        activationCodeId: "code-1",
        actorAccountId: "admin-1",
        reason: "内测名额回收"
      }
    ]);
  });

  it("rejects activation-code revoke without an admin mutation token", async () => {
    const revokeCalls: unknown[] = [];
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      verifyAdminMutation: async () => false,
      revokeActivationCodeWithAudit: async (input) => {
        revokeCalls.push(input);
        throw new Error("not used");
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/activation-codes/code-1/revoke",
      payload: { reason: "内测名额回收" }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: { code: "FORBIDDEN", message: "Admin mutation token required" }
    });
    expect(revokeCalls).toEqual([]);
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

  it("lists accounts for admins", async () => {
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      listAccounts: async () => adminAccountRows
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/accounts"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accounts: adminAccountRows });
  });

  it("guards account listing behind an admin session", async () => {
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => null
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/accounts"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Admin session required" }
    });
  });

  it("disables an account and revokes active sessions for admins", async () => {
    const disableCalls: unknown[] = [];
    const disabledAccount = { ...adminAccountRows[0]!, status: "disabled" as const };
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      verifyAdminMutation: async () => true,
      disableAccount: async (input) => {
        disableCalls.push(input);
        return { account: disabledAccount, revokedSessionCount: 2 };
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/accounts/account-1/disable",
      payload: { reason: "内测违规处理" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ account: disabledAccount, revokedSessionCount: 2 });
    expect(disableCalls).toEqual([
      {
        actorAccountId: "admin-1",
        targetAccountId: "account-1",
        reason: "内测违规处理"
      }
    ]);
  });

  it("rejects account disable without an admin mutation token", async () => {
    const disableCalls: unknown[] = [];
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      verifyAdminMutation: async () => false,
      disableAccount: async (input) => {
        disableCalls.push(input);
        throw new Error("not used");
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/accounts/account-1/disable",
      payload: { reason: "内测违规处理" }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: { code: "FORBIDDEN", message: "Admin mutation token required" }
    });
    expect(disableCalls).toEqual([]);
  });

  it("restores a disabled account for admins", async () => {
    const restoreCalls: unknown[] = [];
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      verifyAdminMutation: async () => true,
      restoreAccount: async (input) => {
        restoreCalls.push(input);
        return { account: adminAccountRows[0]!, revokedSessionCount: 0 };
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/accounts/account-1/restore",
      payload: { reason: "申诉通过恢复" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ account: adminAccountRows[0], revokedSessionCount: 0 });
    expect(restoreCalls).toEqual([
      {
        actorAccountId: "admin-1",
        targetAccountId: "account-1",
        reason: "申诉通过恢复"
      }
    ]);
  });

  it("revokes active sessions for an account", async () => {
    const revokeCalls: unknown[] = [];
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      verifyAdminMutation: async () => true,
      revokeAccountSessions: async (input) => {
        revokeCalls.push(input);
        return { accountId: "account-1", revokedSessionCount: 3 };
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/accounts/account-1/revoke-sessions",
      payload: { reason: "强制重新登录" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accountId: "account-1", revokedSessionCount: 3 });
    expect(revokeCalls).toEqual([
      {
        actorAccountId: "admin-1",
        targetAccountId: "account-1",
        reason: "强制重新登录"
      }
    ]);
  });

  it("guards the world reset route behind an admin session", async () => {
    const resetCalls: unknown[] = [];
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => null,
      verifyAdminMutation: async () => false,
      resetWorld: async (input) => {
        resetCalls.push(input);
        return worldResetResponse;
      },
      now: () => new Date("2026-07-01T00:00:00.000Z")
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/world-reset",
      payload: {
        confirmationText: "RESET BLACKPINE",
        reason: "经济系统崩溃后重置"
      }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Admin session required" }
    });
    expect(resetCalls).toEqual([]);
  });

  it("runs a real world reset for admins with a mutation token", async () => {
    const resetCalls: unknown[] = [];
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      verifyAdminMutation: async () => true,
      resetWorld: async (input) => {
        resetCalls.push(input);
        return worldResetResponse;
      },
      now: () => new Date("2026-07-01T00:00:00.000Z")
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/world-reset",
      payload: {
        confirmationText: "RESET BLACKPINE",
        reason: "经济系统崩溃后重置"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(worldResetResponse);
    expect(resetCalls).toEqual([
      {
        actorAccountId: "admin-1",
        confirmationText: "RESET BLACKPINE",
        reason: "经济系统崩溃后重置"
      }
    ]);
  });

  it("rejects world reset without an admin mutation token", async () => {
    const resetCalls: unknown[] = [];
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      verifyAdminMutation: async () => false,
      resetWorld: async (input) => {
        resetCalls.push(input);
        return worldResetResponse;
      },
      now: () => new Date("2026-07-01T00:00:00.000Z")
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/world-reset",
      payload: {
        confirmationText: "RESET BLACKPINE",
        reason: "经济系统崩溃后重置"
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: { code: "FORBIDDEN", message: "Admin mutation token required" }
    });
    expect(resetCalls).toEqual([]);
  });

  it("rejects malformed world reset input before calling the service", async () => {
    const resetCalls: unknown[] = [];
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      verifyAdminMutation: async () => true,
      resetWorld: async (input) => {
        resetCalls.push(input);
        return worldResetResponse;
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/world-reset",
      payload: {
        confirmationText: "RESET BLACKPINE",
        reason: "短"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: "VALIDATION_ERROR", message: "Invalid reset input" }
    });
    expect(resetCalls).toEqual([]);
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

  it("guards the asset ledger health behind an admin session", async () => {
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => null
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/asset-ledger/health"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Admin session required" }
    });
  });

  it("returns asset ledger health for admins", async () => {
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      getAssetLedgerHealth: async () => assetLedgerHealth
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/asset-ledger/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(assetLedgerHealth);
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

  it("guards AI layer status behind an admin session", async () => {
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => null
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/ai-layer/status"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Admin session required" }
    });
  });

  it("returns AI layer governance status for admins", async () => {
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      getAiLayerStatus: async () => aiLayerStatus
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/ai-layer/status"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(aiLayerStatus);
    expect(response.json().purposes[0].mutatesWorldState).toBe(false);
  });

  it("guards NPC memory behind an admin session", async () => {
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => null
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/npc-memory"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Admin session required" }
    });
  });

  it("returns NPC memory entries and fragments for admins", async () => {
    const app = buildAdminRouteTestApp({
      getCurrentAdmin: async () => ({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin"
      }),
      listNpcMemory: async () => ({
        entries: npcMemoryEntries,
        fragments: npcMemoryFragments
      }),
      now: () => new Date("2026-07-01T12:05:00.000Z")
    });

    const response = await app.inject({
      method: "GET",
      url: "/admin/npc-memory"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      generatedAt: "2026-07-01T12:05:00.000Z",
      entries: npcMemoryEntries,
      fragments: npcMemoryFragments
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
