import type { AiCallStatus, WorldRumorDto } from "@ai-mud/shared";
import {
  WORLD_RUMOR_PROMPT_VERSION,
  type WorldRumorPromptContext
} from "@ai-mud/ai-prompts";
import { createHash } from "node:crypto";
import type { CreateAiCallLogInput } from "../dialogue/dialogue.repository.js";
import type { RumorSourceRecord } from "./rumor.repository.js";

export interface AiWorldRumorResult {
  message: string;
  status: AiCallStatus;
  provider: string;
  model: string;
  fallbackReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
}

export interface RumorRepositoryPort {
  listRecentPublicRumors(limit: number): Promise<WorldRumorDto[]>;
  listUnrumoredNpcEvents(limit: number): Promise<RumorSourceRecord[]>;
  listUnrumoredGameEvents(limit: number): Promise<RumorSourceRecord[]>;
  hasRumorForSource(sourceType: RumorSourceRecord["sourceType"], sourceId: string): Promise<boolean>;
  insertRumor(input: {
    sourceType: RumorSourceRecord["sourceType"];
    sourceId: string | null;
    settlementId: string | null;
    audience: "public";
    message: string;
    tags: string[];
    generatedBy: "template" | "ai";
    createdAt?: Date;
    expiresAt?: Date | null;
  }): Promise<WorldRumorDto>;
}

export interface RumorGeneratorPort {
  generateRumor(input: { context: WorldRumorPromptContext }): Promise<AiWorldRumorResult>;
}

export interface AiRumorAuditPort {
  createAiCallLog(input: CreateAiCallLogInput): Promise<void>;
}

export class RumorService {
  constructor(
    private readonly repo: RumorRepositoryPort,
    private readonly generator?: RumorGeneratorPort,
    private readonly audit?: AiRumorAuditPort
  ) {}

  async syncRumors(input: { now: Date; batchLimit?: number }): Promise<WorldRumorDto[]> {
    const batchLimit = Math.min(3, Math.max(1, Math.floor(input.batchLimit ?? 3)));
    const candidates = await this.listCandidates(batchLimit * 2);
    const created: WorldRumorDto[] = [];

    for (const candidate of candidates) {
      if (created.length >= batchLimit) break;
      if (await this.repo.hasRumorForSource(candidate.sourceType, candidate.sourceId)) continue;

      const fallbackMessage = buildFallbackRumorMessage(candidate.sourceMessage);
      const context: WorldRumorPromptContext = {
        sourceType: candidate.sourceType,
        sourceMessage: candidate.sourceMessage,
        sourceActorName: candidate.sourceActorName,
        sourceLocationName: candidate.sourceLocationName,
        worldDate: input.now.toISOString().slice(0, 10),
        fallbackMessage
      };
      const result = this.generator
        ? await this.generator.generateRumor({ context })
        : templateRumorResult(fallbackMessage);

      if (this.audit && this.generator) {
        await this.audit.createAiCallLog({
          purpose: "world_rumor",
          status: result.status,
          provider: result.provider,
          model: result.model,
          promptVersion: WORLD_RUMOR_PROMPT_VERSION,
          accountId: null,
          characterId: null,
          npcActorId: candidate.npcActorId,
          requestHash: hashRumorRequest(candidate),
          inputSummary: truncateSummary(`${candidate.sourceType}:${candidate.sourceMessage}`),
          outputSummary: truncateSummary(result.message),
          latencyMs: result.latencyMs,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          errorCode: result.fallbackReason
        });
      }

      created.push(
        await this.repo.insertRumor({
          sourceType: candidate.sourceType,
          sourceId: candidate.sourceId,
          settlementId: "blackpine_outpost",
          audience: "public",
          message: clampRumorMessage(result.message || fallbackMessage),
          tags: candidate.tags,
          generatedBy: result.status === "success" ? "ai" : "template",
          createdAt: input.now,
          expiresAt: null
        })
      );
    }

    return created;
  }

  listRecentPublicRumors(limit: number) {
    return this.repo.listRecentPublicRumors(limit);
  }

  private async listCandidates(limit: number) {
    const [npcEvents, gameEvents] = await Promise.all([
      this.repo.listUnrumoredNpcEvents(limit),
      this.repo.listUnrumoredGameEvents(limit)
    ]);
    return [...npcEvents, ...gameEvents].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
    );
  }
}

export function buildFallbackRumorMessage(sourceMessage: string) {
  return clampRumorMessage(`村里有人低声谈起：${sourceMessage}`);
}

function templateRumorResult(message: string): AiWorldRumorResult {
  return {
    message,
    status: "fallback",
    provider: "template",
    model: "template",
    fallbackReason: "disabled",
    inputTokens: null,
    outputTokens: null,
    latencyMs: null
  };
}

function clampRumorMessage(value: string) {
  const trimmed = value.trim();
  const chars = [...trimmed];
  return chars.length <= 80 ? trimmed : chars.slice(0, 77).join("") + "...";
}

function hashRumorRequest(source: RumorSourceRecord) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        sourceMessage: source.sourceMessage,
        createdAt: source.createdAt.toISOString()
      })
    )
    .digest("hex");
}

function truncateSummary(value: string) {
  return value.length <= 120 ? value : `${value.slice(0, 117)}...`;
}
