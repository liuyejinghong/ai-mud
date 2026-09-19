import type {
  BaseClockCommandInputDto,
  BaseSnapshotDto,
  BaseTimeMode,
  CreateProjectInputDto,
  CreateProjectResultDto,
  DefinitionRefDto,
  OrderTemplateDto,
  ProjectTemplateDto,
  RecipeTemplateDto,
  RobotTemplateDto
} from "@ai-mud/shared";
import type { Db } from "../../db/client.js";

// M12-P 冻结的基地用例端口（contractVersion 0.12.0-p1）。
// 语义见 docs/reviews/base-operations/contracts.md §5；文件归属见 ownership.json。
// 事务绑定端口（BaseAssetPort/RobotFactoryPort）：实现方在 assets/npc 模块
// （ACP-B01 边），方法必须在调用方事务内执行，实现自身不得开启或提交事务。

export type BaseTx = Pick<Db, "delete" | "insert" | "select" | "update">;

export interface BasePrincipal {
  accountId: string;
}

// ---------- 内容目录（content-catalog 提供；v0.12 只读内置 release） ----------

export interface ProvisionSeedInputDto {
  itemId: string;
  quantity: number;
}

export interface ProvisionSeedDeviceDto {
  templateStableId: string;
  groupId: string;
  count: number;
  initialBatteryWh: number;
}

export interface ProvisionSeedSiteDto {
  siteKey: string;
  name: string;
  state: "free" | "built";
  facilityRef?: DefinitionRefDto;
}

export interface ProvisionSeedDto {
  releaseId: string;
  baseName: string;
  power: {
    generationWPeak: number;
    storageCapacityWh: number;
    initialStorageWh: number;
  };
  sites: ProvisionSeedSiteDto[];
  inventory: ProvisionSeedInputDto[];
  devices: ProvisionSeedDeviceDto[];
}

export interface BaseFacilityInfoDto {
  name: string;
  note: string;
  description: string;
  attributes: Array<{ label: string; value: string }>;
}

export interface ContentCatalogPort {
  releaseId(): string;
  getItemInfo(): Record<string, { name: string; description: string }>;
  getRecipeTemplate(stableId: string): RecipeTemplateDto | null;
  listRecipes(): RecipeTemplateDto[];
  getOrderTemplate(stableId: string): OrderTemplateDto | null;
  listOrderTemplates(): OrderTemplateDto[];
  getFacilityInfo(stableId: string): BaseFacilityInfoDto | null;
  getRobotTemplate(stableId: string): RobotTemplateDto | null;
  getProjectTemplate(stableId: string): ProjectTemplateDto | null;
  listTemplates(): { robots: RobotTemplateDto[]; projects: ProjectTemplateDto[] };
  getProvisionSeed(): ProvisionSeedDto;
}

// ---------- assets 参与端口（事务绑定） ----------

export interface BaseAssetPort {
  creditBaseInventory(tx: BaseTx, baseId: string, itemId: string, quantity: number): Promise<void>;
  reserveBaseInventoryIfAvailable(
    tx: BaseTx,
    baseId: string,
    itemId: string,
    quantity: number
  ): Promise<boolean>;
  consumeReservedBaseInventory(
    tx: BaseTx,
    baseId: string,
    itemId: string,
    quantity: number
  ): Promise<void>;
  releaseReservedBaseInventory(
    tx: BaseTx,
    baseId: string,
    itemId: string,
    quantity: number
  ): Promise<void>;
  listBaseInventory(
    tx: BaseTx,
    baseId: string
  ): Promise<Array<{ itemId: string; quantity: number; reservedQuantity: number }>>;
  createDeviceAsset(
    tx: BaseTx,
    input: { baseId: string; deviceDefId: string; templateRevision: number; sourceOperation: string }
  ): Promise<{ deviceId: string }>;
  findDeviceAssetBySourceOperation(
    tx: BaseTx,
    input: { sourceOperation: string; deviceDefId: string }
  ): Promise<{ deviceId: string } | null>;
}

// ---------- npc 作业者登记端口（事务绑定；运行期状态经 robot-runtime，由 industry 内部使用） ----------

export interface RobotFactoryPort {
  initializeOperator(
    tx: BaseTx,
    input: {
      deviceId: string;
      baseId: string;
      groupId: string;
      batteryCapacityWh: number;
      initialBatteryWh: number;
    }
  ): Promise<{ operatorId: string }>;
}

// ---------- 路由依赖（transport 只 import application/protocol/platform/kernel） ----------

export interface BaseAuthFacade {
  resolvePrincipal(sessionToken: string): Promise<BasePrincipal | null>;
  verifyCsrf(sessionToken: string, csrfToken: string): boolean;
}

export interface PlaytestRegistrationFacade {
  checkRateLimit(input: { email: string; ip: string }): Promise<{ ok: boolean; retryAfterSeconds: number }>;
  createPlaytestAccount(input: {
    email: string;
    password: string;
  }): Promise<{ accountId: string; email: string; sessionToken: string; csrfToken: string }>;
}

