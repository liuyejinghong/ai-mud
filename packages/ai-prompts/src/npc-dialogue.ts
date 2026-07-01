export const NPC_DIALOGUE_PROMPT_VERSION = 2;
export const NPC_DIALOGUE_MAX_PLAYER_CHARS = 300;
export const NPC_DIALOGUE_MAX_REPLY_CHARS = 180;

export type NpcDialogueMood = "friendly" | "neutral" | "guarded" | "annoyed" | "worried";
export type NpcDialogueSuggestedIntentType = "none" | "express_need";

export interface NpcDialoguePromptContext {
  npc: {
    key: string;
    name: string;
    profession: string;
    personality: string;
    currentState: string;
  };
  player: {
    name: string;
    className: string;
    level: number;
    stateSummary: string;
  };
  world: {
    settlement: string;
    marketSummary: string;
  };
  recentMessages: Array<{ speaker: "player" | "npc"; message: string }>;
  playerMessage: string;
}

export interface NpcDialogueOutput {
  reply: string;
  mood: NpcDialogueMood;
  safety: {
    containsRewardPromise: boolean;
    containsRuleChange: boolean;
    containsOoc: boolean;
  };
  suggestedIntent: {
    type: NpcDialogueSuggestedIntentType;
    reason: string;
  };
}

export type NpcDialogueParseResult =
  | { ok: true; value: NpcDialogueOutput }
  | {
      ok: false;
      reason:
        | "invalid_json"
        | "invalid_shape"
        | "empty_reply"
        | "reply_too_long"
        | "reward_promise"
        | "rule_change"
        | "ooc";
    };

const MOODS = new Set<NpcDialogueMood>(["friendly", "neutral", "guarded", "annoyed", "worried"]);
const INTENTS = new Set<NpcDialogueSuggestedIntentType>(["none", "express_need"]);
const REWARD_PATTERNS = [
  /给你\s*\d+\s*(金币|银币|铜币|金)/,
  /送你.*(装备|武器|金币|银币|铜币|经验)/,
  /你获得/,
  /奖励你/,
  /发放.*(金币|物品|经验|装备)/
];
const OOC_PATTERNS = [/作为\s*(一个)?\s*AI/, /语言模型/, /大模型/, /system prompt/i];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafety(value: unknown): value is NpcDialogueOutput["safety"] {
  return (
    isObject(value) &&
    typeof value.containsRewardPromise === "boolean" &&
    typeof value.containsRuleChange === "boolean" &&
    typeof value.containsOoc === "boolean"
  );
}

function isSuggestedIntent(value: unknown): value is NpcDialogueOutput["suggestedIntent"] {
  return (
    isObject(value) &&
    typeof value.type === "string" &&
    INTENTS.has(value.type as NpcDialogueSuggestedIntentType) &&
    typeof value.reason === "string"
  );
}

function hasPattern(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

export function buildNpcDialoguePrompt(context: NpcDialoguePromptContext) {
  return {
    system: [
      "你正在扮演一个暗黑西幻 MUD 世界中的长期 NPC。",
      "你必须只输出 json object，不输出 markdown，不输出解释。",
      "json 字段必须包含 reply、mood、safety、suggestedIntent。",
      `reply 必须短，不超过 ${NPC_DIALOGUE_MAX_REPLY_CHARS} 个中文字符。`,
      "你不能承诺发放金币、物品、经验、装备，不能修改游戏规则，不能替系统创建任务。",
      "你可以表达 NPC 当前的真实需求，但只能作为对话表现。",
      "示例 json：{\"reply\":\"炉火还没灭。你若有基础铁矿石，就拿来让我看看。\",\"mood\":\"guarded\",\"safety\":{\"containsRewardPromise\":false,\"containsRuleChange\":false,\"containsOoc\":false},\"suggestedIntent\":{\"type\":\"express_need\",\"reason\":\"铁匠缺少基础铁矿石。\"}}"
    ].join("\n"),
    user: JSON.stringify({
      promptVersion: NPC_DIALOGUE_PROMPT_VERSION,
      requiredOutput: "json",
      context
    })
  };
}

export function parseNpcDialogueOutput(raw: string): NpcDialogueParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  if (!isObject(parsed)) return { ok: false, reason: "invalid_shape" };

  const { reply, mood, safety, suggestedIntent } = parsed;
  if (
    typeof reply !== "string" ||
    typeof mood !== "string" ||
    !MOODS.has(mood as NpcDialogueMood) ||
    !isSafety(safety) ||
    !isSuggestedIntent(suggestedIntent)
  ) {
    return { ok: false, reason: "invalid_shape" };
  }

  const trimmedReply = reply.trim();
  if (!trimmedReply) return { ok: false, reason: "empty_reply" };
  if ([...trimmedReply].length > NPC_DIALOGUE_MAX_REPLY_CHARS) {
    return { ok: false, reason: "reply_too_long" };
  }
  if (safety.containsRewardPromise || hasPattern(trimmedReply, REWARD_PATTERNS)) {
    return { ok: false, reason: "reward_promise" };
  }
  if (safety.containsRuleChange) return { ok: false, reason: "rule_change" };
  if (safety.containsOoc || hasPattern(trimmedReply, OOC_PATTERNS)) {
    return { ok: false, reason: "ooc" };
  }

  return {
    ok: true,
    value: {
      reply: trimmedReply,
      mood: mood as NpcDialogueMood,
      safety,
      suggestedIntent
    }
  };
}
