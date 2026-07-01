import { FIRST_ITEMS, getItemById } from "@ai-mud/content";
import { formatMoney } from "@ai-mud/game-rules";
import type { ActivationCodeDto, EconomySnapshotDto, ErrorCode } from "@ai-mud/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { DrizzleActivationCodeRepository } from "../activation-code/activation-code.repository.js";
import { ActivationCodeService } from "../activation-code/activation-code.service.js";
import { DrizzleAuditWriter } from "../audit/audit.repository.js";
import type { AuditWriter } from "../audit/audit.service.js";
import { AuthRepository } from "../auth/auth.repository.js";
import { AuthService } from "../auth/auth.service.js";
import { GameRepository } from "../game/game.repository.js";
import { WorldResetService } from "../world-reset/world-reset.service.js";

export interface AdminAccount {
  id: string;
  email: string;
  role: "admin" | "super_admin";
}

export interface AdminRouteDependencies {
  getCurrentAdmin(request: FastifyRequest): Promise<AdminAccount | null>;
  verifyAdminMutation(request: FastifyRequest): Promise<boolean>;
  listActivationCodes(): Promise<Array<ActivationCodeDto>>;
  getEconomySnapshot(): Promise<EconomySnapshotDto>;
  createActivationCodeWithAudit(input: {
    note?: string;
    createdByAdminId: string;
    expiresAt: Date | null;
    metadata?: Record<string, unknown>;
  }): Promise<{ code: string; activationCode: ActivationCodeDto }>;
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

  app.get("/admin/economy", async (request, reply) => {
    const admin = await deps.getCurrentAdmin(request);
    if (!admin) {
      return sendError(reply, 401, "UNAUTHENTICATED", "Admin session required");
    }

    return deps.getEconomySnapshot();
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
