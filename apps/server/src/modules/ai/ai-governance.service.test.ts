import type { AiCallLogDto, AiLayerStatusDto, AiPurposeStatusDto } from "@ai-mud/shared";
import { describe, expect, it } from "vitest";
import {
  AiGovernanceService,
  summarizeAiCallLogs,
  type AiCallLogSummaryRepository
} from "./ai-governance.service.js";

const baseLog: AiCallLogDto = {
  id: "ai-call-1",
  purpose: "npc_dialogue",
  status: "success",
  provider: "deepseek",
  model: "deepseek-v4-flash",
  promptVersion: 1,
  accountId: "account-1",
  characterId: "character-1",
  npcActorId: "npc-blacksmith",
  inputSummary: "最近缺什么？",
  outputSummary: "基础铁矿石。",
  latencyMs: 100,
  inputTokens: 40,
  outputTokens: 20,
  errorCode: null,
  createdAt: "2026-07-02T11:59:00.000Z"
};

describe("summarizeAiCallLogs", () => {
  it("groups statuses, token totals, latency, and latest status by purpose", () => {
    const rows = summarizeAiCallLogs([
      baseLog,
      {
        ...baseLog,
        id: "ai-call-2",
        status: "disabled",
        inputTokens: null,
        outputTokens: null,
        latencyMs: null,
        inputSummary: "cooldown",
        createdAt: "2026-07-02T12:00:00.000Z"
      },
      {
        ...baseLog,
        id: "ai-call-3",
        purpose: "world_rumor",
        status: "fallback",
        inputTokens: 10,
        outputTokens: 5,
        latencyMs: 50,
        createdAt: "2026-07-02T11:30:00.000Z"
      }
    ]);

    expect(rows).toEqual([
      expect.objectContaining({
        purpose: "npc_dialogue",
        callCount24h: 2,
        successCount24h: 1,
        disabledCount24h: 1,
        totalInputTokens24h: 40,
        totalOutputTokens24h: 20,
        averageLatencyMs24h: 100,
        latestStatus: "disabled",
        latestAt: "2026-07-02T12:00:00.000Z"
      }),
      expect.objectContaining({
        purpose: "world_rumor",
        fallbackCount24h: 1,
        latestStatus: "fallback"
      })
    ]);
  });
});

describe("AiGovernanceService", () => {
  it("returns one status row for every purpose even when no calls exist", async () => {
    const repo: AiCallLogSummaryRepository = {
      summarizeByPurposeSince: async () => []
    };
    const service = new AiGovernanceService(repo, {
      providerEnabled: true,
      providerName: "deepseek",
      model: "deepseek-v4-flash",
      promptVersion: 6
    });

    const status: AiLayerStatusDto = await service.getStatus(
      new Date("2026-07-02T12:00:00.000Z")
    );

    expect(status.providerName).toBe("deepseek");
    expect(status.purposes.map((purpose) => purpose.purpose).sort()).toEqual([
      "npc_dialogue",
      "npc_memory_compression",
      "npc_task_copy",
      "world_rumor"
    ]);
    expect(status.purposes.every((purpose) => purpose.mutatesWorldState === false)).toBe(true);
    expect(status.purposes.every((purpose) => purpose.callCount24h === 0)).toBe(true);
  });

  it("merges 24 hour summaries with registry policy rows", async () => {
    const repo: AiCallLogSummaryRepository = {
      summarizeByPurposeSince: async () => [
        {
          purpose: "npc_dialogue",
          callCount24h: 1,
          successCount24h: 0,
          fallbackCount24h: 0,
          rejectedCount24h: 0,
          errorCount24h: 0,
          disabledCount24h: 1,
          totalInputTokens24h: 0,
          totalOutputTokens24h: 0,
          averageLatencyMs24h: null,
          latestStatus: "disabled",
          latestAt: "2026-07-02T12:00:00.000Z"
        }
      ]
    };
    const service = new AiGovernanceService(repo, {
      providerEnabled: false,
      providerName: "template",
      model: null,
      promptVersion: 6
    });

    const status = await service.getStatus(new Date("2026-07-02T12:00:00.000Z"));
    const dialogue = status.purposes.find(
      (purpose): purpose is AiPurposeStatusDto => purpose.purpose === "npc_dialogue"
    );

    expect(dialogue).toMatchObject({
      enabled: false,
      cooldownMs: 5000,
      disabledCount24h: 1,
      latestStatus: "disabled"
    });
  });
});
