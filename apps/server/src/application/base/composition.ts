import type { Env } from "../../config/env.js";
import type { Db } from "../../db/client.js";
import {
  LANDING_BASE_CONTENT_RELEASE,
  LANDING_BASE_RELEASE_ID,
  TUTORIAL_BASE_CONTENT_RELEASE
} from "@ai-mud/content";
import { DrizzleAuditWriter } from "../../modules/audit/audit.repository.js";
import { AuthRepository } from "../../modules/auth/auth.repository.js";
import type { FastifyRequest } from "fastify";
import { AuthService } from "../../modules/auth/auth.service.js";
import { AssetMutationService } from "../../modules/ledger/asset-mutation.service.js";
import { BaseAssetService } from "../../modules/ledger/base-asset.service.js";
import { createContentCatalog } from "../../modules/content-catalog/catalog.service.js";
import { loadReleaseCatalog } from "../../modules/content-catalog/catalog-db.loader.js";
import { ContentAdminRepository } from "../../modules/content-catalog/content-admin.repository.js";
import { ContentAdminService } from "../../modules/content-catalog/content-admin.service.js";
import { BaseOperationError } from "../../modules/world-runtime/base.service.js";
import { BaseSettlementService } from "../../modules/industry/base-settlement.service.js";
import { ManufacturingService } from "../../modules/industry/manufacturing.service.js";
import { ManufacturingRepository } from "../../modules/industry/manufacturing.repository.js";
import { decisionRecords } from "../../db/schema.js";
import {
  detectAndResolveCooperation,
  applyAcceptedHelpers,
  decideFirstRequest,
  previewPending
} from "../../modules/industry/cooperation.service.js";
import { CooperationRepository } from "../../modules/industry/cooperation.repository.js";
import { DecisionGateway, type DecisionAuditRow } from "../../modules/ai/decision-gateway.js";
import { createEconomyUseCases } from "../economy/usecases.js";
import { OrderRepository } from "../../modules/economy/order.repository.js";
import { PurchaseRepository } from "../../modules/economy/purchase.repository.js";
import { WeatherService } from "../../modules/world-runtime/weather.service.js";
import {
  measureManufacturingDemand,
  settleManufacturing
} from "../../modules/industry/manufacturing.settlement.js";
import {
  ContentAdminUseCases
} from "../content-admin/usecases.js";
import { CancelManufacturingJobCase } from "../manufacturing/cancel-job.js";
import { CreateManufacturingJobCase } from "../manufacturing/create-job.js";
import { BaseOperationError as RouteBaseOperationError, ConstructionService } from "../../modules/industry/construction.service.js";
import { ExtractionRepository, type ExtractionJobRecord } from "../../modules/industry/extraction.repository.js";
import { ExtractionService } from "../../modules/industry/extraction.service.js";
import { ProductionSlotRepository } from "../../modules/industry/production-slot.repository.js";
import { PowerPolicyService, ProductionSlotService } from "../../modules/industry/production-slot.service.js";
import { projectLandingSupplyW } from "../../modules/industry/landing-rules.js";
import { settleLandingBaseMinute } from "../../modules/industry/landing-settlement.js";
import { collectCapabilities, facilityStableIdFromRef } from "../../modules/industry/facility-effects.js";
import { ResourceNodeRepository } from "../../modules/world-runtime/resource-node.repository.js";
import type { IndustryTx } from "../../modules/industry/industry.repository.js";
import { IndustryRepository } from "../../modules/industry/industry.repository.js";
import { RobotFactory } from "../../modules/npc/robot-factory.js";
import { RobotRuntimeService } from "../../modules/npc/robot-runtime.js";
import { InMemoryRateLimitService } from "../../modules/rate-limit/rate-limit.service.js";
import { BaseRepository, scopeTickTransactionToBase } from "../../modules/world-runtime/base.repository.js";
import { BaseEventRepository, type BaseEventTx } from "../../modules/world-runtime/base-event.repository.js";
import { BaseService } from "../../modules/world-runtime/base.service.js";
import { systemWorldClock } from "../../modules/world-runtime/world-clock.js";
import { BaseClockUseCase } from "./base-clock.js";
import { BaseEventsUseCase } from "./base-events.js";
import { BaseSnapshotUseCase } from "./base-snapshot.js";
import { CooperationDecisionCase } from "./cooperation-decision.js";
import { CancelProjectCase } from "./cancel-project.js";
import { CreateProjectCase } from "./create-project.js";
import type {
  BaseAuthFacade,
  BaseProjectsRouteDeps,
  BaseSessionRouteDeps,
  PlaytestRegistrationFacade,
  CatalogResolverPort,
  ContentCatalogPort,
  BaseTx
} from "./ports.js";
import { ProvisionBaseUseCase } from "./provision-base.js";

