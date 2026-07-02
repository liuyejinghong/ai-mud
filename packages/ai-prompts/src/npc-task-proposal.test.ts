import { describe, expect, it } from "vitest";
import {
  NPC_TASK_PROPOSAL_MAX_DESCRIPTION_CHARS,
  NPC_TASK_PROPOSAL_MAX_REASON_CHARS,
  NPC_TASK_PROPOSAL_MAX_TITLE_CHARS,
  NPC_TASK_PROPOSAL_PROMPT_VERSION,
  buildNpcTaskProposalPrompt,
  parseNpcTaskProposalOutput
} from "./npc-task-proposal.js";

const context = {
  npc: {
    name: "伯林",
    profession: "blacksmith",
    personality: "务实，重视等价交换",
    currentState: "炉火还热，但矿箱见底。"
  },
  candidate: {
    needType: "ore_shortage" as const,
    requestedItemName: "基础铁矿石",
    requestedItemId: "iron_ore" as const,
    requestedQuantity: 3,
    rewardCopper: 36,
    expiresInHours: 24
  },
  economy: {
    npcCopperBalance: 120,
    npcCopperReserve: 5,
    canEscrowReward: true
  },
  relationship: {
    summary: "阿岚完成过一次炉火缺矿任务。"
  },
  world: {
    settlement: "黑松哨站",
    marketSummary: "基础铁矿石库存偏低。"
  }
};

describe("npc task proposal prompt", () => {
  it("builds a bounded JSON prompt from a rule-approved candidate", () => {
    const prompt = buildNpcTaskProposalPrompt(context);

    expect(prompt.system).toContain("只能输出 json object");
    expect(prompt.system).toContain("不能改变任务需求、请求物品、请求数量、奖励");
    expect(prompt.user).toContain(`"promptVersion":${NPC_TASK_PROPOSAL_PROMPT_VERSION}`);
    expect(prompt.user).toContain("基础铁矿石");
  });

  it("accepts safe title description and reason", () => {
    const parsed = parseNpcTaskProposalOutput(
      JSON.stringify({
        title: "炉火等矿",
        description: "伯林把空矿箱推到你面前，请你带回三块基础铁矿石。",
        npcReason: "没有矿石，哨站的修理活会拖到深夜。",
        safety: {
          changesReward: false,
          changesRequestedItem: false,
          changesRequestedQuantity: false,
          containsRewardPromise: false,
          containsRuleChange: false,
          containsOoc: false
        }
      })
    );

    expect(parsed).toEqual({
      ok: true,
      value: {
        title: "炉火等矿",
        description: "伯林把空矿箱推到你面前，请你带回三块基础铁矿石。",
        npcReason: "没有矿石，哨站的修理活会拖到深夜。"
      }
    });
  });

  it("rejects overlong fields", () => {
    const base = {
      title: "炉火等矿",
      description: "伯林需要基础铁矿石。",
      npcReason: "矿箱空了。",
      safety: {
        changesReward: false,
        changesRequestedItem: false,
        changesRequestedQuantity: false,
        containsRewardPromise: false,
        containsRuleChange: false,
        containsOoc: false
      }
    };

    expect(
      parseNpcTaskProposalOutput(
        JSON.stringify({ ...base, title: "矿".repeat(NPC_TASK_PROPOSAL_MAX_TITLE_CHARS + 1) })
      )
    ).toEqual({ ok: false, reason: "title_too_long" });
    expect(
      parseNpcTaskProposalOutput(
        JSON.stringify({
          ...base,
          description: "矿".repeat(NPC_TASK_PROPOSAL_MAX_DESCRIPTION_CHARS + 1)
        })
      )
    ).toEqual({ ok: false, reason: "description_too_long" });
    expect(
      parseNpcTaskProposalOutput(
        JSON.stringify({
          ...base,
          npcReason: "矿".repeat(NPC_TASK_PROPOSAL_MAX_REASON_CHARS + 1)
        })
      )
    ).toEqual({ ok: false, reason: "reason_too_long" });
  });

  it("rejects reward mutation and extra reward promises", () => {
    expect(
      parseNpcTaskProposalOutput(
        JSON.stringify({
          title: "炉火等矿",
          description: "带矿回来，我额外奖励你 100 金币。",
          npcReason: "矿箱空了。",
          safety: {
            changesReward: false,
            changesRequestedItem: false,
            changesRequestedQuantity: false,
            containsRewardPromise: true,
            containsRuleChange: false,
            containsOoc: false
          }
        })
      )
    ).toEqual({ ok: false, reason: "reward_promise" });
  });

  it("rejects item and quantity mutation flags", () => {
    expect(
      parseNpcTaskProposalOutput(
        JSON.stringify({
          title: "多带点矿",
          description: "改成带十块秘银矿。",
          npcReason: "我想多攒一点。",
          safety: {
            changesReward: false,
            changesRequestedItem: true,
            changesRequestedQuantity: true,
            containsRewardPromise: false,
            containsRuleChange: false,
            containsOoc: false
          }
        })
      )
    ).toEqual({ ok: false, reason: "requested_item_change" });
  });

  it("rejects OOC text", () => {
    expect(
      parseNpcTaskProposalOutput(
        JSON.stringify({
          title: "炉火等矿",
          description: "作为 AI，我生成这个任务。",
          npcReason: "矿箱空了。",
          safety: {
            changesReward: false,
            changesRequestedItem: false,
            changesRequestedQuantity: false,
            containsRewardPromise: false,
            containsRuleChange: false,
            containsOoc: false
          }
        })
      )
    ).toEqual({ ok: false, reason: "ooc" });
  });
});
