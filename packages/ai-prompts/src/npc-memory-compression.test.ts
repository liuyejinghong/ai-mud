import { describe, expect, it } from "vitest";
import {
  buildNpcMemoryCompressionPrompt,
  parseNpcMemoryCompressionOutput,
  type NpcMemoryCompressionPromptContext
} from "./npc-memory-compression.js";

const context: NpcMemoryCompressionPromptContext = {
  npc: {
    name: "伯林",
    memoryKind: "conversation",
    evidenceLevel: "dialogue_claim"
  },
  entries: [
    {
      summary: "阿岚 说：“我上周送过烤鸡”；NPC 回应：“伯林像是想起了什么”。",
      importance: 4,
      occurredAt: "2026-07-02T08:00:00.000Z"
    },
    {
      summary: "阿岚 说：“我正在找基础铁矿石”；NPC 回应：“炉火还没灭”。",
      importance: 1,
      occurredAt: "2026-07-02T09:00:00.000Z"
    }
  ],
  fallbackSummary: "阿岚提到烤鸡和基础铁矿石。"
};

function validOutput(summary = "伯林记得阿岚声称送过烤鸡，也多次提到基础铁矿石。") {
  return JSON.stringify({
    summary,
    safety: {
      changesEvidenceLevel: false,
      containsRewardPromise: false,
      containsRuleChange: false,
      containsOoc: false
    }
  });
}

describe("NPC memory compression prompt", () => {
  it("builds a JSON-only compression prompt with evidence guardrails", () => {
    const prompt = buildNpcMemoryCompressionPrompt(context);

    expect(prompt.system).toContain("json object");
    expect(prompt.system).toContain("不得改变证据等级");
    expect(prompt.system).toContain("dialogue_claim");
    expect(prompt.user).toContain("\"requiredOutput\":\"json\"");
  });

  it("parses a valid compressed summary", () => {
    expect(parseNpcMemoryCompressionOutput(validOutput())).toEqual({
      ok: true,
      value: {
        summary: "伯林记得阿岚声称送过烤鸡，也多次提到基础铁矿石。"
      }
    });
  });

  it("rejects invalid JSON", () => {
    expect(parseNpcMemoryCompressionOutput("{broken")).toEqual({
      ok: false,
      reason: "invalid_json"
    });
  });

  it("rejects overlong summaries", () => {
    expect(parseNpcMemoryCompressionOutput(validOutput("记忆".repeat(111)))).toEqual({
      ok: false,
      reason: "summary_too_long"
    });
  });

  it("rejects reward promises", () => {
    expect(parseNpcMemoryCompressionOutput(validOutput("伯林答应给你 100 金币。"))).toEqual({
      ok: false,
      reason: "reward_promise"
    });
  });

  it("rejects OOC content", () => {
    expect(parseNpcMemoryCompressionOutput(validOutput("作为 AI 模型，我压缩了记忆。"))).toEqual({
      ok: false,
      reason: "ooc"
    });
  });

  it("rejects evidence-level changes", () => {
    expect(
      parseNpcMemoryCompressionOutput(
        JSON.stringify({
          summary: "伯林确认阿岚确实送过烤鸡。",
          safety: {
            changesEvidenceLevel: true,
            containsRewardPromise: false,
            containsRuleChange: false,
            containsOoc: false
          }
        })
      )
    ).toEqual({
      ok: false,
      reason: "evidence_level_change"
    });
  });
});
