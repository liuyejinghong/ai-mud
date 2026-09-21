// M14-C 决策表达模板：把一次决策的输入与结果写成一句中文，供 RULE 模式 reason、
// 审计日志与 UI 复用。纯函数：不 import 任何模块，不访问网络，不依赖运行时状态；
// 相同输入永远得到相同输出（决策描述可重放、可审计）。
// purpose 取值与 packages/shared/src/decision.ts 的 DecisionPurpose 对齐；本包不依赖
// @ai-mud/shared，故以宽类型接收，未知取值原样回显，不在模板层做业务判断。

export const DECISION_PROMPT_VERSION = 1;

export const DECISION_PURPOSE_LABELS: Record<string, string> = {
  transport_assistance: "工程组请求运输支援",
  work_assignment: "多候选设备或工单选择"
};

export interface DecisionCandidatePromptView {
  candidateId: string;
  summary: string;
}

export function describeDecisionPurposeLabel(purpose: string): string {
  return DECISION_PURPOSE_LABELS[purpose] ?? purpose;
}

export function describeDecisionInput(
  purpose: string,
  question: string,
  candidates: readonly DecisionCandidatePromptView[]
): string {
  const purposeLabel = describeDecisionPurposeLabel(purpose);
  const candidateText =
    candidates.length > 0
      ? `（共 ${candidates.length} 个候选：${candidates
          .map((candidate) => `${candidate.candidateId} ${candidate.summary}`.trim())
          .join("、")}）`
      : `（共 ${candidates.length} 个候选）`;
  return `${purposeLabel}。${question}${candidateText}`;
}

export function describeDecisionOutcome(
  purpose: string,
  selectedCandidateId: string | null,
  reason: string
): string {
  const purposeLabel = describeDecisionPurposeLabel(purpose);
  if (selectedCandidateId === null) {
    return `${purposeLabel}。本次决策没有选择任何候选（弃权）：${reason}`;
  }
  return `${purposeLabel}。本次决策选择了候选 ${selectedCandidateId}：${reason}`;
}
