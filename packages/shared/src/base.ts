import type { CooperationRequestDto } from "./decision.js";
import type { BaseOrderDto, PurchaseOrderDto } from "./economy.js";
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
  kind: "robot_template" | "project" | "facility" | "recipe" | "order";
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
  // R1 landing：出工每基地分钟耗电 Wh；缺省 = 旧规则常量 500。
  workDrainWhPerTick?: number;
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
    generationWPeak?: number;
    effects?: {
      storageCapacityWh?: number;
      chargeLimitW?: number;
      processingSlots?: number;
      capabilities?: string[];
    };
  };
  // R1 landing（缺省 = 旧语义：无前置、不占扩建配额）。
  requiresFacilities?: string[];
  expansionSlot?: boolean;
  allowedSiteKeys?: string[];
}

// ---------- BaseSnapshot（观察投影，纯读） ----------

export interface BasePowerDto {
  generationWPeak: number;
  availableW: number;
  storageWh: number;
  storageCapacityWh: number;
  loadW: number;
  // R1 landing（旧档缺省省略）。
  emergencyGenerationW?: number;
  chargeLimitW?: number;
  powerPolicy?: PowerPolicyPriority;
  // 实际当期供电投影（与结算同源；夜间太阳能为 0，应急恒定）。
  actualGenerationW?: number;
  actualSolarW?: number;
}

// 库存占用来源（M 合同增量）：总量/占用事实以 base_inventory 为唯一权威；
// 来源只是同基地仍持有预留的项目/制造工单的只读投影，可支配量 = quantity - reservedQuantity。
export interface BaseResourceReservationSourceDto {
  kind: "project" | "manufacturing";
  id: string;
  name: string;
  quantity: number;
}

export interface BaseResourceDto {
  itemId: string;
  name: string;
  quantity: number;
  reservedQuantity: number;
  reservationSources: BaseResourceReservationSourceDto[];
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
  // R1 landing：当前勘探/采矿单（与 currentAssignment 互斥）。
  currentExtractionJobId?: string | null;
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
  builderCount?: number;
  steps: BaseProjectStepDto[];
}

export interface BaseControlLeaseDto {
  heldByThisSession: boolean;
  controlActive: boolean;
  leaseUntil: string | null;
}

// ---------- 天气（M15，确定性循环序列，无随机） ----------
export const WEATHER_TYPES = ["clear", "warning", "storm"] as const;
export type WeatherType = (typeof WEATHER_TYPES)[number];

export interface BaseWeatherDto {
  current: WeatherType;
  // 当前天气对太阳出力的光照系数（storm 0.25 / warning 0.7 / clear 1.0；积尘另算）。
  lightFactor: number;
  // 当前积尘衰减（0—1，发电再乘 (1 - dustLevel/200)）。
  dustLevel: number;
  // 下一段天气切换的基地时间（ISO）。
  nextChangeAt: string;
  nextWeather: WeatherType;
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
  displayNames?: {
    items: Record<string, string>;
    facilities: Record<string, string>;
    robots: Record<string, string>;
  };
  sites: BaseSiteDto[];
  devices: BaseDeviceDto[];
  projects: BaseProjectDto[];
  // 可建项目模板（来自已发布内容目录，与运行实例无关；开局即可见）。
  buildableProjects: Array<{
    definitionRef: DefinitionRefDto;
    name: string;
    description: string;
    // 开工材料需求（来自内容目录模板）；面板据此显示材料清单与库存缺口（BUILD-01）。
    inputs?: Array<{ itemId: string; quantity: number }>;
    // R1 landing：设施前置 / 扩建位标记 / 位置合法键 / 当前提可开工结论与结构化阻塞。
    requiresFacilities?: string[];
    expansionSlot?: boolean;
    allowedSiteKeys?: string[];
    canStart?: boolean;
    blockers?: BaseActionBlockerDto[];
    outputFacility?: ProjectTemplateDto["outputFacility"];
  }>;
  manufacturingJobs: ManufacturingJobDto[];
  availableRecipes: RecipeTemplateDto[];
  // R1 landing：能力位（新档不含 external_trade）、资源节点、勘探/采矿单、加工槽。
  capabilities?: string[];
  resourceNodes?: BaseResourceNodeDto[];
  extractionJobs?: BaseExtractionJobDto[];
  productionSlots?: BaseProductionSlotDto[];
  cooperationRequests: CooperationRequestDto[];
  credits: number;
  orders: BaseOrderDto[];
  purchases: PurchaseOrderDto[];
  weather: BaseWeatherDto;
  controlLease: BaseControlLeaseDto;
}

// ---------- R1 landing：资源节点 / 勘探采矿 / 加工槽 / 电力策略 ----------

export type PowerPolicyPriority = "production" | "charging";

