import type {
  AiCallLogDto,
  AiCallPurpose,
  AiCallStatus,
  AiLayerStatusDto,
  AiPurposeStatusDto
} from "@ai-mud/shared";
import { AI_PURPOSE_ORDER, AI_PURPOSE_POLICIES } from "./ai-purpose-policy.js";

export type AiPurposeSummaryRow = Pick<
  AiPurposeStatusDto,
  | "purpose"
  | "callCount24h"
  | "successCount24h"
  | "fallbackCount24h"
  | "rejectedCount24h"
  | "errorCount24h"
  | "disabledCount24h"
  | "totalInputTokens24h"
  | "totalOutputTokens24h"
  | "averageLatencyMs24h"
  | "latestStatus"
  | "latestAt"
>;

export interface AiCallLogSummaryRepository {
  summarizeByPurposeSince(since: Date): Promise<AiPurposeSummaryRow[]>;
}

export interface AiGovernanceConfig {
  providerEnabled: boolean;
  providerName: string;
  model: string | null;
  promptVersion: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function summarizeAiCallLogs(logs: AiCallLogDto[]): AiPurposeSummaryRow[] {
  const groups = new Map<
    AiCallPurpose,
    {
      purpose: AiCallPurpose;
      callCount24h: number;
      successCount24h: number;
      fallbackCount24h: number;
      rejectedCount24h: number;
      errorCount24h: number;
      disabledCount24h: number;
      totalInputTokens24h: number;
      totalOutputTokens24h: number;
      latencyTotal: number;
      latencyCount: number;
      latestStatus: AiCallStatus | null;
      latestAt: string | null;
    }
  >();

  for (const log of logs) {
    const group =
      groups.get(log.purpose) ??
      {
        purpose: log.purpose,
        callCount24h: 0,
        successCount24h: 0,
        fallbackCount24h: 0,
        rejectedCount24h: 0,
        errorCount24h: 0,
        disabledCount24h: 0,
        totalInputTokens24h: 0,
        totalOutputTokens24h: 0,
        latencyTotal: 0,
        latencyCount: 0,
        latestStatus: null,
        latestAt: null
      };

    group.callCount24h += 1;
    if (log.status === "success") group.successCount24h += 1;
    if (log.status === "fallback") group.fallbackCount24h += 1;
    if (log.status === "rejected") group.rejectedCount24h += 1;
    if (log.status === "error") group.errorCount24h += 1;
    if (log.status === "disabled") group.disabledCount24h += 1;
    group.totalInputTokens24h += log.inputTokens ?? 0;
    group.totalOutputTokens24h += log.outputTokens ?? 0;
    if (log.latencyMs !== null) {
      group.latencyTotal += log.latencyMs;
      group.latencyCount += 1;
    }
    if (!group.latestAt || log.createdAt > group.latestAt) {
      group.latestStatus = log.status;
      group.latestAt = log.createdAt;
    }

    groups.set(log.purpose, group);
  }

  return [...groups.values()]
    .sort((left, right) => AI_PURPOSE_ORDER.indexOf(left.purpose) - AI_PURPOSE_ORDER.indexOf(right.purpose))
    .map((group) => ({
      purpose: group.purpose,
      callCount24h: group.callCount24h,
      successCount24h: group.successCount24h,
      fallbackCount24h: group.fallbackCount24h,
      rejectedCount24h: group.rejectedCount24h,
      errorCount24h: group.errorCount24h,
      disabledCount24h: group.disabledCount24h,
      totalInputTokens24h: group.totalInputTokens24h,
      totalOutputTokens24h: group.totalOutputTokens24h,
      averageLatencyMs24h:
        group.latencyCount > 0 ? Math.round(group.latencyTotal / group.latencyCount) : null,
      latestStatus: group.latestStatus,
      latestAt: group.latestAt
    }));
}

export class AiGovernanceService {
  constructor(
    private readonly repository: AiCallLogSummaryRepository,
    private readonly config: AiGovernanceConfig
  ) {}

  async getStatus(now: Date): Promise<AiLayerStatusDto> {
    const since = new Date(now.getTime() - DAY_MS);
    const summaries = new Map(
      (await this.repository.summarizeByPurposeSince(since)).map((row) => [row.purpose, row])
    );

    return {
      providerEnabled: this.config.providerEnabled,
      providerName: this.config.providerName,
      model: this.config.model,
      promptVersion: this.config.promptVersion,
      purposes: AI_PURPOSE_ORDER.map((purpose) =>
        this.buildPurposeStatus(purpose, summaries.get(purpose))
      )
    };
  }

  private buildPurposeStatus(
    purpose: AiCallPurpose,
    summary: AiPurposeSummaryRow | undefined
  ): AiPurposeStatusDto {
    const policy = AI_PURPOSE_POLICIES[purpose];
    return {
      purpose,
      authorityClass: policy.authorityClass,
      enabled: this.config.providerEnabled,
      mutatesWorldState: false,
      maxOutputTokens: policy.maxOutputTokens,
      cooldownMs: policy.cooldownMs,
      fallbackRequired: true,
      promptVersion: policy.promptVersion,
      callCount24h: summary?.callCount24h ?? 0,
      successCount24h: summary?.successCount24h ?? 0,
      fallbackCount24h: summary?.fallbackCount24h ?? 0,
      rejectedCount24h: summary?.rejectedCount24h ?? 0,
      errorCount24h: summary?.errorCount24h ?? 0,
      disabledCount24h: summary?.disabledCount24h ?? 0,
      totalInputTokens24h: summary?.totalInputTokens24h ?? 0,
      totalOutputTokens24h: summary?.totalOutputTokens24h ?? 0,
      averageLatencyMs24h: summary?.averageLatencyMs24h ?? null,
      latestStatus: summary?.latestStatus ?? null,
      latestAt: summary?.latestAt ?? null
    };
  }
}
