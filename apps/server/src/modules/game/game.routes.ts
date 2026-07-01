import {
  CHARACTER_CLASS_IDS,
  DIRECTIONS,
  ITEM_IDS,
  type CreateCharacterRequestDto,
  type Direction,
  type EatFoodRequestDto,
  type ErrorCode,
  type GameStateDto,
  type MarketDto,
  type MarketTradeRequestDto,
  type RepairEquipmentRequestDto,
  type RepairQuoteDto,
  type StartGatheringRequestDto
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

const gatherSchema = z.object({
  plannedMinutes: z.union([z.literal(10), z.literal(30), z.literal(120)]).default(10)
});

const marketTradeSchema = z.object({
  itemId: z.enum(ITEM_IDS),
  quantity: z.number().int().min(1).max(999)
});

const repairEquipmentSchema = z.object({
  equipmentId: z.string().min(1)
});

const eatFoodSchema = z.object({
  itemId: z.enum(ITEM_IDS)
});

export interface GameRouteDependencies {
  getCurrentAccount(request: FastifyRequest): Promise<PublicAccountRecord | null>;
  verifyGameMutation(request: FastifyRequest): Promise<boolean>;
  settleWorldIfDue(): Promise<void>;
  getState(accountId: string): Promise<GameStateDto>;
  createCharacter(accountId: string, input: CreateCharacterRequestDto): Promise<GameStateDto>;
  enterCorruptForest(accountId: string): Promise<GameStateDto>;
  move(accountId: string, direction: Direction): Promise<GameStateDto>;
  startGathering(accountId: string, input: StartGatheringRequestDto): Promise<GameStateDto>;
  startCombat(accountId: string): Promise<GameStateDto>;
  cancelAction(accountId: string): Promise<GameStateDto>;
  returnToVillage(accountId: string): Promise<GameStateDto>;
  getMarket(accountId: string): Promise<MarketDto>;
  buyMarketItem(accountId: string, input: MarketTradeRequestDto): Promise<GameStateDto>;
  sellMarketItem(accountId: string, input: MarketTradeRequestDto): Promise<GameStateDto>;
  getRepairQuote(accountId: string, input: RepairEquipmentRequestDto): Promise<RepairQuoteDto>;
  repairEquipment(accountId: string, input: RepairEquipmentRequestDto): Promise<GameStateDto>;
  repairAllEquipment(accountId: string): Promise<GameStateDto>;
  eatFood(accountId: string, input: EatFoodRequestDto): Promise<GameStateDto>;
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
    settleWorldIfDue: async () => {
      await app.di.worldRuntime.settleDue(new Date());
    },
    getState: (accountId) => game.getState(accountId),
    createCharacter: (accountId, input) => game.createCharacter(accountId, input),
    enterCorruptForest: (accountId) => game.enterCorruptForest(accountId),
    move: (accountId, direction) => game.move(accountId, direction),
    startGathering: (accountId, input) => game.startGathering(accountId, input),
    startCombat: (accountId) => game.startCombat(accountId),
    cancelAction: (accountId) => game.cancelAction(accountId),
    returnToVillage: (accountId) => game.returnToVillage(accountId),
    getMarket: (accountId) => game.getMarket(accountId),
    buyMarketItem: (accountId, input) => game.buyMarketItem(accountId, input),
    sellMarketItem: (accountId, input) => game.sellMarketItem(accountId, input),
    getRepairQuote: (accountId, input) => game.getRepairQuote(accountId, input),
    repairEquipment: (accountId, input) => game.repairEquipment(accountId, input),
    repairAllEquipment: (accountId) => game.repairAllEquipment(accountId),
    eatFood: (accountId, input) => game.eatFood(accountId, input)
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
    await deps.settleWorldIfDue();
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

    const parsed = gatherSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid gathering input");
    }

    try {
      return await deps.startGathering(account.id, parsed.data);
    } catch (error) {
      return handleGameError(reply, error);
    }
  });

  app.post("/game/combat/start", async (request, reply) => {
    const account = await requireAccount(deps, request, reply);
    if (!account) return reply;
    if (!(await requireMutationToken(deps, request, reply))) return reply;

    try {
      return await deps.startCombat(account.id);
    } catch (error) {
      return handleGameError(reply, error);
    }
  });

  app.post("/game/action/cancel", async (request, reply) => {
    const account = await requireAccount(deps, request, reply);
    if (!account) return reply;
    if (!(await requireMutationToken(deps, request, reply))) return reply;

    try {
      return await deps.cancelAction(account.id);
    } catch (error) {
      return handleGameError(reply, error);
    }
  });

  app.post("/game/return-village", async (request, reply) => {
    const account = await requireAccount(deps, request, reply);
    if (!account) return reply;
    if (!(await requireMutationToken(deps, request, reply))) return reply;

    try {
      return await deps.returnToVillage(account.id);
    } catch (error) {
      return handleGameError(reply, error);
    }
  });

  app.get("/game/market", async (request, reply) => {
    const account = await requireAccount(deps, request, reply);
    if (!account) return reply;

    try {
      return await deps.getMarket(account.id);
    } catch (error) {
      return handleGameError(reply, error);
    }
  });

  app.post("/game/market/buy", async (request, reply) => {
    const account = await requireAccount(deps, request, reply);
    if (!account) return reply;
    if (!(await requireMutationToken(deps, request, reply))) return reply;

    const parsed = marketTradeSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid market input");
    }

    try {
      return await deps.buyMarketItem(account.id, parsed.data);
    } catch (error) {
      return handleGameError(reply, error);
    }
  });

  app.post("/game/market/sell", async (request, reply) => {
    const account = await requireAccount(deps, request, reply);
    if (!account) return reply;
    if (!(await requireMutationToken(deps, request, reply))) return reply;

    const parsed = marketTradeSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid market input");
    }

    try {
      return await deps.sellMarketItem(account.id, parsed.data);
    } catch (error) {
      return handleGameError(reply, error);
    }
  });

  app.post("/game/repair/quote", async (request, reply) => {
    const account = await requireAccount(deps, request, reply);
    if (!account) return reply;
    if (!(await requireMutationToken(deps, request, reply))) return reply;

    const parsed = repairEquipmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid repair input");
    }

    try {
      return await deps.getRepairQuote(account.id, parsed.data);
    } catch (error) {
      return handleGameError(reply, error);
    }
  });

  app.post("/game/repair", async (request, reply) => {
    const account = await requireAccount(deps, request, reply);
    if (!account) return reply;
    if (!(await requireMutationToken(deps, request, reply))) return reply;

    const parsed = repairEquipmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid repair input");
    }

    try {
      return await deps.repairEquipment(account.id, parsed.data);
    } catch (error) {
      return handleGameError(reply, error);
    }
  });

  app.post("/game/repair/all", async (request, reply) => {
    const account = await requireAccount(deps, request, reply);
    if (!account) return reply;
    if (!(await requireMutationToken(deps, request, reply))) return reply;

    try {
      return await deps.repairAllEquipment(account.id);
    } catch (error) {
      return handleGameError(reply, error);
    }
  });

  app.post("/game/eat", async (request, reply) => {
    const account = await requireAccount(deps, request, reply);
    if (!account) return reply;
    if (!(await requireMutationToken(deps, request, reply))) return reply;

    const parsed = eatFoodSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid food input");
    }

    try {
      return await deps.eatFood(account.id, parsed.data);
    } catch (error) {
      return handleGameError(reply, error);
    }
  });
}
