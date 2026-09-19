import { randomUUID } from "node:crypto";
import type { ErrorCode } from "@ai-mud/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type {
  BasePrincipal,
  BaseSessionRouteDeps
} from "../../application/base/ports.js";

// M12-A：试玩注册 / provision / 快照 / 心跳 / 时钟命令路由。
// 合同：docs/reviews/base-operations/m12-p-contract.md §6 REST 面。
// 依赖必填（BaseSessionRouteDeps，无默认依赖）：transport 只 import
// application/protocol/platform/kernel，不在路由内组装业务模块（DEBT-007/008 口径）。

const PLAYTEST_REGISTER_SCHEMA = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128)
});

const PROVISION_SCHEMA = z.object({
  commandId: z.string().min(1).optional()
});

const CLOCK_COMMAND_SCHEMA = z.object({
  command: z.enum(["pause", "resume", "set_speed"]),
  speed: z.number().int().optional()
});

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  BASE_SCOPE_INVALID: 403,
  VALIDATION_ERROR: 400,
  RATE_LIMITED: 429,
  IDEMPOTENCY_CONFLICT: 409,
  RESOURCE_INSUFFICIENT: 409,
  REVISION_EXPIRED: 409,
  CONTENT_INCOMPATIBLE: 409,
  SITE_OCCUPIED: 409,
  REQUIREMENTS_NOT_MET: 409,
  BUDGET_EXCEEDED: 409
};

function sendError(reply: FastifyReply, statusCode: number, code: ErrorCode, message: string) {
  return reply.code(statusCode).send({ error: { code, message } });
}

// 服务层错误按形状识别（错误源不 export 类给 transport）。
function sendOperationError(reply: FastifyReply, error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  if (error instanceof Error && typeof code === "string") {
    const errorCode = code as ErrorCode;
    return sendError(reply, STATUS_BY_CODE[errorCode] ?? 500, errorCode, error.message);
  }
  throw error;
}

function setSessionCookie(app: FastifyInstance, reply: FastifyReply, token: string) {
  reply.setCookie(app.config.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: app.config.NODE_ENV === "production",
    path: "/"
  });
}

function readSessionToken(app: FastifyInstance, request: FastifyRequest): string | null {
  const token = request.cookies[app.config.SESSION_COOKIE_NAME];
  return typeof token === "string" && token.length > 0 ? token : null;
}

function readCsrfToken(request: FastifyRequest): string | null {
  const header = request.headers["x-csrf-token"];
  const token = Array.isArray(header) ? header[0] : header;
  return typeof token === "string" && token.length > 0 ? token : null;
}

async function authenticate(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  deps: BaseSessionRouteDeps
): Promise<{ token: string; principal: BasePrincipal } | null> {
  const token = readSessionToken(app, request);
  if (!token) {
    sendError(reply, 401, "UNAUTHENTICATED", "未登录。");
    return null;
  }
  const principal = await deps.auth.resolvePrincipal(token);
  if (!principal) {
    sendError(reply, 401, "UNAUTHENTICATED", "会话已失效，请重新登录。");
    return null;
  }
  return { token, principal };
}

function authorizeWrite(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: BaseSessionRouteDeps,
  session: { token: string }
): boolean {
  const csrfToken = readCsrfToken(request);
  if (!csrfToken || !deps.auth.verifyCsrf(session.token, csrfToken)) {
    sendError(reply, 403, "FORBIDDEN", "缺少有效的 CSRF 令牌。");
    return false;
  }
  return true;
}

export async function registerBaseSessionRoutes(app: FastifyInstance, deps: BaseSessionRouteDeps) {
  // 试玩注册：简化注册 + 自动登录 + 直达基地（仅 PLAYTEST_REGISTRATION_ENABLED 开放）。
  app.post("/base/playtest-register", async (request, reply) => {
    const parsed = PLAYTEST_REGISTER_SCHEMA.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "请提供有效邮箱和密码（1—128 位）。");
    }

    if (!app.config.PLAYTEST_REGISTRATION_ENABLED) {
      return sendError(reply, 403, "FORBIDDEN", "试玩注册未开放。");
    }

    const rateLimit = await deps.registration.checkRateLimit({
      email: parsed.data.email,
      ip: request.ip
    });
    if (!rateLimit.ok) {
      reply.header("retry-after", String(rateLimit.retryAfterSeconds));
      return sendError(reply, 429, "RATE_LIMITED", "请求太频繁，请稍后再试。");
    }

    try {
      const account = await deps.registration.createPlaytestAccount({
        email: parsed.data.email,
        password: parsed.data.password
      });

      setSessionCookie(app, reply, account.sessionToken);

      // 合同 §5#1「直达基地」：注册响应即含 baseId。provision 幂等，
      // 无论会话/基地在哪一步中断，重试都会收敛到同一 baseId。
      const provisioned = await deps.provision.execute(
        { accountId: account.accountId },
        { commandId: randomUUID() }
      );

      return reply.code(201).send({
        user: { accountId: account.accountId, email: account.email },
        baseId: provisioned.baseId,
        csrfToken: account.csrfToken
      });
    } catch (error) {
      return sendOperationError(reply, error);
    }
  });

  app.post("/base/provision", async (request, reply) => {
    const session = await authenticate(app, request, reply, deps);
    if (!session) return reply;

    if (!authorizeWrite(request, reply, deps, session)) return reply;

    const parsed = PROVISION_SCHEMA.safeParse(request.body ?? {});
    const commandId = parsed.success && parsed.data.commandId ? parsed.data.commandId : randomUUID();

    try {
      return await deps.provision.execute(session.principal, { commandId });
    } catch (error) {
      return sendOperationError(reply, error);
    }
  });

  app.get("/base/snapshot", async (request, reply) => {
    const session = await authenticate(app, request, reply, deps);
    if (!session) return reply;

    try {
      return await deps.snapshot.execute(session.principal);
    } catch (error) {
      return sendOperationError(reply, error);
    }
  });

  app.post("/base/heartbeat", async (request, reply) => {
    const session = await authenticate(app, request, reply, deps);
    if (!session) return reply;

    if (!authorizeWrite(request, reply, deps, session)) return reply;

    try {
      return await deps.clock.heartbeat(session.principal);
    } catch (error) {
      return sendOperationError(reply, error);
    }
  });

  app.post("/base/clock", async (request, reply) => {
    const session = await authenticate(app, request, reply, deps);
    if (!session) return reply;

    if (!authorizeWrite(request, reply, deps, session)) return reply;

    const parsed = CLOCK_COMMAND_SCHEMA.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "时钟命令格式不正确。");
    }

    // exactOptionalPropertyTypes：显式区分缺省 speed 与显式 undefined。
    const clockInput =
      parsed.data.speed === undefined
        ? { command: parsed.data.command }
        : { command: parsed.data.command, speed: parsed.data.speed };

    try {
      return await deps.clock.applyCommand(session.principal, clockInput);
    } catch (error) {
      return sendOperationError(reply, error);
    }
  });
}
