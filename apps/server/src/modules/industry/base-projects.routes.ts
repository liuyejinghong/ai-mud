// M12-B 项目创建/取消路由（REST 面见 m12-p-contract.md §6；台账登记为 transport，仅 import
// application 与 kernel）。deps 必填（无默认依赖）：composition 绑定
// CreateProjectCase/CancelProjectCase 与 auth 门面。鉴权 + CSRF 模式同 auth.routes
// （cookie = app.config.SESSION_COOKIE_NAME，头 x-csrf-token）。
import { randomUUID } from "node:crypto";
import type { ErrorCode } from "@ai-mud/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { BaseOperationError } from "../../application/base/create-project.js";
import type { BaseProjectsRouteDeps } from "../../application/base/ports.js";

const createProjectSchema = z.object({
  definitionRef: z.object({
    kind: z.literal("project"),
    stableId: z.string().min(1).max(64),
    revision: z.number().int().positive()
  }),
  siteId: z.string().uuid(),
  commandId: z.string().uuid().optional()
});

const cancelProjectSchema = z.object({
  commandId: z.string().uuid().optional()
});

const projectIdSchema = z.string().uuid();

function sendError(reply: FastifyReply, statusCode: number, code: ErrorCode, message: string) {
  return reply.code(statusCode).send({ error: { code, message } });
}

interface SessionContext {
  token: string;
  accountId: string;
}

export async function registerBaseProjectsRoutes(
  app: FastifyInstance,
  deps: BaseProjectsRouteDeps
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

  app.post("/base/projects", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return reply;

    const parsed = createProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "项目请求格式无效。");
    }

    try {
      const result = await deps.create.execute(
        { accountId: session.accountId },
        {
          definitionRef: {
            kind: "project",
            stableId: parsed.data.definitionRef.stableId,
            revision: parsed.data.definitionRef.revision
          },
          siteId: parsed.data.siteId,
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

  app.post<{ Params: { projectId: string } }>(
    "/base/projects/:projectId/cancel",
    async (request, reply) => {
      const session = await requireSession(request, reply);
      if (!session) return reply;

      const projectId = projectIdSchema.safeParse(request.params.projectId);
      if (!projectId.success) {
        return sendError(reply, 404, "VALIDATION_ERROR", "项目不存在。");
      }
      const parsed = cancelProjectSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return sendError(reply, 400, "VALIDATION_ERROR", "取消请求格式无效。");
      }

      try {
        const result = await deps.cancel.execute(
          { accountId: session.accountId },
          { projectId: projectId.data, commandId: parsed.data.commandId ?? randomUUID() }
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
