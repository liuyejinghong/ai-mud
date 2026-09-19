// M14-A 决策提供者（m14-p-contract.md §1/§3 冻结语义）。
// 三模式 seam：本版只实现 RULE（RuleDecisionProvider）；SHADOW/LIVE 由后续版本在
// DecisionProvider 接口后挂新实现，provider 未配置时网关安全回退 RULE，不调用付费模型
// （LIVE_MODEL_GATE 留待用户授权）。决策只选 ID：候选与 score 全部由服务端规则生成，
// provider 返回值不得改变候选语义（越权选择由 DecisionGateway 校验拦截）。
// 纯函数式决策：确定性（同输入同输出）、无 IO、无时钟依赖。
import type { DecisionPurpose } from "@ai-mud/shared";

// ---------- 决策提供者端口（SHADOW/LIVE seam） ----------

export interface DecisionCandidateScore {
  candidateId: string;
  score: number;
}

export interface DecisionProviderRequest {
  purpose: DecisionPurpose;
  question: string;
  candidates: DecisionCandidateScore[];
  deadlineMs: number;
}

export interface DecisionProviderResult {
  // null = 弃权（abstain）：请求保持 pending，等待下次 tick 重评。
  selectedCandidateId: string | null;
  // 审计用实现名：RULE 固定 "rule"；超时兜底由网关记 "timeout"。
  provider: string;
  reason: string;
}

export interface DecisionProvider {
  decide(request: DecisionProviderRequest): Promise<DecisionProviderResult>;
}

// ---------- RULE 实现 ----------

export const RULE_DECISION_PROVIDER_NAME = "rule";

// RULE reason 文案：中文一句话；packages/ai-prompts 的决策表达模板可在此文案外层
// 组合输入/结果描述（M14-D），本层保持最小自含、不依赖表达包。
const RULE_REASON_BY_PURPOSE: Partial<Record<DecisionPurpose, string>> = {
  transport_assistance: "选择电量最充足的支援设备",
  work_assignment: "选择评分最高的候选"
};

const RULE_REASON_DEFAULT = "选择评分最高的候选";

export class RuleDecisionProvider implements DecisionProvider {
  async decide(request: DecisionProviderRequest): Promise<DecisionProviderResult> {
    if (request.candidates.length === 0) {
      return {
        selectedCandidateId: null,
        provider: RULE_DECISION_PROVIDER_NAME,
        reason: "没有可用候选，本次弃权"
      };
    }
    // 最高分当选；并列取 candidateId 字典序最小者（跨 tick/跨进程可重放，无隐藏 tiebreak）。
    const sorted = [...request.candidates].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0;
    });
    const selected = sorted[0];
    if (!selected) {
      return {
        selectedCandidateId: null,
        provider: RULE_DECISION_PROVIDER_NAME,
        reason: "没有可用候选，本次弃权"
      };
    }
    return {
      selectedCandidateId: selected.candidateId,
      provider: RULE_DECISION_PROVIDER_NAME,
      reason: RULE_REASON_BY_PURPOSE[request.purpose] ?? RULE_REASON_DEFAULT
    };
  }
}
