import {
  buildNpcDialoguePrompt,
  buildNpcMemoryCompressionPrompt,
  buildNpcTaskProposalPrompt,
  buildNpcTaskCopyPrompt,
  buildWorldRumorPrompt,
  parseNpcDialogueOutput,
  parseNpcMemoryCompressionOutput,
  parseNpcTaskProposalOutput,
  parseNpcTaskCopyOutput,
  parseWorldRumorOutput,
  type NpcDialoguePromptContext,
  type NpcMemoryCompressionPromptContext,
  type NpcTaskProposalPromptContext,
  type NpcTaskCopyPromptContext,
  type WorldRumorPromptContext
} from "@ai-mud/ai-prompts";
import type { AiCallStatus } from "@ai-mud/shared";
import type { AiProvider } from "./ai-provider.js";
import { buildTemplateNpcReply } from "./template-ai-provider.js";

type AiProviderCallStatus = Exclude<AiCallStatus, "disabled">;

export interface AiOrchestratorOptions {
  enabled: boolean;
  providerName: string;
  model: string;
  maxOutputTokens: number;
  timeoutMs: number;
  provider: AiProvider;
}

export interface AiDialogueReply {
  reply: string;
  status: AiProviderCallStatus;
  provider: string;
  model: string;
  fallbackReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
}

export interface AiTaskCopyResult {
  title: string;
  description: string;
  status: AiProviderCallStatus;
  provider: string;
  model: string;
  fallbackReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
}

export interface AiTaskProposalResult {
  title: string;
  description: string;
  npcReason: string;
  status: AiProviderCallStatus;
  provider: string;
  model: string;
  fallbackReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
}

export interface AiMemoryCompressionResult {
  summary: string;
  status: AiProviderCallStatus;
  provider: string;
  model: string;
  fallbackReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
}

export interface AiWorldRumorResult {
  message: string;
  status: AiProviderCallStatus;
  provider: string;
  model: string;
  fallbackReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
}

export class AiOrchestrator {
  constructor(private readonly options: AiOrchestratorOptions) {}

  async replyToNpcDialogue(input: {
    npcContext: NpcDialoguePromptContext;
    accountId: string;
    characterId: string;
    npcActorId: string;
  }): Promise<AiDialogueReply> {
    if (!this.options.enabled) {
      return this.templateReply(input.npcContext, "disabled", "fallback");
    }

    const prompt = buildNpcDialoguePrompt(input.npcContext);

    try {
      const result = await this.options.provider.completeJson({
        provider: this.options.providerName,
        model: this.options.model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user }
        ],
        responseFormat: { type: "json_object" },
        maxTokens: this.options.maxOutputTokens,
        timeoutMs: this.options.timeoutMs
      });
      const parsed = parseNpcDialogueOutput(result.rawContent);

      if (!parsed.ok) {
        return {
          ...this.templateReply(input.npcContext, parsed.reason, "rejected"),
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs: result.latencyMs
        };
      }

