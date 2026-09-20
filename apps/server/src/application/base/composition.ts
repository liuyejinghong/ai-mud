import type { Env } from "../../config/env.js";
import type { Db } from "../../db/client.js";
import { DrizzleAuditWriter } from "../../modules/audit/audit.repository.js";
import { AuthRepository } from "../../modules/auth/auth.repository.js";
import type { FastifyRequest } from "fastify";
import { AuthService } from "../../modules/auth/auth.service.js";
import { AssetMutationService } from "../../modules/ledger/asset-mutation.service.js";
import { BaseAssetService } from "../../modules/ledger/base-asset.service.js";
import { createContentCatalog } from "../../modules/content-catalog/catalog.service.js";
import { ContentAdminRepository } from "../../modules/content-catalog/content-admin.repository.js";
import { ContentAdminService } from "../../modules/content-catalog/content-admin.service.js";
import { BaseSettlementService } from "../../modules/industry/base-settlement.service.js";
import { ManufacturingService } from "../../modules/industry/manufacturing.service.js";
import { ManufacturingRepository } from "../../modules/industry/manufacturing.repository.js";
import { decisionRecords } from "../../db/schema.js";
import {
  detectAndResolveCooperation,
  applyAcceptedHelpers
} from "../../modules/industry/cooperation.service.js";
import { CooperationRepository } from "../../modules/industry/cooperation.repository.js";
import { DecisionGateway } from "../../modules/ai/decision-gateway.js";
import { TypeSafeShadowDecisionProvider } from "../../modules/ai/typesafe-decision-provider.js";
import { createEconomyUseCases } from "../economy/usecases.js";
import { OrderRepository } from "../../modules/economy/order.repository.js";
import { PurchaseRepository } from "../../modules/economy/purchase.repository.js";
import { WeatherService } from "../../modules/world-runtime/weather.service.js";
import { settleManufacturing } from "../../modules/industry/manufacturing.settlement.js";
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
import { BaseRepository } from "../../modules/world-runtime/base.repository.js";
import { BaseService } from "../../modules/world-runtime/base.service.js";
import { systemWorldClock } from "../../modules/world-runtime/world-clock.js";
import { BaseClockUseCase } from "./base-clock.js";
import { BaseSnapshotUseCase } from "./base-snapshot.js";
import { CancelProjectCase } from "./cancel-project.js";
import { CreateProjectCase } from "./create-project.js";
import type {
  BaseAuthFacade,
  BaseProjectsRouteDeps,
  BaseSessionRouteDeps,
  PlaytestRegistrationFacade
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
          helperOperatorId: row.helperOperatorId,
          question: row.question,
          createdAt: row.createdAt
        }));
      }
    }
  });

  const baseAssetsService = baseAssets;
  const manufacturing = new ManufacturingService({
    lookup: baseRepo,
    assets: baseAssetsService,
    catalog,
    store: new ManufacturingRepository(db),
    receipts: (tx) => new AssetMutationService(tx)
  });

  const construction = new ConstructionService({
    lookup: baseRepo,
    assets: baseAssets,
    sites: baseRepo,
    catalog,
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

  // 开工动员：创建项目提交后立即结算一个模拟步，机器人马上到位出工，
  // 消除"下一分钟才有动静"的空窗（玩家视角：点下建设就看到设备进场）。
  const createCase = new CreateProjectCase(db, construction);
  const manufacturingJobs = {
    create: new CreateManufacturingJobCase(db, manufacturing),
    cancel: new CancelManufacturingJobCase(db, manufacturing)
  };

  const projects: BaseProjectsRouteDeps = {
    auth: authFacade,
    create: {
      execute: async (principal, input) => {
        const result = await createCase.execute(principal, input);
        await db.transaction((tx) => settlement.settleBases(tx, systemWorldClock.now()));
        return result;
      }
    },
    cancel: new CancelProjectCase(db, construction)
  };

  // M14-LIVE seam：TYPE_SAFE_DECISION_MODE=shadow 且配置 key 时启用 Jev 对照
  //（SHADOW：Jev 意见只进审计 reason，不改变 RULE 执行语义）。
  const decisionGateway =
    config.TYPE_SAFE_DECISION_MODE === "shadow" && config.TYPE_SAFE_API_KEY
      ? new DecisionGateway({
          provider: new TypeSafeShadowDecisionProvider({
            apiKey: config.TYPE_SAFE_API_KEY,
            model: config.TYPE_SAFE_MODEL,
            baseUrl: config.TYPE_SAFE_BASE_URL
          }),
          recordAudit: async (row) => {
            await db.insert(decisionRecords).values(row);
          }
        })
      : new DecisionGateway({
          recordAudit: async (row) => {
            await db.insert(decisionRecords).values(row);
          }
        });
  const cooperation = {
    detectAndResolve: (
      tx: Parameters<typeof detectAndResolveCooperation>[0],
      baseId: string,
      runningSteps: Parameters<typeof detectAndResolveCooperation>[2],
      meta: { baseRevision: number; epoch: number; clock: { now(): Date } }
    ) =>
      detectAndResolveCooperation(tx, baseId, runningSteps, {
        robots: new RobotRuntimeService(db),
        gateway: decisionGateway,
        clock: meta.clock,
        baseRevision: meta.baseRevision,
        epoch: meta.epoch,
        openCooperation: (coopTx) => new CooperationRepository(coopTx)
      }),
    applyAcceptedHelpers: (
      tx: Parameters<typeof applyAcceptedHelpers>[0],
      baseId: string,
      clock: { now(): Date }
    ) =>
      applyAcceptedHelpers(tx, baseId, {
        robots: new RobotRuntimeService(db),
        openCooperation: (coopTx) => new CooperationRepository(coopTx)
      }),
    markFulfilledByProject: async (
      tx: Parameters<typeof applyAcceptedHelpers>[0],
      baseId: string,
      projectId: string
    ) => {
      const repo = new CooperationRepository(tx);
      const steps = await repo.listByBase(tx, baseId);
      for (const request of steps) {
        if (request.projectId !== projectId) continue;
        await repo.markFulfilledByStep(tx, baseId, projectId, request.stepIndex);
      }
    }
  };



  const economy = createEconomyUseCases(db, catalog);
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
    openIndustry: (tx) => new IndustryRepository(tx),
    openRobots: (tx) => (tx === db ? robotRuntime : new RobotRuntimeService(tx)),
    cooperation,
    economy: economyTick,
    manufacturing: {
      settle: (tx, now, input) =>
        settleManufacturing(tx, now, {
          availableEnergyWh: input.availableEnergyWh,
          powerW: input.powerW,
          deltaSimMs: input.deltaSimMs,
          catalog,
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
    settlement,
    manufacturingJobs,
    contentAdmin,
    adminSession,
    economy
  };
}
