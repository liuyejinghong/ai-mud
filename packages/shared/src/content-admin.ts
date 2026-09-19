import type { DefinitionRefDto, ProjectInputDto } from "./base.js";

// 内容工坊公共协议（M13-P 冻结，contractVersion 0.13.0-p1）。
// Draft 可变；Release 不可变（整包校验后发布）；激活按基地显式结算边界。
// 目录化范围裁决（M13-P）：robot_template / project / recipe 三类；物品与设施
// 维持静态代码（推迟目录化，见 m13-p-contract.md §1 BOUNDARY-01）。

export const CONTENT_DEFINITION_KINDS = ["robot_template", "project", "recipe"] as const;
export type ContentDefinitionKind = (typeof CONTENT_DEFINITION_KINDS)[number];

export const DRAFT_STATUSES = ["draft", "published"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export interface ContentDraftDto {
  draftId: string;
  kind: ContentDefinitionKind;
  stableId: string;
  revision: number;
  payload: Record<string, unknown>;
  status: DraftStatus;
  updatedAt: string;
}

export interface CreateContentDraftInputDto {
  kind: ContentDefinitionKind;
  stableId: string;
  payload: Record<string, unknown>;
}

export interface UpdateContentDraftInputDto {
  draftId: string;
  payload: Record<string, unknown>;
}

export interface ContentReleaseSummaryDto {
  releaseId: string;
  contentHash: string;
  definitionCount: number;
  createdAt: string;
}

export interface PublishContentReleaseResultDto {
  releaseId: string;
  definitionCount: number;
  contentHash: string;
}

export interface ActivateContentReleaseInputDto {
  releaseId: string;
  baseId: string;
}

// ---------- 制造（玩家侧） ----------

export interface RecipeOutputDto {
  templateStableId: string;
  initialBatteryWh: number;
}

export interface RecipeTemplateDto {
  ref: DefinitionRefDto;
  name: string;
  description: string;
  inputs: ProjectInputDto[];
  // 每台的工作量（industry 结算按电力推进）。
  workPerUnit: number;
  output: RecipeOutputDto;
}

export const MANUFACTURING_JOB_STATUSES = [
  "active",
  "paused",
  "blocked",
  "completed",
  "cancelled"
] as const;
export type ManufacturingJobStatus = (typeof MANUFACTURING_JOB_STATUSES)[number];

export interface ManufacturingJobDto {
  jobId: string;
  recipeRef: DefinitionRefDto;
  recipeName: string;
  status: ManufacturingJobStatus;
  outputsPlanned: number;
  outputsDone: number;
  currentUnitWorkDone: number;
  blockedReason: string | null;
}

export interface CreateManufacturingJobInputDto {
  recipeRef: DefinitionRefDto;
  outputsPlanned: number;
  commandId: string;
}

export interface CreateManufacturingJobResultDto {
  jobId: string;
  duplicate: boolean;
}

export interface CancelManufacturingJobResultDto {
  cancelled: boolean;
  duplicate: boolean;
  releasedInputs: Array<{ itemId: string; quantity: number }>;
}

// 制造批量与单批上限（P fixture，防一次巨大事务造万台）。
export const MANUFACTURING_MAX_OUTPUTS = 20;
