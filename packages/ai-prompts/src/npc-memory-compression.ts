export const NPC_MEMORY_COMPRESSION_PROMPT_VERSION = 5;
export const NPC_MEMORY_COMPRESSION_MAX_SUMMARY_CHARS = 220;

export interface NpcMemoryCompressionPromptContext {
  npc: {
    name: string;
    memoryKind: string;
    evidenceLevel: "dialogue_claim" | "system_verified";
  };
  entries: Array<{
    summary: string;
    importance: number;
    occurredAt: string;
  }>;
  fallbackSummary: string;
}

export interface NpcMemoryCompressionOutput {
  summary: string;
  safety: {
    changesEvidenceLevel: boolean;
    containsRewardPromise: boolean;
    containsRuleChange: boolean;
    containsOoc: boolean;
  };
}

export type NpcMemoryCompressionParseResult =
  | { ok: true; value: Pick<NpcMemoryCompressionOutput, "summary"> }
  | {
      ok: false;
      reason:
        | "invalid_json"
        | "invalid_shape"
        | "empty_summary"
        | "summary_too_long"
        | "evidence_level_change"
        | "reward_promise"
        | "rule_change"
        | "ooc";
    };

const REWARD_PATTERNS = [
  /给你\s*\d+\s*(金币|银币|铜币|金)/,
  /奖励\s*\d+\s*(金币|银币|铜币|金|经验)/,
  /送你.*(装备|武器|金币|银币|铜币|经验)/,
  /你获得/,
  /发放.*(金币|银币|铜币|物品|装备|经验)/
];
const OOC_PATTERNS = [/作为\s*(一个)?\s*AI/, /语言模型/, /大模型/, /system prompt/i];

export function buildNpcMemoryCompressionPrompt(context: NpcMemoryCompressionPromptContext) {
  return {
    system: [
      "你正在为暗黑西幻 MUD 的长期 NPC 压缩记忆。",
      "你必须只输出 json object，不输出 markdown，不输出解释。",
      "json 字段必须包含 summary、safety。",
      `summary 不超过 ${NPC_MEMORY_COMPRESSION_MAX_SUMMARY_CHARS} 个中文字符。`,
      "你只能压缩输入事实，不得新增事实，不得改变证据等级，不得把玩家声称改写成系统事实。",
      "你不能承诺或发放金币、物品、经验、装备，不能修改任务、市场、战斗或游戏规则。",
      "如果输入是 dialogue_claim，输出仍只能描述为 NPC 记得玩家曾经说过或声称过。",
      "示例 json：{\"summary\":\"伯林记得阿岚多次提到基础铁矿石，但这些仍只是对话记忆。\",\"safety\":{\"changesEvidenceLevel\":false,\"containsRewardPromise\":false,\"containsRuleChange\":false,\"containsOoc\":false}}"
    ].join("\n"),
    user: JSON.stringify({
      promptVersion: NPC_MEMORY_COMPRESSION_PROMPT_VERSION,
      requiredOutput: "json",
      context
    })
  };
}

export function parseNpcMemoryCompressionOutput(
  raw: string
): NpcMemoryCompressionParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  if (!isObject(parsed)) return { ok: false, reason: "invalid_shape" };

  const { summary, safety } = parsed;
  if (typeof summary !== "string" || !isSafety(safety)) {
    return { ok: false, reason: "invalid_shape" };
  }

  const trimmedSummary = summary.trim();
  if (!trimmedSummary) return { ok: false, reason: "empty_summary" };
  if ([...trimmedSummary].length > NPC_MEMORY_COMPRESSION_MAX_SUMMARY_CHARS) {
    return { ok: false, reason: "summary_too_long" };
  }
  if (safety.changesEvidenceLevel) return { ok: false, reason: "evidence_level_change" };
  if (safety.containsRewardPromise || hasPattern(trimmedSummary, REWARD_PATTERNS)) {
    return { ok: false, reason: "reward_promise" };
  }
  if (safety.containsRuleChange) return { ok: false, reason: "rule_change" };
  if (safety.containsOoc || hasPattern(trimmedSummary, OOC_PATTERNS)) {
    return { ok: false, reason: "ooc" };
  }

  return { ok: true, value: { summary: trimmedSummary } };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafety(value: unknown): value is NpcMemoryCompressionOutput["safety"] {
  return (
    isObject(value) &&
    typeof value.changesEvidenceLevel === "boolean" &&
    typeof value.containsRewardPromise === "boolean" &&
    typeof value.containsRuleChange === "boolean" &&
    typeof value.containsOoc === "boolean"
  );
}

function hasPattern(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}
