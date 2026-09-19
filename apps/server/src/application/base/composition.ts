import type { Env } from "../../config/env.js";
import type { Db } from "../../db/client.js";
import { DrizzleAuditWriter } from "../../modules/audit/audit.repository.js";
import { AuthRepository } from "../../modules/auth/auth.repository.js";
import { AuthService } from "../../modules/auth/auth.service.js";
import { AssetMutationService } from "../../modules/ledger/asset-mutation.service.js";
import { BaseAssetService } from "../../modules/ledger/base-asset.service.js";
import { createContentCatalog } from "../../modules/content-catalog/catalog.service.js";
import { BaseSettlementService } from "../../modules/industry/base-settlement.service.js";
import { ConstructionService } from "../../modules/industry/construction.service.js";
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
    robotRead: robotRuntime
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

  const projects: BaseProjectsRouteDeps = {
    auth: authFacade,
    create: new CreateProjectCase(db, construction),
    cancel: new CancelProjectCase(db, construction)
  };

  const settlement = new BaseSettlementService({
    clock: baseRepo,
    sites: baseRepo,
    assets: baseAssets,
    catalog,
    openIndustry: (tx) => new IndustryRepository(tx),
    openRobots: (tx) => (tx === db ? robotRuntime : new RobotRuntimeService(tx))
  });

  return { session, projects, settlement };
}
