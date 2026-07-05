import type { AiCallLogDto } from "@ai-mud/shared";
import { describe, expect, it, vi } from "vitest";
import type { AiOfflineSummaryResult } from "../ai/ai-orchestrator.js";
import type { AiPurposeSummaryRow } from "../ai/ai-governance.service.js";
import type { CreateAiCallLogInput } from "../dialogue/dialogue.repository.js";
import type { CharacterRecord, GameEventRecord } from "../game/game.repository.js";
import { OfflineReportService } from "./offline-report.service.js";

const now = new Date("2026-07-02T10:00:00.000Z");
const character: CharacterRecord = {
  id: "character-1",
  accountId: "account-1",
  name: "伊森",
  classId: "warrior",
  level: 5,
  xp: 120,
  hp: 100,
  maxHp: 100,
  copperBalance: 20,
  hunger: 4,
  lastHungerSettledAt: now,
  currentLocation: "blackpine_outpost",
  position: null,
  injuryUntil: null
};
const events: GameEventRecord[] = [
  {
    id: "event-1",
    message: "集市记录了基础铁矿石成交。",
    createdAt: new Date("2026-07-02T09:00:00.000Z")
  }
];

function summary(overrides: Partial<AiPurposeSummaryRow> = {}): AiPurposeSummaryRow {
  return {
    purpose: "npc_dialogue",
    callCount24h: 1,
    successCount24h: 1,
    fallbackCount24h: 0,
    rejectedCount24h: 0,
    errorCount24h: 0,
    disabledCount24h: 0,
    totalInputTokens24h: 10,
    totalOutputTokens24h: 5,
    averageLatencyMs24h: 100,
    latestStatus: "success",
    latestAt: "2026-07-02T09:30:00.000Z",
    ...overrides
  };
}

function createService(input: {
  aiResult?: AiOfflineSummaryResult;
  latestLog?: AiCallLogDto | null;
  summaries?: AiPurposeSummaryRow[];
  dailyTokenBudget?: number | null;
}) {
  const createdLogs: CreateAiCallLogInput[] = [];
  const ai = {
    generateOfflineSummary: vi.fn(async () =>
      input.aiResult ??
      ({
        title: "离线简报",
        summary: "你离开期间，黑松哨站记录了一笔基础铁矿石成交。",
        highlights: ["集市记录了基础铁矿石成交。"],
        status: "success",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        fallbackReason: null,
        inputTokens: 40,
        outputTokens: 20,
        latencyMs: 120
      } satisfies AiOfflineSummaryResult)
    )
  };
  const service = new OfflineReportService({
    ai,
    gameRepository: {
      findCharacterByAccountId: async () => character,
      listRecentEvents: async () => events
    },
    aiLogRepository: {
      createAiCallLog: async (log) => {
        createdLogs.push(log);
      },
      findLatestAiCallLogByAccountPurpose: async () => input.latestLog ?? null,
      summarizeByPurposeSince: async () => input.summaries ?? []
    },
    dailyTokenBudget: input.dailyTokenBudget ?? null
  });

  return { service, ai, createdLogs };
}

describe("OfflineReportService", () => {
  it("generates one AI report from verified recent events and records an audit log", async () => {
    const { service, ai, createdLogs } = createService({});

    const report = await service.getReport("account-1", now);

    expect(ai.generateOfflineSummary).toHaveBeenCalledOnce();
    expect(report?.summary).toContain("基础铁矿石成交");
    expect(createdLogs).toHaveLength(1);
    expect(createdLogs[0]).toMatchObject({
      purpose: "offline_summary",
      status: "success",
      accountId: "account-1",
      characterId: "character-1",
      provider: "deepseek"
    });
  });

  it("reuses the same-day cached report without calling AI again", async () => {
    const cachedReport = {
      generatedAt: "2026-07-02T08:00:00.000Z",
      since: "2026-07-02T06:00:00.000Z",
      until: "2026-07-02T08:00:00.000Z",
      status: "success",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      fallbackReason: null,
      title: "缓存简报",
      summary: "这是缓存。",
      highlights: ["缓存记录。"]
    };
    const { service, ai, createdLogs } = createService({
      latestLog: {
        id: "ai-call-1",
        purpose: "offline_summary",
        status: "success",
        provider: "deepseek",
        model: "deepseek-v4-flash",
        promptVersion: 1,
        accountId: "account-1",
        characterId: "character-1",
        npcActorId: null,
        inputSummary: "cached",
        outputSummary: JSON.stringify(cachedReport),
        latencyMs: 100,
        inputTokens: 10,
        outputTokens: 5,
        errorCode: null,
        createdAt: "2026-07-02T08:00:00.000Z"
      }
    });

    const report = await service.getReport("account-1", now);

    expect(report?.title).toBe("缓存简报");
    expect(ai.generateOfflineSummary).not.toHaveBeenCalled();
    expect(createdLogs).toHaveLength(0);
  });

  it("falls back to a template when the daily token budget is exhausted", async () => {
    const { service, ai, createdLogs } = createService({
      dailyTokenBudget: 10,
      summaries: [summary({ totalInputTokens24h: 8, totalOutputTokens24h: 2 })]
    });

    const report = await service.getReport("account-1", now);

    expect(ai.generateOfflineSummary).not.toHaveBeenCalled();
    expect(report?.status).toBe("fallback");
    expect(report?.fallbackReason).toBe("budget_exhausted");
    expect(createdLogs[0]).toMatchObject({
      purpose: "offline_summary",
      status: "fallback",
      provider: "template",
      errorCode: "budget_exhausted"
    });
  });
});
