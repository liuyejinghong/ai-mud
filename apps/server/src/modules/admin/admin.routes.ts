import { FIRST_ITEMS, getItemById } from "@ai-mud/content";
import { formatMoney } from "@ai-mud/game-rules";
import type {
  ActivationCodeDto,
  AdminAccountDto,
  AiCallLogDto,
  AiLayerStatusDto,
  ChatMessageDto,
  EconomySnapshotDto,
  ErrorCode,
  MoneyDto,
  NpcMemoryEntryDto,
  NpcMemoryFragmentDto,
  NpcSimulationReportDto,
  NpcSummaryDto,
  AccountOperationResponseDto,
  RevokeSessionsResponseDto,
  WorldRuntimeStatusDto
} from "@ai-mud/shared";
import { WORLD_COMPATIBILITY } from "@ai-mud/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { DrizzleActivationCodeRepository } from "../activation-code/activation-code.repository.js";
import { ActivationCodeService } from "../activation-code/activation-code.service.js";
import { AccountOpsRepository } from "../account-ops/account-ops.repository.js";
import {
  AccountOpsService,
  AccountOpsServiceError
} from "../account-ops/account-ops.service.js";
import { AnnouncementRepository } from "../announcement/announcement.repository.js";
import {
  AnnouncementService,
  AnnouncementServiceError
} from "../announcement/announcement.service.js";
import { DrizzleAuditWriter } from "../audit/audit.repository.js";
import { AiGovernanceService } from "../ai/ai-governance.service.js";
import type { AuditWriter } from "../audit/audit.service.js";
import { AuthRepository } from "../auth/auth.repository.js";
import { AuthService } from "../auth/auth.service.js";
import { DialogueRepository } from "../dialogue/dialogue.repository.js";
import { GameRepository } from "../game/game.repository.js";
import { NpcRepository } from "../npc/npc.repository.js";
import { NpcMemoryRepository } from "../npc-memory/npc-memory.repository.js";
import { NpcMemoryService } from "../npc-memory/npc-memory.service.js";
import { NpcService } from "../npc/npc.service.js";
import { WorldRuntimeRepository } from "../world-runtime/world-runtime.repository.js";
import {
  NPC_WORLD_RUNTIME_KEY,
  WORLD_RUNTIME_TICK_MS
} from "../world-runtime/world-runtime.service.js";
import { WorldResetService } from "../world-reset/world-reset.service.js";

export interface AdminAccount {
  id: string;
  email: string;
  role: "admin" | "super_admin";
}

export interface NpcSnapshotResponse {
  generatedAt: string;
  settlementId: "blackpine_outpost";
  treasury: MoneyDto;
  npcs: NpcSummaryDto[];
}

export interface AdminRouteDependencies {
  getCurrentAdmin(request: FastifyRequest): Promise<AdminAccount | null>;
  verifyAdminMutation(request: FastifyRequest): Promise<boolean>;
  listActivationCodes(): Promise<Array<ActivationCodeDto>>;
  getEconomySnapshot(): Promise<EconomySnapshotDto>;
  getNpcSnapshot(): Promise<NpcSnapshotResponse>;
  getWorldRuntimeStatus(): Promise<WorldRuntimeStatusDto>;
  listAiCallLogs(): Promise<AiCallLogDto[]>;
  getAiLayerStatus(): Promise<AiLayerStatusDto>;
  listAccounts(): Promise<AdminAccountDto[]>;
  disableAccount(input: {
    actorAccountId: string;
    targetAccountId: string;
    reason: string;
  }): Promise<AccountOperationResponseDto>;
  restoreAccount(input: {
    actorAccountId: string;
    targetAccountId: string;
    reason: string;
  }): Promise<AccountOperationResponseDto>;
  revokeAccountSessions(input: {
    actorAccountId: string;
    targetAccountId: string;
    reason: string;
  }): Promise<RevokeSessionsResponseDto>;
  listNpcMemory(): Promise<{
    entries: NpcMemoryEntryDto[];
    fragments: NpcMemoryFragmentDto[];
  }>;
  settleNpcWorld(): Promise<NpcSnapshotResponse>;
  runNpcSimulation(input: {
    days: number;
    startAt: Date;
  }): Promise<NpcSimulationReportDto>;
  publishSystemAnnouncement(input: {
    adminAccountId: string;
    body: string;
  }): Promise<ChatMessageDto>;
  createActivationCodeWithAudit(input: {
    note?: string;
    createdByAdminId: string;
    expiresAt: Date | null;
    metadata?: Record<string, unknown>;
  }): Promise<{ code: string; activationCode: ActivationCodeDto }>;
  revokeActivationCodeWithAudit(input: {
    activationCodeId: string;
    actorAccountId: string;
    reason: string;
  }): Promise<{ activationCodeId: string; status: "revoked" }>;
  writeAudit(input: Parameters<AuditWriter["write"]>[0]): Promise<void>;
  now(): Date;
}

