import {
  NPC_MEMORY_COMPRESSION_PROMPT_VERSION,
  NPC_TASK_PROPOSAL_PROMPT_VERSION,
  type NpcMemoryCompressionPromptContext,
  type NpcTaskProposalPromptContext,
  type WorldRumorPromptContext
} from "@ai-mud/ai-prompts";
import { getItemById } from "@ai-mud/content";
import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { AiOrchestrator } from "../ai/ai-orchestrator.js";
import type { AiProvider } from "../ai/ai-provider.js";
import { DeepSeekAiProvider } from "../ai/deepseek-ai-provider.js";
import { DialogueRepository } from "../dialogue/dialogue.repository.js";
import { NpcMemoryRepository } from "../npc-memory/npc-memory.repository.js";
import {
  NpcMemoryService,
  type NpcMemoryCompressorPort
} from "../npc-memory/npc-memory.service.js";
import { NpcTaskRepository } from "../npc-task/npc-task.repository.js";
import {
  NpcTaskService,
  type NpcTaskProposalInput
} from "../npc-task/npc-task.service.js";
import { RumorRepository } from "../rumor/rumor.repository.js";
import { RumorService } from "../rumor/rumor.service.js";

export function createNpcTaskService(app: FastifyInstance) {
  return new NpcTaskService(
    new NpcTaskRepository(app.di.db),
    createNpcMemoryService(app),
    createNpcTaskProposalPort(app)
  );
}

export function createRumorService(app: FastifyInstance) {
  return new RumorService(
    new RumorRepository(app.di.db),
    createWorldRumorGenerator(app),
    new DialogueRepository(app.di.db)
  );
}

export function createAiOrchestrator(app: FastifyInstance) {
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

function createNpcTaskProposalPort(app: FastifyInstance) {
  const ai = createAiOrchestrator(app);
  const dialogueRepo = new DialogueRepository(app.di.db);

  return {
    proposeNpcTask: async (input: NpcTaskProposalInput) => {
      const item = getItemById(input.requestedItemId);
      const itemName = item?.name ?? input.requestedItemId;
      const context: NpcTaskProposalPromptContext = {
        npc: {
          name: input.actor.name,
          profession: describeNpcProfession(input.actor.profession),
          personality: describeNpcPersonality(input.actor.npcKey),
          currentState: describeNpcTaskState(input)
        },
        candidate: {
          needType: input.needType,
          requestedItemName: itemName,
          requestedItemId: input.requestedItemId,
          requestedQuantity: input.requestedQuantity,
          rewardCopper: input.rewardCopper,
          expiresInHours: 24
        },
        economy: {
          npcCopperBalance: input.actor.copperBalance,
          npcCopperReserve: 5,
          canEscrowReward: input.actor.copperBalance >= input.rewardCopper + 5
        },
        relationship: {
          summary: "首版 AI 任务提案只读取真实需求，不使用关系调整奖励。"
        },
        world: {
          settlement: "黑松哨站",
          marketSummary: "任务提案只使用 NPC 当前库存和合法任务草案，不读取或改变集市价格。"
        }
      };
      const result = await ai.proposeNpcTask({ context });

      await dialogueRepo.createAiCallLog({
        purpose: "npc_task_proposal",
        status: result.status,
        provider: result.provider,
        model: result.model,
        promptVersion: NPC_TASK_PROPOSAL_PROMPT_VERSION,
        accountId: null,
        characterId: null,
        npcActorId: input.actor.id,
        requestHash: hashNpcTaskProposalRequest(input),
        inputSummary: summarizeNpcTaskProposalInput(input, itemName),
        outputSummary: truncateSummary(`${result.title}：${result.description}｜${result.npcReason}`),
        latencyMs: result.latencyMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        errorCode: result.fallbackReason
      });

      return {
        title: result.title,
        description: result.description,
        npcReason: result.npcReason,
        status: result.status
      };
    }
  };
}

function createWorldRumorGenerator(app: FastifyInstance) {
  const ai = createAiOrchestrator(app);
  return {
    generateRumor: async (input: { context: WorldRumorPromptContext }) =>
      ai.generateWorldRumor(input)
  };
}

export function createNpcMemoryService(app: FastifyInstance) {
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

function describeNpcTaskState(input: NpcTaskProposalInput) {
  const inventoryLine = input.inventory.length
    ? input.inventory.map((entry) => `${entry.itemId} x${entry.quantity}`).join("，")
    : "库存为空";
  return `饱腹度 ${input.actor.hunger}/5，铜币 ${input.actor.copperBalance}，库存：${inventoryLine}。`;
}

function hashNpcTaskProposalRequest(input: NpcTaskProposalInput) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        actorId: input.actor.id,
        needType: input.needType,
        requestedItemId: input.requestedItemId,
        requestedQuantity: input.requestedQuantity,
        rewardCopper: input.rewardCopper,
        title: input.title,
        description: input.description,
        proposalReason: input.proposalReason
      })
    )
    .digest("hex");
}

function hashNpcMemoryCompressionRequest(
  input: Parameters<NpcMemoryCompressorPort["compressMemory"]>[0]
) {
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

function summarizeNpcTaskProposalInput(input: NpcTaskProposalInput, itemName: string) {
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
