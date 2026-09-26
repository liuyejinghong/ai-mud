import type { Env } from "../../config/env.js";
import type { Db } from "../../db/client.js";
import { TUTORIAL_BASE_CONTENT_RELEASE } from "@ai-mud/content";
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
import { ConstructionService } from "../../modules/industry/construction.service.js";
import type { IndustryTx } from "../../modules/industry/industry.repository.js";
import { IndustryRepository } from "../../modules/industry/industry.repository.js";
import { RobotFactory } from "../../modules/npc/robot-factory.js";
import { RobotRuntimeService } from "../../modules/npc/robot-runtime.js";
import { InMemoryRateLimitService } from "../../modules/rate-limit/rate-limit.service.js";
import { BaseRepository, scopeTickTransactionToBase } from "../../modules/world-runtime/base.repository.js";
import { BaseService } from "../../modules/world-runtime/base.service.js";
import { systemWorldClock } from "../../modules/world-runtime/world-clock.js";
import { BaseClockUseCase } from "./base-clock.js";
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
export function createBaseOperations(input: { db: Db; config: Env }) {
  const { db, config } = input;
  const auth = new AuthService();
  const catalog = createContentCatalog();
  const baseRepo = new BaseRepository(db, systemWorldClock);
  const tutorialCatalog = createContentCatalog(TUTORIAL_BASE_CONTENT_RELEASE);
  const catalogByTransaction = new WeakMap<object, Map<string, Promise<ContentCatalogPort>>>();
  const catalogResolver: CatalogResolverPort = {
    forProvision: () => tutorialCatalog,
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
    receipts: (tx) => new AssetMutationService(tx)
  });

  const construction = new ConstructionService({
    lookup: baseRepo,
    assets: baseAssets,
    sites: baseRepo,
    robots: robotRuntime,
    catalog,
    catalogResolver,
    store: industryRepo,
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
    clock: new BaseClockUseCase(baseService)
  };

  // 开工只受理，不在请求路径结算（2026-09-25 B008 / ARCH-domain-02）：此前开工成功后另开事务跑
  // 全服 settleBases，且不看 duplicate——任何已登录玩家重放同一 commandId 即可给全服加速施工、
  // 反复发起锁住全部 running 基地行的全服事务。结算只由 world tick 按模拟时长推进；
  // 开工后首次进度变化最长约一个 tick（约 60 秒），是预期行为。
  // Directive：不要把请求路径结算加回来；需要“就地反馈”时在前端写明“下次结算时间”。
  const createCase = new CreateProjectCase(db, construction);
  const manufacturingJobs = {
    create: new CreateManufacturingJobCase(db, manufacturing),
    cancel: new CancelManufacturingJobCase(db, manufacturing)
  };

  const projects: BaseProjectsRouteDeps = {
    auth: authFacade,
    create: createCase,
    cancel: new CancelProjectCase(db, construction)
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
      meta: { baseRevision: number; epoch: number; clock: { now(): Date } }
    ) =>
      detectAndResolveCooperation(tx, baseId, needySteps, {
        robots: new RobotRuntimeService(tx),
        gateway: decisionGateway,
        clock: meta.clock,
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



  const economy = createEconomyUseCases(db, catalog, catalogResolver);
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
    economy
  };
}