const createActivationCodeSchema = z.object({
  note: z.string().max(200).optional(),
  expiresAt: z.string().datetime().optional()
});

const softResetSchema = z.object({
  confirmationText: z.string(),
  reason: z.string().min(8)
});

const npcSimulationSchema = z.object({
  days: z.number().int().min(1).max(7).default(1),
  startAt: z.string().datetime().optional()
});

const systemAnnouncementSchema = z.object({
  body: z.string().trim().min(1).max(240)
});

const adminReasonSchema = z.object({
  reason: z.string().trim().min(4).max(240)
});

const BLACKPINE_MARKET_ID = "blackpine_outpost";

function sendError(reply: FastifyReply, statusCode: number, code: ErrorCode, message: string) {
  return reply.code(statusCode).send({ error: { code, message } });
}

function hasAdminRouteDependencies(value: unknown): value is AdminRouteDependencies {
  return (
    typeof value === "object" &&
    value !== null &&
    "getCurrentAdmin" in value &&
    typeof value.getCurrentAdmin === "function"
  );
}

function toActivationCodeDto(record: {
  id: string;
  status: ActivationCodeDto["status"];
  note: string | null;
  usedByAccountId: string | null;
  expiresAt: Date | string | null;
  createdAt: Date | string;
  usedAt: Date | string | null;
  revokedAt: Date | string | null;
}): ActivationCodeDto {
  return {
    id: record.id,
    status: record.status,
    note: record.note,
    usedByAccountId: record.usedByAccountId,
    expiresAt: record.expiresAt ? new Date(record.expiresAt).toISOString() : null,
    createdAt: new Date(record.createdAt).toISOString(),
    usedAt: record.usedAt ? new Date(record.usedAt).toISOString() : null,
    revokedAt: record.revokedAt ? new Date(record.revokedAt).toISOString() : null
  };
}