      return {
        reply: parsed.value.reply,
        status: "success",
        provider: this.options.providerName,
        model: this.options.model,
        fallbackReason: null,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs
      };
    } catch {
      return this.templateReply(input.npcContext, "provider_error", "error");
    }
  }

  async polishNpcTaskCopy(input: {
    context: NpcTaskCopyPromptContext;
  }): Promise<AiTaskCopyResult> {
    if (!this.options.enabled) {
      return this.templateTaskCopy(input.context, "disabled", "fallback");
    }

    const prompt = buildNpcTaskCopyPrompt(input.context);

    try {
      const result = await this.options.provider.completeJson({
        provider: this.options.providerName,
        model: this.options.model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user }
        ],
        responseFormat: { type: "json_object" },
        maxTokens: Math.min(this.options.maxOutputTokens, 220),
        timeoutMs: this.options.timeoutMs
      });
      const parsed = parseNpcTaskCopyOutput(result.rawContent);

      if (!parsed.ok) {
        return {
          ...this.templateTaskCopy(input.context, parsed.reason, "rejected"),
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs: result.latencyMs
        };
      }

      return {
        title: parsed.value.title,
        description: parsed.value.description,
        status: "success",
        provider: this.options.providerName,
        model: this.options.model,
        fallbackReason: null,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs
      };
    } catch {
      return this.templateTaskCopy(input.context, "provider_error", "error");
    }
  }

  async proposeNpcTask(input: {
    context: NpcTaskProposalPromptContext;
  }): Promise<AiTaskProposalResult> {
    if (!this.options.enabled) {
      return this.templateTaskProposal(input.context, "disabled", "fallback");
    }

    const prompt = buildNpcTaskProposalPrompt(input.context);

    try {
      const result = await this.options.provider.completeJson({
        provider: this.options.providerName,
        model: this.options.model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user }
        ],
        responseFormat: { type: "json_object" },
        maxTokens: Math.min(this.options.maxOutputTokens, 220),
        timeoutMs: this.options.timeoutMs
      });
      const parsed = parseNpcTaskProposalOutput(result.rawContent);

      if (!parsed.ok) {
        return {
          ...this.templateTaskProposal(input.context, parsed.reason, "rejected"),
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs: result.latencyMs
        };
      }

      return {
        title: parsed.value.title,
        description: parsed.value.description,
        npcReason: parsed.value.npcReason,
        status: "success",
        provider: this.options.providerName,
        model: this.options.model,
        fallbackReason: null,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs
      };
    } catch {
      return this.templateTaskProposal(input.context, "provider_error", "error");
    }
  }

  async compressNpcMemory(input: {
    context: NpcMemoryCompressionPromptContext;
  }): Promise<AiMemoryCompressionResult> {
    if (!this.options.enabled) {
      return this.templateMemoryCompression(input.context, "disabled", "fallback");
    }

    const prompt = buildNpcMemoryCompressionPrompt(input.context);

    try {
      const result = await this.options.provider.completeJson({
        provider: this.options.providerName,
        model: this.options.model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user }
        ],
        responseFormat: { type: "json_object" },
        maxTokens: Math.min(this.options.maxOutputTokens, 260),
        timeoutMs: this.options.timeoutMs
      });
      const parsed = parseNpcMemoryCompressionOutput(result.rawContent);

      if (!parsed.ok) {
        return {
          ...this.templateMemoryCompression(input.context, parsed.reason, "rejected"),
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs: result.latencyMs
        };
      }

      return {
        summary: parsed.value.summary,
        status: "success",
        provider: this.options.providerName,
        model: this.options.model,
        fallbackReason: null,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs
      };
    } catch {
      return this.templateMemoryCompression(input.context, "provider_error", "error");
    }
  }

  async generateWorldRumor(input: {
    context: WorldRumorPromptContext;
  }): Promise<AiWorldRumorResult> {
    if (!this.options.enabled) {
      return this.templateWorldRumor(input.context, "disabled", "fallback");
    }

    const prompt = buildWorldRumorPrompt(input.context);

    try {
      const result = await this.options.provider.completeJson({
        provider: this.options.providerName,
        model: this.options.model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user }
        ],
        responseFormat: { type: "json_object" },
        maxTokens: Math.min(this.options.maxOutputTokens, 120),
        timeoutMs: this.options.timeoutMs
      });
      const parsed = parseWorldRumorOutput(result.rawContent);

      if (!parsed.ok) {
        return {
          ...this.templateWorldRumor(input.context, parsed.reason, "rejected"),
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs: result.latencyMs
        };
      }

      return {
        message: parsed.value.message,
        status: "success",
        provider: this.options.providerName,
        model: this.options.model,
        fallbackReason: null,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs
      };
    } catch {
      return this.templateWorldRumor(input.context, "provider_error", "error");
    }
  }

  private templateReply(
    context: NpcDialoguePromptContext,
    fallbackReason: string,
    status: Exclude<AiProviderCallStatus, "success">
  ): AiDialogueReply {
    return {
      reply: buildTemplateNpcReply(context),
      status,
      provider: "template",
      model: "template",
      fallbackReason,
      inputTokens: null,
      outputTokens: null,
      latencyMs: null
    };
  }

  private templateTaskCopy(
    context: NpcTaskCopyPromptContext,
    fallbackReason: string,
    status: Exclude<AiProviderCallStatus, "success">
  ): AiTaskCopyResult {
    return {
      title: context.task.deterministicTitle,
      description: context.task.deterministicDescription,
      status,
      provider: "template",
      model: "template",
      fallbackReason,
      inputTokens: null,
      outputTokens: null,
      latencyMs: null
    };
  }

  private templateTaskProposal(
    context: NpcTaskProposalPromptContext,
    fallbackReason: string,
    status: Exclude<AiProviderCallStatus, "success">
  ): AiTaskProposalResult {
    return {
      title: defaultTaskTitle(context),
      description: defaultTaskDescription(context),
      npcReason: defaultTaskReason(context),
      status,
      provider: "template",
      model: "template",
      fallbackReason,
      inputTokens: null,
      outputTokens: null,
      latencyMs: null
    };
  }

  private templateMemoryCompression(
    context: NpcMemoryCompressionPromptContext,
    fallbackReason: string,
    status: Exclude<AiProviderCallStatus, "success">
  ): AiMemoryCompressionResult {
    return {
      summary: context.fallbackSummary,
      status,
      provider: "template",
      model: "template",
      fallbackReason,
      inputTokens: null,
      outputTokens: null,
      latencyMs: null
    };
  }

  private templateWorldRumor(
    context: WorldRumorPromptContext,
    fallbackReason: string,
    status: Exclude<AiProviderCallStatus, "success">
  ): AiWorldRumorResult {
    return {
      message: context.fallbackMessage,
      status,
      provider: "template",
      model: "template",
      fallbackReason,
      inputTokens: null,
      outputTokens: null,
      latencyMs: null
    };
  }
}

function defaultTaskTitle(context: NpcTaskProposalPromptContext) {
  if (context.candidate.needType === "ore_shortage") return "炉火缺矿";
  return `${context.npc.name}的空粮袋`;
}

function defaultTaskDescription(context: NpcTaskProposalPromptContext) {
  if (context.candidate.needType === "ore_shortage") {
    return `${context.npc.name}缺少${context.candidate.requestedItemName}，修理炉火和补强装备都会被拖慢。`;
  }
  return `${context.npc.name}的口粮已经见底，需要有人送来${context.candidate.requestedItemName}维持今天的行动。`;
}

function defaultTaskReason(context: NpcTaskProposalPromptContext) {
  if (context.candidate.needType === "ore_shortage") {
    return `${context.candidate.requestedItemName}不足，${context.npc.name}的修理活会被拖慢。`;
  }
  return `${context.npc.name}缺少食物，今天的行动会受影响。`;
}
