import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { loadEnv, type Env } from "./config/env.js";
import { createDb, type Db, type DbConnection } from "./db/client.js";
import { registerAdminRoutes } from "./modules/admin/admin.routes.js";
import { AdminBootstrapService } from "./modules/auth/admin-bootstrap.service.js";
import { AuthRepository } from "./modules/auth/auth.repository.js";
import { registerAuthRoutes } from "./modules/auth/auth.routes.js";
import { AuthService } from "./modules/auth/auth.service.js";
import { registerGameRoutes } from "./modules/game/game.routes.js";
import {
  createNpcTaskService,
  createRumorService
} from "./modules/game/game.composition.js";
import { GameRepository } from "./modules/game/game.repository.js";
import { AssetMutationService } from "./modules/ledger/asset-mutation.service.js";
import { LedgerRepository } from "./modules/ledger/ledger.repository.js";
import { LedgerService } from "./modules/ledger/ledger.service.js";
import { NpcRepository } from "./modules/npc/npc.repository.js";
import { NpcService } from "./modules/npc/npc.service.js";
import { systemWorldClock } from "./modules/world-runtime/world-clock.js";
import { WorldRuntimeRepository } from "./modules/world-runtime/world-runtime.repository.js";
import { WorldPostTickService } from "./modules/world-runtime/world-post-tick.service.js";
import {
  floorToTick,
  NPC_WORLD_RUNTIME_KEY,
  WorldRuntimeService,
  type WorldRuntimeSettleResult
} from "./modules/world-runtime/world-runtime.service.js";

declare module "fastify" {
  interface FastifyInstance {
    config: Env;
    di: {
      db: Db;
      worldRuntime: {
        settleDue(now?: Date): Promise<WorldRuntimeSettleResult>;
        idle(): Promise<void>;
      };
    };
  }
}

function isAllowedOrigin(origin: string | undefined, allowedOrigins: string[]) {
  if (!origin) return true;
  return allowedOrigins.includes(origin);
}

export function createWorldRuntimeScheduler(input: {
  settleDue(now: Date): Promise<WorldRuntimeSettleResult>;
  runPostTick(now: Date): Promise<void>;
  onPostTickError(error: unknown): void;
}) {
  let settlementInFlight: Promise<WorldRuntimeSettleResult> | null = null;
  let postTickInFlight: Promise<void> | null = null;

  const startPostTick = (now: Date) => {
    if (postTickInFlight) return;
    postTickInFlight = Promise.resolve()
      .then(() => input.runPostTick(now))
      .catch((error: unknown) => {
        try {
          input.onPostTickError(error);
        } catch {
          // Logging failures must not become unhandled background rejections.
        }
      })
      .finally(() => {
        postTickInFlight = null;
      });
  };

  return {
    settleDue: async (now = new Date()): Promise<WorldRuntimeSettleResult> => {
      if (settlementInFlight) return { settledSteps: 0, skipped: true };
      settlementInFlight = Promise.resolve().then(() => input.settleDue(now));
      try {
        const result = await settlementInFlight;
        if (!result.skipped && result.settledSteps > 0) startPostTick(now);
        return result;
      } finally {
        settlementInFlight = null;
      }
    },
    // Shutdown ordering: stop accepting (timer cleared by caller) -> drain the
    // bounded in-flight settlement/post-tick work -> caller closes connections.
    idle: async () => {
      if (settlementInFlight) await settlementInFlight.catch(() => {});
      if (postTickInFlight) await postTickInFlight.catch(() => {});
    }
  };
}

export async function buildApp(input?: { env?: Env; db?: Db }) {
  const app = Fastify({ logger: true });
  const config = input?.env ?? loadEnv();
  let dbConnection: DbConnection | null = null;
  let db: Db;

  if (input?.db) {
    db = input.db;
  } else {
    dbConnection = createDb(config.DATABASE_URL);
    db = dbConnection.db;
  }
  const runSettleDue = async (now = systemWorldClock.now()) => {
    const runtime = new WorldRuntimeService({
      repo: new WorldRuntimeRepository(db),
      clock: systemWorldClock,
      maxStepsPerRun: config.WORLD_TICK_MAX_STEPS,
      participants: [
        async (tx, tickAt) => {
          const npcService = new NpcService(
            new NpcRepository(tx),
            new LedgerService(new LedgerRepository(tx)),
            new AssetMutationService(tx)
          );
          await npcService.settleNpcWorld(tickAt);
        },
        async (tx, tickAt) => {
          await new GameRepository(tx).refreshDueInstanceResources({ now: tickAt });
        }
      ]
    });
    return runtime.settleDue(now);
  };
  const worldRuntime = createWorldRuntimeScheduler({
    settleDue: runSettleDue,
    runPostTick: async (now) => {
      const postTick = new WorldPostTickService({
        tasks: createNpcTaskService(app),
        rumors: createRumorService(app),
        onFailure: (failure) => {
          app.log.error(
            { err: failure.error, phase: failure.phase, npcActorId: failure.npcActorId },
            "world post-tick operation failed"
          );
        }
      });
      await postTick.run(now);
    },
    onPostTickError: (error) => {
      app.log.error({ err: error }, "world post-tick failed");
    }
  });
  let worldTickTimer: NodeJS.Timeout | null = null;

  app.decorate("config", config);
  app.decorate("di", { db, worldRuntime });

  try {
    await new WorldRuntimeRepository(db).ensureRow(
      NPC_WORLD_RUNTIME_KEY,
      floorToTick(systemWorldClock.now())
    );
  } catch (error) {
    app.log.warn({ err: error }, "world runtime row preflight failed; first tick will retry");
  }

  app.setErrorHandler((error, _request, reply) => {
    app.log.error({ err: error }, "request failed");
    return reply.code(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error"
      }
    });
  });

  const adminBootstrap = new AdminBootstrapService({
    repository: new AuthRepository(db),
    auth: new AuthService()
  });
  const bootstrapResult = await adminBootstrap.ensure({
    email: config.ADMIN_BOOTSTRAP_EMAIL,
    password: config.ADMIN_BOOTSTRAP_PASSWORD
  });
  if (bootstrapResult.created) {
    app.log.info({ accountId: bootstrapResult.accountId }, "bootstrap admin account created");
  }

  if (config.WORLD_TICK_ENABLED) {
    worldTickTimer = setInterval(() => {
      void worldRuntime.settleDue().catch((error: unknown) => {
        app.log.error({ err: error }, "world runtime settlement failed");
      });
    }, config.WORLD_TICK_INTERVAL_MS);
  }

  app.addHook("onClose", async () => {
    if (worldTickTimer) clearInterval(worldTickTimer);
    await worldRuntime.idle();
  });

  if (dbConnection) {
    app.addHook("onClose", async () => {
      await dbConnection.close();
    });
  }

  await app.register(cors, {
    credentials: true,
    origin: (origin, callback) => {
      callback(null, isAllowedOrigin(origin, config.WEB_ORIGINS));
    }
  });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(registerAuthRoutes);
  await app.register(registerGameRoutes);
  await app.register(registerAdminRoutes);

  app.get("/health", async () => ({ ok: true, service: "ai-mud-server" }));

  return app;
}