export interface BaseResourceNodeDto {
  nodeId: string;
  nodeKey: string;
  name: string;
  // 未勘探：矿种与储量不显示（null）；勘探完成才揭示。
  discovered: boolean;
  itemId: string | null;
  itemName: string | null;
  remainingQuantity: number | null;
  reservedQuantity: number | null;
}

export const EXTRACTION_JOB_STATUSES = ["active", "paused", "stopping", "completed", "cancelled"] as const;
export type ExtractionJobStatus = (typeof EXTRACTION_JOB_STATUSES)[number];
export type ExtractionJobKind = "survey" | "mine";
// mining = 开采工序（筑垒出工）；hauling = 运输工序（驮运出工）；survey 单完成即揭示。
export type ExtractionPhase = "mining" | "hauling" | null;

export interface BaseExtractionJobDto {
  jobId: string;
  kind: ExtractionJobKind;
  status: ExtractionJobStatus;
  nodeId: string;
  nodeName: string;
  batchesPlanned: number;
  batchesExtracted: number;
  batchesDelivered: number;
  phase: ExtractionPhase;
  phaseWorkDone: number;
  phaseWorkRequired: number;
  builderOperatorIds: string[];
  haulerOperatorId: string | null;
  surveyorOperatorId: string | null;
  blockedReason: string | null;
}

export interface BaseProductionSlotDto {
  slotId: string;
  siteId: string;
  siteName: string;
  slotIndex: number;
  batchesSinceMaintenance: number;
  maintenanceBlocked: boolean;
  activeJobId: string | null;
}

// 动作 blocker（预览/快照共用结构化原因；不把文案当规则）。
export interface BaseActionBlockerDto {
  type:
    | "material" // 缺料：itemId/required/available/inTransit
    | "facility" // 缺设施前置：facilityId
    | "expansion_quota" // 扩建位配额用尽
    | "device" // 设备被占用：operatorId/conflictJobId
    | "node" // 节点未勘探/耗尽/已有活动采矿单
    | "slot" // 无可用加工槽 / 槽维护停机
    | "site"; // 无空闲建设位
  itemId?: string;
  required?: number;
  available?: number;
  inTransit?: number;
  facilityId?: string;
  operatorId?: string;
  conflictJobId?: string;
  nodeId?: string;
}

export interface SurveyNodeInputDto {
  operatorId: string;
  commandId: string;
  expectedBaseRevision?: number;
}

export interface CreateExtractionJobInputDto {
  nodeId: string;
  batches: number;
  builderOperatorIds: string[];
  haulerOperatorId: string;
  commandId: string;
  expectedBaseRevision?: number;
}

export interface CreateExtractionJobResultDto {
  jobId: string;
  status: ExtractionJobStatus;
  reservedOre: number;
  duplicate: boolean;
}

// pause/cancel 无额外字段；resume 可替换设备（重验）。
export interface ExtractionJobActionInputDto {
  commandId: string;
  expectedBaseRevision?: number;
  builderOperatorIds?: string[];
  haulerOperatorId?: string;
  operatorId?: string;
}

export interface ExtractionJobActionResultDto {
  jobId: string;
  status: ExtractionJobStatus;
  duplicate: boolean;
  releasedOre?: number;
}

export interface PauseManufacturingJobInputDto {
  commandId: string;
  expectedBaseRevision?: number;
}

export interface MaintainSlotInputDto {
  commandId: string;
  expectedBaseRevision?: number;
}

export interface MaintainSlotResultDto {
  slotId: string;
  batchesSinceMaintenance: number;
  duplicate: boolean;
}

export interface PowerPolicyInputDto {
  priority: PowerPolicyPriority;
  commandId: string;
  expectedBaseRevision?: number;
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
  builderCount?: number;
  expectedBaseRevision?: number;
}

export interface CreateProjectResultDto {
  projectId: string;
  duplicate: boolean;
}

export interface BaseClockCommandInputDto {
  command: "pause" | "resume" | "set_speed";
  speed?: number;
}

export interface BaseHeartbeatInputDto {
  action: "acquire" | "renew" | "release";
  controlToken?: string;
}

export interface BaseHeartbeatResultDto {
  controlToken: string | null;
  leaseUntil: string | null;
  timeMode: BaseTimeMode;
}

// 心跳：控制会话每 BASE_LEASE_HINT_MS 续租一次；租期到期基地自动暂停。
export const BASE_LEASE_HINT_MS = 30_000;
export const BASE_LEASE_TTL_MS = 120_000;
// 单次结算最大补算墙钟；超过按上限推进，不把停服时间当生产时间。
export const BASE_MAX_CATCHUP_MS = 10 * 60_000;
export const BASE_SPEEDS = [1, 2, 4] as const;
export type BaseSpeed = (typeof BASE_SPEEDS)[number];
