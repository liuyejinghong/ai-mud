import { randomUUID } from "node:crypto";
import type {
  BaseClockCommandInputDto,
  BaseDeviceDto,
  BaseProjectDto,
  BaseResourceDto,
  BaseResourceReservationSourceDto,
  BaseRobotGroupId,
  BaseSiteDto,
  BaseSnapshotDto,
  CooperationResolutionReason,
  CooperationStatus,
  BaseTimeMode,
  DefinitionRefDto,
  ManufacturingJobStatus,
  ProjectStatus,
  RobotStatus,
  OrderStatus,
  StepKind,
  StepStatus,
  WeatherType
} from "@ai-mud/shared";
import { BASE_LEASE_TTL_MS, BASE_SPEEDS, definitionRefKey } from "@ai-mud/shared";
import type { ErrorCode } from "@ai-mud/shared";
import type {
  AdvanceableBaseRecord,
  BaseDb,
  BaseRecord,
  BaseRepoTx,
  BaseRepository,
  BaseSiteRecord
} from "./base.repository.js";
import { BASE_PROVISION_COMMAND_KIND, hashRequestPayload } from "./base.repository.js";

// M12-A：world 基地子域服务（provision / snapshot / heartbeat / clock command）。
// 语义来源：docs/reviews/base-operations/m12-p-contract.md §3。
// 依赖注入的参与端口（assets/npc/industry/content）在下方以结构等价形状镜像
// application/base/ports.ts 的冻结端口（world 不可反向 import application，
// 由 application 薄壳用例的编译期断言防漂移）；物料/设备/作业者行绝不直写 SQL，
// 只经端口。事务边界：provision 用 db.transaction；快照为纯读。

// ---------- 端口镜像（与 ports.ts 结构等价；tx 形状 = BaseRepoTx = BaseTx） ----------

export interface BaseAssetPort {
  creditBaseInventory(tx: BaseRepoTx, baseId: string, itemId: string, quantity: number): Promise<void>;
  createDeviceAsset(
    tx: BaseRepoTx,
    input: { baseId: string; deviceDefId: string; templateRevision: number; sourceOperation: string }
  ): Promise<{ deviceId: string }>;
  listBaseInventory(
    tx: BaseRepoTx,
    baseId: string
  ): Promise<Array<{ itemId: string; quantity: number; reservedQuantity: number }>>;
}

export interface RobotFactoryPort {
  initializeOperator(
    tx: BaseRepoTx,
    input: {
      deviceId: string;
      baseId: string;
      groupId: string;
      batteryCapacityWh: number;
      initialBatteryWh: number;
    }
  ): Promise<{ operatorId: string }>;
}

export interface BaseIndustryInitPort {
  ensurePowerState(
    tx: BaseRepoTx,
    baseId: string,
    seed: { generationWPeak: number; storageCapacityWh: number; initialStorageWh: number }
  ): Promise<void>;
}

export interface RobotTemplateSpec {
  ref: DefinitionRefDto;
  name: string;
  groupId: string;
  description: string;
  batteryCapacityWh: number;
}

export interface ProjectTemplateSpec {
  ref: DefinitionRefDto;
  name: string;
  description: string;
  // 开工材料需求（内容模板必有；快照原样透出，面板据此显示清单与缺口）。
  inputs: Array<{ itemId: string; quantity: number }>;
}

export interface RecipeTemplateSpec {
  ref: DefinitionRefDto;
  name: string;
  description: string;
  inputs: Array<{ itemId: string; quantity: number }>;
  workPerUnit: number;
  output: { templateStableId: string; initialBatteryWh: number };
}

export interface ProvisionSeedSpec {
  releaseId: string;
  baseName: string;
  power: {
    generationWPeak: number;
    storageCapacityWh: number;
    initialStorageWh: number;
  };
  sites: Array<{ siteKey: string; name: string; state: "free" | "built"; facilityRef?: DefinitionRefDto | undefined }>;
  inventory: Array<{ itemId: string; quantity: number }>;
  devices: Array<{ templateStableId: string; groupId: string; count: number; initialBatteryWh: number }>;
}

