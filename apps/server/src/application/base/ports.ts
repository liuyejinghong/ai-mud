import type {
  BaseClockCommandInputDto,
  BaseSnapshotDto,
  BaseTimeMode,
  CreateProjectInputDto,
  CreateProjectResultDto,
  DefinitionRefDto,
  ProjectTemplateDto,
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

export interface ContentCatalogPort {
  releaseId(): string;
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
  createPlaytestAccount(input: { email: string; password: string }): Promise<{ accountId: string }>;
}

export interface ProvisionUseCase {
  execute(principal: BasePrincipal, input: { commandId: string }): Promise<{
    baseId: string;
    duplicate: boolean;
  }>;
}

export interface SnapshotUseCase {
  execute(principal: BasePrincipal, query: { sessionLeaseToken?: string }): Promise<BaseSnapshotDto>;
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
  heartbeat(principal: BasePrincipal, input: { leaseToken: string }): Promise<ClockHeartbeatResultDto>;
  applyCommand(principal: BasePrincipal, input: BaseClockCommandInputDto): Promise<ClockCommandResultDto>;
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
