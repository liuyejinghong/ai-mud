import type { ActivationCodeDto, ErrorCode } from "@ai-mud/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { DrizzleActivationCodeRepository } from "../activation-code/activation-code.repository.js";
import { ActivationCodeService } from "../activation-code/activation-code.service.js";
import { DrizzleAuditWriter } from "../audit/audit.repository.js";
import type { AuditWriter } from "../audit/audit.service.js";
import { AuthRepository } from "../auth/auth.repository.js";
import { AuthService } from "../auth/auth.service.js";
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
