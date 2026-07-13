import { NPC_DIALOGUE_MAX_PLAYER_CHARS } from "@ai-mud/ai-prompts";
import { getItemById, getZoneById } from "@ai-mud/content";
import {
  CHARACTER_CLASS_IDS,
  DIRECTIONS,
  type ChatMessageDto,
  type CreateCharacterRequestDto,
  type Direction,
  type EatFoodRequestDto,
  type EquipEquipmentRequestDto,
  type ErrorCode,
  type GameStateDto,
  type GameSyncResponseDto,
  type GameLocationId,
  type MarketDto,
  type MarketTradeRequestDto,
  type NpcTaskDto,
  type NpcDialogueResponseDto,
  type NpcDialogueTargetDto,
  type RepairEquipmentRequestDto,
  type RepairQuoteDto,
  type StartGatheringRequestDto,
  type WorldRumorDto
} from "@ai-mud/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AuthRepository, type PublicAccountRecord } from "../auth/auth.repository.js";
import { AuthService } from "../auth/auth.service.js";
import { DialogueRepository } from "../dialogue/dialogue.repository.js";
import { DialogueResourceTransferRepository } from "../dialogue/dialogue-resource-transfer.repository.js";
import { DialogueService, DialogueServiceError } from "../dialogue/dialogue.service.js";
import { ItemServiceError } from "../item/item.service.js";
import { LobbyRepository } from "../lobby/lobby.repository.js";
import { LobbyService, LobbyServiceError } from "../lobby/lobby.service.js";
import { NpcRepository } from "../npc/npc.repository.js";
import { NpcTaskRepository } from "../npc-task/npc-task.repository.js";
import { NpcTaskServiceError } from "../npc-task/npc-task.service.js";
import { OfflineReportService } from "../offline-report/offline-report.service.js";
import {
  createAiOrchestrator,
  createNpcMemoryService,
  createNpcTaskService,
  createRumorService
} from "./game.composition.js";
import { GameRepository } from "./game.repository.js";
import { GameService, GameServiceError } from "./game.service.js";

const createCharacterSchema = z.object({
  name: z.string().trim().min(2).max(24),
  classId: z.enum(CHARACTER_CLASS_IDS)
});

const enterZoneSchema = z.object({
  zoneId: z
    .string()
    .min(1)
    .refine((zoneId) => getZoneById(zoneId as GameLocationId) !== null, "Unknown zone id")
});

const moveSchema = z.object({
  direction: z.enum(DIRECTIONS)
});

const gatherSchema = z.object({
  plannedMinutes: z.union([z.literal(10), z.literal(30), z.literal(120)]).default(10)
});

const knownItemIdSchema = z
  .string()
  .min(1)
  .refine((itemId) => getItemById(itemId) !== null, "Unknown item id");

const marketTradeSchema = z.object({
  itemId: knownItemIdSchema,
  quantity: z.number().int().min(1).max(999)
});

const repairEquipmentSchema = z.object({
  equipmentId: z.string().min(1)
});

const equipEquipmentSchema = z.object({
  instanceId: z.string().min(1)
});

const eatFoodSchema = z.object({
  itemId: knownItemIdSchema.refine(
    (itemId) => getItemById(itemId)?.category === "food",
    "Item is not food"
  )
});

const dialogueMessageSchema = z.object({
  message: z.string().trim().min(1).max(NPC_DIALOGUE_MAX_PLAYER_CHARS)
});

const lobbyChatSchema = z.object({
  body: z.string().trim().min(1).max(240)
});

const municipalReliefClaimSchema = z.object({}).strict();

const gameSyncQuerySchema = z.object({
  cursor: z.coerce.number().int().min(0).optional()
});

