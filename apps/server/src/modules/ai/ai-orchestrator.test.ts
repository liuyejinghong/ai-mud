import { describe, expect, it } from "vitest";
import type { NpcDialoguePromptContext } from "@ai-mud/ai-prompts";
import type { AiJsonCompletionInput, AiProvider } from "./ai-provider.js";
import { AiOrchestrator } from "./ai-orchestrator.js";

const context: NpcDialoguePromptContext = {
  npc: {
    key: "blackpine_blacksmith_borin",
    name: "伯林",
    profession: "blacksmith",
    personality: "谨慎、务实、讨厌浪费矿石。",
    currentState: "正在黑松哨站盘点基础铁矿石。"
  },
  player: {
    name: "Zichen",
    className: "战士",
    level: 3,
    stateSummary: "站在黑松哨站。"
  },
  world: {
    settlement: "黑松哨站",
    marketSummary: "基础铁矿石库存偏低。"
  },
  recentMessages: [],
  playerMessage: "最近缺什么？"
};

class FakeProvider implements AiProvider {
  public lastInput: AiJsonCompletionInput | null = null;

  constructor(private readonly rawContent: string) {}

  async completeJson(input: AiJsonCompletionInput) {
    this.lastInput = input;
    return {
      rawContent: this.rawContent,
      inputTokens: 100,
      outputTokens: 30,
      latencyMs: 25
    };
  }
}

describe("AiOrchestrator", () => {
  it("uses the template provider when NPC dialogue AI is disabled", async () => {
    const provider = new FakeProvider("{}");
    const orchestrator = new AiOrchestrator({
      enabled: false,
      providerName: "deepseek",
      model: "deepseek-v4-flash",
      maxOutputTokens: 400,
      timeoutMs: 8000,
      provider
    });

    const reply = await orchestrator.replyToNpcDialogue({
      npcContext: context,
      accountId: "account-1",
      characterId: "character-1",
      npcActorId: "npc-1"
    });

    expect(reply.status).toBe("fallback");
    expect(reply.provider).toBe("template");
    expect(reply.reply).toContain("铁矿石");
    expect(provider.lastInput).toBeNull();
  });

  it("parses valid provider JSON replies", async () => {
    const provider = new FakeProvider(
      JSON.stringify({
        reply: "基础铁矿石不够。你若去旧矿脉，记得别空手回来。",
        mood: "guarded",
        safety: {
          containsRewardPromise: false,
          containsRuleChange: false,
          containsOoc: false
        },
        suggestedIntent: {
          type: "express_need",
          reason: "铁匠缺矿。"
        }
      })
    );
    const orchestrator = new AiOrchestrator({
      enabled: true,
      providerName: "deepseek",
      model: "deepseek-v4-flash",
      maxOutputTokens: 400,
      timeoutMs: 8000,
      provider
    });

    const reply = await orchestrator.replyToNpcDialogue({
      npcContext: context,
      accountId: "account-1",
      characterId: "character-1",
      npcActorId: "npc-1"
    });

    expect(reply.status).toBe("success");
    expect(reply.reply).toContain("基础铁矿石");
    expect(provider.lastInput?.responseFormat).toEqual({ type: "json_object" });
    expect(provider.lastInput?.maxTokens).toBe(400);
    expect(provider.lastInput?.model).toBe("deepseek-v4-flash");
  });

  it("falls back when AI output promises rewards", async () => {
    const provider = new FakeProvider(
      JSON.stringify({
        reply: "我给你 100 金币。",
        mood: "friendly",
        safety: {
          containsRewardPromise: true,
          containsRuleChange: false,
          containsOoc: false
        },
        suggestedIntent: {
          type: "none",
          reason: "非法奖励。"
        }
      })
    );
    const orchestrator = new AiOrchestrator({
      enabled: true,
      providerName: "deepseek",
      model: "deepseek-v4-flash",
      maxOutputTokens: 400,
      timeoutMs: 8000,
      provider
    });

    const reply = await orchestrator.replyToNpcDialogue({
      npcContext: context,
      accountId: "account-1",
      characterId: "character-1",
      npcActorId: "npc-1"
    });

    expect(reply.status).toBe("rejected");
    expect(reply.fallbackReason).toBe("reward_promise");
    expect(reply.reply).not.toContain("100 金币");
  });

  it("falls back when the provider throws", async () => {
    const provider: AiProvider = {
      async completeJson() {
        throw new Error("provider timeout");
      }
    };
    const orchestrator = new AiOrchestrator({
      enabled: true,
      providerName: "deepseek",
      model: "deepseek-v4-flash",
      maxOutputTokens: 400,
      timeoutMs: 8000,
      provider
    });

    const reply = await orchestrator.replyToNpcDialogue({
      npcContext: context,
      accountId: "account-1",
      characterId: "character-1",
      npcActorId: "npc-1"
    });

    expect(reply.status).toBe("error");
    expect(reply.fallbackReason).toBe("provider_error");
    expect(reply.reply.length).toBeGreaterThan(0);
  });
});
