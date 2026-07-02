import { describe, expect, it } from "vitest";
import {
  NPC_TASK_COPY_MAX_DESCRIPTION_CHARS,
  NPC_TASK_COPY_MAX_TITLE_CHARS,
  buildNpcTaskCopyPrompt,
  parseNpcTaskCopyOutput
} from "./npc-task-copy.js";

const context = {
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

describe("npc task copy prompt", () => {
  it("builds a bounded json-only task copy prompt", () => {
    const prompt = buildNpcTaskCopyPrompt(context);

    expect(prompt.system).toContain("只输出 json object");
    expect(prompt.system).toContain("不能改变任务需求");
    expect(prompt.user).toContain("炉火缺矿");
    expect(prompt.user).toContain("基础铁矿石");
  });

  it("parses valid task copy", () => {
    const parsed = parseNpcTaskCopyOutput(
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

    expect(parsed).toEqual({
      ok: true,
      value: {
        title: "炉火待矿",
        description: "伯林把空矿箱踢回炉边，催你带回基础铁矿石，免得修理活全压到夜里。"
      }
    });
  });

  it("rejects overlong title and description", () => {
    expect(
      parseNpcTaskCopyOutput(
        JSON.stringify({
          title: "矿".repeat(NPC_TASK_COPY_MAX_TITLE_CHARS + 1),
          description: "带矿回来。",
          safety: {
            changesReward: false,
            changesRequestedItem: false,
            containsRewardPromise: false,
            containsRuleChange: false,
            containsOoc: false
          }
        })
      )
    ).toEqual({ ok: false, reason: "title_too_long" });

    expect(
      parseNpcTaskCopyOutput(
        JSON.stringify({
          title: "炉火待矿",
          description: "矿".repeat(NPC_TASK_COPY_MAX_DESCRIPTION_CHARS + 1),
          safety: {
            changesReward: false,
            changesRequestedItem: false,
            containsRewardPromise: false,
            containsRuleChange: false,
            containsOoc: false
          }
        })
      )
    ).toEqual({ ok: false, reason: "description_too_long" });
  });

  it("rejects reward promises and rule changes", () => {
    expect(
      parseNpcTaskCopyOutput(
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
      )
    ).toEqual({ ok: false, reason: "reward_promise" });

    expect(
      parseNpcTaskCopyOutput(
        JSON.stringify({
          title: "炉火待矿",
          description: "这次改成提交木材也算完成。",
          safety: {
            changesReward: false,
            changesRequestedItem: true,
            containsRewardPromise: false,
            containsRuleChange: true,
            containsOoc: false
          }
        })
      )
    ).toEqual({ ok: false, reason: "requested_item_change" });
  });
});