async function buildEconomySnapshot(repo: GameRepository, now: Date): Promise<EconomySnapshotDto> {
  const inventory = await repo.listMarketInventory(BLACKPINE_MARKET_ID);
  const inventoryByItemId = new Map(inventory.map((item) => [item.itemId, item]));
  const allTransactions = await repo.listAllMarketTransactions(BLACKPINE_MARKET_ID);
  const recentTransactions = await repo.listMarketTransactions({
    settlementId: BLACKPINE_MARKET_ID,
    limit: 20
  });
  const taxSummary = allTransactions.reduce(
    (summary, transaction) => ({
      transactionCount: summary.transactionCount + 1,
      grossCopper: summary.grossCopper + transaction.grossCopper,
      taxCopper: summary.taxCopper + transaction.taxCopper,
      buyTaxCopper:
        summary.buyTaxCopper + (transaction.transactionType === "buy" ? transaction.taxCopper : 0),
      sellTaxCopper:
        summary.sellTaxCopper + (transaction.transactionType === "sell" ? transaction.taxCopper : 0),
      netCopper: summary.netCopper + transaction.netCopper
    }),
    {
      transactionCount: 0,
      grossCopper: 0,
      taxCopper: 0,
      buyTaxCopper: 0,
      sellTaxCopper: 0,
      netCopper: 0
    }
  );

  return {
    settlementId: BLACKPINE_MARKET_ID,
    settlementName: "黑松哨站市政集市",
    generatedAt: now.toISOString(),
    taxSummary,
    marketItems: FIRST_ITEMS.map((item) => {
      const marketItem = inventoryByItemId.get(item.id);
      return {
        itemId: item.id,
        name: item.name,
        category: item.category,
        itemLevel: item.itemLevel,
        stockQuantity: marketItem?.quantity ?? Math.floor(item.targetMarketQuantity / 2),
        targetQuantity: marketItem?.targetQuantity ?? item.targetMarketQuantity,
        baseBuyPrice: formatMoney(marketItem?.baseBuyPriceCopper ?? item.baseBuyPriceCopper),
        baseSellPrice: formatMoney(marketItem?.baseSellPriceCopper ?? item.baseSellPriceCopper)
      };
    }),
    recentTransactions: recentTransactions.map((transaction) => {
      const item = getItemById(transaction.itemId);
      return {
        id: transaction.id,
        settlementId: BLACKPINE_MARKET_ID,
        actorId: transaction.actorId ?? transaction.characterId ?? "unknown",
        actorType: transaction.actorType,
        actorName: transaction.actorName,
        characterId: transaction.characterId,
        transactionType: transaction.transactionType,
        itemId: transaction.itemId,
        itemName: item?.name ?? transaction.itemId,
        quantity: transaction.quantity,
        unitPrice: formatMoney(transaction.unitPriceCopper),
        gross: formatMoney(transaction.grossCopper),
        tax: formatMoney(transaction.taxCopper),
        net: formatMoney(transaction.netCopper),
        createdAt: transaction.createdAt.toISOString()
      };
    })
  };
}

async function buildNpcSnapshot(
  repo: NpcRepository,
  service: NpcService,
  now: Date
): Promise<NpcSnapshotResponse> {
  await service.ensureWorldSeeded(now);
  const treasury = await repo.findMunicipalTreasury(BLACKPINE_MARKET_ID);

  return {
    generatedAt: now.toISOString(),
    settlementId: BLACKPINE_MARKET_ID,
    treasury: formatMoney(treasury?.copperBalance ?? 0),
    npcs: await service.listNpcSummaries(now)
  };
}

async function buildWorldRuntimeStatus(
  repo: WorldRuntimeRepository,
  now: Date
): Promise<WorldRuntimeStatusDto> {
  const record = await repo.find(NPC_WORLD_RUNTIME_KEY);
  const nextTickAt = record?.lastSettledAt
    ? new Date(record.lastSettledAt.getTime() + WORLD_RUNTIME_TICK_MS)
    : null;

  return {
    key: NPC_WORLD_RUNTIME_KEY,
    generatedAt: now.toISOString(),
    lastSettledAt: record?.lastSettledAt?.toISOString() ?? null,
    nextTickAt: nextTickAt?.toISOString() ?? null,
    leaseOwner: record?.leaseOwner ?? null,
    leaseUntil: record?.leaseUntil?.toISOString() ?? null
  };
}

