// R1 landing 路由：加工槽维护 / 电力策略 / 制造暂停恢复。
import { randomUUID } from "node:crypto";
import type { ErrorCode } from "@ai-mud/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { BaseOperationError } from "../../application/base/create-project.js";
import type { BaseAuthFacade } from "../../application/base/ports.js";

function sendError(reply: FastifyReply, statusCode: number, code: ErrorCode, message: string) {
  return reply.code(statusCode).send({ error: { code, message } });
}

export interface BaseProductionRouteDeps {
  auth: BaseAuthFacade;
  maintain: {
    execute(
      principal: { accountId: string },
      input: { siteId: string; commandId: string; expectedBaseRevision?: number; controlToken?: string | null }
    ): Promise<{ slotId: string; batchesSinceMaintenance: number; duplicate: boolean }>;
  };
  powerPolicy: {
    execute(
      principal: { accountId: string },
      input: {
        priority: "production" | "charging"; commandId: string; expectedBaseRevision?: number;
        controlToken?: string | null;
      }
    ): Promise<{ priority: "production" | "charging"; duplicate: boolean }>;
  };
  pauseJob: {
    execute(
      principal: { accountId: string },
      input: { jobId: string; commandId: string; expectedBaseRevision?: number; controlToken?: string | null }
    ): Promise<{ jobId: string; status: string; duplicate: boolean }>;
  };
  resumeJob: {
    execute(
      principal: { accountId: string },
      input: { jobId: string; commandId: string; expectedBaseRevision?: number; controlToken?: string | null }
    ): Promise<{ jobId: string; status: string; duplicate: boolean }>;
  };
}

const maintainSchema = z.object({
  commandId: z.string().uuid().optional(),
  expectedBaseRevision: z.number().int().positive().optional()
});

const policySchema = z.object({
  priority: z.enum(["production", "charging"]),
  commandId: z.string().uuid().optional(),
  expectedBaseRevision: z.number().int().positive().optional()
});

const jobActionSchema = z.object({
  commandId: z.string().uuid().optional(),
  expectedBaseRevision: z.number().int().positive().optional()
});

const idSchema = z.string().uuid();

export async function registerBaseProductionRoutes(
  app: FastifyInstance,
  deps: BaseProductionRouteDeps
) {
  // R1：新写命令与旧面同权——需有效控制租约（X-Base-Control-Token；03 §4）。
  const requireSession = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<{ accountId: string; controlToken: string | null } | null> => {
    const token = request.cookies[app.config.SESSION_COOKIE_NAME];
    if (!token) {
      void sendError(reply, 401, "UNAUTHENTICATED", "未登录。");
      return null;
    }
    const principal = await deps.auth.resolvePrincipal(token);
    if (!principal) {
      void sendError(reply, 401, "UNAUTHENTICATED", "未登录。");
      return null;
    }
    const csrfToken = request.headers["x-csrf-token"];
    if (typeof csrfToken !== "string" || !deps.auth.verifyCsrf(token, csrfToken)) {
      void sendError(reply, 403, "FORBIDDEN", "CSRF 令牌缺失或不有效。");
      return null;
    }
    return {
      accountId: principal.accountId,
      controlToken:
        typeof request.headers["x-base-control-token"] === "string"
          ? request.headers["x-base-control-token"]
          : null
    };
  };

  const guard = async (
    request: FastifyRequest,
    reply: FastifyReply,
    handler: (session: { accountId: string; controlToken: string | null }) => Promise<FastifyReply>
  ): Promise<FastifyReply> => {
    const session = await requireSession(request, reply);
    if (!session) return reply;
    try {
      return await handler(session);
    } catch (error) {
      if (error instanceof BaseOperationError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      throw error;
    }
  };

  app.post<{ Params: { siteId: string } }>(
    "/base/production-slots/:siteId/maintain",
    async (request, reply) =>
      guard(request, reply, async (session) => {
        const siteId = idSchema.safeParse(request.params.siteId);
        if (!siteId.success) return sendError(reply, 404, "VALIDATION_ERROR", "站点不存在。");
        const parsed = maintainSchema.safeParse(request.body ?? {});
        if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "维护请求格式无效。");
        const result = await deps.maintain.execute(session, {
          siteId: siteId.data,
          commandId: parsed.data.commandId ?? randomUUID(),
          ...(parsed.data.expectedBaseRevision !== undefined
            ? { expectedBaseRevision: parsed.data.expectedBaseRevision }
            : {}),
          controlToken: session.controlToken
        });
        return reply.code(200).send(result);
      })
  );

  app.post("/base/power-policy", async (request, reply) =>
    guard(request, reply, async (session) => {
      const parsed = policySchema.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "策略请求格式无效。");
      const result = await deps.powerPolicy.execute(session, {
        priority: parsed.data.priority,
        commandId: parsed.data.commandId ?? randomUUID(),
        ...(parsed.data.expectedBaseRevision !== undefined
          ? { expectedBaseRevision: parsed.data.expectedBaseRevision }
          : {}),
        controlToken: session.controlToken
      });
      return reply.code(200).send(result);
    })
  );

  for (const action of ["pause", "resume"] as const) {
    app.post<{ Params: { jobId: string } }>(
      `/base/manufacturing/:jobId/${action}`,
      async (request, reply) =>
        guard(request, reply, async (session) => {
          const jobId = idSchema.safeParse(request.params.jobId);
          if (!jobId.success) return sendError(reply, 404, "VALIDATION_ERROR", "工单不存在。");
          const parsed = jobActionSchema.safeParse(request.body ?? {});
          if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "请求格式无效。");
          const input = {
            jobId: jobId.data,
            commandId: parsed.data.commandId ?? randomUUID(),
            ...(parsed.data.expectedBaseRevision !== undefined
              ? { expectedBaseRevision: parsed.data.expectedBaseRevision }
              : {}),
            controlToken: session.controlToken
          };
          const result = action === "pause"
            ? await deps.pauseJob.execute(session, input)
            : await deps.resumeJob.execute(session, input);
          return reply.code(200).send(result);
        })
    );
  }
}
