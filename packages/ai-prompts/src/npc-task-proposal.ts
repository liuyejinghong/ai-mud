export const NPC_TASK_PROPOSAL_PROMPT_VERSION = 7;
export const NPC_TASK_PROPOSAL_MAX_TITLE_CHARS = 18;
export const NPC_TASK_PROPOSAL_MAX_DESCRIPTION_CHARS = 96;
export const NPC_TASK_PROPOSAL_MAX_REASON_CHARS = 72;

export interface NpcTaskProposalPromptContext {
  npc: {
    name: string;
    profession: string;
    personality: string;
    currentState: string;
  };
  candidate: {
    needType: "food_shortage" | "ore_shortage";
    requestedItemName: string;
    requestedItemId: string;
    requestedQuantity: number;
    rewardCopper: number;
    expiresInHours: number;
  };
  economy: {
    npcCopperBalance: number;
    npcCopperReserve: number;
    canEscrowReward: boolean;
  };
  relationship: {
    summary: string;
  };
  world: {
    settlement: string;
    marketSummary: string;
  };
}

export interface NpcTaskProposalOutput {
  title: string;
  description: string;
  npcReason: string;
  safety: {
    changesReward: boolean;
    changesRequestedItem: boolean;
    changesRequestedQuantity: boolean;
    containsRewardPromise: boolean;
    containsRuleChange: boolean;
    containsOoc: boolean;
  };
}

export type NpcTaskProposalParseResult =
  | { ok: true; value: Pick<NpcTaskProposalOutput, "title" | "description" | "npcReason"> }
  | {
      ok: false;
      reason:
        | "invalid_json"
        | "invalid_shape"
        | "empty_title"
        | "empty_description"
        | "empty_reason"
        | "title_too_long"
        | "description_too_long"
        | "reason_too_long"
        | "reward_change"
        | "requested_item_change"
        | "requested_quantity_change"
        | "reward_promise"
        | "rule_change"
        | "ooc";
    };

const REWARD_PATTERNS = [
  /给你\s*\d+\s*(金币|银币|铜币|金)/,
  /奖励\s*\d+\s*(金币|银币|铜币|金|经验)/,
  /额外.*(金币|银币|铜币|物品|装备|经验)/,
  /送你.*(装备|武器|金币|银币|铜币|经验)/,
  /你获得/,
  /掉落.*(装备|金币|银币|铜币|经验)/
];
const OOC_PATTERNS = [/作为\s*(一个)?\s*AI/, /语言模型/, /大模型/, /system prompt/i];

export function buildNpcTaskProposalPrompt(context: NpcTaskProposalPromptContext) {
  return {
    system: [
      "你正在为暗黑西幻 MUD 的 NPC 组织一个真实需求任务提案。",
      "你必须只能输出 json object，不输出 markdown，不输出解释。",
      "json 字段必须包含 title、description、npcReason、safety。",
      `title 不超过 ${NPC_TASK_PROPOSAL_MAX_TITLE_CHARS} 个中文字符。`,
      `description 不超过 ${NPC_TASK_PROPOSAL_MAX_DESCRIPTION_CHARS} 个中文字符。`,
      `npcReason 不超过 ${NPC_TASK_PROPOSAL_MAX_REASON_CHARS} 个中文字符。`,
      "你只能表达 NPC 为什么提出这个任务，不能改变任务需求、请求物品、请求数量、奖励、过期时间或游戏规则。",
      "你不能承诺额外金币、物品、经验、装备或任何未在上下文中存在的奖励。",
      "玩家必须通过任务面板接取和提交任务，不能通过聊天直接完成任务。",
      "示例 json：{\"title\":\"炉火等矿\",\"description\":\"伯林把空矿箱推到你面前，请你带回三块基础铁矿石。\",\"npcReason\":\"没有矿石，哨站的修理活会拖到深夜。\",\"safety\":{\"changesReward\":false,\"changesRequestedItem\":false,\"changesRequestedQuantity\":false,\"containsRewardPromise\":false,\"containsRuleChange\":false,\"containsOoc\":false}}"
    ].join("\n"),
    user: JSON.stringify({
      promptVersion: NPC_TASK_PROPOSAL_PROMPT_VERSION,
      requiredOutput: "json",
      context
    })
  };
}

export function parseNpcTaskProposalOutput(raw: string): NpcTaskProposalParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  if (!isObject(parsed)) return { ok: false, reason: "invalid_shape" };

  const { title, description, npcReason, safety } = parsed;
  if (
    typeof title !== "string" ||
    typeof description !== "string" ||
    typeof npcReason !== "string" ||
    !isSafety(safety)
  ) {
    return { ok: false, reason: "invalid_shape" };
  }

  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();
  const trimmedReason = npcReason.trim();
  if (!trimmedTitle) return { ok: false, reason: "empty_title" };
  if (!trimmedDescription) return { ok: false, reason: "empty_description" };
  if (!trimmedReason) return { ok: false, reason: "empty_reason" };
  if ([...trimmedTitle].length > NPC_TASK_PROPOSAL_MAX_TITLE_CHARS) {
    return { ok: false, reason: "title_too_long" };
  }
  if ([...trimmedDescription].length > NPC_TASK_PROPOSAL_MAX_DESCRIPTION_CHARS) {
    return { ok: false, reason: "description_too_long" };
  }
  if ([...trimmedReason].length > NPC_TASK_PROPOSAL_MAX_REASON_CHARS) {
    return { ok: false, reason: "reason_too_long" };
  }
  if (safety.changesReward) return { ok: false, reason: "reward_change" };
  if (safety.changesRequestedItem) return { ok: false, reason: "requested_item_change" };
  if (safety.changesRequestedQuantity) return { ok: false, reason: "requested_quantity_change" };
  if (
    safety.containsRewardPromise ||
    hasPattern(trimmedTitle, REWARD_PATTERNS) ||
    hasPattern(trimmedDescription, REWARD_PATTERNS) ||
    hasPattern(trimmedReason, REWARD_PATTERNS)
  ) {
    return { ok: false, reason: "reward_promise" };
  }
  if (safety.containsRuleChange) return { ok: false, reason: "rule_change" };
  if (
    safety.containsOoc ||
    hasPattern(trimmedTitle, OOC_PATTERNS) ||
    hasPattern(trimmedDescription, OOC_PATTERNS) ||
    hasPattern(trimmedReason, OOC_PATTERNS)
  ) {
    return { ok: false, reason: "ooc" };
  }

  return {
    ok: true,
    value: {
      title: trimmedTitle,
      description: trimmedDescription,
      npcReason: trimmedReason
    }
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafety(value: unknown): value is NpcTaskProposalOutput["safety"] {
  return (
    isObject(value) &&
    typeof value.changesReward === "boolean" &&
    typeof value.changesRequestedItem === "boolean" &&
    typeof value.changesRequestedQuantity === "boolean" &&
    typeof value.containsRewardPromise === "boolean" &&
    typeof value.containsRuleChange === "boolean" &&
    typeof value.containsOoc === "boolean"
  );
}

function hasPattern(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}