// 订单模板端口契约：base.service 只消费 name（快照订单标题）；其余字段由目录层自持。
export interface OrderTemplateSpec {
  ref: DefinitionRefDto;
  name: string;
  description: string;
}

export interface ContentCatalogPort {
  getProvisionSeed(): ProvisionSeedSpec;
  getItemInfo(): Record<string, { name: string; description: string }>;
  getRecipeTemplate(stableId: string, revision?: number): RecipeTemplateSpec | null;
  listRecipes(): RecipeTemplateSpec[];
  getOrderTemplate(stableId: string): OrderTemplateSpec | null;
  listOrderTemplates(): OrderTemplateSpec[];
  getRobotTemplate(stableId: string): RobotTemplateSpec | null;
  getFacilityInfo(stableId: string): {
    name: string;
    note: string;
    description: string;
    attributes: Array<{ label: string; value: string }>;
  } | null;
  getRobotTemplate(stableId: string): RobotTemplateSpec | null;
  getProjectTemplate(stableId: string): ProjectTemplateSpec | null;
  listTemplates(): { robots: RobotTemplateSpec[]; projects: ProjectTemplateSpec[] };
}

export interface BaseIndustryReadPort {
  getPowerState(baseId: string): Promise<{
    generationWPeak: number;
    storageWh: number;
    storageCapacityWh: number;
    lastLoadW: number;
    dustLevel: number;
  } | null>;
  listProjects(baseId: string): Promise<
    Array<{
      id: string;
      projectDefId: string;
      templateRevision: number;
      status: string;
      currentStepIndex: number;
      siteId: string;
      reservedInputs: Array<{ itemId: string; quantity: number }>;
    }>
  >;
  listSteps(projectIds: string[]): Promise<
    Array<{
      projectId: string;
      stepIndex: number;
      kind: string;
      groupId: string;
      status: string;
      workRequired: number;
      workDone: number;
      blockedReason: string | null;
    }>
  >;
}

export interface BaseRobotReadPort {
  listOperators(baseId: string): Promise<
    Array<{
      operatorId: string;
      deviceId: string;
      deviceDefId: string;
      groupId: string;
      batteryWh: number;
      batteryCapacityWh: number;
      status: string;
      currentProjectId: string | null;
      currentStepIndex: number | null;
    }>
  >;
}

export interface BaseServiceDeps {
  db: BaseDb;
  clock: { now(): Date };
  repo: BaseRepository;
  settleConfirmedThrough(tx: BaseRepoTx, baseId: string, at: Date): Promise<void>;
  assets: BaseAssetPort;
  robots: RobotFactoryPort;
  industryInit: BaseIndustryInitPort;
  catalog: ContentCatalogPort;
  catalogResolver?: {
    forProvision(): ContentCatalogPort;
    forBase(tx: BaseRepoTx, baseId: string): Promise<ContentCatalogPort>;
  };
  industryRead: BaseIndustryReadPort;
  robotRead: BaseRobotReadPort;
  economyRead: {
    getCredits(baseId: string): Promise<number>;
    listOrdersForBase(baseId: string): Promise<
      Array<{
        id: string;
        orderDefId: string;
        orderRevision: number;
        status: string;
        requiredItemId: string;
        quantity: number;
        rewardCredits: number;
        deadlineSim: Date | null;
        acceptedAtSim: Date | null;
      }>
    >;
    listPurchasesForBase(baseId: string): Promise<
      Array<{
        id: string;
        itemId: string;
        quantity: number;
        costCredits: number;
        status: string;
        arrivesAtSim: Date;
      }>
    >;
  };
  cooperationRead: {
    listByBase(baseId: string): Promise<
      Array<{
        id: string;
        projectId: string;
        stepIndex: number;
        fromGroupId: string;
        helperGroupId: string;
        status: string;
        resolutionReason: CooperationResolutionReason | null;
        helperOperatorId: string | null;
        question: string;
        createdAt: Date | null;
      }>
    >;
    previewPending?(tx: BaseRepoTx, baseId: string, requestId: string): Promise<{
      operatorId: string;
      groupId: string;
      batteryWh: number;
      batteryCapacityWh: number;
    } | null>;
  };
  weather?: {
    current(baseId: string, simTime: Date): Promise<{
      current: WeatherType;
      lightFactor: number;
      nextChangeAt: Date;
      nextWeather: WeatherType;
    }>;
  };
  manufacturingRead: {
    listJobsForBase(baseId: string): Promise<
      Array<{
        id: string;
        recipeDefId: string;
        recipeRevision: number;
        status: string;
        outputsPlanned: number;
        outputsDone: number;
        currentUnitWorkDone: number;
        blockedReason: string | null;
        // 剩余预留（结算逐台递减；快照占用来源投影用）。manufacturing.repository
        // 的 ManufacturingJobRecord 已含此列，组合根原样透传，无需适配。
        reservedInputs: Array<{ itemId: string; quantity: number }>;
      }>
    >;
  };
}