function createDefaultDependencies(app: FastifyInstance): AdminRouteDependencies {
  const auth = new AuthService();
  const authRepo = new AuthRepository(app.di.db);
  const now = () => new Date();

  return {
    getCurrentAdmin: async (request) => {
      const token = request.cookies[app.config.SESSION_COOKIE_NAME];
      if (!token) return null;

      const account = await authRepo.findAccountBySessionTokenHash(auth.hashToken(token));
      if (!account || account.status !== "active") return null;
      if (account.role !== "admin" && account.role !== "super_admin") return null;

      return {
        id: account.id,
        email: account.email,
        role: account.role
      };
    },
    verifyAdminMutation: async (request) => {
      const token = request.cookies[app.config.SESSION_COOKIE_NAME];
      const csrfToken = request.headers["x-ai-mud-csrf"];
      if (!token || typeof csrfToken !== "string") return false;
      return auth.verifyCsrfToken(token, app.config.SESSION_SECRET, csrfToken);
    },
    listActivationCodes: async () => {
      const activationCodeRepo = new DrizzleActivationCodeRepository(app.di.db);
      const records = await activationCodeRepo.listForAdmin();
      return records.map(toActivationCodeDto);
    },
    getEconomySnapshot: async () => {
      const repo = new GameRepository(app.di.db);
      return buildEconomySnapshot(repo, now());
    },
    getNpcSnapshot: async () => {
      const repo = new NpcRepository(app.di.db);
      const service = new NpcService(repo);
      const timestamp = now();
      await app.di.worldRuntime.settleDue(timestamp);
      return buildNpcSnapshot(repo, service, timestamp);
    },
    getWorldRuntimeStatus: async () => {
      const repo = new WorldRuntimeRepository(app.di.db);
      return buildWorldRuntimeStatus(repo, now());
    },
    listAiCallLogs: async () => {
      const repo = new DialogueRepository(app.di.db);
      return repo.listAiCallLogs({ limit: 50 });
    },
    getAiLayerStatus: async () => {
      const repo = new DialogueRepository(app.di.db);
      const service = new AiGovernanceService(repo, {
        providerEnabled: app.config.AI_NPC_DIALOGUE_ENABLED,
        providerName: app.config.AI_PROVIDER,
        model: app.config.AI_NPC_DIALOGUE_ENABLED ? app.config.DEEPSEEK_MODEL : null,
        promptVersion: WORLD_COMPATIBILITY.promptVersion,
        dailyTokenBudget: app.config.AI_DAILY_TOKEN_BUDGET
      });
      return service.getStatus(now());
    },
    listAccounts: async () => {
      const service = new AccountOpsService({
        repository: new AccountOpsRepository(app.di.db),
        audit: new DrizzleAuditWriter(app.di.db)
      });
      return service.listAccounts();
    },
    disableAccount: async (input) =>
      app.di.db.transaction(async (tx) => {
        const service = new AccountOpsService({
          repository: new AccountOpsRepository(tx),
          audit: new DrizzleAuditWriter(tx)
        });
        return service.disableAccount(input);
      }),
    restoreAccount: async (input) =>
      app.di.db.transaction(async (tx) => {
        const service = new AccountOpsService({
          repository: new AccountOpsRepository(tx),
          audit: new DrizzleAuditWriter(tx)
        });
        return service.restoreAccount(input);
      }),
    revokeAccountSessions: async (input) =>
      app.di.db.transaction(async (tx) => {
        const service = new AccountOpsService({
          repository: new AccountOpsRepository(tx),
          audit: new DrizzleAuditWriter(tx)
        });
        return service.revokeSessions(input);
      }),
    listNpcMemory: async () => {
      const memory = new NpcMemoryService(new NpcMemoryRepository(app.di.db));
      return memory.listAdminMemory({ limit: 50 });
    },
    settleNpcWorld: async () => {
      const repo = new NpcRepository(app.di.db);
      const service = new NpcService(repo);
      const timestamp = now();
      await app.di.worldRuntime.settleDue(timestamp);
      return buildNpcSnapshot(repo, service, timestamp);
    },
    runNpcSimulation: async (input) => {
      const repo = new NpcRepository(app.di.db);
      const service = new NpcService(repo);
      return service.runNpcSimulation(input.days, input.startAt);
    },
    publishSystemAnnouncement: async (input) =>
      app.di.db.transaction(async (tx) => {
        const service = new AnnouncementService({
          repository: new AnnouncementRepository(tx),
          audit: new DrizzleAuditWriter(tx),
          now
        });
        return service.publish(input);
      }),
    createActivationCodeWithAudit: async (input) =>
      app.di.db.transaction(async (tx) => {
        const activationCodeRepo = new DrizzleActivationCodeRepository(tx);
        const activationCodes = new ActivationCodeService(activationCodeRepo);
        const audit = new DrizzleAuditWriter(tx);
        const created = await activationCodes.create({
          ...(input.note ? { note: input.note } : {}),
          createdByAdminId: input.createdByAdminId,
          expiresAt: input.expiresAt
        });
        const activationCode: ActivationCodeDto = {
          id: created.activationCodeId,
          status: "unused",
          note: input.note ?? null,
          usedByAccountId: null,
          expiresAt: input.expiresAt?.toISOString() ?? null,
          createdAt: now().toISOString(),
          usedAt: null,
          revokedAt: null
        };

        await audit.write({
          actorAccountId: input.createdByAdminId,
          action: "activation_code.create",
          targetType: "activation_code",
          targetId: activationCode.id,
          reason: activationCode.note,
          metadata: input.metadata ?? {}
        });

        return { code: created.code, activationCode };
      }),
    revokeActivationCodeWithAudit: async (input) =>
      app.di.db.transaction(async (tx) => {
        const activationCodes = new ActivationCodeService(
          new DrizzleActivationCodeRepository(tx)
        );
        const revoked = await activationCodes.revokeUnused(input.activationCodeId);
        if (!revoked.ok) {
          throw new AccountOpsServiceError(
            "VALIDATION_ERROR",
            "激活码不存在或已被使用，不能作废。"
          );
        }
        const audit = new DrizzleAuditWriter(tx);
        await audit.write({
          actorAccountId: input.actorAccountId,
          action: "activation_code.revoke",
          targetType: "activation_code",
          targetId: input.activationCodeId,
          reason: input.reason,
          metadata: { status: "revoked" }
        });
        return { activationCodeId: input.activationCodeId, status: "revoked" };
      }),
    writeAudit: async (input) => {
      const audit = new DrizzleAuditWriter(app.di.db);
      await audit.write(input);
    },
    now
  };
}

