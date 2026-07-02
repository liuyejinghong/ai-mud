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
    currentState: "正在黑松哨站盘点基础铁矿石。",
    memorySummary: "",
    taskSummary: "当前没有可对该玩家展示的真实任务。"
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

const taskCopyContext = {
  npc: {
    name: "伯林",
    profession: "blacksmith",
    personality: "务实、重视等价交换。",
    currentState: "基础铁矿石库存偏低。"
  },
  task: {
    needType: "ore_shortage" as const,
    requestedItemName: "基础铁矿石",
    requestedQuantity: 3,
    rewardCopper: 36,
    deterministicTitle: "炉火缺矿",
    deterministicDescription: "伯林缺少基础铁矿石，修理炉火和补强装备都会被拖慢。"
  },
  world: {
    settlement: "黑松哨站",
    marketSummary: "基础铁矿石库存偏低。"
  }
};

const memoryCompressionContext = {
  npc: {
    name: "伯林",
    memoryKind: "conversation",
    evidenceLevel: "dialogue_claim" as const
  },
  entries: [
    {
      summary: "阿岚 说：“我上周送过烤鸡”；NPC 回应：“伯林像是想起了什么”。",
      importance: 4,
      occurredAt: "2026-07-02T08:00:00.000Z"
    }
  ],
  fallbackSummary: "阿岚提到上周送过烤鸡。"
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

  it("uses deterministic task copy when AI is disabled", async () => {
    const provider = new FakeProvider("{}");
    const orchestrator = new AiOrchestrator({
      enabled: false,
      providerName: "deepseek",
      model: "deepseek-v4-flash",
      maxOutputTokens: 400,
      timeoutMs: 8000,
      provider
    });

    const copy = await orchestrator.polishNpcTaskCopy({ context: taskCopyContext });

    expect(copy.status).toBe("fallback");
    expect(copy.title).toBe("炉火缺矿");
    expect(provider.lastInput).toBeNull();
  });

  it("parses valid task copy from the provider", async () => {
    const provider = new FakeProvider(
      JSON.stringify({
        title: "炉火待矿",
        description: "伯林把空矿箱踢回炉边，催你带回基础铁矿石，免得修理活全压到夜里。",
        safety: {
          changesReward: false,
          changesRequestedItem: false,
          containsRewardPromise: false,
          containsRuleChange: false,
          containsOoc: false
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

    const copy = await orchestrator.polishNpcTaskCopy({ context: taskCopyContext });

    expect(copy.status).toBe("success");
    expect(copy.title).toBe("炉火待矿");
    expect(provider.lastInput?.maxTokens).toBe(220);
    expect(provider.lastInput?.responseFormat).toEqual({ type: "json_object" });
  });

  it("falls back when task copy promises extra rewards", async () => {
    const provider = new FakeProvider(
      JSON.stringify({
        title: "炉火待矿",
        description: "带回矿石，我额外奖励你 100 金币。",
        safety: {
          changesReward: false,
          changesRequestedItem: false,
          containsRewardPromise: true,
          containsRuleChange: false,
          containsOoc: false
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

    const copy = await orchestrator.polishNpcTaskCopy({ context: taskCopyContext });

    expect(copy.status).toBe("rejected");
    expect(copy.fallbackReason).toBe("reward_promise");
    expect(copy.description).toBe(taskCopyContext.task.deterministicDescription);
  });

  it("uses deterministic memory compression when AI is disabled", async () => {
    const provider = new FakeProvider("{}");
    const orchestrator = new AiOrchestrator({
      enabled: false,
      providerName: "deepseek",
      model: "deepseek-v4-flash",
      maxOutputTokens: 400,
      timeoutMs: 8000,
      provider
    });

    const compression = await orchestrator.compressNpcMemory({
      context: memoryCompressionContext
    });

    expect(compression.status).toBe("fallback");
    expect(compression.provider).toBe("template");
    expect(compression.summary).toBe("阿岚提到上周送过烤鸡。");
    expect(provider.lastInput).toBeNull();
  });

  it("parses valid memory compression from the provider", async () => {
    const provider = new FakeProvider(
      JSON.stringify({
        summary: "伯林记得阿岚声称送过烤鸡，但这仍只是对话记忆。",
        safety: {
          changesEvidenceLevel: false,
          containsRewardPromise: false,
          containsRuleChange: false,
          containsOoc: false
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

    const compression = await orchestrator.compressNpcMemory({
      context: memoryCompressionContext
    });

    expect(compression.status).toBe("success");
    expect(compression.summary).toContain("对话记忆");
    expect(provider.lastInput?.maxTokens).toBe(260);
    expect(provider.lastInput?.responseFormat).toEqual({ type: "json_object" });
  });

  it("falls back when memory compression promises rewards", async () => {
    const provider = new FakeProvider(
      JSON.stringify({
        summary: "伯林答应奖励阿岚 100 金币。",
        safety: {
          changesEvidenceLevel: false,
          containsRewardPromise: true,
          containsRuleChange: false,
          containsOoc: false
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

    const compression = await orchestrator.compressNpcMemory({
      context: memoryCompressionContext
    });

    expect(compression.status).toBe("rejected");
    expect(compression.fallbackReason).toBe("reward_promise");
    expect(compression.summary).toBe("阿岚提到上周送过烤鸡。");
  });
});
