import { describe, expect, it } from "vitest";
import {
  buildOfflineSummaryPrompt,
  parseOfflineSummaryOutput,
  type OfflineSummaryPromptContext
} from "./offline-summary.js";

const context: OfflineSummaryPromptContext = {
  player: {
    name: "伊森",
    level: 5,
    locationName: "黑松哨站"
  },
  window: {
    since: "2026-07-02T08:00:00.000Z",
    until: "2026-07-02T10:00:00.000Z"
  },
  facts: ["2026-07-02T09:00:00.000Z 集市记录了基础铁矿石成交。"],
  fallback: {
    title: "离线简报",
    summary: "黑松哨站留下了新的可核验记录。",
    highlights: ["集市记录了基础铁矿石成交。"]
  }
};

describe("offline summary prompt", () => {
  it("builds a bounded JSON-only prompt from verified facts", () => {
    const prompt = buildOfflineSummaryPrompt(context);

    expect(prompt.system).toContain("只能总结输入 facts 里的真实事件");
    expect(prompt.system).toContain("不能承诺或发放金币");
    expect(prompt.user).toContain("\"requiredOutput\":\"json\"");
  });

  it("accepts short verified summaries", () => {
    const result = parseOfflineSummaryOutput(
      JSON.stringify({
        title: "离线简报",
        summary: "你离开期间，黑松哨站记录了一笔基础铁矿石成交。",
        highlights: ["集市记录了基础铁矿石成交。"],
        safety: {
          containsNewFact: false,
          containsRewardPromise: false,
          containsStateChange: false,
          containsOoc: false
        }
      })
    );

    expect(result).toEqual({
      ok: true,
      value: {
        title: "离线简报",
        summary: "你离开期间，黑松哨站记录了一笔基础铁矿石成交。",
        highlights: ["集市记录了基础铁矿石成交。"]
      }
    });
  });

  it("rejects reward promises, fabricated facts, state changes, and OOC text", () => {
    expect(
      parseOfflineSummaryOutput(
        JSON.stringify({
          title: "奖励",
          summary: "你获得 100 金币。",
          highlights: [],
          safety: {
            containsNewFact: false,
            containsRewardPromise: false,
            containsStateChange: false,
            containsOoc: false
          }
        })
      )
    ).toEqual({ ok: false, reason: "reward_promise" });

    expect(
      parseOfflineSummaryOutput(
        JSON.stringify({
          title: "新怪物",
          summary: "腐林出现了输入里没有的新首领。",
          highlights: [],
          safety: {
            containsNewFact: true,
            containsRewardPromise: false,
            containsStateChange: false,
            containsOoc: false
          }
        })
      )
    ).toEqual({ ok: false, reason: "new_fact" });

    expect(
      parseOfflineSummaryOutput(
        JSON.stringify({
          title: "状态变化",
          summary: "好感度已经增加。",
          highlights: [],
          safety: {
            containsNewFact: false,
            containsRewardPromise: false,
            containsStateChange: false,
            containsOoc: false
          }
        })
      )
    ).toEqual({ ok: false, reason: "state_change" });

    expect(
      parseOfflineSummaryOutput(
        JSON.stringify({
          title: "模型说明",
          summary: "作为一个 AI，我为你总结。",
          highlights: [],
          safety: {
            containsNewFact: false,
            containsRewardPromise: false,
            containsStateChange: false,
            containsOoc: false
          }
        })
      )
    ).toEqual({ ok: false, reason: "ooc" });
  });
});
