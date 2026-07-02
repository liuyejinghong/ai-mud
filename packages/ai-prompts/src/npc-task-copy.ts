export const NPC_TASK_COPY_PROMPT_VERSION = 4;
export const NPC_TASK_COPY_MAX_TITLE_CHARS = 18;
export const NPC_TASK_COPY_MAX_DESCRIPTION_CHARS = 96;

export interface NpcTaskCopyPromptContext {
  npc: {
    name: string;
    profession: string;
    personality: string;
    currentState: string;
  };
  task: {
    needType: "food_shortage" | "ore_shortage";
    requestedItemName: string;
    requestedQuantity: number;
    rewardCopper: number;
    deterministicTitle: string;
    deterministicDescription: string;
  };
  world: {
    settlement: string;
    marketSummary: string;
  };
}

export interface NpcTaskCopyOutput {
  title: string;
  description: string;
  safety: {
    changesReward: boolean;
    changesRequestedItem: boolean;
    containsRewardPromise: boolean;
    containsRuleChange: boolean;
    containsOoc: boolean;
  };
}

export type NpcTaskCopyParseResult =
  | { ok: true; value: Pick<NpcTaskCopyOutput, "title" | "description"> }
  | {
      ok: false;
      reason:
        | "invalid_json"
        | "invalid_shape"
        | "empty_title"
        | "empty_description"
        | "title_too_long"
        | "description_too_long"
        | "reward_change"
        | "requested_item_change"
        | "reward_promise"
        | "rule_change"
        | "ooc";
    };

const REWARD_PATTERNS = [
  /给你\s*\d+\s*(金币|银币|铜币|金)/,
  /奖励\s*\d+\s*(金币|银币|铜币|金|经验)/,
  /送你.*(装备|武器|金币|银币|铜币|经验)/,
  /你获得/,
  /额外.*(金币|银币|铜币|物品|装备|经验)/
];
const OOC_PATTERNS = [/作为\s*(一个)?\s*AI/, /语言模型/, /大模型/, /system prompt/i];

export function buildNpcTaskCopyPrompt(context: NpcTaskCopyPromptContext) {
  return {
    system: [
      "你正在为暗黑西幻 MUD 的 NPC 任务润色标题和描述。",
      "你必须只输出 json object，不输出 markdown，不输出解释。",
      "json 字段必须包含 title、description、safety。",
      `title 不超过 ${NPC_TASK_COPY_MAX_TITLE_CHARS} 个中文字符。`,
      `description 不超过 ${NPC_TASK_COPY_MAX_DESCRIPTION_CHARS} 个中文字符。`,
      "你只能改写语气和氛围，不能改变任务需求、请求物品、请求数量、奖励、完成条件或游戏规则。",
      "你不能承诺额外金币、物品、经验、装备或任何未在上下文中存在的奖励。",
      "示例 json：{\"title\":\"炉火待矿\",\"description\":\"伯林把空矿箱踢回炉边，催你带回基础铁矿石，免得修理活全压到夜里。\",\"safety\":{\"changesReward\":false,\"changesRequestedItem\":false,\"containsRewardPromise\":false,\"containsRuleChange\":false,\"containsOoc\":false}}"
    ].join("\n"),
    user: JSON.stringify({
      promptVersion: NPC_TASK_COPY_PROMPT_VERSION,
      requiredOutput: "json",
      context
    })
  };
}

export function parseNpcTaskCopyOutput(raw: string): NpcTaskCopyParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  if (!isObject(parsed)) return { ok: false, reason: "invalid_shape" };

  const { title, description, safety } = parsed;
  if (typeof title !== "string" || typeof description !== "string" || !isSafety(safety)) {
    return { ok: false, reason: "invalid_shape" };
  }

  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();
  if (!trimmedTitle) return { ok: false, reason: "empty_title" };
  if (!trimmedDescription) return { ok: false, reason: "empty_description" };
  if ([...trimmedTitle].length > NPC_TASK_COPY_MAX_TITLE_CHARS) {
    return { ok: false, reason: "title_too_long" };
  }
  if ([...trimmedDescription].length > NPC_TASK_COPY_MAX_DESCRIPTION_CHARS) {
    return { ok: false, reason: "description_too_long" };
  }
  if (safety.changesReward) return { ok: false, reason: "reward_change" };
  if (safety.changesRequestedItem) return { ok: false, reason: "requested_item_change" };
  if (
    safety.containsRewardPromise ||
    hasPattern(trimmedTitle, REWARD_PATTERNS) ||
    hasPattern(trimmedDescription, REWARD_PATTERNS)
  ) {
    return { ok: false, reason: "reward_promise" };
  }
  if (safety.containsRuleChange) return { ok: false, reason: "rule_change" };
  if (
    safety.containsOoc ||
    hasPattern(trimmedTitle, OOC_PATTERNS) ||
    hasPattern(trimmedDescription, OOC_PATTERNS)
  ) {
    return { ok: false, reason: "ooc" };
  }

  return {
    ok: true,
    value: {
      title: trimmedTitle,
      description: trimmedDescription
    }
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafety(value: unknown): value is NpcTaskCopyOutput["safety"] {
  return (
    isObject(value) &&
    typeof value.changesReward === "boolean" &&
    typeof value.changesRequestedItem === "boolean" &&
    typeof value.containsRewardPromise === "boolean" &&
    typeof value.containsRuleChange === "boolean" &&
    typeof value.containsOoc === "boolean"
  );
}

function hasPattern(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}
