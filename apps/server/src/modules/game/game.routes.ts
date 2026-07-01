import {
  CHARACTER_CLASS_IDS,
  DIRECTIONS,
  type CreateCharacterRequestDto,
  type Direction,
  type ErrorCode,
  type GameStateDto
} from "@ai-mud/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthRepository, type PublicAccountRecord } from "../auth/auth.repository.js";
import { AuthService } from "../auth/auth.service.js";
import { GameService, GameServiceError } from "./game.service.js";

const createCharacterSchema = z.object({
  name: z.string().trim().min(2).max(24),
  classId: z.enum(CHARACTER_CLASS_IDS)
});

const enterZoneSchema = z.object({
  zoneId: z.literal("corrupt_forest")
});

const moveSchema = z.object({
  direction: z.enum(DIRECTIONS)
});

export interface GameRouteDependencies {
  getCurrentAccount(request: FastifyRequest): Promise<PublicAccountRecord | null>;
  verifyGameMutation(request: FastifyRequest): Promise<boolean>;
  getState(accountId: string): Promise<GameStateDto>;
  createCharacter(accountId: string, input: CreateCharacterRequestDto): Promise<GameStateDto>;
  enterCorruptForest(accountId: string): Promise<GameStateDto>;
  move(accountId: string, direction: Direction): Promise<GameStateDto>;
  gather(accountId: string): Promise<GameStateDto>;
}

function sendError(reply: FastifyReply, statusCode: number, code: ErrorCode, message: string) {
  return reply.code(statusCode).send({ error: { code, message } });
}

function hasGameRouteDependencies(value: unknown): value is GameRouteDependencies {
  return (
    typeof value === "object" &&
    value !== null &&
    "getCurrentAccount" in value &&
    typeof value.getCurrentAccount === "function"
  );
}

function createDefaultDependencies(app: FastifyInstance): GameRouteDependencies {
  const auth = new AuthService();
  const authRepo = new AuthRepository(app.di.db);
  const game = new GameService(app.di.db);

  return {
    getCurrentAccount: async (request) => {
      const token = request.cookies[app.config.SESSION_COOKIE_NAME];
      if (!token) return null;

      const account = await authRepo.findAccountBySessionTokenHash(auth.hashToken(token));
      if (!account || account.status !== "active") return null;
      return account;
    },
    verifyGameMutation: async (request) => {
      const token = request.cookies[app.config.SESSION_COOKIE_NAME];
      const csrfToken = request.headers["x-csrf-token"];
      if (!token || typeof csrfToken !== "string") return false;
      return auth.verifyCsrfToken(token, app.config.SESSION_SECRET, csrfToken);
    },
    getState: (accountId) => game.getState(accountId),
    createCharacter: (accountId, input) => game.createCharacter(accountId, input),
    enterCorruptForest: (accountId) => game.enterCorruptForest(accountId),
    move: (accountId, direction) => game.move(accountId, direction),
    gather: (accountId) => game.gather(accountId)
  };
}

async function requireAccount(
  deps: GameRouteDependencies,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const account = await deps.getCurrentAccount(request);
  if (!account) {
    sendError(reply, 401, "UNAUTHENTICATED", "Not signed in");
    return null;
  }

  return account;
}

async function requireMutationToken(
  deps: GameRouteDependencies,
  request: FastifyRequest,
  reply: FastifyReply
) {
  if (!(await deps.verifyGameMutation(request))) {
    sendError(reply, 403, "FORBIDDEN", "Game mutation token required");
    return false;
  }

  return true;
}

function handleGameError(reply: FastifyReply, error: unknown) {
  if (error instanceof GameServiceError) {
    return sendError(reply, 400, error.code, error.message);
  }
  throw error;
}

export async function registerGameRoutes(app: FastifyInstance, maybeDependencies?: unknown) {
  const deps = hasGameRouteDependencies(maybeDependencies)
    ? maybeDependencies
    : createDefaultDependencies(app);

  app.get("/game/state", async (request, reply) => {
    const account = await requireAccount(deps, request, reply);
    if (!account) return reply;
    return deps.getState(account.id);
  });

  app.post("/game/characters", async (request, reply) => {
    const account = await requireAccount(deps, request, reply);
    if (!account) return reply;
    if (!(await requireMutationToken(deps, request, reply))) return reply;

    const parsed = createCharacterSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid character input");
    }

    try {
      return await deps.createCharacter(account.id, parsed.data);
    } catch (error) {
      return handleGameError(reply, error);
    }
  });

  app.post("/game/enter-zone", async (request, reply) => {
    const account = await requireAccount(deps, request, reply);
    if (!account) return reply;
    if (!(await requireMutationToken(deps, request, reply))) return reply;

    const parsed = enterZoneSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid zone input");
    }

    try {
      return await deps.enterCorruptForest(account.id);
    } catch (error) {
      return handleGameError(reply, error);
    }
  });

  app.post("/game/move", async (request, reply) => {
    const account = await requireAccount(deps, request, reply);
    if (!account) return reply;
    if (!(await requireMutationToken(deps, request, reply))) return reply;

    const parsed = moveSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid movement input");
    }

    try {
      return await deps.move(account.id, parsed.data.direction);
    } catch (error) {
      return handleGameError(reply, error);
    }
  });

  app.post("/game/gather", async (request, reply) => {
    const account = await requireAccount(deps, request, reply);
    if (!account) return reply;
    if (!(await requireMutationToken(deps, request, reply))) return reply;

    try {
      return await deps.gather(account.id);
    } catch (error) {
      return handleGameError(reply, error);
    }
  });
}