export async function registerAdminRoutes(
  app: FastifyInstance,
  maybeDependencies?: unknown
) {
  const deps = hasAdminRouteDependencies(maybeDependencies)
    ? maybeDependencies
    : createDefaultDependencies(app);

  app.get("/admin/activation-codes", async (request, reply) => {
    const admin = await deps.getCurrentAdmin(request);
    if (!admin) {
      return sendError(reply, 401, "UNAUTHENTICATED", "Admin session required");
    }

    return { activationCodes: await deps.listActivationCodes() };
  });

  app.get("/admin/accounts", async (request, reply) => {
    const admin = await deps.getCurrentAdmin(request);
    if (!admin) {
      return sendError(reply, 401, "UNAUTHENTICATED", "Admin session required");
    }

    return { accounts: await deps.listAccounts() };
  });

  app.get("/admin/economy", async (request, reply) => {
    const admin = await deps.getCurrentAdmin(request);
    if (!admin) {
      return sendError(reply, 401, "UNAUTHENTICATED", "Admin session required");
    }

    return deps.getEconomySnapshot();
  });

  app.get("/admin/npcs", async (request, reply) => {
    const admin = await deps.getCurrentAdmin(request);
    if (!admin) {
      return sendError(reply, 401, "UNAUTHENTICATED", "Admin session required");
    }

    return deps.getNpcSnapshot();
  });

  app.get("/admin/world-runtime", async (request, reply) => {
    const admin = await deps.getCurrentAdmin(request);
    if (!admin) {
      return sendError(reply, 401, "UNAUTHENTICATED", "Admin session required");
    }

    return deps.getWorldRuntimeStatus();
  });

  app.get("/admin/ai-calls", async (request, reply) => {
    const admin = await deps.getCurrentAdmin(request);
    if (!admin) {
      return sendError(reply, 401, "UNAUTHENTICATED", "Admin session required");
    }

    return {
      generatedAt: deps.now().toISOString(),
      aiCalls: await deps.listAiCallLogs()
    };
  });

  app.get("/admin/ai-layer/status", async (request, reply) => {
    const admin = await deps.getCurrentAdmin(request);
    if (!admin) {
      return sendError(reply, 401, "UNAUTHENTICATED", "Admin session required");
    }

    return deps.getAiLayerStatus();
  });

  app.get("/admin/npc-memory", async (request, reply) => {
    const admin = await deps.getCurrentAdmin(request);
    if (!admin) {
      return sendError(reply, 401, "UNAUTHENTICATED", "Admin session required");
    }

    return {
      generatedAt: deps.now().toISOString(),
      ...(await deps.listNpcMemory())
    };
  });

  app.post("/admin/npcs/settle", async (request, reply) => {
    const admin = await deps.getCurrentAdmin(request);
    if (!admin) {
      return sendError(reply, 401, "UNAUTHENTICATED", "Admin session required");
    }
    if (!(await deps.verifyAdminMutation(request))) {
      return sendError(reply, 403, "FORBIDDEN", "Admin mutation token required");
    }

    return deps.settleNpcWorld();
  });

  app.post("/admin/npcs/simulate", async (request, reply) => {
    const admin = await deps.getCurrentAdmin(request);
    if (!admin) {
      return sendError(reply, 401, "UNAUTHENTICATED", "Admin session required");
    }
    if (!(await deps.verifyAdminMutation(request))) {
      return sendError(reply, 403, "FORBIDDEN", "Admin mutation token required");
    }

    const parsed = npcSimulationSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid NPC simulation input");
    }

    return deps.runNpcSimulation({
      days: parsed.data.days,
      startAt: parsed.data.startAt ? new Date(parsed.data.startAt) : deps.now()
    });
  });

  app.post("/admin/announcements", async (request, reply) => {
    const admin = await deps.getCurrentAdmin(request);
    if (!admin) {
      return sendError(reply, 401, "UNAUTHENTICATED", "Admin session required");
    }
    if (!(await deps.verifyAdminMutation(request))) {
      return sendError(reply, 403, "FORBIDDEN", "Admin mutation token required");
    }

    const parsed = systemAnnouncementSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid announcement input");
    }

    try {
      return await deps.publishSystemAnnouncement({
        adminAccountId: admin.id,
        body: parsed.data.body
      });
    } catch (error) {
      if (error instanceof AnnouncementServiceError) {
        return sendError(reply, 400, error.code, error.message);
      }
      throw error;
    }
  });

  app.post("/admin/activation-codes", async (request, reply) => {
    const admin = await deps.getCurrentAdmin(request);
    if (!admin) {
      return sendError(reply, 401, "UNAUTHENTICATED", "Admin session required");
    }
    if (!(await deps.verifyAdminMutation(request))) {
      return sendError(reply, 403, "FORBIDDEN", "Admin mutation token required");
    }

    const parsed = createActivationCodeSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid activation-code input");
    }

    const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
    const result = await deps.createActivationCodeWithAudit({
      ...(parsed.data.note ? { note: parsed.data.note } : {}),
      createdByAdminId: admin.id,
      expiresAt,
      metadata: { expiresAt: expiresAt?.toISOString() ?? null }
    });

    return result;
  });

  app.post("/admin/activation-codes/:activationCodeId/revoke", async (request, reply) => {
    const admin = await deps.getCurrentAdmin(request);
    if (!admin) {
      return sendError(reply, 401, "UNAUTHENTICATED", "Admin session required");
    }
    if (!(await deps.verifyAdminMutation(request))) {
      return sendError(reply, 403, "FORBIDDEN", "Admin mutation token required");
    }

    const params = z.object({ activationCodeId: z.string().min(1) }).safeParse(request.params);
    const body = adminReasonSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid activation-code revoke input");
    }

    try {
      return await deps.revokeActivationCodeWithAudit({
        activationCodeId: params.data.activationCodeId,
        actorAccountId: admin.id,
        reason: body.data.reason
      });
    } catch (error) {
      if (error instanceof AccountOpsServiceError) {
        return sendError(reply, 400, error.code, error.message);
      }
      throw error;
    }
  });

  app.post("/admin/accounts/:accountId/disable", async (request, reply) => {
    const admin = await deps.getCurrentAdmin(request);
    if (!admin) {
      return sendError(reply, 401, "UNAUTHENTICATED", "Admin session required");
    }
    if (!(await deps.verifyAdminMutation(request))) {
      return sendError(reply, 403, "FORBIDDEN", "Admin mutation token required");
    }

    const params = z.object({ accountId: z.string().min(1) }).safeParse(request.params);
    const body = adminReasonSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid account disable input");
    }

    try {
      return await deps.disableAccount({
        actorAccountId: admin.id,
        targetAccountId: params.data.accountId,
        reason: body.data.reason
      });
    } catch (error) {
      if (error instanceof AccountOpsServiceError) {
        return sendError(reply, 400, error.code, error.message);
      }
      throw error;
    }
  });

  app.post("/admin/accounts/:accountId/restore", async (request, reply) => {
    const admin = await deps.getCurrentAdmin(request);
    if (!admin) {
      return sendError(reply, 401, "UNAUTHENTICATED", "Admin session required");
    }
    if (!(await deps.verifyAdminMutation(request))) {
      return sendError(reply, 403, "FORBIDDEN", "Admin mutation token required");
    }

    const params = z.object({ accountId: z.string().min(1) }).safeParse(request.params);
    const body = adminReasonSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid account restore input");
    }

    try {
      return await deps.restoreAccount({
        actorAccountId: admin.id,
        targetAccountId: params.data.accountId,
        reason: body.data.reason
      });
    } catch (error) {
      if (error instanceof AccountOpsServiceError) {
        return sendError(reply, 400, error.code, error.message);
      }
      throw error;
    }
  });

  app.post("/admin/accounts/:accountId/revoke-sessions", async (request, reply) => {
    const admin = await deps.getCurrentAdmin(request);
    if (!admin) {
      return sendError(reply, 401, "UNAUTHENTICATED", "Admin session required");
    }
    if (!(await deps.verifyAdminMutation(request))) {
      return sendError(reply, 403, "FORBIDDEN", "Admin mutation token required");
    }

    const params = z.object({ accountId: z.string().min(1) }).safeParse(request.params);
    const body = adminReasonSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid session revoke input");
    }

    try {
      return await deps.revokeAccountSessions({
        actorAccountId: admin.id,
        targetAccountId: params.data.accountId,
        reason: body.data.reason
      });
    } catch (error) {
      if (error instanceof AccountOpsServiceError) {
        return sendError(reply, 400, error.code, error.message);
      }
      throw error;
    }
  });

  app.post("/admin/world-reset/soft", async (request, reply) => {
    const admin = await deps.getCurrentAdmin(request);
    if (!admin) {
      return sendError(reply, 401, "UNAUTHENTICATED", "Admin session required");
    }
    if (!(await deps.verifyAdminMutation(request))) {
      return sendError(reply, 403, "FORBIDDEN", "Admin mutation token required");
    }

    const parsed = softResetSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid reset input");
    }

    const service = new WorldResetService();
    const result = await service.requestSoftReset({
      actorAccountId: admin.id,
      confirmationText: parsed.data.confirmationText,
      reason: parsed.data.reason
    });

    if (!result.ok) {
      return sendError(reply, 400, "VALIDATION_ERROR", result.reason);
    }

    await deps.writeAudit({
      actorAccountId: admin.id,
      action: "world_reset.soft.request",
      targetType: "world",
      targetId: null,
      reason: parsed.data.reason,
      metadata: { mode: result.mode }
    });

    return result;
  });
}