// 占用来源只统计仍持有预留的持有者：项目终态（completed/cancelled/failed，与
// construction.service TERMINAL_PROJECT_STATUSES 对齐——完成已消耗、取消已释放）
// 与工单终态（completed/cancelled，与 manufacturing.service 对齐）不再计入。
const RESERVATION_TERMINAL_PROJECT_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "cancelled",
  "failed"
]);
const RESERVATION_TERMINAL_JOB_STATUSES: ReadonlySet<string> = new Set(["completed", "cancelled"]);

// 领域错误：code 为 shared ErrorCode。transport 不 import 本类，
// 靠 { code, message } 形状识别（见 base-session.routes.ts）。
export class BaseOperationError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
    this.name = "BaseOperationError";
  }
}

export class BaseService {
  constructor(private readonly deps: BaseServiceDeps) {}

  // 有 transaction 则开事务并为 repo 重绑 tx；否则（测试替身）直用当前 repo。
  private transact<T>(operation: (tx: BaseRepoTx, repo: BaseRepository) => Promise<T>): Promise<T> {
    const { db, repo } = this.deps;
    if (typeof db.transaction !== "function") {
      return operation(db as BaseRepoTx, repo);
    }
    return db.transaction(async (tx) =>
      operation(tx as unknown as BaseRepoTx, repo.forTransaction(tx as unknown as BaseRepoTx))
    );
  }

  private async requireBaseId(tx: BaseRepoTx, repo: BaseRepository, accountId: string): Promise<string> {
    const baseId = await repo.findBaseIdByAccount(tx, accountId);
    if (!baseId) {
      // 不泄漏其他账号基地的存在性（合同 S2）。
      throw new BaseOperationError("BASE_SCOPE_INVALID", "账号没有可访问的基地。");
    }
    return baseId;
  }

  // ---------- provision：账号作用域收据 + 全链种子装配 ----------