export interface GameRouteDependencies {
  getCurrentAccount(request: FastifyRequest): Promise<PublicAccountRecord | null>;
  verifyGameMutation(request: FastifyRequest): Promise<boolean>;
  settleWorldIfDue(): Promise<void>;
  getState(accountId: string): Promise<GameStateDto>;
  syncGame(accountId: string, cursor?: number): Promise<GameSyncResponseDto>;
  sendLobbyChat(accountId: string, body: string): Promise<ChatMessageDto>;
  heartbeatPresence(accountId: string): Promise<void>;
  createCharacter(accountId: string, input: CreateCharacterRequestDto): Promise<GameStateDto>;
  enterZone(accountId: string, zoneId: GameLocationId): Promise<GameStateDto>;
  move(accountId: string, direction: Direction): Promise<GameStateDto>;
  startGathering(accountId: string, input: StartGatheringRequestDto): Promise<GameStateDto>;
  startCombat(accountId: string): Promise<GameStateDto>;
  cancelAction(accountId: string): Promise<GameStateDto>;
  returnToVillage(accountId: string): Promise<GameStateDto>;
  claimMunicipalRelief(accountId: string): Promise<GameStateDto>;
  getMarket(accountId: string): Promise<MarketDto>;
  buyMarketItem(accountId: string, input: MarketTradeRequestDto): Promise<GameStateDto>;
  sellMarketItem(accountId: string, input: MarketTradeRequestDto): Promise<GameStateDto>;
  getRepairQuote(accountId: string, input: RepairEquipmentRequestDto): Promise<RepairQuoteDto>;
  repairEquipment(accountId: string, input: RepairEquipmentRequestDto): Promise<GameStateDto>;
  repairAllEquipment(accountId: string): Promise<GameStateDto>;
  equipEquipment(accountId: string, input: EquipEquipmentRequestDto): Promise<GameStateDto>;
  eatFood(accountId: string, input: EatFoodRequestDto): Promise<GameStateDto>;
  acceptNpcTask(accountId: string, taskId: string): Promise<GameStateDto>;
  completeNpcTask(accountId: string, taskId: string): Promise<GameStateDto>;
  listDialogueTargets(accountId: string): Promise<NpcDialogueTargetDto[]>;
  getNpcDialogue(accountId: string, npcActorId: string): Promise<NpcDialogueResponseDto>;
  sendNpcDialogueMessage(
    accountId: string,
    npcActorId: string,
    message: string
  ): Promise<NpcDialogueResponseDto>;
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

interface GameStateEnricherOptions {
  tasks: {
    listTasksForAccount(accountId: string, now?: Date): Promise<NpcTaskDto[]>;
  };
  rumors: {
    listRecentPublicRumors(limit: number): Promise<WorldRumorDto[]>;
  };
  listNpcActors(): Promise<Array<{ id: string; currentLocation: GameLocationId }>>;
  now?: () => Date;
}

export type GameStateEnricher = (
  accountId: string,
  state: GameStateDto
) => Promise<GameStateDto>;

export function createGameStateEnricher(options: GameStateEnricherOptions): GameStateEnricher {
  return async (accountId, state) => {
    if (!state.character) return state;

    const currentLocation = state.character.currentLocation;
    const now = options.now?.() ?? new Date();
    const [tasks, rumors, actors] = await Promise.all([
      options.tasks.listTasksForAccount(accountId, now),
      options.rumors.listRecentPublicRumors(8),
      options.listNpcActors()
    ]);
    const actorLocations = new Map(actors.map((actor) => [actor.id, actor.currentLocation]));
    const npcTasks = tasks
      .map((task) => {
        const npcLocation = actorLocations.get(task.npcActorId) ?? task.npcLocation ?? null;
        return { ...task, npcLocation };
      })
      .filter(
        (task) =>
          task.status === "accepted" ||
          (task.status === "open" && task.npcLocation === currentLocation)
      );
    const availableActions: GameStateDto["availableActions"] = state.availableActions.filter(
      (action) => action !== "view_npc_tasks"
    );
    if (npcTasks.length > 0) availableActions.push("view_npc_tasks");

    return { ...state, npcTasks, rumors, availableActions };
  };
}

export async function enrichGameSyncResponse(
  accountId: string,
  sync: GameSyncResponseDto,
  enrichState: GameStateEnricher
): Promise<GameSyncResponseDto> {
  if (sync.state === null) return sync;
  return { ...sync, state: await enrichState(accountId, sync.state) };
}

function createDefaultDependencies(app: FastifyInstance): GameRouteDependencies {
  const auth = new AuthService();
  const authRepo = new AuthRepository(app.di.db);
  const game = new GameService(app.di.db);
  const lobby = new LobbyService(new LobbyRepository(app.di.db));
  const dialogue = createDialogueService(app);
  const task = createNpcTaskService(app);
  const rumor = createRumorService(app);
  const enrichState = createGameStateEnricher({
    tasks: task,
    rumors: rumor,
    listNpcActors: () => new NpcRepository(app.di.db).listNpcActors()
  });
  const offlineReport = new OfflineReportService({
    ai: createAiOrchestrator(app),
    gameRepository: new GameRepository(app.di.db),
    aiLogRepository: new DialogueRepository(app.di.db),
    dailyTokenBudget: app.config.AI_DAILY_TOKEN_BUDGET
  });

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
    getState: async (accountId) => enrichState(accountId, await game.getState(accountId)),
    syncGame: async (accountId, cursor) => {
      const sync = await enrichGameSyncResponse(
        accountId,
        await game.getSync(accountId, cursor),
        enrichState
      );
      if ((cursor ?? 0) > 0) return sync;
      const report = await offlineReport.getReport(accountId, new Date());
      return report ? { ...sync, offlineReport: report } : sync;
    },
    sendLobbyChat: (accountId, body) => lobby.sendLobbyChat(accountId, body),
    heartbeatPresence: (accountId) => lobby.heartbeat(accountId),
    createCharacter: async (accountId, input) =>
      enrichState(accountId, await game.createCharacter(accountId, input)),
    enterZone: async (accountId, zoneId) =>
      enrichState(accountId, await game.enterZone(accountId, zoneId)),
    move: async (accountId, direction) =>
      enrichState(accountId, await game.move(accountId, direction)),
    startGathering: async (accountId, input) =>
      enrichState(accountId, await game.startGathering(accountId, input)),
    startCombat: async (accountId) =>
      enrichState(accountId, await game.startCombat(accountId)),
    cancelAction: async (accountId) =>
      enrichState(accountId, await game.cancelAction(accountId)),
    returnToVillage: async (accountId) =>
      enrichState(accountId, await game.returnToVillage(accountId)),
    claimMunicipalRelief: async (accountId) =>
      enrichState(accountId, await game.claimMunicipalRelief(accountId)),
    getMarket: (accountId) => game.getMarket(accountId),
    buyMarketItem: async (accountId, input) =>
      enrichState(accountId, await game.buyMarketItem(accountId, input)),
    sellMarketItem: async (accountId, input) =>
      enrichState(accountId, await game.sellMarketItem(accountId, input)),
    getRepairQuote: (accountId, input) => game.getRepairQuote(accountId, input),
    repairEquipment: async (accountId, input) =>
      enrichState(accountId, await game.repairEquipment(accountId, input)),
    repairAllEquipment: async (accountId) =>
      enrichState(accountId, await game.repairAllEquipment(accountId)),
    equipEquipment: async (accountId, input) =>
      enrichState(accountId, await game.equipEquipment(accountId, input)),
    eatFood: async (accountId, input) =>
      enrichState(accountId, await game.eatFood(accountId, input)),
    acceptNpcTask: async (accountId, taskId) => {
      await task.acceptTask(accountId, taskId, new Date());
      return enrichState(accountId, await game.getState(accountId));
    },
    completeNpcTask: async (accountId, taskId) => {
      await task.completeTask(accountId, taskId, new Date());
      return enrichState(accountId, await game.getState(accountId));
    },
    listDialogueTargets: (accountId) => dialogue.listDialogueTargets(accountId),
    getNpcDialogue: (accountId, npcActorId) => dialogue.getDialogue(accountId, npcActorId),
    sendNpcDialogueMessage: (accountId, npcActorId, message) =>
      dialogue.sendDialogueMessage(accountId, npcActorId, message)
  };
}

