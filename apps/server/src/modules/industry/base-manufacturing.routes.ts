// M13-C 制造工单路由（REST 面见 m13-p-contract.md §3；台账登记为 transport，仅 import
// application 与 kernel）。deps 必填（无默认依赖）：composition 绑定
// Create/CancelManufacturingJobCase 与 auth 门面。鉴权 + CSRF 模式与错误映射同
// base-projects.routes.ts（cookie = app.config.SESSION_COOKIE_NAME，头 x-csrf-token）。
import { randomUUID } from "node:crypto";
import type { ErrorCode } from "@ai-mud/shared";
import { MANUFACTURING_MAX_OUTPUTS } from "@ai-mud/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { BaseOperationError } from "../../application/manufacturing/create-job.js";
import type { CreateManufacturingJobUseCase } from "../../application/manufacturing/create-job.js";
import type { CancelManufacturingJobUseCase } from "../../application/manufacturing/cancel-job.js";
import type { BaseAuthFacade } from "../../application/base/ports.js";

const createJobSchema = z.object({
  recipeRef: z.object({
    kind: z.literal("recipe"),
    stableId: z.string().min(1).max(64),
    revision: z.number().int().positive()
  }),
  outputsPlanned: z.number().int().min(1).max(MANUFACTURING_MAX_OUTPUTS),
  commandId: z.string().uuid().optional()
});

const cancelJobSchema = z.object({
  commandId: z.string().uuid().optional()
});

const jobIdSchema = z.string().uuid();

function sendError(reply: FastifyReply, statusCode: number, code: ErrorCode, message: string) {
  return reply.code(statusCode).send({ error: { code, message } });
}

interface SessionContext {
  token: string;
  accountId: string;
}

export interface BaseManufacturingRouteDeps {
  auth: BaseAuthFacade;
  create: CreateManufacturingJobUseCase;
  cancel: CancelManufacturingJobUseCase;
}

export async function registerBaseManufacturingRoutes(
  app: FastifyInstance,
  deps: BaseManufacturingRouteDeps
) {
  // 登录态 + CSRF（写命令必须携带 x-csrf-token）。
  const requireSession = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<SessionContext | null> => {
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
    return { token, accountId: principal.accountId };
  };

  app.post("/base/manufacturing", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return reply;

    const parsed = createJobSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "制造请求格式无效。");
    }

    try {
      const result = await deps.create.execute(
        { accountId: session.accountId },
        {
          recipeRef: {
            kind: "recipe",
            stableId: parsed.data.recipeRef.stableId,
            revision: parsed.data.recipeRef.revision
          },
          outputsPlanned: parsed.data.outputsPlanned,
          commandId: parsed.data.commandId ?? randomUUID()
        }
      );
      return reply.code(result.duplicate ? 200 : 201).send(result);
    } catch (error) {
      if (error instanceof BaseOperationError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      throw error;
    }
  });

  app.post<{ Params: { jobId: string } }>(
    "/base/manufacturing/:jobId/cancel",
    async (request, reply) => {
      const session = await requireSession(request, reply);
      if (!session) return reply;

      const jobId = jobIdSchema.safeParse(request.params.jobId);
      if (!jobId.success) {
        return sendError(reply, 404, "VALIDATION_ERROR", "工单不存在。");
      }
      const parsed = cancelJobSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return sendError(reply, 400, "VALIDATION_ERROR", "取消请求格式无效。");
      }

      try {
        const result = await deps.cancel.execute(
          { accountId: session.accountId },
          { jobId: jobId.data, commandId: parsed.data.commandId ?? randomUUID() }
        );
        return reply.code(200).send(result);
      } catch (error) {
        if (error instanceof BaseOperationError) {
          return sendError(reply, error.statusCode, error.code, error.message);
        }
        throw error;
      }
    }
  );
}
