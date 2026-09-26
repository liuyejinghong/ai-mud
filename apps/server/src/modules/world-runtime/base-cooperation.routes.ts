import type { ErrorCode } from "@ai-mud/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { BaseCooperationRouteDeps } from "../../application/base/ports.js";

const requestIdSchema = z.string().uuid();
const decisionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("support"),
    commandId: z.string().uuid(),
    expectedHelperOperatorId: z.string().uuid()
  }),
  z.object({ action: z.literal("wait"), commandId: z.string().uuid() })
]);

function sendError(reply: FastifyReply, status: number, code: ErrorCode, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

export async function registerBaseCooperationRoutes(
  app: FastifyInstance,
  deps: BaseCooperationRouteDeps
) {
  app.post<{ Params: { requestId: string } }>(
    "/base/cooperation/:requestId/decision",
    async (request, reply) => {
      const token = request.cookies[app.config.SESSION_COOKIE_NAME];
      if (!token) return sendError(reply, 401, "UNAUTHENTICATED", "未登录。");
      const principal = await deps.auth.resolvePrincipal(token);
      if (!principal) return sendError(reply, 401, "UNAUTHENTICATED", "会话已失效，请重新登录。");
      const csrf = request.headers["x-csrf-token"];
      if (typeof csrf !== "string" || !deps.auth.verifyCsrf(token, csrf)) {
        return sendError(reply, 403, "FORBIDDEN", "CSRF 令牌缺失或无效。");
      }

      const requestId = requestIdSchema.safeParse(request.params.requestId);
      const input = decisionSchema.safeParse(request.body);
      if (!requestId.success || !input.success) {
        return sendError(reply, 400, "VALIDATION_ERROR", "协作选择格式无效，请刷新后重试。");
      }
      try {
        const result = await deps.decide.execute(principal, { requestId: requestId.data, ...input.data });
        return reply.code(result.duplicate ? 200 : 201).send(result);
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        if (error instanceof Error && typeof code === "string") {
          const status = code === "BASE_SCOPE_INVALID" || code === "FORBIDDEN" ? 403
            : code === "VALIDATION_ERROR" ? 400 : 409;
          return sendError(reply, status, code as ErrorCode, error.message);
        }
        throw error;
      }
    }
  );
}
