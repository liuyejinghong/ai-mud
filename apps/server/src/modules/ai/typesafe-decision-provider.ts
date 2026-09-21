// M14-LIVE seam 首个真实现：TypeSafe Jev（OpenRouter chat/completions，jev-latest）。
// 默认 SHADOW 模式：先规则决策（执行语义不变），再真调 Jev 记录对照进审计——
// Jev 结果只进 reason 对照文本，绝不驱动调度（切 LIVE 由用户授权后另做）。
// 失败/超时/无 key 一律安全回退 RULE，游戏零阻塞。
import { RuleDecisionProvider, type DecisionCandidateScore, type DecisionProvider, type DecisionProviderRequest, type DecisionProviderResult } from "./decision-provider.js";

export const TYPESAFE_DECISION_PROVIDER_NAME = "typesafe-shadow";

export interface TypeSafeProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface ChatChoice {
  message?: { content?: string };
}

interface ChatResponse {
  choices?: ChatChoice[];
}

export class TypeSafeShadowDecisionProvider implements DecisionProvider {
  private readonly rule = new RuleDecisionProvider();
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: TypeSafeProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 1_800;
  }

  async decide(request: DecisionProviderRequest): Promise<DecisionProviderResult> {
    // 执行语义永远是规则：SHADOW 只做对照记录。
    const ruleOutcome = await this.rule.decide(request);

    try {
      const jevReason = await this.askJev(request);
      return {
        ...ruleOutcome,
        provider: TYPESAFE_DECISION_PROVIDER_NAME,
        reason: `${ruleOutcome.reason}（Jev 对照：${jevReason}）`
      };
    } catch {
      // Jev 不可用：照常返回规则结果，provider 名照实标注对照失败。
      return {
        ...ruleOutcome,
        provider: TYPESAFE_DECISION_PROVIDER_NAME,
        reason: `${ruleOutcome.reason}（Jev 对照不可用）`
      };
    }
  }

  private async askJev(request: DecisionProviderRequest): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const candidateLines = request.candidates
        .map((candidate: DecisionCandidateScore) => `- ${candidate.candidateId}（评分 ${candidate.score}）`)
        .join("\n");
      const response = await this.fetchImpl(
        `${(this.options.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.options.apiKey}`
          },
          body: JSON.stringify({
            model: this.options.model ?? "jev-latest",
            messages: [
              {
                role: "system",
                content:
                  "你是火星基地工程队的决策顾问。只输出一句话中文点评：规则选择是否合理，或你会如何选择。不执行任何操作。"
              },
              {
                role: "user",
                content: `问题：${request.question}\n候选：\n${candidateLines}\n规则选择：${request.candidates[0]?.candidateId ?? "无"}`
              }
            ],
            max_tokens: 120,
            stream: false
          }),
          signal: controller.signal
        }
      );
      if (!response.ok) {
        throw new Error(`typesafe http ${response.status}`);
      }
      const body = (await response.json()) as ChatResponse;
      const content = body.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new Error("typesafe empty content");
      }
      return content.slice(0, 120);
    } finally {
      clearTimeout(timer);
    }
  }
}
