// M14-P 决策与协作公共协议（contractVersion 0.14.0-p1）。
// 三模式：RULE（规则决策）/ SHADOW（影子记录不执行）/ LIVE（真实模型，需用户授权预算）。
// 本版交付 RULE 全链 + SHADOW/LIVE seam（provider 未配置时安全回退 RULE）。

export const DECISION_PURPOSES = [
  "transport_assistance", // 工程组请求运输支援
  "work_assignment" // 多候选设备/工单选择
] as const;
export type DecisionPurpose = (typeof DECISION_PURPOSES)[number];

export const DECISION_MODES = ["rule", "shadow", "live"] as const;
export type DecisionMode = (typeof DECISION_MODES)[number];

export interface DecisionCandidateDto {
  candidateId: string;
  summary: string;
  // 服务端保留的结构化收益/代价（模型只选 ID，不改数值）。
  score: number;
}

export interface DecisionRequestDto {
  decisionId: string;
  purpose: DecisionPurpose;
  baseId: string;
  epoch: number;
  planRevision: number;
  question: string;
  candidates: DecisionCandidateDto[];
  deadlineMs: number;
}

export interface DecisionOutcomeDto {
  decisionId: string;
  selectedCandidateId: string | null; // null = abstain
  mode: DecisionMode;
  provider: string;
  latencyMs: number;
  reason: string;
}

// 协作请求（工程队内部跨组支援）。
export const COOPERATION_STATUSES = [
  "pending",
  "accepted",
  "declined",
  "expired",
  "fulfilled"
] as const;
export type CooperationStatus = (typeof COOPERATION_STATUSES)[number];

export type CooperationResolutionReason =
  | "ttl_expired"
  | "project_cancelled"
  | "project_failed"
  | "step_failed"
  | "content_missing"
  | "no_longer_needed";

export interface CooperationHelperDto {
  operatorId: string;
  groupId: string;
  batteryWh: number;
  batteryCapacityWh: number;
}

export interface CooperationRequestDto {
  requestId: string;
  projectId: string;
  projectName: string;
  stepIndex: number;
  fromGroupId: string;
  helperGroupId: string;
  status: CooperationStatus;
  resolutionReason: CooperationResolutionReason | null;
  helperOperatorId: string | null;
  proposedHelper: CooperationHelperDto | null;
  question: string;
  createdAt: string;
}

export interface CooperationDecisionInputDto {
  action: "support" | "wait";
  commandId: string;
  expectedHelperOperatorId?: string;
}

export interface CooperationDecisionResultDto {
  requestId: string;
  status: "accepted" | "declined";
  helperOperatorId?: string;
  duplicate: boolean;
}

export const COOPERATION_TTL_MS = 720_000;
export const DECISION_TIMEOUT_MS = 2_000;
