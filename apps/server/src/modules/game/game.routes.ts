import {
  NPC_DIALOGUE_MAX_PLAYER_CHARS,
  NPC_MEMORY_COMPRESSION_PROMPT_VERSION,
  NPC_TASK_COPY_PROMPT_VERSION,
  type NpcMemoryCompressionPromptContext,
  type NpcTaskCopyPromptContext
} from "@ai-mud/ai-prompts";
import { getItemById } from "@ai-mud/content";
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
  type NpcDialogueResponseDto,
  type NpcDialogueTargetDto,
  type RepairEquipmentRequestDto,
  type RepairQuoteDto,
  type StartGatheringRequestDto
} from "@ai-mud/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { AiOrchestrator } from "../ai/ai-orchestrator.js";
import type { AiProvider } from "../ai/ai-provider.js";
import { DeepSeekAiProvider } from "../ai/deepseek-ai-provider.js";
import { AuthRepository, type PublicAccountRecord } from "../auth/auth.repository.js";
import { AuthService } from "../auth/auth.service.js";
import { DialogueRepository } from "../dialogue/dialogue.repository.js";
import { DialogueService, DialogueServiceError } from "../dialogue/dialogue.service.js";
import { NpcRepository } from "../npc/npc.repository.js";
import { NpcMemoryRepository } from "../npc-memory/npc-memory.repository.js";
import {
  NpcMemoryService,
  type NpcMemoryCompressorPort
} from "../npc-memory/npc-memory.service.js";
import { NpcTaskRepository } from "../npc-task/npc-task.repository.js";
import {
  NpcTaskService,
  NpcTaskServiceError,
  type NpcTaskCopywriterInput
} from "../npc-task/npc-task.service.js";
import { GameRepository } from "./game.repository.js";
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

