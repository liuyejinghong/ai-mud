// M16-A/B 订单经济路由（REST 面见 m16-p-contract.md §2；台账登记为 transport，仅 import
// application 与 kernel）。deps 必填（无默认依赖）：composition 绑定 EconomyUseCases 的
// accept/deliver/purchase 与 auth 门面。鉴权 + CSRF 模式与错误映射同
// base-manufacturing.routes.ts（cookie = app.config.SESSION_COOKIE_NAME，头 x-csrf-token）。
import { randomUUID } from "node:crypto";
import type { ErrorCode } from "@ai-mud/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  BaseOperationError,
  type AcceptOrderUseCase,
  type CreatePurchaseUseCase,
  type DeliverOrderUseCase
} from "../../application/economy/usecases.js";
import type { BaseAuthFacade } from "../../application/base/ports.js";

const commandSchema = z.object({
  commandId: z.string().uuid().optional()
});

const purchaseSchema = z.object({
  itemId: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(50),
  commandId: z.string().uuid().optional()
});

const orderIdSchema = z.string().uuid();

function sendError(reply: FastifyReply, statusCode: number, code: ErrorCode, message: string) {
  return reply.code(statusCode).send({ error: { code, message } });
}

interface SessionContext {
  token: string;
  accountId: string;
}

export interface BaseEconomyRouteDeps {
  auth: BaseAuthFacade;
  accept: AcceptOrderUseCase;
  deliver: DeliverOrderUseCase;
  purchase: CreatePurchaseUseCase;
}

export async function registerBaseEconomyRoutes(app: FastifyInstance, deps: BaseEconomyRouteDeps) {
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

  const parseOrderId = (request: FastifyRequest<{ Params: { orderId: string } }>, reply: FastifyReply) => {
    const parsed = orderIdSchema.safeParse(request.params.orderId);
    if (!parsed.success) {
      void sendError(reply, 404, "VALIDATION_ERROR", "订单不存在。");
      return null;
    }
    return parsed.data;
  };

  app.post<{ Params: { orderId: string } }>("/base/orders/:orderId/accept", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return reply;

    const orderId = parseOrderId(request, reply);
    if (!orderId) return reply;

    const parsed = commandSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "接单请求格式无效。");
    }

    try {
      const result = await deps.accept.execute(
        { accountId: session.accountId },
        { orderId, commandId: parsed.data.commandId ?? randomUUID() }
      );
      return reply.code(result.duplicate ? 200 : 201).send(result);
    } catch (error) {
      if (error instanceof BaseOperationError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      throw error;
    }
  });

  app.post<{ Params: { orderId: string } }>("/base/orders/:orderId/deliver", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return reply;

    const orderId = parseOrderId(request, reply);
    if (!orderId) return reply;

    const parsed = commandSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "交付请求格式无效。");
    }

    try {
      const result = await deps.deliver.execute(
        { accountId: session.accountId },
        { orderId, commandId: parsed.data.commandId ?? randomUUID() }
      );
      return reply.code(200).send(result);
    } catch (error) {
      if (error instanceof BaseOperationError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      throw error;
    }
  });

  app.post("/base/purchases", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (!session) return reply;

    const parsed = purchaseSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "采购请求格式无效。");
    }

    try {
      const result = await deps.purchase.execute(
        { accountId: session.accountId },
        {
          itemId: parsed.data.itemId,
          quantity: parsed.data.quantity,
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
}