function createDialogueService(app: FastifyInstance) {
  return new DialogueService({
    dialogueRepo: new DialogueRepository(app.di.db),
    gameRepo: new GameRepository(app.di.db),
    resourceTransferRepo: new DialogueResourceTransferRepository(app.di.db),
    npcRepo: new NpcRepository(app.di.db),
    taskRepo: new NpcTaskRepository(app.di.db),
    memory: createNpcMemoryService(app),
    ai: createAiOrchestrator(app)
  });
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
  if (error instanceof DialogueServiceError) {
    return sendError(reply, 400, error.code, error.message);
  }
  if (error instanceof NpcTaskServiceError) {
    return sendError(reply, 400, error.code, error.message);
  }
  if (error instanceof GameServiceError) {
    return sendError(reply, 400, error.code, error.message);
  }
  if (error instanceof LobbyServiceError) {
    return sendError(reply, 400, error.code, error.message);
  }
  if (error instanceof ItemServiceError) {
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

  app.get("/game/sync", async (request, reply) => {
    const account = await requireAccount(deps, request, reply);
    if (!account) return reply;

    const parsed = gameSyncQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid sync cursor");
    }

    return deps.syncGame(account.id, parsed.data.cursor);
  });

  app.post("/game/chat", async (request, reply) => {
    const account = await requireAccount(deps, request, reply);
    if (!account) return reply;
    if (!(await requireMutationToken(deps, request, reply))) return reply;

    const parsed = lobbyChatSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid chat input");
    }

    try {
      return await deps.sendLobbyChat(account.id, parsed.data.body);
    } catch (error) {
      return handleGameError(reply, error);
    }
  });

  app.post("/game/presence/heartbeat", async (request, reply) => {
    const account = await requireAccount(deps, request, reply);
    if (!account) return reply;
    if (!(await requireMutationToken(deps, request, reply))) return reply;

    try {
      await deps.heartbeatPresence(account.id);
      return { ok: true };
    } catch (error) {
      return handleGameError(reply, error);
    }
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
      return await deps.enterZone(account.id, parsed.data.zoneId as GameLocationId);
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

  app.post("/game/relief/claim", async (request, reply) => {
    const account = await requireAccount(deps, request, reply);
    if (!account) return reply;
    if (!(await requireMutationToken(deps, request, reply))) return reply;

    const parsed = municipalReliefClaimSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid relief claim input");
    }

    try {
      return await deps.claimMunicipalRelief(account.id);
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

  app.get("/game/npcs/dialogue-targets", async (request, reply) => {
    const account = await requireAccount(deps, request, reply);
    if (!account) return reply;
    await deps.settleWorldIfDue();

    try {
      return await deps.listDialogueTargets(account.id);
    } catch (error) {
      return handleGameError(reply, error);
    }
  });

  app.get("/game/npcs/:npcActorId/dialogue", async (request, reply) => {
    const account = await requireAccount(deps, request, reply);
    if (!account) return reply;
    await deps.settleWorldIfDue();

    const params = z.object({ npcActorId: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid NPC dialogue target");
    }

    try {
      return await deps.getNpcDialogue(account.id, params.data.npcActorId);
    } catch (error) {
      return handleGameError(reply, error);
    }
  });

  app.post("/game/npcs/:npcActorId/dialogue", async (request, reply) => {
    const account = await requireAccount(deps, request, reply);
    if (!account) return reply;
    if (!(await requireMutationToken(deps, request, reply))) return reply;

    const params = z.object({ npcActorId: z.string().min(1) }).safeParse(request.params);
    const parsed = dialogueMessageSchema.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid dialogue input");
    }

    try {
      return await deps.sendNpcDialogueMessage(
        account.id,
        params.data.npcActorId,
        parsed.data.message
      );
    } catch (error) {
      return handleGameError(reply, error);
    }
  });

  app.post("/game/npc-tasks/:taskId/accept", async (request, reply) => {
    const account = await requireAccount(deps, request, reply);
    if (!account) return reply;
    if (!(await requireMutationToken(deps, request, reply))) return reply;

    const params = z.object({ taskId: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid NPC task");
    }

    try {
      return await deps.acceptNpcTask(account.id, params.data.taskId);
    } catch (error) {
      return handleGameError(reply, error);
    }
  });

  app.post("/game/npc-tasks/:taskId/complete", async (request, reply) => {
    const account = await requireAccount(deps, request, reply);
    if (!account) return reply;
    if (!(await requireMutationToken(deps, request, reply))) return reply;

    const params = z.object({ taskId: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid NPC task");
    }

    try {
      return await deps.completeNpcTask(account.id, params.data.taskId);
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

  app.post("/game/equipment/equip", async (request, reply) => {
    const account = await requireAccount(deps, request, reply);
    if (!account) return reply;
    if (!(await requireMutationToken(deps, request, reply))) return reply;

    const parsed = equipEquipmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Invalid equipment input");
    }

    try {
      return await deps.equipEquipment(account.id, parsed.data);
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
