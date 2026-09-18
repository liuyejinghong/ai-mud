import {
  OFFLINE_SUMMARY_PROMPT_VERSION,
  type OfflineSummaryPromptContext
} from "@ai-mud/ai-prompts";
import { getZoneById } from "@ai-mud/content";
import type { AiCallLogDto, AiCallStatus, GameLocationId, OfflineReportDto } from "@ai-mud/shared";
import { createHash } from "node:crypto";
import type { AiOfflineSummaryResult, AiOrchestrator } from "../ai/ai-orchestrator.js";
import type { AiPurposeSummaryRow } from "../ai/ai-governance.service.js";
import type { CreateAiCallLogInput } from "../dialogue/dialogue.repository.js";
import type { CharacterRecord, GameEventRecord } from "../game/game.repository.js";

export interface OfflineReportGameRepository {
  findCharacterByAccountId(accountId: string): Promise<CharacterRecord | null>;
  listRecentEvents(characterId: string): Promise<GameEventRecord[]>;
}

export interface OfflineReportAiLogRepository {
  createAiCallLog(input: CreateAiCallLogInput): Promise<void>;
  findLatestAiCallLogByAccountPurpose(input: {
    accountId: string;
    purpose: "offline_summary";
  }): Promise<AiCallLogDto | null>;
  summarizeByPurposeSince(since: Date): Promise<AiPurposeSummaryRow[]>;
}

export interface OfflineReportServiceOptions {
  ai: Pick<AiOrchestrator, "generateOfflineSummary">;
  gameRepository: OfflineReportGameRepository;
  aiLogRepository: OfflineReportAiLogRepository;
  dailyTokenBudget: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_MS = 2 * 60 * 60 * 1000;

export class OfflineReportService {
  constructor(private readonly options: OfflineReportServiceOptions) {}

  async getReport(accountId: string, now: Date): Promise<OfflineReportDto | null> {
    const character = await this.options.gameRepository.findCharacterByAccountId(accountId);
    if (!character) return null;

    const cached = await this.options.aiLogRepository.findLatestAiCallLogByAccountPurpose({
      accountId,
      purpose: "offline_summary"
    });
    if (cached && sameUtcDay(new Date(cached.createdAt), now)) {
      const parsed = parseCachedReport(cached.outputSummary);
      if (parsed) return parsed;
    }

    const recentEvents = await this.options.gameRepository.listRecentEvents(character.id);
    const since = cached ? new Date(cached.createdAt) : new Date(now.getTime() - DEFAULT_WINDOW_MS);
    const context = buildContext(character, recentEvents, since, now);
    const budget = await this.getBudget(now);
    const requestHash = hashContext(context);

    if (budget.exhausted) {
      return this.logAndBuildReport(accountId, character.id, context, now, {
        ...templateResult(context, "budget_exhausted"),
        status: "fallback"
      }, requestHash);
    }

    // ARCH-06: the core snapshot must not wait on an optional model call.
    // Return the template now; kick the real generation off in the background.
    // The next poll within the same UTC day picks the AI report up from the
    // ai_call_logs cache.
    void this.options.ai
      .generateOfflineSummary({ context })
      .then((aiResult) =>
        this.logAndBuildReport(accountId, character.id, context, now, aiResult, requestHash)
      )
      .catch(() => {
        // Generation failures already fall back inside the orchestrator; a
        // crash here must not take the sync path down. Next poll retries.
      });

    return this.logAndBuildReport(accountId, character.id, context, now, {
      ...templateResult(context, "generation_pending"),
      status: "fallback"
    }, requestHash);
  }

  private async getBudget(now: Date) {
    const since = new Date(now.getTime() - DAY_MS);
    const summaries = await this.options.aiLogRepository.summarizeByPurposeSince(since);
    const usedTokens = summaries.reduce(
      (total, row) => total + row.totalInputTokens24h + row.totalOutputTokens24h,
      0
    );
    return {
      usedTokens,
      exhausted:
        this.options.dailyTokenBudget !== null && usedTokens >= this.options.dailyTokenBudget
    };
  }

  private async logAndBuildReport(
    accountId: string,
    characterId: string,
    context: OfflineSummaryPromptContext,
    now: Date,
    result: AiOfflineSummaryResult,
    requestHash: string
  ) {
    const report: OfflineReportDto = {
      generatedAt: now.toISOString(),
      since: context.window.since,
      until: context.window.until,
      status: result.status,
      provider: result.provider,
      model: result.model,
      fallbackReason: result.fallbackReason,
      title: result.title,
      summary: result.summary,
      highlights: result.highlights
    };

    await this.options.aiLogRepository.createAiCallLog({
      purpose: "offline_summary",
      status: result.status as AiCallStatus,
      provider: result.provider,
      model: result.model,
      promptVersion: OFFLINE_SUMMARY_PROMPT_VERSION,
      accountId,
      characterId,
      npcActorId: null,
      requestHash,
      inputSummary: context.facts.slice(0, 4).join(" | ") || "no_recent_facts",
      outputSummary: JSON.stringify(report),
      latencyMs: result.latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      errorCode: result.fallbackReason,
      createdAt: now
    });

    return report;
  }
}

function buildContext(
  character: CharacterRecord,
  events: GameEventRecord[],
  since: Date,
  now: Date
): OfflineSummaryPromptContext {
  const locationName = zoneName(character.currentLocation);
  const facts = events
    .filter((event) => event.createdAt <= now)
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
    .slice(-8)
    .map((event) => `${playerFacingElapsedTime(event.createdAt, now)}，${event.message}`);
  const fallback = {
    title: "离线简报",
    summary:
      facts.length > 0
        ? `${character.name}离开期间，${locationName}留下了${facts.length}条可核验记录。`
        : `${character.name}离开期间，${locationName}没有出现新的可核验记录。`,
    highlights: facts.length > 0 ? facts.slice(-3) : ["世界仍在按既定规则缓慢运转。"]
  };

  return {
    player: {
      name: character.name,
      level: character.level,
      locationName
    },
    window: {
      since: since.toISOString(),
      until: now.toISOString()
    },
    facts,
    fallback
  };
}

function templateResult(
  context: OfflineSummaryPromptContext,
  fallbackReason: string
): AiOfflineSummaryResult {
  return {
    title: context.fallback.title,
    summary: context.fallback.summary,
    highlights: context.fallback.highlights,
    status: "fallback",
    provider: "template",
    model: "template",
    fallbackReason,
    inputTokens: null,
    outputTokens: null,
    latencyMs: null
  };
}

function parseCachedReport(value: string): OfflineReportDto | null {
  try {
    const parsed = JSON.parse(value) as Partial<OfflineReportDto>;
    if (
      typeof parsed.generatedAt !== "string" ||
      typeof parsed.title !== "string" ||
      typeof parsed.summary !== "string" ||
      !Array.isArray(parsed.highlights)
    ) {
      return null;
    }
    return parsed as OfflineReportDto;
  } catch {
    return null;
  }
}

function sameUtcDay(left: Date, right: Date) {
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate()
  );
}

function zoneName(locationId: GameLocationId) {
  return getZoneById(locationId)?.title ?? locationId;
}

function playerFacingElapsedTime(occurredAt: Date, now: Date) {
  const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - occurredAt.getTime()) / 60_000));
  if (elapsedMinutes < 1) return "刚刚";
  if (elapsedMinutes < 60) return `约 ${elapsedMinutes} 分钟前`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `约 ${elapsedHours} 小时前`;
  return "此前";
}

function hashContext(context: OfflineSummaryPromptContext) {
  return createHash("sha256").update(JSON.stringify(context)).digest("hex");
}
