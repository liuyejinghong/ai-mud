import type { ErrorCode } from "@ai-mud/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { DrizzleActivationCodeRepository } from "../activation-code/activation-code.repository.js";
import { ActivationCodeService } from "../activation-code/activation-code.service.js";
import { DrizzleAuditWriter } from "../audit/audit.repository.js";
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

export interface AuthRouteDependencies {
  findAccountByEmail(email: string): Promise<AccountRecord | null>;
  registerWithActivationCode(input: {
    email: string;
    password: string;
    activationCode: string;
  }): Promise<{ account: AccountRecord; token: string }>;
  verifyPassword(password: string, passwordHash: string): Promise<boolean>;
  createSession(accountId: string): Promise<string>;
  revokeSessionByToken(token: string): Promise<void>;
  findAccountBySessionToken(token: string): Promise<Omit<AccountRecord, "passwordHash"> | null>;
  createCsrfToken(token: string): string;
}

class ActivationCodeConsumeError extends Error {
  constructor(readonly reason: ErrorCode) {
    super(reason);
  }
}

function hasAuthRouteDependencies(value: unknown): value is AuthRouteDependencies {
  return (
    typeof value === "object" &&
    value !== null &&
    "registerWithActivationCode" in value &&
    typeof value.registerWithActivationCode === "function"
  );
}

function createDefaultDependencies(app: FastifyInstance): AuthRouteDependencies {
  const auth = new AuthService();
  const authRepo = new AuthRepository(app.di.db);

  return {
    findAccountByEmail: (email) => authRepo.findAccountByEmail(email),
    registerWithActivationCode: async (input) => {
      const passwordHash = await auth.hashPassword(input.password);

      return app.di.db.transaction(async (tx) => {
        const scopedAuthRepo = new AuthRepository(tx);
        const scopedActivationCodes = new ActivationCodeService(
          new DrizzleActivationCodeRepository(tx)
        );
        const audit = new DrizzleAuditWriter(tx);
        const account = await scopedAuthRepo.createAccount({ email: input.email, passwordHash });
        const consumed = await scopedActivationCodes.consume(input.activationCode, account.id);

        if (!consumed.ok) {
          throw new ActivationCodeConsumeError(consumed.reason);
        }

        const session = auth.createSessionToken();
        await scopedAuthRepo.createSession({
          accountId: account.id,
          tokenHash: session.tokenHash,
          expiresAt: new Date(Date.now() + SESSION_TTL_MS)
        });
        await audit.write({
          actorAccountId: account.id,
          action: "activation_code.consume",
          targetType: "activation_code",
          targetId: consumed.activationCodeId,
          reason: "account_registration",
          metadata: { accountId: account.id }
        });

        return { account, token: session.token };
      });
    },
    verifyPassword: (password, passwordHash) => auth.verifyPassword(password, passwordHash),
    createSession: async (accountId) => {
      const session = auth.createSessionToken();
      await authRepo.createSession({
        accountId,
        tokenHash: session.tokenHash,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS)
      });
      return session.token;
    },
    revokeSessionByToken: (token) => authRepo.revokeSessionByTokenHash(auth.hashToken(token)),
    findAccountBySessionToken: (token) => authRepo.findAccountBySessionTokenHash(auth.hashToken(token)),
    createCsrfToken: (token) => auth.createCsrfToken(token, app.config.SESSION_SECRET)
  };
}

export async function registerAuthRoutes(app: FastifyInstance, maybeDependencies?: unknown) {
  const deps = hasAuthRouteDependencies(maybeDependencies)
    ? maybeDependencies
    : createDefaultDependencies(app);

  app.post("/auth/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid registration input");
    }

    const existing = await deps.findAccountByEmail(parsed.data.email);
    if (existing) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Email is already registered");
    }

    let result: { account: AccountRecord; token: string };

    try {
      result = await deps.registerWithActivationCode({
        email: parsed.data.email,
        password: parsed.data.password,
        activationCode: parsed.data.activationCode
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
      },
      csrfToken: deps.createCsrfToken(result.token)
    };
  });

  app.post("/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid login input");
    }

    const account = await deps.findAccountByEmail(parsed.data.email);
    if (!account || account.status !== "active") {
      return sendError(reply, 401, "UNAUTHENTICATED", "Invalid email or password");
    }

    const passwordOk = await deps.verifyPassword(parsed.data.password, account.passwordHash);
    if (!passwordOk) {
      return sendError(reply, 401, "UNAUTHENTICATED", "Invalid email or password");
    }

    const token = await deps.createSession(account.id);

    setSessionCookie(app, reply, token);
    return {
      user: {
        id: account.id,
        email: account.email,
        role: account.role,
        status: account.status
      },
      csrfToken: deps.createCsrfToken(token)
    };
  });

  app.post("/auth/logout", async (request, reply) => {
    const token = request.cookies[app.config.SESSION_COOKIE_NAME];
    if (token) {
      await deps.revokeSessionByToken(token);
    }

    reply.clearCookie(app.config.SESSION_COOKIE_NAME, { path: "/" });
    return reply.code(204).send();
  });

  app.get("/auth/me", async (request, reply) => {
    const token = request.cookies[app.config.SESSION_COOKIE_NAME];
    if (!token) {
      return sendError(reply, 401, "UNAUTHENTICATED", "Not signed in");
    }

    const account = await deps.findAccountBySessionToken(token);
    if (!account || account.status !== "active") {
      return sendError(reply, 401, "UNAUTHENTICATED", "Not signed in");
    }

    return { user: account, csrfToken: deps.createCsrfToken(token) };
  });
}
