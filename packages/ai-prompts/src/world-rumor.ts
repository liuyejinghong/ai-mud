export const WORLD_RUMOR_PROMPT_VERSION = 6;
export const WORLD_RUMOR_MAX_MESSAGE_CHARS = 80;

export interface WorldRumorPromptContext {
  sourceType: "game_event" | "npc_event" | "market_event" | "world_event" | "system";
  sourceMessage: string;
  sourceActorName: string | null;
  sourceLocationName: string | null;
  worldDate: string;
  fallbackMessage: string;
}

export interface WorldRumorOutput {
  message: string;
  safety: {
    containsNewFact: boolean;
    containsRewardPromise: boolean;
    containsOoc: boolean;
    containsPlayerInstruction: boolean;
  };
}

export type WorldRumorParseResult =
  | { ok: true; value: Pick<WorldRumorOutput, "message"> }
  | {
      ok: false;
      reason:
        | "invalid_json"
        | "invalid_shape"
        | "empty_message"
        | "message_too_long"
        | "new_fact"
        | "reward_promise"
        | "player_instruction"
        | "ooc";
    };

const REWARD_PATTERNS = [
  /给你\s*\d+\s*(金币|银币|铜币|金)/,
  /奖励\s*\d+\s*(金币|银币|铜币|金|经验)/,
  /送你.*(装备|武器|金币|银币|铜币|经验)/,
  /你获得/,
  /发放.*(金币|银币|铜币|物品|装备|经验)/,
  /掉落.*(金币|银币|铜币|装备|武器)/,
  /领取\s*\d+\s*(金币|银币|铜币|金|经验)/
];
const OOC_PATTERNS = [/作为\s*(一个)?\s*AI/, /语言模型/, /大模型/, /system prompt/i];
const INSTRUCTION_PATTERNS = [
  /点击/,
  /输入/,
  /按下/,
  /立刻去/,
  /你应该/,
  /你必须/,
  /领取/,
  /接取/
];

export function buildWorldRumorPrompt(context: WorldRumorPromptContext) {
  return {
    system: [
      "你正在为暗黑西幻 MUD 生成村庄传闻。",
      "你必须只输出 json object，不输出 markdown，不输出解释。",
      "json 字段必须包含 message、safety。",
      `message 不超过 ${WORLD_RUMOR_MAX_MESSAGE_CHARS} 个中文字符。`,
      "你只能把输入中的真实事件改写成短传闻，不能新增人物、地点、奖励、掉落、任务、价格、战斗结果或世界事实。",
      "你不能承诺或发放金币、物品、经验、装备，不能指导玩家点击、输入、接任务或领取奖励。",
      "传闻必须像村民闲聊，不要像系统公告，不要提到 AI、模型、prompt 或规则。",
      "示例 json：{\"message\":\"村里有人低声谈起：伯林的矿箱又见了底。\",\"safety\":{\"containsNewFact\":false,\"containsRewardPromise\":false,\"containsOoc\":false,\"containsPlayerInstruction\":false}}"
    ].join("\n"),
    user: JSON.stringify({
      promptVersion: WORLD_RUMOR_PROMPT_VERSION,
      requiredOutput: "json",
      context
    })
  };
}

export function parseWorldRumorOutput(raw: string): WorldRumorParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  if (!isObject(parsed)) return { ok: false, reason: "invalid_shape" };

  const { message, safety } = parsed;
  if (typeof message !== "string" || !isSafety(safety)) {
    return { ok: false, reason: "invalid_shape" };
  }

  const trimmedMessage = message.trim();
  if (!trimmedMessage) return { ok: false, reason: "empty_message" };
  if ([...trimmedMessage].length > WORLD_RUMOR_MAX_MESSAGE_CHARS) {
    return { ok: false, reason: "message_too_long" };
  }
  if (safety.containsNewFact) return { ok: false, reason: "new_fact" };
  if (safety.containsRewardPromise || hasPattern(trimmedMessage, REWARD_PATTERNS)) {
    return { ok: false, reason: "reward_promise" };
  }
  if (
    safety.containsPlayerInstruction ||
    hasPattern(trimmedMessage, INSTRUCTION_PATTERNS)
  ) {
    return { ok: false, reason: "player_instruction" };
  }
  if (safety.containsOoc || hasPattern(trimmedMessage, OOC_PATTERNS)) {
    return { ok: false, reason: "ooc" };
  }

  return { ok: true, value: { message: trimmedMessage } };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafety(value: unknown): value is WorldRumorOutput["safety"] {
  return (
    isObject(value) &&
    typeof value.containsNewFact === "boolean" &&
    typeof value.containsRewardPromise === "boolean" &&
    typeof value.containsOoc === "boolean" &&
    typeof value.containsPlayerInstruction === "boolean"
  );
}

function hasPattern(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}