const PLAYTEST_REGISTER_LIMIT = 5;
const PLAYTEST_REGISTER_WINDOW_MS = 60 * 60 * 1000;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

// M12-I 集成装配：把 world（基地子域）/assets/npc/industry/content-catalog 的
// 真实实现按 ports.ts 冻结端口绑定成路由依赖与 tick 参与者。
// transport 路由只 import 本文件（application），不接触各模块内部。
export function createBaseOperations(input: {
  db: Db;
  config: Env;
  // R1：provision 目录缺省 landing-1；旧 profile 验收测试显式传 legacy 目录（05 §5）。
  provisionCatalog?: CatalogResolverPort["forProvision"] extends () => infer T ? T : never;
}) {
  const { db, config } = input;
  const auth = new AuthService();
  const catalog = createContentCatalog();
  const baseRepo = new BaseRepository(db, systemWorldClock);
  const tutorialCatalog = createContentCatalog(TUTORIAL_BASE_CONTENT_RELEASE);
  // R1：注册默认内容改为 landing-1；旧档按 bases.content_release 继续读旧目录。
  const landingCatalog = createContentCatalog(LANDING_BASE_CONTENT_RELEASE);
  const catalogByTransaction = new WeakMap<object, Map<string, Promise<ContentCatalogPort>>>();
  const catalogResolver: CatalogResolverPort = {
    forProvision: () => input.provisionCatalog ?? landingCatalog,
    forBase: (tx: BaseTx, baseId: string) => {
      const load = async () => {
        const releaseId = await baseRepo.getContentRelease(tx, baseId);
        if (!releaseId) throw new BaseOperationError("BASE_SCOPE_INVALID", "基地不存在。");
        return loadReleaseCatalog(tx, releaseId);
      };
      if (tx === db) return load();
      let cache = catalogByTransaction.get(tx);
      if (!cache) {
        cache = new Map();
        catalogByTransaction.set(tx, cache);
      }
      let resolved = cache.get(baseId);
      if (!resolved) {
        resolved = load();
        cache.set(baseId, resolved);
      }
      return resolved;
    }
  };
  const baseAssets = new BaseAssetService(db);
  const robotRuntime = new RobotRuntimeService(db);
  const industryRepo = new IndustryRepository(db);

  // D013 事件历史：world/base-event 是 base_events 唯一写者；各结算点经本工厂
  // 在自己的事务内追加（与 receipts 的 (tx) => 写口 模式一致）。
  const openBaseEvents = (tx: BaseEventTx) =>
    new BaseEventRepository(tx);

  const baseService = new BaseService({
    db,
    clock: systemWorldClock,
    repo: baseRepo,
    assets: baseAssets,
    robots: new RobotFactory(db),
    industryInit: industryRepo,
    catalog,
    catalogResolver,
    settleConfirmedThrough: async (tx: BaseTx, baseId: string, at: Date) => {
      scopeTickTransactionToBase(tx, baseId);
      while (await settlement.settleBases(tx, at) > 0) {
        // A 单次最多结算十分钟；继续处理已确认的剩余时段。
      }
    },
    industryRead: industryRepo,
    robotRead: robotRuntime,
    facilityCapabilities: (refs, projects) =>
      [...collectCapabilities(new Set(refs.map(facilityStableIdFromRef)),
        projects.flatMap((project) => project.outputFacility ? [{ outputFacility: project.outputFacility }] : []))],
    nodeSeeds: {
      insertResourceNode: (tx, input) => new ResourceNodeRepository(tx).insertNode(tx, input)
    },
    landingRead: {
      listResourceNodes: (tx, baseId) => new ResourceNodeRepository(tx).listForBase(tx, baseId),
      listExtractionJobs: (tx, baseId) =>
        new ExtractionRepository(tx).listForBase(tx, baseId) as Promise<ExtractionJobRecord[]>,
      listProductionSlots: (tx, baseId) => new ProductionSlotRepository(tx).listForBase(tx, baseId)
    },
    powerProjection: (input) => {
      // 与 landing 结算同源：R1 不生成天气日程，WeatherService.current 对无日程基地
      // 恒返回 clear/1.0（settlement 侧同一取值路径），积尘经 power 行传入。
      return projectLandingSupplyW({ ...input, weatherLight: 1.0 });
    },
    manufacturingRead: {
      listJobsForBase: async (baseId: string) =>
        new ManufacturingRepository(db).listJobsForBase(db, baseId)
    },
    weather: {
      current: (baseId: string, simTime: Date) =>
        new WeatherService(db).current(db, baseId, simTime)
    },
    economyRead: {
      getCredits: async (baseId: string) => (await new PurchaseRepository(db).getCredits(db, baseId)) ?? 0,
      listOrdersForBase: async (baseId: string) =>
        new OrderRepository(db).listOrdersForBase(db, baseId),
      listPurchasesForBase: async (baseId: string) =>
        new PurchaseRepository(db).listPurchasesForBase(db, baseId)
    },
    cooperationRead: {
      listByBase: async (baseId: string) => {
        const repo = new CooperationRepository(db);
        const rows = await repo.listByBase(db, baseId);
        return rows.map((row) => ({
          id: row.requestId,
          projectId: row.projectId,
          stepIndex: row.stepIndex,
          fromGroupId: row.fromGroupId,
          helperGroupId: row.helperGroupId,
          status: row.status,
          resolutionReason: row.resolutionReason,
          helperOperatorId: row.helperOperatorId,
          question: row.question,
          createdAt: row.createdAt
        }));
      },
      previewPending: (tx: BaseTx, baseId: string, requestId: string) =>
        previewPending(tx, baseId, requestId, {
          robots: new RobotRuntimeService(tx),
          openCooperation: (readTx) => new CooperationRepository(readTx)
        })
    }
  });

  const baseAssetsService = baseAssets;
  const manufacturing = new ManufacturingService({
    lookup: baseRepo,
    assets: baseAssetsService,
    catalog,
    catalogResolver,
    store: new ManufacturingRepository(db),
    sites: {
      listSites: (tx, baseId) => baseRepo.forTransaction(tx as never).listSites(tx, baseId)
    },
    slots: {
      countSlotsForSite: (tx: Parameters<typeof ProductionSlotRepository.prototype.countSlotsForSite>[0], siteId: string) =>
        new ProductionSlotRepository(tx).countSlotsForSite(tx, siteId),
      listSlotsForSite: (tx: Parameters<typeof ProductionSlotRepository.prototype.listForSite>[0], baseId: string, siteId: string) =>
        new ProductionSlotRepository(tx).listForSite(tx, baseId, siteId)
    },
    boundSites: {
      listBoundSiteJobs: (tx, baseId, siteId) =>
        new ManufacturingRepository(tx).listBoundSiteJobs(tx, baseId, siteId)
    },
    receipts: (tx) => new AssetMutationService(tx)
  });

  const construction = new ConstructionService({
    lookup: baseRepo,
    assets: baseAssets,
    sites: {
      getSite: (tx, baseId, siteId) => baseRepo.forTransaction(tx as never).getSite(tx, baseId, siteId),
      markSiteReserved: (tx, siteId) => baseRepo.forTransaction(tx as never).markSiteReserved(tx, siteId),
      releaseSite: (tx, siteId) => baseRepo.forTransaction(tx as never).releaseSite(tx, siteId),
      listSites: (tx, baseId) => baseRepo.forTransaction(tx as never).listSites(tx, baseId),
      getSiteKey: async (tx, baseId, siteId) =>
        (await baseRepo.forTransaction(tx as never).getSite(tx, baseId, siteId))?.siteKey ?? null
    },
    robots: robotRuntime,
    catalog,
    catalogResolver,
    store: industryRepo,
    countExpansionProjects: (tx, baseId, projectDefIds) =>
      new IndustryRepository(tx).countExpansionProjects(tx, baseId, projectDefIds),
    receipts: (tx) => new AssetMutationService(tx)
  });

  const authFacade: BaseAuthFacade = {
    resolvePrincipal: async (sessionToken) => {
      const account = await new AuthRepository(db).findAccountBySessionTokenHash(
        auth.hashToken(sessionToken)
      );
      return account && account.status === "active" ? { accountId: account.id } : null;
    },
    verifyCsrf: (sessionToken, csrfToken) =>
      auth.verifyCsrfToken(sessionToken, config.SESSION_SECRET, csrfToken)
  };

  const rateLimits = new InMemoryRateLimitService();
  const registration: PlaytestRegistrationFacade = {
    checkRateLimit: async ({ email, ip }) =>
      rateLimits.check({
        key: `playtest-register:${email.toLowerCase()}:${ip}`,
        limit: PLAYTEST_REGISTER_LIMIT,
        windowMs: PLAYTEST_REGISTER_WINDOW_MS
      }),
    createPlaytestAccount: async ({ email, password }) => {
      const passwordHash = await auth.hashPassword(password);
      return db.transaction(async (tx) => {
        const scopedRepo = new AuthRepository(tx);
        // 幂等注册：邮箱已存在且密码正确 → 直接当登录（先注册后丢失会话的场景不再报错）。
        const existing = await scopedRepo.findAccountByEmail(email);
        if (existing) {
          const passwordOk = await auth.verifyPassword(password, existing.passwordHash);
          if (!passwordOk) {
            throw new BaseOperationError(
              "UNAUTHENTICATED",
              "该邮箱已注册，密码不正确；请用原密码登录，或换个邮箱。"
            );
          }
          const existingSession = auth.createSessionToken();
          await scopedRepo.createSession({
            accountId: existing.id,
            tokenHash: existingSession.tokenHash,
            expiresAt: new Date(Date.now() + SESSION_TTL_MS)
          });
          return {
            accountId: existing.id,
            email: existing.email,
            sessionToken: existingSession.token,
            csrfToken: auth.createCsrfToken(existingSession.token, config.SESSION_SECRET)
          };
        }
        const account = await scopedRepo.createAccount({ email, passwordHash });
        await new DrizzleAuditWriter(tx).write({
          actorAccountId: account.id,
          action: "playtest_account.create",
          targetType: "account",
          targetId: account.id,
          reason: "playtest_registration",
          metadata: { accountId: account.id }
        });
        const session = auth.createSessionToken();
        await scopedRepo.createSession({
          accountId: account.id,
          tokenHash: session.tokenHash,
          expiresAt: new Date(Date.now() + SESSION_TTL_MS)
        });
        return {
          accountId: account.id,
          email: account.email,
          sessionToken: session.token,
          csrfToken: auth.createCsrfToken(session.token, config.SESSION_SECRET)
        };
      });
    }
  };

  const session: BaseSessionRouteDeps = {
    auth: authFacade,
    registration,
    provision: new ProvisionBaseUseCase(baseService),
    snapshot: new BaseSnapshotUseCase(baseService),
    clock: new BaseClockUseCase(baseService),
    // D013 事件历史（GET /api/base/events）。
    events: new BaseEventsUseCase({
      db,
      repo: baseRepo,
      events: (tx) => openBaseEvents(tx as never)
    })
  };

  // 开工只受理，不在请求路径结算（2026-09-25 B008 / ARCH-domain-02）：此前开工成功后另开事务跑
  // 全服 settleBases，且不看 duplicate——任何已登录玩家重放同一 commandId 即可给全服加速施工、
  // 反复发起锁住全部 running 基地行的全服事务。结算只由 world tick 按模拟时长推进；
  // 开工后首次进度变化最长约一个 tick（约 60 秒），是预期行为。
  // Directive：不要把请求路径结算加回来；需要“就地反馈”时在前端写明“下次结算时间”。
  const authorizeProfileWrite = async (tx: BaseTx, accountId: string, controlToken?: string | null) => {
    const baseId = await baseRepo.findBaseIdByAccount(tx, accountId);
    if (!baseId || !(await baseRepo.getBaseForUpdate(tx, baseId))) {
      throw new RouteBaseOperationError(403, "BASE_SCOPE_INVALID", "账号没有可操作的基地。");
    }
    if ((await catalogResolver.forBase(tx, baseId)).rulesProfile() === "landing-v1") {
      await requireLandingControl(tx, accountId, controlToken);
    }
  };
  const createCase = new CreateProjectCase(db, construction, authorizeProfileWrite);
  const manufacturingJobs = {
    create: new CreateManufacturingJobCase(db, manufacturing, authorizeProfileWrite),
    cancel: new CancelManufacturingJobCase(db, manufacturing, authorizeProfileWrite)
  };

  const projects: BaseProjectsRouteDeps = {
    auth: authFacade,
    create: createCase,
    cancel: new CancelProjectCase(db, construction, authorizeProfileWrite)
  };

  const cooperationDecision = {
    auth: authFacade,
    decide: new CooperationDecisionCase(db, baseRepo, {
      decide: (tx, baseId, decision) =>
        decideFirstRequest(tx, baseId, decision, {
          robots: new RobotRuntimeService(tx),
          openCooperation: (decisionTx) => new CooperationRepository(decisionTx)
        })
    })
  };

  // 基地结算事务内只运行确定性 RULE；外部模型网络不能占着基地锁等待。
  const recordAuditInCallerTx = async (tx: unknown, row: DecisionAuditRow) => {
    await (tx as Parameters<Parameters<Db["transaction"]>[0]>[0]).insert(decisionRecords).values({
      decisionId: row.decisionId,
      purpose: row.purpose,
      mode: row.mode,
      provider: row.provider,
      baseId: row.baseId,
      planRevision: row.planRevision,
      question: row.question,
      candidates: row.candidates as never,
      selectedCandidateId: row.selectedCandidateId,
      latencyMs: row.latencyMs
    });
  };
  const decisionGateway = new DecisionGateway({ recordAudit: recordAuditInCallerTx });
  const cooperation = {
    listOpenRequests: async (tx: IndustryTx, baseId: string) =>
      (await new CooperationRepository(tx).listByBase(tx, baseId)).flatMap((request) =>
        request.status === "pending" || request.status === "accepted"
          ? [{ status: request.status, operatorId: request.helperOperatorId, projectId: request.projectId, stepIndex: request.stepIndex }]
          : []
      ),
    detectAndResolve: (
      tx: Parameters<typeof detectAndResolveCooperation>[0],
      baseId: string,
      needySteps: Parameters<typeof detectAndResolveCooperation>[2],
      meta: { baseRevision: number; epoch: number; clock: { now(): Date }; deferFirstCreation: boolean }
    ) =>
      detectAndResolveCooperation(tx, baseId, needySteps, {
        robots: new RobotRuntimeService(tx),
        gateway: decisionGateway,
        clock: meta.clock,
        deferFirstCreation: meta.deferFirstCreation,
        baseRevision: meta.baseRevision,
        epoch: meta.epoch,
        openCooperation: (coopTx) => new CooperationRepository(coopTx)
      }),
    applyAcceptedHelpers: (
      tx: Parameters<typeof applyAcceptedHelpers>[0],
      baseId: string,
      runnableSteps: Parameters<typeof applyAcceptedHelpers>[2]
    ) =>
      applyAcceptedHelpers(tx, baseId, runnableSteps, {
        robots: new RobotRuntimeService(tx),
        openCooperation: (coopTx) => new CooperationRepository(coopTx)
      }),
    markFulfilledByStep: async (
      tx: Parameters<typeof applyAcceptedHelpers>[0],
      baseId: string,
      projectId: string,
      stepIndex: number
    ) => {
      await new CooperationRepository(tx).markFulfilledByStep(tx, baseId, projectId, stepIndex);
    }
  };



  // R1 能力位派生：built 站点 × 目录项目模板 effects（采矿要 warehouse、维护要 maintenance）。
  const hasLandingCapability = async (tx: BaseTx, baseId: string, capability: string): Promise<boolean> => {
    const sites = await baseRepo.forTransaction(tx as never).listSites(tx, baseId);
    const baseCatalog = await catalogResolver.forBase(tx, baseId);
    const built = new Set(
      sites
        .filter((site) => site.state === "built" && site.builtFacilityRef)
        .map((site) => facilityStableIdFromRef(site.builtFacilityRef!))
    );
    return collectCapabilities(built, baseCatalog.listTemplates().projects).has(capability);
  };

  // R1：landing 写命令需有效控制租约（03 §4；与 clock 命令同一语义）。
  const requireLandingControl = async (
    tx: BaseTx,
    accountId: string,
    controlToken: string | null | undefined
  ): Promise<void> => {
    const baseId = await baseRepo.findBaseIdByAccount(tx, accountId);
    if (!baseId) {
      throw new RouteBaseOperationError(403, "BASE_SCOPE_INVALID", "账号没有可操作的基地。");
    }
    // 与接管操作使用同一基地锁，防止租约校验后、命令落盘前控制权被替换。
    if (!(await baseRepo.getBaseForUpdate(tx, baseId))) {
      throw new RouteBaseOperationError(403, "BASE_SCOPE_INVALID", "账号没有可操作的基地。");
    }
    const lease = await baseRepo.getControlLease(tx, baseId);
    const now = systemWorldClock.now();
    if (
      !controlToken ||
      !lease ||
      lease.leaseToken !== controlToken ||
      lease.leaseUntil.getTime() <= now.getTime()
    ) {
      // D010：带机器可读原因。本会话令牌匹配但租约过期 = 心跳断档；无令牌/令牌
      // 不匹配（含过期幽灵租约残留）= 控制权在他方，接管基地即可收回。
      const staleHeartbeat =
        !!controlToken && !!lease && lease.leaseToken === controlToken;
      throw new RouteBaseOperationError(
        409,
        "CONTROL_EXPIRED",
        staleHeartbeat
          ? "心跳断档，本标签已失去基地控制权，请重新接管。"
          : "当前标签已失去基地控制权，请接管基地后重试。",
        staleHeartbeat ? "HEARTBEAT_STALE" : "GHOST_LEASE"
      );
    }
  };

  const extractionService = new ExtractionService({
    lookup: baseRepo,
    nodes: new ResourceNodeRepository(db),
    robots: robotRuntime,
    store: new ExtractionRepository(db),
    catalogResolver,
    capabilities: { hasCapability: hasLandingCapability },
    receipts: (tx) => new AssetMutationService(tx)
  });

  const productionSlots = new ProductionSlotService({
    lookup: baseRepo,
    slots: {
      listForSite: (tx, baseId, siteId) =>
        new ProductionSlotRepository(tx).listForSite(tx, baseId, siteId),
      saveSlot: (tx, patch) => new ProductionSlotRepository(tx).saveSlot(tx, patch)
    },
    assets: baseAssets,
    capabilities: { hasCapability: hasLandingCapability },
    catalogResolver,
    receipts: (tx) => new AssetMutationService(tx)
  });

  const economy = createEconomyUseCases(
    db,
    catalog,
    catalogResolver,
    async (tx, baseId) => (await catalogResolver.forBase(tx, baseId)).capabilities(),
    // D013：订单交付结算点同事务写事件。
    (tx) => openBaseEvents(tx as never)
  );
  const economyTick = {
    markExpiredAndRefresh: (tx: IndustryTx, baseId: string, sim: Date) =>
      new OrderRepository(tx)
        .markExpiredOrders(tx, baseId, sim)
        .then(() => economy.orders.ensureOrders(tx, baseId, sim)),
    settlePurchases: (tx: IndustryTx, baseId: string, sim: Date) =>
      economy.purchases.settlePurchases(tx, baseId, sim)
  };

  const contentAdmin = new ContentAdminUseCases(
    db,
    new ContentAdminService((tx) => new ContentAdminRepository(tx))
  );

  const settlement = new BaseSettlementService({
    landing: (tx, baseId, simTime) =>
      settleLandingBaseMinute(tx, { baseId, simTime }, {
        catalogResolver: catalogResolver as unknown as Parameters<typeof settleLandingBaseMinute>[2]["catalogResolver"],
        industry: {
          // 读必须绑定结算事务：多分钟单事务内根 db 连接读不到本事务未提交状态
          // （完工/能量会按陈旧状态重复应用——G09 分片等价曾因此失败）。
          listProjects: (settleTx, settleBaseId) =>
            new IndustryRepository(settleTx).listProjects(settleBaseId),
          listSteps: (settleTx, projectIds) =>
            new IndustryRepository(settleTx).listSteps(projectIds),
          saveStepUpdates: (settleTx, updates) =>
            new IndustryRepository(settleTx).saveStepUpdates(settleTx, updates as never),
          saveProjectUpdates: (settleTx, updates) =>
            new IndustryRepository(settleTx).saveProjectUpdates(settleTx, updates),
          getLandingPower: (settleTx, settleBaseId) =>
            new IndustryRepository(settleTx).getLandingPower(settleBaseId),
          saveLandingPower: (settleTx, settleBaseId, patch) =>
            new IndustryRepository(settleTx).saveLandingPower(settleTx, settleBaseId, patch),
          markSiteBuilt: (settleTx, siteId, facilityRef) =>
            baseRepo.forTransaction(settleTx as never).markSiteBuilt(settleTx, siteId, facilityRef),
          addGenerationWPeak: (settleTx, settleBaseId, deltaW) =>
            new IndustryRepository(settleTx).addGenerationWPeak(settleTx, settleBaseId, deltaW),
          addStorageCapacityWh: (settleTx, settleBaseId, deltaWh) =>
            new IndustryRepository(settleTx).addStorageCapacityWh(settleTx, settleBaseId, deltaWh),
          addChargeLimitW: (settleTx, settleBaseId, deltaW) =>
            new IndustryRepository(settleTx).addChargeLimitW(settleTx, settleBaseId, deltaW),
          insertProductionSlots: (settleTx, settleBaseId, siteId, count) =>
            new ProductionSlotRepository(settleTx).insertSlots(settleTx, settleBaseId, siteId, count)
        },
        slots: {
          listForBase: (settleTx, settleBaseId) =>
            new ProductionSlotRepository(settleTx).listForBase(settleTx, settleBaseId),
          saveSlot: (settleTx, patch) => new ProductionSlotRepository(settleTx).saveSlot(settleTx, patch)
        },
        nodes: new ResourceNodeRepository(db),
        extraction: {
          listSettleable: (settleTx, settleBaseId) =>
            new ExtractionRepository(settleTx).listSettleable(settleTx, settleBaseId),
          saveJob: (settleTx, patch) => new ExtractionRepository(settleTx).saveJob(settleTx, patch),
          insertOutput: (settleTx, input) =>
            new ExtractionRepository(settleTx).insertOutput(settleTx, input),
          markOutputDelivered: (settleTx, jobId, ordinal) =>
            new ExtractionRepository(settleTx).markOutputDelivered(settleTx, jobId, ordinal)
        },
        manufacturing: {
          listLandingJobs: (settleTx, settleBaseId) =>
            new ManufacturingRepository(settleTx).listLandingJobs(settleTx, settleBaseId),
          findLandingOutputByOrdinal: (settleTx, jobId, ordinal) =>
            new ManufacturingRepository(settleTx).findOutputByOrdinal(settleTx, jobId, ordinal),
          saveLandingBinding: (settleTx, patch) =>
            new ManufacturingRepository(settleTx).saveLandingBinding(settleTx, patch),
          saveLandingProgress: (settleTx, patch) =>
            new ManufacturingRepository(settleTx).saveLandingProgress(settleTx, patch),
          insertLandingOutput: (settleTx, input) =>
            new ManufacturingRepository(settleTx).insertLandingOutput(settleTx, input)
        },
        robots: {
          listOperators: (settleTx, settleBaseId) =>
            new RobotRuntimeService(settleTx).listOperators(settleBaseId),
          applyRobotUpdates: (settleTx, updates) =>
            new RobotRuntimeService(settleTx).applyRobotUpdates(settleTx, updates as never)
        },
        assets: baseAssets,
        robotFactory: {
          initializeOperator: (settleTx, input) => new RobotFactory(settleTx).initializeOperator(settleTx, input)
        },
        sites: {
          listSites: (settleTx, settleBaseId) =>
            baseRepo.forTransaction(settleTx as never).listSites(settleTx, settleBaseId)
        },
        weather: {
          current: (settleBaseId, simTime) =>
            new WeatherService(db).current(db, settleBaseId, simTime)
        },
        // D013：landing 结算点（工程完工/采矿送达/制造完工）同事务写事件。
        events: (settleTx) => openBaseEvents(settleTx as never)
      }),
    clock: baseRepo,
    sites: baseRepo,
    assets: baseAssets,
    catalog,
    catalogResolver,
    openIndustry: (tx) => new IndustryRepository(tx),
    openRobots: (tx) => (tx === db ? robotRuntime : new RobotRuntimeService(tx)),
    cooperation,
    economy: economyTick,
    // 制造按基地结算（B001）：baseId 必须由 settleBase 传入，禁止在此遍历全服工单。
    manufacturing: {
      measure: async (tx, baseId) =>
        measureManufacturingDemand(tx, baseId, {
          catalog: await catalogResolver.forBase(tx, baseId),
          openManufacturing: (settleTx) => new ManufacturingRepository(settleTx)
        }),
      settle: async (tx, baseId, simTime, input) =>
        settleManufacturing(tx, simTime, {
          baseId,
          availableEnergyWh: input.availableEnergyWh,
          powerW: input.powerW,
          deltaSimMs: input.deltaSimMs,
          catalog: await catalogResolver.forBase(tx, baseId),
          settleAssets: baseAssets,
          settleRobots: {
            initializeOperator: (settleTx: IndustryTx, input) =>
              new RobotFactory(settleTx).initializeOperator(settleTx, input)
          },
          openManufacturing: (settleTx) => new ManufacturingRepository(settleTx)
        })
    },
    // D013：legacy 工程完工结算点同事务写事件。
    events: (settleTx) => openBaseEvents(settleTx as never)
  });


  // R1：电力策略切换前按旧策略结清本基地已确认时段（03 §4；复用 tick 的结算参与，
  // 只结已确认边界，不在请求路径凭空调用次数产收益——B008 禁的是后者）。
  const powerPolicy = new PowerPolicyService({
    lookup: baseRepo,
    power: {
      savePowerPolicy: (tx, baseId, priority) =>
        new IndustryRepository(tx).savePowerPolicy(tx, baseId, priority)
    },
    catalogResolver,
    receipts: (tx) => new AssetMutationService(tx),
    settleConfirmedThrough: async (tx, baseId, at) => {
      scopeTickTransactionToBase(tx, baseId);
      while (await settlement.settleBases(tx, at) > 0) {
        // 与 heartbeat 同语义：结清已确认时段的剩余部分。
      }
    }
  });

  // 管理员会话门面（M13-B 路由消费；与 admin.routes 默认实现同语义）。
  const adminSession = {
    getCurrentAdmin: async (request: FastifyRequest) => {
      const token = request.cookies[config.SESSION_COOKIE_NAME];
      if (!token) return null;
      const account = await new AuthRepository(db).findAccountBySessionTokenHash(
        auth.hashToken(token)
      );
      if (!account || account.status !== "active") return null;
      if (account.role !== "admin" && account.role !== "super_admin") return null;
      return { accountId: account.id, role: account.role };
    },
    verifyAdminMutation: async (request: FastifyRequest) => {
      const token = request.cookies[config.SESSION_COOKIE_NAME];
      const csrfToken = request.headers["x-ai-mud-csrf"];
      if (!token || typeof csrfToken !== "string") return false;
      return auth.verifyCsrfToken(token, config.SESSION_SECRET, csrfToken);
    }
  };

  return {
    session,
    projects,
    cooperationDecision,
    settlement,
    manufacturingJobs,
    contentAdmin,
    adminSession,
    economy,
    // R1 landing 命令面（transport 路由消费）。
    extraction: {
      survey: {
        execute: (principal: { accountId: string }, input: Parameters<typeof extractionService.survey>[2]) =>
          db.transaction(async (tx) => {
            await requireLandingControl(tx as never, principal.accountId, input.controlToken);
            return extractionService.survey(tx as never, principal, input);
          })
      },
      createMining: {
        execute: (principal: { accountId: string }, input: Parameters<typeof extractionService.createMining>[2]) =>
          db.transaction(async (tx) => {
            await requireLandingControl(tx as never, principal.accountId, input.controlToken);
            return extractionService.createMining(tx as never, principal, input);
          })
      },
      pause: {
        execute: (principal: { accountId: string }, input: Parameters<typeof extractionService.pause>[2]) =>
          db.transaction(async (tx) => {
            await requireLandingControl(tx as never, principal.accountId, input.controlToken);
            return extractionService.pause(tx as never, principal, input);
          })
      },
      resume: {
        execute: (principal: { accountId: string }, input: Parameters<typeof extractionService.resume>[2]) =>
          db.transaction(async (tx) => {
            await requireLandingControl(tx as never, principal.accountId, input.controlToken);
            return extractionService.resume(tx as never, principal, input);
          })
      },
      cancel: {
        execute: (principal: { accountId: string }, input: Parameters<typeof extractionService.cancel>[2]) =>
          db.transaction(async (tx) => {
            await requireLandingControl(tx as never, principal.accountId, input.controlToken);
            return extractionService.cancel(tx as never, principal, input);
          })
      }
    },
    production: {
      maintain: {
        execute: (principal: { accountId: string }, input: Parameters<typeof productionSlots.maintain>[2]) =>
          db.transaction(async (tx) => {
            await requireLandingControl(tx as never, principal.accountId, input.controlToken);
            return productionSlots.maintain(tx as never, principal, input);
          })
      },
      powerPolicy: {
        execute: (principal: { accountId: string }, input: Parameters<typeof powerPolicy.setPolicy>[2]) =>
          db.transaction(async (tx) => {
            await requireLandingControl(tx as never, principal.accountId, input.controlToken);
            return powerPolicy.setPolicy(tx as never, principal, input);
          })
      },
      pauseJob: {
        execute: (principal: { accountId: string }, input: Parameters<typeof manufacturing.pause>[2]) =>
          db.transaction(async (tx) => {
            await requireLandingControl(tx as never, principal.accountId, input.controlToken);
            return manufacturing.pause(tx as never, principal, input);
          })
      },
      resumeJob: {
        execute: (principal: { accountId: string }, input: Parameters<typeof manufacturing.resume>[2]) =>
          db.transaction(async (tx) => {
            await requireLandingControl(tx as never, principal.accountId, input.controlToken);
            return manufacturing.resume(tx as never, principal, input);
          })
      }
    }
  };
}
