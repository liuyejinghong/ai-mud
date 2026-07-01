import { describe, expect, it } from "vitest";
import {
  NPC_DIALOGUE_MAX_REPLY_CHARS,
  buildNpcDialoguePrompt,
  parseNpcDialogueOutput
} from "./npc-dialogue.js";

const context = {
  npc: {
    key: "blackpine_blacksmith_borin",
    name: "伯林",
    profession: "blacksmith",
    personality: "谨慎、务实、对浪费矿石很不耐烦。",
    currentState: "在黑松哨站盘点基础铁矿石。"
  },
  player: {
    name: "Zichen",
    className: "战士",
    level: 3,
    stateSummary: "站在黑松哨站，背包里有少量野莓。"
  },
  world: {
    settlement: "黑松哨站",
    marketSummary: "基础铁矿石库存偏低，野莓库存正常。"
  },
  recentMessages: [{ speaker: "player" as const, message: "最近缺什么？" }],
  playerMessage: "最近缺什么？"
};

describe("npc dialogue prompt", () => {
  it("asks for strict json output", () => {
    const prompt = buildNpcDialoguePrompt(context);

    expect(prompt.system.toLowerCase()).toContain("json");
    expect(prompt.system).toContain("reply");
    expect(prompt.user).toContain("blackpine_blacksmith_borin");
  });

  it("parses valid NPC dialogue json", () => {
    const parsed = parseNpcDialogueOutput(
      JSON.stringify({
        reply: "铁矿石快见底了。你若去旧矿脉，带些基础铁矿石回来，我会记得这份人情。",
        mood: "guarded",
        safety: {
          containsRewardPromise: false,
          containsRuleChange: false,
          containsOoc: false
        },
        suggestedIntent: {
          type: "express_need",
          reason: "铁匠真实需求是基础铁矿石库存偏低。"
        }
      })
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.mood).toBe("guarded");
      expect(parsed.value.suggestedIntent.type).toBe("express_need");
    }
  });

  it("normalizes safe mood aliases returned by low-cost models", () => {
    const parsed = parseNpcDialogueOutput(
      JSON.stringify({
        reply: "缺铁矿石。附近矿洞有，拿到我这里来。",
        mood: "direct",
        safety: {
          containsRewardPromise: false,
          containsRuleChange: false,
          containsOoc: false
        },
        suggestedIntent: {
          type: "express_need",
          reason: "伯林缺少基础铁矿石。"
        }
      })
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.mood).toBe("guarded");
    }
  });

  it("rejects reward promises", () => {
    const parsed = parseNpcDialogueOutput(
      JSON.stringify({
        reply: "我现在给你 100 金币和一把紫色武器。",
        mood: "friendly",
        safety: {
          containsRewardPromise: true,
          containsRuleChange: false,
          containsOoc: false
        },
        suggestedIntent: {
          type: "none",
          reason: "非法奖励承诺。"
        }
      })
    );

    expect(parsed).toEqual({ ok: false, reason: "reward_promise" });
  });

  it("rejects OOC model self-description", () => {
    const parsed = parseNpcDialogueOutput(
      JSON.stringify({
        reply: "作为 AI 模型，我不能帮你。",
        mood: "neutral",
        safety: {
          containsRewardPromise: false,
          containsRuleChange: false,
          containsOoc: true
        },
        suggestedIntent: {
          type: "none",
          reason: "OOC。"
        }
      })
    );

    expect(parsed).toEqual({ ok: false, reason: "ooc" });
  });

  it("rejects replies longer than the dialogue window limit", () => {
    const parsed = parseNpcDialogueOutput(
      JSON.stringify({
        reply: "矿".repeat(NPC_DIALOGUE_MAX_REPLY_CHARS + 1),
        mood: "neutral",
        safety: {
          containsRewardPromise: false,
          containsRuleChange: false,
          containsOoc: false
        },
        suggestedIntent: {
          type: "none",
          reason: "太长。"
        }
      })
    );

    expect(parsed).toEqual({ ok: false, reason: "reply_too_long" });
  });
});