const dialogueMessageSchema = z.object({
  message: z.string().trim().min(1).max(NPC_DIALOGUE_MAX_PLAYER_CHARS)
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

function createDefaultDependencies(app: FastifyInstance): GameRouteDependencies {
  const auth = new AuthService();
  const authRepo = new AuthRepository(app.di.db);
  const game = new GameService(app.di.db);
  const dialogue = createDialogueService(app);
  const task = createNpcTaskService(app);

  const withNpcTasks = async (accountId: string, state: GameStateDto): Promise<GameStateDto> => {
    if (!state.character) return state;
    const npcTasks = await task.listTasksForAccount(accountId, new Date());
    const availableActions = npcTasks.length
      ? Array.from(new Set([...state.availableActions, "view_npc_tasks" as const]))
      : state.availableActions;
    return { ...state, npcTasks, availableActions };
  };

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
    getState: async (accountId) => withNpcTasks(accountId, await game.getState(accountId)),
    createCharacter: async (accountId, input) =>
      withNpcTasks(accountId, await game.createCharacter(accountId, input)),
    enterCorruptForest: async (accountId) =>
      withNpcTasks(accountId, await game.enterCorruptForest(accountId)),
    move: async (accountId, direction) => withNpcTasks(accountId, await game.move(accountId, direction)),
    startGathering: async (accountId, input) =>
      withNpcTasks(accountId, await game.startGathering(accountId, input)),
    startCombat: async (accountId) => withNpcTasks(accountId, await game.startCombat(accountId)),
    cancelAction: async (accountId) => withNpcTasks(accountId, await game.cancelAction(accountId)),
    returnToVillage: async (accountId) =>
      withNpcTasks(accountId, await game.returnToVillage(accountId)),
    getMarket: (accountId) => game.getMarket(accountId),
    buyMarketItem: async (accountId, input) =>
      withNpcTasks(accountId, await game.buyMarketItem(accountId, input)),
    sellMarketItem: async (accountId, input) =>
      withNpcTasks(accountId, await game.sellMarketItem(accountId, input)),
    getRepairQuote: (accountId, input) => game.getRepairQuote(accountId, input),
    repairEquipment: async (accountId, input) =>
      withNpcTasks(accountId, await game.repairEquipment(accountId, input)),
    repairAllEquipment: async (accountId) =>
      withNpcTasks(accountId, await game.repairAllEquipment(accountId)),
    eatFood: async (accountId, input) => withNpcTasks(accountId, await game.eatFood(accountId, input)),
    acceptNpcTask: async (accountId, taskId) => {
      await task.acceptTask(accountId, taskId, new Date());
      return withNpcTasks(accountId, await game.getState(accountId));
    },
    completeNpcTask: async (accountId, taskId) => {
      await task.completeTask(accountId, taskId, new Date());
      return withNpcTasks(accountId, await game.getState(accountId));
    },
    listDialogueTargets: (accountId) => dialogue.listDialogueTargets(accountId),
    getNpcDialogue: (accountId, npcActorId) => dialogue.getDialogue(accountId, npcActorId),
    sendNpcDialogueMessage: (accountId, npcActorId, message) =>
      dialogue.sendDialogueMessage(accountId, npcActorId, message)
  };
}

function createNpcTaskService(app: FastifyInstance) {
  return new NpcTaskService(
    new NpcTaskRepository(app.di.db),
    createNpcMemoryService(app),
    createNpcTaskCopywriter(app)
  );
}

function createAiOrchestrator(app: FastifyInstance) {
  const hasDeepSeekKey =
    app.config.AI_NPC_DIALOGUE_ENABLED &&
    app.config.AI_PROVIDER === "deepseek" &&
    Boolean(app.config.DEEPSEEK_API_KEY);
  const provider: AiProvider = hasDeepSeekKey
    ? new DeepSeekAiProvider({
        apiKey: app.config.DEEPSEEK_API_KEY!,
        baseUrl: app.config.DEEPSEEK_BASE_URL
      })
    : {
        completeJson: async () => {
          throw new Error("AI provider is disabled");
        }
      };

  return new AiOrchestrator({
    enabled: hasDeepSeekKey,
    providerName: hasDeepSeekKey ? "deepseek" : "template",
    model: hasDeepSeekKey ? app.config.DEEPSEEK_MODEL : "template",
    maxOutputTokens: app.config.AI_DIALOGUE_MAX_OUTPUT_TOKENS,
    timeoutMs: app.config.AI_DIALOGUE_TIMEOUT_MS,
    provider
  });
}

function createNpcTaskCopywriter(app: FastifyInstance) {
  const ai = createAiOrchestrator(app);
  const dialogueRepo = new DialogueRepository(app.di.db);

  return {
    polishTaskCopy: async (input: NpcTaskCopywriterInput) => {
      const item = getItemById(input.requestedItemId);
      const context: NpcTaskCopyPromptContext = {
        npc: {
          name: input.actor.name,
          profession: describeNpcProfession(input.actor.profession),
          personality: describeNpcPersonality(input.actor.npcKey),
          currentState: describeNpcTaskState(input)
        },
        task: {
          needType: input.needType,
          requestedItemName: item?.name ?? input.requestedItemId,
          requestedQuantity: input.requestedQuantity,
          rewardCopper: input.rewardCopper,
          deterministicTitle: input.title,
          deterministicDescription: input.description
        },
        world: {
          settlement: "黑松哨站",
          marketSummary: "任务文案只使用 NPC 当前库存和合法任务草案，不读取或改变集市价格。"
        }
      };
      const result = await ai.polishNpcTaskCopy({ context });

      await dialogueRepo.createAiCallLog({
        purpose: "npc_task_copy",
        status: result.status,
        provider: result.provider,
        model: result.model,
        promptVersion: NPC_TASK_COPY_PROMPT_VERSION,
        accountId: null,
        characterId: null,
        npcActorId: input.actor.id,
        requestHash: hashNpcTaskCopyRequest(input),
        inputSummary: summarizeNpcTaskCopyInput(input, item?.name ?? input.requestedItemId),
        outputSummary: truncateSummary(`${result.title}：${result.description}`),
        latencyMs: result.latencyMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        errorCode: result.fallbackReason
      });

      return { title: result.title, description: result.description };
    }
  };
}

function createDialogueService(app: FastifyInstance) {
  return new DialogueService({
    dialogueRepo: new DialogueRepository(app.di.db),
    gameRepo: new GameRepository(app.di.db),
    npcRepo: new NpcRepository(app.di.db),
    taskRepo: new NpcTaskRepository(app.di.db),
    memory: createNpcMemoryService(app),
    ai: createAiOrchestrator(app)
  });
}

function createNpcMemoryService(app: FastifyInstance) {
  return new NpcMemoryService(
    new NpcMemoryRepository(app.di.db),
    createNpcMemoryCompressor(app)
  );
}

function createNpcMemoryCompressor(app: FastifyInstance): NpcMemoryCompressorPort {
  const ai = createAiOrchestrator(app);
  const dialogueRepo = new DialogueRepository(app.di.db);

  return {
    compressMemory: async (input) => {
      const context: NpcMemoryCompressionPromptContext = {
        npc: {
          name: input.npcActorId,
          memoryKind: input.memoryKind,
          evidenceLevel: input.evidenceLevel
        },
        entries: input.entries.map((entry) => ({
          summary: entry.summary,
          importance: entry.importance,
          occurredAt: entry.occurredAt.toISOString()
        })),
        fallbackSummary: input.fallbackSummary
      };
      const result = await ai.compressNpcMemory({ context });

      await dialogueRepo.createAiCallLog({
        purpose: "npc_memory_compression",
        status: result.status,
        provider: result.provider,
        model: result.model,
        promptVersion: NPC_MEMORY_COMPRESSION_PROMPT_VERSION,
        accountId: null,
        characterId: null,
        npcActorId: input.npcActorId,
        requestHash: hashNpcMemoryCompressionRequest(input),
        inputSummary: summarizeNpcMemoryCompressionInput(input),
        outputSummary: truncateSummary(result.summary),
        latencyMs: result.latencyMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        errorCode: result.fallbackReason
      });

      return result;
    }
  };
}

function describeNpcProfession(profession: string) {
  switch (profession) {
    case "blacksmith":
      return "铁匠，负责修理和打造基础装备";
    case "farmer":
      return "农民，负责采集和供应基础食物";
    default:
      return profession;
  }
}

function describeNpcPersonality(npcKey: string) {
  if (npcKey.includes("blacksmith")) return "直率、重视材料库存，不喜欢空口承诺。";
  if (npcKey.includes("farmer")) return "务实、关心食物储备，愿意感谢真正帮忙的人。";
  return "谨慎、只根据自己真实需求发布请求。";
}

function describeNpcTaskState(input: NpcTaskCopywriterInput) {
  const inventoryLine = input.inventory.length
    ? input.inventory.map((item) => `${item.itemId} x${item.quantity}`).join("，")
    : "库存为空";
  return `饱腹度 ${input.actor.hunger}/5，铜币 ${input.actor.copperBalance}，库存：${inventoryLine}。`;
}

function hashNpcTaskCopyRequest(input: NpcTaskCopywriterInput) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        actorId: input.actor.id,
        needType: input.needType,
        requestedItemId: input.requestedItemId,
        requestedQuantity: input.requestedQuantity,
        rewardCopper: input.rewardCopper,
        title: input.title,
        description: input.description
      })
    )
    .digest("hex");
}

function hashNpcMemoryCompressionRequest(input: Parameters<NpcMemoryCompressorPort["compressMemory"]>[0]) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        actorId: input.npcActorId,
        characterId: input.characterId,
        memoryKind: input.memoryKind,
        evidenceLevel: input.evidenceLevel,
        entryCount: input.entries.length,
        firstOccurredAt: input.entries[0]?.occurredAt.toISOString() ?? null,
        lastOccurredAt: input.entries.at(-1)?.occurredAt.toISOString() ?? null,
        fallbackSummary: input.fallbackSummary
      })
    )
    .digest("hex");
}

function summarizeNpcTaskCopyInput(input: NpcTaskCopywriterInput, itemName: string) {
  return truncateSummary(
    `${input.actor.name}:${input.needType}:${itemName}x${input.requestedQuantity}:${input.rewardCopper}铜`
  );
}

function summarizeNpcMemoryCompressionInput(
  input: Parameters<NpcMemoryCompressorPort["compressMemory"]>[0]
) {
  return truncateSummary(
    `${input.npcActorId}:${input.memoryKind}:${input.evidenceLevel}:${input.entries.length}条`
  );
}

function truncateSummary(value: string) {
  return value.length <= 120 ? value : `${value.slice(0, 117)}...`;
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