// world：账号 → 初始基地（一账号一基地）
export interface BaseLookupPort {
  findBaseIdByAccount(tx: BaseTx, accountId: string): Promise<string | null>;
}

export interface ProvisionUseCase {
  execute(principal: BasePrincipal, input: { commandId: string }): Promise<{
    baseId: string;
    duplicate: boolean;
  }>;
}

export interface SnapshotUseCase {
  execute(principal: BasePrincipal): Promise<BaseSnapshotDto>;
}

export interface ClockHeartbeatResultDto {
  leaseUntil: string;
  timeMode: BaseTimeMode;
}

export interface ClockCommandResultDto {
  timeMode: BaseTimeMode;
  speed: number;
  simTime: string;
}

export interface ClockUseCase {
  heartbeat(principal: BasePrincipal): Promise<ClockHeartbeatResultDto>;
  applyCommand(principal: BasePrincipal, input: BaseClockCommandInputDto): Promise<ClockCommandResultDto>;
}

// ---------- 跨线只读/事务绑定端口（world/industry/npc 各自实现，I 负责绑定） ----------

// world：结算推进的时钟政策（running + 租约有效 + 追补上限）封装在此端口实现内。
export interface AdvanceableBaseDto {
  baseId: string;
  simTime: Date;
  speed: number;
  deltaSimMs: number;
}

export interface BaseClockStorePort {
  lockAdvanceableBases(tx: BaseTx, now: Date): Promise<AdvanceableBaseDto[]>;
  saveSimAdvance(tx: BaseTx, baseId: string, simTime: Date, lastAdvancedAt: Date): Promise<void>;
}

export interface BaseSiteRecordDto {
  id: string;
  siteKey: string;
  state: "free" | "reserved" | "built";
  builtFacilityRef: string | null;
}

export interface BaseSiteStorePort {
  getSite(tx: BaseTx, baseId: string, siteId: string): Promise<BaseSiteRecordDto | null>;
  markSiteReserved(tx: BaseTx, siteId: string): Promise<void>;
  markSiteBuilt(tx: BaseTx, siteId: string, facilityRef: string): Promise<void>;
  releaseSite(tx: BaseTx, siteId: string): Promise<void>;
  listSites(tx: BaseTx, baseId: string): Promise<BaseSiteRecordDto[]>;
}

export interface BaseIndustryInitPort {
  ensurePowerState(
    tx: BaseTx,
    baseId: string,
    seed: { generationWPeak: number; storageCapacityWh: number; initialStorageWh: number }
  ): Promise<void>;
}

export interface BasePowerRecordDto {
  generationWPeak: number;
  storageWh: number;
  storageCapacityWh: number;
  lastLoadW: number;
  dustLevel: number;
}

export interface BaseIndustryProjectRecordDto {
  id: string;
  projectDefId: string;
  templateRevision: number;
  status: string;
  currentStepIndex: number;
  siteId: string;
  reservedInputs: Array<{ itemId: string; quantity: number }>;
}

export interface BaseIndustryStepRecordDto {
  projectId: string;
  stepIndex: number;
  kind: string;
  groupId: string;
  status: string;
  workRequired: number;
  workDone: number;
  blockedReason: string | null;
}

export interface BaseIndustryReadPort {
  getPowerState(baseId: string): Promise<BasePowerRecordDto | null>;
  listProjects(baseId: string): Promise<BaseIndustryProjectRecordDto[]>;
  listSteps(projectIds: string[]): Promise<BaseIndustryStepRecordDto[]>;
}

export interface BaseRobotRecordDto {
  operatorId: string;
  deviceId: string;
  deviceDefId: string;
  groupId: string;
  batteryWh: number;
  batteryCapacityWh: number;
  status: string;
  currentProjectId: string | null;
  currentStepIndex: number | null;
}

export interface BaseRobotReadPort {
  listOperators(baseId: string): Promise<BaseRobotRecordDto[]>;
}

export interface CancelProjectResultDto {
  cancelled: boolean;
  duplicate: boolean;
  completed: boolean;
  releasedInputs: Array<{ itemId: string; quantity: number }>;
}

export interface CreateProjectUseCase {
  execute(principal: BasePrincipal, input: CreateProjectInputDto): Promise<CreateProjectResultDto>;
}

export interface CancelProjectUseCase {
  execute(
    principal: BasePrincipal,
    input: { projectId: string; commandId: string }
  ): Promise<CancelProjectResultDto>;
}

export interface BaseSessionRouteDeps {
  auth: BaseAuthFacade;
  registration: PlaytestRegistrationFacade;
  provision: ProvisionUseCase;
  snapshot: SnapshotUseCase;
  clock: ClockUseCase;
}

export interface BaseProjectsRouteDeps {
  auth: BaseAuthFacade;
  create: CreateProjectUseCase;
  cancel: CancelProjectUseCase;
}
