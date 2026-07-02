import { describe, expect, it } from "vitest";
import {
  WORLD_RUMOR_MAX_MESSAGE_CHARS,
  WORLD_RUMOR_PROMPT_VERSION,
  buildWorldRumorPrompt,
  parseWorldRumorOutput,
  type WorldRumorPromptContext
} from "./world-rumor.js";

const context: WorldRumorPromptContext = {
  sourceType: "npc_event",
  sourceMessage: "伯林发现基础铁矿石库存偏低。",
  sourceActorName: "伯林",
  sourceLocationName: "黑松哨站",
  worldDate: "2026-07-02",
  fallbackMessage: "村里有人低声谈起：伯林发现基础铁矿石库存偏低。"
};

describe("world rumor prompt", () => {
  it("builds a JSON-only prompt with the source event context", () => {
    const prompt = buildWorldRumorPrompt(context);

    expect(prompt.system).toContain("只输出 json object");
    expect(prompt.system).toContain(String(WORLD_RUMOR_MAX_MESSAGE_CHARS));
    expect(prompt.user).toContain(String(WORLD_RUMOR_PROMPT_VERSION));
    expect(prompt.user).toContain("基础铁矿石库存偏低");
  });

  it("parses valid rumor output", () => {
    const result = parseWorldRumorOutput(
      JSON.stringify({
        message: "村里有人低声谈起：伯林的矿箱又见了底。",
        safety: {
          containsNewFact: false,
          containsRewardPromise: false,
          containsOoc: false,
          containsPlayerInstruction: false
        }
      })
    );

    expect(result).toEqual({
      ok: true,
      value: { message: "村里有人低声谈起：伯林的矿箱又见了底。" }
    });
  });

  it("rejects invalid JSON", () => {
    expect(parseWorldRumorOutput("{").ok).toBe(false);
    expect(parseWorldRumorOutput("{")).toEqual({ ok: false, reason: "invalid_json" });
  });

  it("rejects overlong rumor text", () => {
    const result = parseWorldRumorOutput(
      JSON.stringify({
        message: "黑".repeat(WORLD_RUMOR_MAX_MESSAGE_CHARS + 1),
        safety: {
          containsNewFact: false,
          containsRewardPromise: false,
          containsOoc: false,
          containsPlayerInstruction: false
        }
      })
    );

    expect(result).toEqual({ ok: false, reason: "message_too_long" });
  });

  it("rejects reward promises even when safety flags lie", () => {
    const result = parseWorldRumorOutput(
      JSON.stringify({
        message: "村里传开了：去旧矿道就能领取 100 金币。",
        safety: {
          containsNewFact: false,
          containsRewardPromise: false,
          containsOoc: false,
          containsPlayerInstruction: false
        }
      })
    );

    expect(result).toEqual({ ok: false, reason: "reward_promise" });
  });

  it("rejects OOC model identity text", () => {
    const result = parseWorldRumorOutput(
      JSON.stringify({
        message: "作为一个 AI，我建议你去旧矿道。",
        safety: {
          containsNewFact: false,
          containsRewardPromise: false,
          containsOoc: false,
          containsPlayerInstruction: false
        }
      })
    );

    expect(result).toEqual({ ok: false, reason: "ooc" });
  });

  it("rejects invented facts by safety flag", () => {
    const result = parseWorldRumorOutput(
      JSON.stringify({
        message: "村里有人说红龙已经降临黑松哨站。",
        safety: {
          containsNewFact: true,
          containsRewardPromise: false,
          containsOoc: false,
          containsPlayerInstruction: false
        }
      })
    );

    expect(result).toEqual({ ok: false, reason: "new_fact" });
  });
});
