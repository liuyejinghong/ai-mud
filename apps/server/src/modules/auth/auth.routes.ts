import type { ErrorCode } from "@ai-mud/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { DrizzleActivationCodeRepository } from "../activation-code/activation-code.repository.js";
import { ActivationCodeService } from "../activation-code/activation-code.service.js";
import { AuthRepository, type AccountRecord } from "./auth.repository.js";
import { AuthService } from "./auth.service.js";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  activationCode: z.string().min(8)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

function sendError(reply: FastifyReply, statusCode: number, code: ErrorCode, message: string) {
  return reply.code(statusCode).send({ error: { code, message } });
}

function setSessionCookie(app: FastifyInstance, reply: FastifyReply, token: string) {
  reply.setCookie(app.config.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: app.config.NODE_ENV === "production",
    path: "/"
  });
}

class ActivationCodeConsumeError extends Error {
  constructor(readonly reason: ErrorCode) {
    super(reason);
  }
}

export async function registerAuthRoutes(app: FastifyInstance) {
  const auth = new AuthService();
  const authRepo = new AuthRepository(app.di.db);

  app.post("/auth/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid registration input");
    }

    const existing = await authRepo.findAccountByEmail(parsed.data.email);
    if (existing) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Email is already registered");
    }

    const passwordHash = await auth.hashPassword(parsed.data.password);
    let result: { account: AccountRecord; token: string };

    try {
      result = await app.di.db.transaction(async (tx) => {
        const scopedAuthRepo = new AuthRepository(tx);
        const scopedActivationCodes = new ActivationCodeService(
          new DrizzleActivationCodeRepository(tx)
        );
        const account = await scopedAuthRepo.createAccount({ email: parsed.data.email, passwordHash });
        const consumed = await scopedActivationCodes.consume(parsed.data.activationCode, account.id);

        if (!consumed.ok) {
          throw new ActivationCodeConsumeError(consumed.reason);
        }

        const session = auth.createSessionToken();
        await scopedAuthRepo.createSession({
          accountId: account.id,
          tokenHash: session.tokenHash,
          expiresAt: new Date(Date.now() + SESSION_TTL_MS)
        });

        return { account, token: session.token };
      });
    } catch (error) {
      if (error instanceof ActivationCodeConsumeError) {
        return sendError(reply, 400, error.reason, "Activation code cannot be used");
      }
      throw error;
    }

    setSessionCookie(app, reply, result.token);
    return {
      user: {
        id: result.account.id,
        email: result.account.email,
        role: result.account.role,
        status: result.account.status
      }
    };
  });

  app.post("/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid login input");
    }

    const account = await authRepo.findAccountByEmail(parsed.data.email);
    if (!account || account.status !== "active") {
      return sendError(reply, 401, "UNAUTHENTICATED", "Invalid email or password");
    }

    const passwordOk = await auth.verifyPassword(parsed.data.password, account.passwordHash);
    if (!passwordOk) {
      return sendError(reply, 401, "UNAUTHENTICATED", "Invalid email or password");
    }

    const session = auth.createSessionToken();
    await authRepo.createSession({
      accountId: account.id,
      tokenHash: session.tokenHash,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS)
    });

    setSessionCookie(app, reply, session.token);
    return {
      user: {
        id: account.id,
        email: account.email,
        role: account.role,
        status: account.status
      }
    };
  });

  app.post("/auth/logout", async (request, reply) => {
    const token = request.cookies[app.config.SESSION_COOKIE_NAME];
    if (token) {
      await authRepo.revokeSessionByTokenHash(auth.hashToken(token));
    }

    reply.clearCookie(app.config.SESSION_COOKIE_NAME, { path: "/" });
    return reply.code(204).send();
  });

  app.get("/auth/me", async (request, reply) => {
    const token = request.cookies[app.config.SESSION_COOKIE_NAME];
    if (!token) {
      return sendError(reply, 401, "UNAUTHENTICATED", "Not signed in");
    }

    const account = await authRepo.findAccountBySessionTokenHash(auth.hashToken(token));
    if (!account || account.status !== "active") {
      return sendError(reply, 401, "UNAUTHENTICATED", "Not signed in");
    }

    return { user: account };
  });
}
