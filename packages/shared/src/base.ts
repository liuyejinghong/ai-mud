import type {
  ManufacturingJobDto,
  RecipeTemplateDto
} from "./content-admin.js";

// 基地经营公共协议（M12-P 冻结，contractVersion 0.12.0-p1）。
// 事实唯一写者与接口语义见 docs/reviews/base-operations/contracts.md §4—§6。
// 纯类型与常量：不包含服务端实现，不得 import 服务端模块。

export const BASE_ROBOT_GROUPS = ["transport", "engineering", "survey"] as const;
export type BaseRobotGroupId = (typeof BASE_ROBOT_GROUPS)[number];

export const BASE_ROBOT_GROUP_NAMES: Record<BaseRobotGroupId, string> = {
  transport: "资源运输组",
  engineering: "工程维护组",
  survey: "勘测巡检组"
};

export const BASE_TIME_MODES = ["paused", "running"] as const;
export type BaseTimeMode = (typeof BASE_TIME_MODES)[number];

export const PROJECT_STATUSES = [
  "planned",
  "active",
  "paused",
  "blocked",
  "completed",
  "cancelled",
  "failed"
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const STEP_KINDS = ["site_clearing", "transport", "installation", "commissioning"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const STEP_STATUSES = ["pending", "ready", "running", "blocked", "completed", "failed"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const ROBOT_STATUSES = ["idle", "charging", "working", "offline"] as const;
export type RobotStatus = (typeof ROBOT_STATUSES)[number];

// 模拟时间：sol 简化为 24 小时模拟时；昼间 06:00—18:00（simTime）出力，其余时段靠储能。
// Q-06 已按"简化值"冻结，取值属于内容包声明范围。开局无第二电源（Q-01：纯储能过夜）。
export const SIM_DAY_HOURS = 24;
export const SIM_DAYLIGHT_START_HOUR = 6;
export const SIM_DAYLIGHT_END_HOUR = 18;

// 内容目录引用：kind + 稳定 ID + 修订。运行实例固定开工时修订，不静默升级。
export interface DefinitionRefDto {
  kind: "robot_template" | "project" | "facility" | "recipe";
  stableId: string;
  revision: number;
}

export function definitionRefKey(ref: DefinitionRefDto): string {
  return `${ref.kind}:${ref.stableId}@${ref.revision}`;
}

// ---------- 机器人模板（内容包提供，运行只读） ----------
// 精度合同：功率一律 W、电量一律 Wh 的整数定点；kW/kWh 仅为 UI 换算显示。

export interface RobotTemplateDto {
  ref: DefinitionRefDto;
  name: string;
  groupId: BaseRobotGroupId;
  description: string;
  batteryCapacityWh: number;
  chargeRateW: number;
  workRatePerTick: number;
}

// ---------- 项目模板与设施（内容包提供，运行只读） ----------

export interface ProjectStepTemplateDto {
  kind: StepKind;
  groupId: BaseRobotGroupId;
  workRequired: number;
}

export interface ProjectInputDto {
  itemId: string;
  quantity: number;
}

export interface ProjectTemplateDto {
  ref: DefinitionRefDto;
  name: string;
  description: string;
  steps: ProjectStepTemplateDto[];
  inputs: ProjectInputDto[];
  outputFacility: {
    ref: DefinitionRefDto;
    name: string;
    generationWPeak: number;
  };
}

// ---------- BaseSnapshot（观察投影，纯读） ----------

export interface BasePowerDto {
  generationWPeak: number;
  availableW: number;
  storageWh: number;
  storageCapacityWh: number;
  loadW: number;
}

export interface BaseResourceDto {
  itemId: string;
  name: string;
  quantity: number;
  description: string;
}

export interface BaseAttributeDto {
  label: string;
  value: string;
}

export interface BaseSiteDto {
  siteId: string;
  siteKey: string;
  name: string;
  state: "free" | "reserved" | "built";
  // built 站点携带设施说明与静态属性（来自内容包）；free/reserved 为 null。
  note: string | null;
  description: string | null;
  attributes: BaseAttributeDto[];
}

export interface BaseDeviceDto {
  deviceId: string;
  operatorId: string;
  name: string;
  groupId: BaseRobotGroupId;
  description: string;
  status: RobotStatus;
  batteryWh: number;
  batteryCapacityWh: number;
  currentAssignment: { projectId: string; stepIndex: number } | null;
}

export interface BaseProjectStepDto {
  index: number;
  kind: StepKind;
  groupId: BaseRobotGroupId;
  status: StepStatus;
  workRequired: number;
  workDone: number;
  blockedReason: string | null;
}

export interface BaseProjectDto {
  projectId: string;
  definitionRef: DefinitionRefDto;
  name: string;
  status: ProjectStatus;
  siteId: string;
  steps: BaseProjectStepDto[];
}

export interface BaseControlLeaseDto {
  heldByThisSession: boolean;
  leaseUntil: string | null;
}

export interface BaseSnapshotDto {
  name: string;
  baseId: string;
  epoch: number;
  baseRevision: number;
  simTime: string;
  timeMode: BaseTimeMode;
  speed: number;
  activeContentRelease: string;
  power: BasePowerDto;
  resources: BaseResourceDto[];
  sites: BaseSiteDto[];
  devices: BaseDeviceDto[];
  projects: BaseProjectDto[];
  // 可建项目模板（来自已发布内容目录，与运行实例无关；开局即可见）。
  buildableProjects: Array<{
    definitionRef: DefinitionRefDto;
    name: string;
    description: string;
  }>;
  manufacturingJobs: ManufacturingJobDto[];
  availableRecipes: RecipeTemplateDto[];
  controlLease: BaseControlLeaseDto;
}

// ---------- 命令 ----------

export interface BaseAuthzDto {
  accountId: string;
  baseId: string;
}

// 制造/配方 DTO 在 content-admin.ts，此处 re-export 引用（快照字段）。
export interface CreateProjectInputDto {
  definitionRef: DefinitionRefDto;
  siteId: string;
  commandId: string;
}

export interface CreateProjectResultDto {
  projectId: string;
  duplicate: boolean;
}

export interface BaseClockCommandInputDto {
  command: "pause" | "resume" | "set_speed";
  speed?: number;
}

// 心跳：控制会话每 BASE_LEASE_HINT_MS 续租一次；租期到期基地自动暂停。
export const BASE_LEASE_HINT_MS = 30_000;
export const BASE_LEASE_TTL_MS = 120_000;
// 单次结算最大补算墙钟；超过按上限推进，不把停服时间当生产时间。
export const BASE_MAX_CATCHUP_MS = 10 * 60_000;
export const BASE_SPEEDS = [1, 2, 4] as const;
export type BaseSpeed = (typeof BASE_SPEEDS)[number];
