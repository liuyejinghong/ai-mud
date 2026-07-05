export const OFFLINE_SUMMARY_PROMPT_VERSION = 1;
export const OFFLINE_SUMMARY_MAX_TITLE_CHARS = 24;
export const OFFLINE_SUMMARY_MAX_SUMMARY_CHARS = 180;
export const OFFLINE_SUMMARY_MAX_HIGHLIGHTS = 4;
export const OFFLINE_SUMMARY_MAX_HIGHLIGHT_CHARS = 80;

export interface OfflineSummaryPromptContext {
  player: {
    name: string;
    level: number;
    locationName: string;
  };
  window: {
    since: string;
    until: string;
  };
  facts: string[];
  fallback: {
    title: string;
    summary: string;
    highlights: string[];
  };
}

export interface OfflineSummaryOutput {
  title: string;
  summary: string;
  highlights: string[];
  safety: {
    containsNewFact: boolean;
    containsRewardPromise: boolean;
    containsStateChange: boolean;
    containsOoc: boolean;
  };
}

export type OfflineSummaryParseResult =
  | { ok: true; value: Pick<OfflineSummaryOutput, "title" | "summary" | "highlights"> }
  | {
      ok: false;
      reason:
        | "invalid_json"
        | "invalid_shape"
        | "empty_title"
        | "empty_summary"
        | "title_too_long"
        | "summary_too_long"
        | "too_many_highlights"
        | "highlight_too_long"
        | "new_fact"
        | "reward_promise"
        | "state_change"
        | "ooc";
    };

const REWARD_PATTERNS = [
  /你获得/,
  /奖励\s*\d+\s*(金币|银币|铜币|金|经验)/,
  /发放.*(金币|银币|铜币|物品|装备|经验)/,
  /领取\s*\d+\s*(金币|银币|铜币|金|经验)/,
  /掉落.*(金币|银币|铜币|装备|武器)/
];
const STATE_CHANGE_PATTERNS = [/已发放/, /已加入背包/, /等级提升至/, /好感度.*增加/];
const OOC_PATTERNS = [/作为\s*(一个)?\s*AI/, /语言模型/, /大模型/, /system prompt/i];

export function buildOfflineSummaryPrompt(context: OfflineSummaryPromptContext) {
  return {
    system: [
      "你正在为暗黑西幻 MUD 生成玩家离线期间的世界简报。",
      "你必须只输出 json object，不输出 markdown，不输出解释。",
      "json 字段必须包含 title、summary、highlights、safety。",
      `title 不超过 ${OFFLINE_SUMMARY_MAX_TITLE_CHARS} 个中文字符。`,
      `summary 不超过 ${OFFLINE_SUMMARY_MAX_SUMMARY_CHARS} 个中文字符。`,
      `highlights 最多 ${OFFLINE_SUMMARY_MAX_HIGHLIGHTS} 条，每条不超过 ${OFFLINE_SUMMARY_MAX_HIGHLIGHT_CHARS} 个中文字符。`,
      "你只能总结输入 facts 里的真实事件，不能新增人物、地点、奖励、掉落、任务、价格、战斗结果或世界事实。",
      "你不能承诺或发放金币、物品、经验、装备，不能改变角色状态、背包、好感、任务或世界状态。",
      "语气是游戏内书记员的简报，不要提到 AI、模型、prompt 或规则。",
      "示例 json：{\"title\":\"离线简报\",\"summary\":\"你离开期间，黑松哨站仍在缓慢运转。\",\"highlights\":[\"集市记录了新的矿石流动。\"],\"safety\":{\"containsNewFact\":false,\"containsRewardPromise\":false,\"containsStateChange\":false,\"containsOoc\":false}}"
    ].join("\n"),
    user: JSON.stringify({
      promptVersion: OFFLINE_SUMMARY_PROMPT_VERSION,
      requiredOutput: "json",
      context
    })
  };
}

export function parseOfflineSummaryOutput(raw: string): OfflineSummaryParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  if (!isObject(parsed)) return { ok: false, reason: "invalid_shape" };
  const { title, summary, highlights, safety } = parsed;
  if (
    typeof title !== "string" ||
    typeof summary !== "string" ||
    !Array.isArray(highlights) ||
    !isSafety(safety)
  ) {
    return { ok: false, reason: "invalid_shape" };
  }

  const trimmedTitle = title.trim();
  const trimmedSummary = summary.trim();
  const trimmedHighlights = highlights.map((entry) =>
    typeof entry === "string" ? entry.trim() : null
  );
  if (trimmedHighlights.some((entry) => entry === null)) return { ok: false, reason: "invalid_shape" };
  if (!trimmedTitle) return { ok: false, reason: "empty_title" };
  if (!trimmedSummary) return { ok: false, reason: "empty_summary" };
  if ([...trimmedTitle].length > OFFLINE_SUMMARY_MAX_TITLE_CHARS) {
    return { ok: false, reason: "title_too_long" };
  }
  if ([...trimmedSummary].length > OFFLINE_SUMMARY_MAX_SUMMARY_CHARS) {
    return { ok: false, reason: "summary_too_long" };
  }
  if (trimmedHighlights.length > OFFLINE_SUMMARY_MAX_HIGHLIGHTS) {
    return { ok: false, reason: "too_many_highlights" };
  }
  if (
    trimmedHighlights.some(
      (entry) => entry !== null && [...entry].length > OFFLINE_SUMMARY_MAX_HIGHLIGHT_CHARS
    )
  ) {
    return { ok: false, reason: "highlight_too_long" };
  }
  const allText = [trimmedTitle, trimmedSummary, ...trimmedHighlights.filter(isString)].join("\n");
  if (safety.containsNewFact) return { ok: false, reason: "new_fact" };
  if (safety.containsRewardPromise || hasPattern(allText, REWARD_PATTERNS)) {
    return { ok: false, reason: "reward_promise" };
  }
  if (safety.containsStateChange || hasPattern(allText, STATE_CHANGE_PATTERNS)) {
    return { ok: false, reason: "state_change" };
  }
  if (safety.containsOoc || hasPattern(allText, OOC_PATTERNS)) {
    return { ok: false, reason: "ooc" };
  }

  return {
    ok: true,
    value: {
      title: trimmedTitle,
      summary: trimmedSummary,
      highlights: trimmedHighlights.filter(isString)
    }
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafety(value: unknown): value is OfflineSummaryOutput["safety"] {
  return (
    isObject(value) &&
    typeof value.containsNewFact === "boolean" &&
    typeof value.containsRewardPromise === "boolean" &&
    typeof value.containsStateChange === "boolean" &&
    typeof value.containsOoc === "boolean"
  );
}

function isString(value: string | null): value is string {
  return value !== null;
}

function hasPattern(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}