  async provision(
    principal: { accountId: string },
    input: { commandId: string }
  ): Promise<{ baseId: string; duplicate: boolean }> {
    return this.transact(async (tx, repo) => {
      const actorScope = `account:${principal.accountId}`;
      const requestHash = hashRequestPayload({});

      const existing = await repo.findReceiptForUpdate(
        tx,
        actorScope,
        BASE_PROVISION_COMMAND_KIND,
        input.commandId
      );
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new BaseOperationError("IDEMPOTENCY_CONFLICT", "同一命令ID对应了不同请求。");
        }
        const replay = existing.result as { baseId?: unknown } | null;
        if (!replay || typeof replay.baseId !== "string") {
          throw new BaseOperationError("IDEMPOTENCY_CONFLICT", "命令收据缺少可重放结果。");
        }
        // 幂等重放不补建设备/作业者/物资（合同 §3.6）。
        return { baseId: replay.baseId, duplicate: true };
      }

      const claimed = await repo.claimReceipt(tx, {
        actorScope,
        commandKind: BASE_PROVISION_COMMAND_KIND,
        commandId: input.commandId,
        requestHash
      });
      if (!claimed) {
        throw new BaseOperationError("IDEMPOTENCY_CONFLICT", "命令正在处理中，请稍后重试。");
      }

      // 账号级幂等：收据按 commandId 区分，但基地按账号唯一。已有基地的账号换了
      // 新 commandId（如再次注册/登录触发的 provision）必须收敛回原基地，
      // 不能再插一行撞 bases_account_id_unique。与收据重放一样不补种设备/物资。
      const ownedBaseId = await repo.findBaseIdByAccount(tx, principal.accountId);
      if (ownedBaseId !== null) {
        const result = { baseId: ownedBaseId, duplicate: true };
        await repo.saveReceiptResult(tx, {
          actorScope,
          commandKind: BASE_PROVISION_COMMAND_KIND,
          commandId: input.commandId,
          result
        });
        return result;
      }

      const now = this.deps.clock.now();
      const catalog = this.deps.catalogResolver?.forProvision() ?? this.deps.catalog;
      const seed = catalog.getProvisionSeed();
      const simTime = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8));

      const baseId = await repo.insertBase(tx, {
        accountId: principal.accountId,
        name: seed.baseName,
        contentRelease: seed.releaseId,
        timeMode: "paused",
        speed: 1,
        simTime,
        lastAdvancedAt: now
      });

      for (const site of seed.sites) {
        await repo.insertSite(tx, {
          baseId,
          siteKey: site.siteKey,
          state: site.state,
          builtFacilityRef: site.facilityRef ? definitionRefKey(site.facilityRef) : null
        });
      }

      await this.deps.industryInit.ensurePowerState(tx, baseId, seed.power);

      for (const item of seed.inventory) {
        await this.deps.assets.creditBaseInventory(tx, baseId, item.itemId, item.quantity);
      }

      for (const device of seed.devices) {
        const template = catalog.getRobotTemplate(device.templateStableId);
        if (!template) {
          throw new BaseOperationError(
            "CONTENT_INCOMPATIBLE",
            `种子引用了未知机器人模板：${device.templateStableId}`
          );
        }
        for (let index = 1; index <= device.count; index += 1) {
          // 唯一索引 (source_operation, device_def_id) 要求每台设备实例可区分，
          // 故 sourceOperation 带模板与序号后缀；provision:${accountId} 为其公共前缀。
          const { deviceId } = await this.deps.assets.createDeviceAsset(tx, {
            baseId,
            deviceDefId: device.templateStableId,
            templateRevision: template.ref.revision,
            sourceOperation: `provision:${principal.accountId}:${device.templateStableId}:${index}`
          });
          await this.deps.robots.initializeOperator(tx, {
            deviceId,
            baseId,
            groupId: template.groupId,
            batteryCapacityWh: template.batteryCapacityWh,
            initialBatteryWh: device.initialBatteryWh
          });
        }
      }

      const result = { baseId, duplicate: false };
      await repo.saveReceiptResult(tx, {
        actorScope,
        commandKind: BASE_PROVISION_COMMAND_KIND,
        commandId: input.commandId,
        result
      });
      return result;
    });
  }

  // ---------- snapshot：观察投影（纯读） ----------

  async snapshot(principal: { accountId: string }, controlToken?: string): Promise<BaseSnapshotDto> {
    return this.transact(async (tx, repo) => {
      const now = this.deps.clock.now();
      const base = await repo.getBaseByAccount(tx, principal.accountId);
      if (!base) {
        throw new BaseOperationError("BASE_SCOPE_INVALID", "账号没有可访问的基地。");
      }
      const baseId = base.id;
      const catalog = this.deps.catalogResolver
        ? await this.deps.catalogResolver.forBase(tx, baseId)
        : this.deps.catalog;

      const sites = await repo.listSites(tx, baseId);
      const inventory = await this.deps.assets.listBaseInventory(tx, baseId);
      const lease = await repo.getControlLease(tx, baseId);
      const powerRecord = await this.deps.industryRead.getPowerState(baseId);
      const projectRecords = await this.deps.industryRead.listProjects(baseId);
      const stepRecords =
        projectRecords.length > 0
          ? await this.deps.industryRead.listSteps(projectRecords.map((project) => project.id))
          : [];
      const operators = await this.deps.robotRead.listOperators(baseId);
      const jobRecords = await this.deps.manufacturingRead.listJobsForBase(baseId);

      const seed = catalog.getProvisionSeed();
      const siteNames = new Map(seed.sites.map((site) => [site.siteKey, site.name]));
      const itemInfo = catalog.getItemInfo();

      const siteDtos: BaseSiteDto[] = sites.map((site: BaseSiteRecord) => {
        const facility =
          site.state === "built" && site.builtFacilityRef
            ? catalog.getFacilityInfo(site.builtFacilityRef.split(":")[1]?.split("@")[0] ?? "")
            : null;
        return {
          siteId: site.id,
          siteKey: site.siteKey,
          name: siteNames.get(site.siteKey) ?? site.siteKey,
          state: site.state,
          note: facility?.note ?? null,
          description: facility?.description ?? null,
          attributes: facility?.attributes ?? []
        };
      });

      // 占用来源投影（M 合同）：总量/占用事实只在 base_inventory（assets 唯一写者）；
      // 这里把同基地仍持有预留的项目/工单（非终态）映射到物品，不构成第二套库存，
      // 也不与 reservedQuantity 对账（终态行的持久 reserved_inputs 是历史值，剔除）。
      const reservationSources = new Map<string, BaseResourceReservationSourceDto[]>();
      const collectSources = (itemId: string, source: BaseResourceReservationSourceDto) => {
        const bucket = reservationSources.get(itemId);
        if (bucket) bucket.push(source);
        else reservationSources.set(itemId, [source]);
      };
      for (const project of projectRecords) {
        if (RESERVATION_TERMINAL_PROJECT_STATUSES.has(project.status)) continue;
        const name = catalog.getProjectTemplate(project.projectDefId)?.name ?? project.projectDefId;
        for (const item of project.reservedInputs) {
          collectSources(item.itemId, { kind: "project", id: project.id, name, quantity: item.quantity });
        }
      }
      for (const job of jobRecords) {
        if (RESERVATION_TERMINAL_JOB_STATUSES.has(job.status)) continue;
        const name = catalog.getRecipeTemplate(job.recipeDefId, job.recipeRevision)?.name ?? job.recipeDefId;
        for (const item of job.reservedInputs) {
          collectSources(item.itemId, { kind: "manufacturing", id: job.id, name, quantity: item.quantity });
        }
      }

      const resources: BaseResourceDto[] = inventory.map((row) => ({
        itemId: row.itemId,
        name: itemInfo[row.itemId]?.name ?? row.itemId,
        description: itemInfo[row.itemId]?.description ?? "",
        quantity: row.quantity,
        reservedQuantity: row.reservedQuantity,
        reservationSources: reservationSources.get(row.itemId) ?? []
      }));

      const devices: BaseDeviceDto[] = operators.map((operator) => {
        const template = catalog.getRobotTemplate(operator.deviceDefId);
        return {
          deviceId: operator.deviceId,
          operatorId: operator.operatorId,
          name: template?.name ?? operator.deviceDefId,
          groupId: operator.groupId as BaseRobotGroupId,
          description: template?.description ?? "",
          status: operator.status as RobotStatus,
          batteryWh: operator.batteryWh,
          batteryCapacityWh: operator.batteryCapacityWh,
          currentAssignment:
            operator.currentProjectId !== null && operator.currentStepIndex !== null
              ? { projectId: operator.currentProjectId, stepIndex: operator.currentStepIndex }
              : null
        };
      });

      const projects: BaseProjectDto[] = projectRecords.map((project) => ({
        projectId: project.id,
        definitionRef: {
          kind: "project",
          stableId: project.projectDefId,
          revision: project.templateRevision
        },
        name: catalog.getProjectTemplate(project.projectDefId)?.name ?? project.projectDefId,
        status: project.status as ProjectStatus,
        siteId: project.siteId,
        steps: stepRecords
          .filter((step) => step.projectId === project.id)
          .sort((a, b) => a.stepIndex - b.stepIndex)
          .map((step) => ({
            index: step.stepIndex,
            kind: step.kind as StepKind,
            groupId: step.groupId as BaseRobotGroupId,
            status: step.status as StepStatus,
            workRequired: step.workRequired,
            workDone: step.workDone,
            blockedReason: step.blockedReason
          }))
      }));

      const cooperationRequests = await Promise.all(
        (await this.deps.cooperationRead.listByBase(baseId)).map(async (request) => ({
          requestId: request.id,
          projectId: request.projectId,
          projectName: projects.find((project) => project.projectId === request.projectId)?.name ?? "",
          stepIndex: request.stepIndex,
          fromGroupId: request.fromGroupId,
          helperGroupId: request.helperGroupId,
          status: request.status as CooperationStatus,
          resolutionReason: request.resolutionReason,
          helperOperatorId: request.helperOperatorId,
          proposedHelper: request.status === "pending" && this.deps.cooperationRead.previewPending
            ? await this.deps.cooperationRead.previewPending(tx, baseId, request.id)
            : null,
          question: request.question,
          createdAt: request.createdAt?.toISOString() ?? ""
        }))
      );
      const unavailableProjects = new Set(
        projectRecords
          .filter((project) => project.status !== "cancelled" && project.status !== "failed")
          .map((project) => project.projectDefId)
      );

      return {
        name: base.name,
        baseId: base.id,
        epoch: base.epoch,
        baseRevision: base.baseRevision,
        simTime: base.simTime.toISOString(),
        timeMode: base.timeMode,
        speed: base.speed,
        activeContentRelease: base.contentRelease,
        power: {
          // v0.12 电力事实无独立 availableW 记录，快照回显峰值出力；结算语义在 industry。
          generationWPeak: powerRecord?.generationWPeak ?? 0,
          availableW: powerRecord?.generationWPeak ?? 0,
          storageWh: powerRecord?.storageWh ?? 0,
          storageCapacityWh: powerRecord?.storageCapacityWh ?? 0,
          loadW: powerRecord?.lastLoadW ?? 0
        },
        resources,
        sites: siteDtos,
        devices,
        projects,
        buildableProjects: catalog.listTemplates().projects
          .filter((project) => !unavailableProjects.has(project.ref.stableId))
          .map((project) => ({
            definitionRef: project.ref,
            name: project.name,
            description: project.description,
            inputs: project.inputs.map((input) => ({ itemId: input.itemId, quantity: input.quantity }))
          })),
        availableRecipes: catalog.listRecipes().map((recipe) => ({
          ref: recipe.ref,
          name: recipe.name,
          description: recipe.description,
          inputs: recipe.inputs.map((input) => ({ ...input })),
          workPerUnit: recipe.workPerUnit,
          output: { ...recipe.output }
        })),
        weather: {
          ...(this.deps.weather
            ? await this.deps.weather.current(baseId, base.simTime).then((weather) => ({
                ...weather,
                nextChangeAt: weather.nextChangeAt.toISOString()
              }))
            : {
                current: "clear" as WeatherType,
                lightFactor: 1.0,
                nextChangeAt: base.simTime.toISOString(),
                nextWeather: "clear" as WeatherType
              }),
          dustLevel: powerRecord?.dustLevel ?? 30
        },
        credits: await this.deps.economyRead.getCredits(baseId),
        orders: (
          await this.deps.economyRead.listOrdersForBase(baseId)
        ).map((order) => {
          const template = catalog.getOrderTemplate(order.orderDefId);
          return {
            orderId: order.id,
            orderRef: { kind: "order" as const, stableId: order.orderDefId, revision: order.orderRevision },
            name: template?.name ?? order.orderDefId,
            status: order.status as OrderStatus,
            requiredItemId: order.requiredItemId,
            requiredItemName:
              catalog.getItemInfo()[order.requiredItemId]?.name ?? order.requiredItemId,
            quantity: order.quantity,
            rewardCredits: order.rewardCredits,
            deadlineSim: order.deadlineSim?.toISOString() ?? null,
            acceptedAtSim: order.acceptedAtSim?.toISOString() ?? null
          };
        }),
        purchases: (await this.deps.economyRead.listPurchasesForBase(baseId)).map((purchase) => ({
          purchaseId: purchase.id,
          itemId: purchase.itemId,
          itemName: catalog.getItemInfo()[purchase.itemId]?.name ?? purchase.itemId,
          quantity: purchase.quantity,
          costCredits: purchase.costCredits,
          status: purchase.status as "in_transit" | "delivered",
          arrivesAtSim: purchase.arrivesAtSim.toISOString()
        })),
        cooperationRequests,
        manufacturingJobs: jobRecords.map(
          (job) => ({
            jobId: job.id,
            recipeRef: {
              kind: "recipe" as const,
              stableId: job.recipeDefId,
              revision: job.recipeRevision
            },
            recipeName:
              catalog.getRecipeTemplate(job.recipeDefId, job.recipeRevision)?.name ?? job.recipeDefId,
            status: job.status as ManufacturingJobStatus,
            outputsPlanned: job.outputsPlanned,
            outputsDone: job.outputsDone,
            currentUnitWorkDone: job.currentUnitWorkDone,
            blockedReason: job.blockedReason
          })
        ),
        controlLease: {
          heldByThisSession: !!lease && lease.leaseUntil.getTime() > now.getTime() && lease.leaseToken === controlToken,
          controlActive: !!lease && lease.leaseUntil.getTime() > now.getTime(),
          leaseUntil: lease ? lease.leaseUntil.toISOString() : null
        }
      };
    });
  }

  // ---------- clock：服务端确认的前台控制段 ----------

  async heartbeat(
    principal: { accountId: string },
    input: { action: "acquire" | "renew" | "release"; controlToken?: string | null }
  ): Promise<{ controlToken: string | null; leaseUntil: string | null; timeMode: BaseTimeMode }> {
    return this.transact(async (tx, repo) => {
      const now = this.deps.clock.now();
      const base = await this.requireBaseRecord(tx, repo, principal.accountId);

      if (input.action === "acquire") {
        // 旧标签只结清最后一次确认前的时间；断档从本次取得控制权开始。
        await this.deps.settleConfirmedThrough(tx, base.id, now);
        const current = await this.alignClock(tx, repo, base.id, now);
        const controlToken = randomUUID();
        const leaseUntil = new Date(now.getTime() + BASE_LEASE_TTL_MS);
        await repo.upsertControlLease(tx, { baseId: base.id, leaseToken: controlToken, leaseUntil, updatedAt: now });
        return { controlToken, leaseUntil: leaseUntil.toISOString(), timeMode: current.timeMode };
      }

      const lease = await this.requireActiveControl(tx, repo, base.id, input.controlToken, now);
      if (input.action === "renew") {
        const leaseUntil = new Date(now.getTime() + BASE_LEASE_TTL_MS);
        await repo.upsertControlLease(tx, {
          baseId: base.id,
          leaseToken: lease.leaseToken,
          leaseUntil,
          updatedAt: new Date(Math.max(now.getTime(), lease.updatedAt.getTime()))
        });
        return { controlToken: lease.leaseToken, leaseUntil: leaseUntil.toISOString(), timeMode: base.timeMode };
      }
      if (input.action !== "release") throw new BaseOperationError("VALIDATION_ERROR", "未知的控制命令。");

      // 正常离开可确认到服务端收到 release 的时点；丢包时仍止于最后一次 renew。
      await repo.upsertControlLease(tx, {
        baseId: base.id,
        leaseToken: lease.leaseToken,
        leaseUntil: new Date(now.getTime() + BASE_LEASE_TTL_MS),
        updatedAt: now
      });
      await this.deps.settleConfirmedThrough(tx, base.id, now);
      const current = await this.alignClock(tx, repo, base.id, now);
      await repo.clearControlLease(tx, base.id, lease.leaseToken);
      return { controlToken: null, leaseUntil: null, timeMode: current.timeMode };
    });
  }

  async applyCommand(
    principal: { accountId: string },
    input: BaseClockCommandInputDto,
    controlToken?: string
  ): Promise<{ timeMode: BaseTimeMode; speed: number; simTime: string }> {
    return this.transact(async (tx, repo) => {
      const now = this.deps.clock.now();
      const base = await this.requireBaseRecord(tx, repo, principal.accountId);
      if (input.command === "set_speed" &&
          (input.speed === undefined || !(BASE_SPEEDS as readonly number[]).includes(input.speed))) {
        throw new BaseOperationError("VALIDATION_ERROR", "不支持的倍速，允许值：1、2、4。");
      }
      if (input.command !== "pause" && input.command !== "resume" && input.command !== "set_speed") {
        throw new BaseOperationError("VALIDATION_ERROR", "未知的时钟命令。");
      }
      const lease = await this.requireActiveControl(tx, repo, base.id, controlToken, now);
      await repo.upsertControlLease(tx, {
        baseId: base.id,
        leaseToken: lease.leaseToken,
        leaseUntil: new Date(now.getTime() + BASE_LEASE_TTL_MS),
        updatedAt: now
      });
      if (base.timeMode === "running") await this.deps.settleConfirmedThrough(tx, base.id, now);
      const current = await repo.getBaseForUpdate(tx, base.id);
      if (!current) throw new BaseOperationError("BASE_SCOPE_INVALID", "账号没有可访问的基地。");

      let timeMode = current.timeMode;
      let speed = current.speed;

      if (input.command === "pause") {
        timeMode = "paused";
      } else if (input.command === "resume") {
        timeMode = "running";
      } else if (input.command === "set_speed") {
        speed = input.speed!;
      }

      const advanced = await repo.updateBaseClock(tx, {
        baseId: base.id,
        expectedBaseRevision: current.baseRevision,
        timeMode,
        speed,
        lastAdvancedAt: new Date(Math.max(now.getTime(), current.lastAdvancedAt.getTime()))
      });
      if (!advanced) {
        throw new BaseOperationError("REVISION_EXPIRED", "基地状态已变化，请刷新后重试。");
      }

      return { timeMode, speed, simTime: current.simTime.toISOString() };
    });
  }

  private async requireActiveControl(
    tx: BaseRepoTx,
    repo: BaseRepository,
    baseId: string,
    controlToken: string | null | undefined,
    now: Date
  ) {
    const lease = await repo.getControlLease(tx, baseId);
    if (!controlToken || !lease || lease.leaseToken !== controlToken || lease.leaseUntil.getTime() <= now.getTime()) {
      throw new BaseOperationError("CONTROL_EXPIRED" as ErrorCode, "当前标签已失去基地控制权，请刷新后重试。");
    }
    return lease;
  }

  private async alignClock(tx: BaseRepoTx, repo: BaseRepository, baseId: string, now: Date): Promise<BaseRecord> {
    const current = await repo.getBaseForUpdate(tx, baseId);
    if (!current) throw new BaseOperationError("BASE_SCOPE_INVALID", "账号没有可访问的基地。");
    const aligned = await repo.updateBaseClock(tx, {
      baseId,
      expectedBaseRevision: current.baseRevision,
      timeMode: current.timeMode,
      speed: current.speed,
      lastAdvancedAt: new Date(Math.max(now.getTime(), current.lastAdvancedAt.getTime()))
    });
    if (!aligned) throw new BaseOperationError("REVISION_EXPIRED", "基地状态已变化，请刷新后重试。");
    return current;
  }

  private async requireBaseRecord(
    tx: BaseRepoTx,
    repo: BaseRepository,
    accountId: string
  ): Promise<BaseRecord> {
    const baseId = await this.requireBaseId(tx, repo, accountId);
    const base = await repo.getBaseForUpdate(tx, baseId);
    if (!base) {
      throw new BaseOperationError("BASE_SCOPE_INVALID", "账号没有可访问的基地。");
    }
    return base;
  }
}

// AdvanceableBaseRecord 与 ports.ts AdvanceableBaseDto 的形状契约由使用方
// （composition / I 线）绑定；本模块不反向 import application。
export type { AdvanceableBaseRecord };
