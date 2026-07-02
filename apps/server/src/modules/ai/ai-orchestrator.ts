import {
  buildNpcDialoguePrompt,
  buildNpcTaskCopyPrompt,
  parseNpcDialogueOutput,
  parseNpcTaskCopyOutput,
  type NpcDialoguePromptContext,
  type NpcTaskCopyPromptContext
} from "@ai-mud/ai-prompts";
import type { AiCallStatus } from "@ai-mud/shared";
import type { AiProvider } from "./ai-provider.js";
import { buildTemplateNpcReply } from "./template-ai-provider.js";

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
  status: AiCallStatus;
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
  status: AiCallStatus;
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

  private templateReply(
    context: NpcDialoguePromptContext,
    fallbackReason: string,
    status: Exclude<AiCallStatus, "success">
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
    status: Exclude<AiCallStatus, "success">
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
}
