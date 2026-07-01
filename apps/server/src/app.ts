import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { loadEnv, type Env } from "./config/env.js";
import { createDb, type Db, type DbConnection } from "./db/client.js";
import { registerAdminRoutes } from "./modules/admin/admin.routes.js";
import { registerAuthRoutes } from "./modules/auth/auth.routes.js";
import { registerGameRoutes } from "./modules/game/game.routes.js";
import { NpcRepository } from "./modules/npc/npc.repository.js";
import { NpcService } from "./modules/npc/npc.service.js";
import { WorldRuntimeRepository } from "./modules/world-runtime/world-runtime.repository.js";
import {
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
      };
    };
  }
}

function isAllowedOrigin(origin: string | undefined, allowedOrigins: string[]) {
  if (!origin) return true;
  return allowedOrigins.includes(origin);
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
  let worldRuntimeInFlight: Promise<WorldRuntimeSettleResult> | null = null;
  const runSettleDue = async (now = new Date()) => {
    const repo = new WorldRuntimeRepository(db);
    const runtime = new WorldRuntimeService({
      repo,
      ownerId: `server-${process.pid}`,
      maxStepsPerRun: config.WORLD_TICK_MAX_STEPS,
      settleNpcWorld: async (tickAt) => {
        const npcRepo = new NpcRepository(db);
        const npcService = new NpcService(npcRepo);
        await npcService.settleNpcWorld(tickAt);
      },
      settleTick: async (tickAt, progress) => {
        await db.transaction(async (tx) => {
          const txNpcRepo = new NpcRepository(tx);
          const txNpcService = new NpcService(txNpcRepo);
          const txRuntimeRepo = new WorldRuntimeRepository(tx);
          await txNpcService.settleNpcWorld(tickAt);
          await txRuntimeRepo.saveProgress(progress);
        });
      }
    });
    return runtime.settleDue(now);
  };
  const worldRuntime = {
    settleDue: async (now = new Date()) => {
      if (worldRuntimeInFlight) return { settledSteps: 0, skipped: true };
      worldRuntimeInFlight = runSettleDue(now);
      try {
        return await worldRuntimeInFlight;
      } finally {
        worldRuntimeInFlight = null;
      }
    }
  };
  let worldTickTimer: NodeJS.Timeout | null = null;

  app.decorate("config", config);
  app.decorate("di", { db, worldRuntime });

  if (config.WORLD_TICK_ENABLED) {
    worldTickTimer = setInterval(() => {
      void worldRuntime.settleDue().catch((error: unknown) => {
        app.log.error({ err: error }, "world runtime settlement failed");
      });
    }, config.WORLD_TICK_INTERVAL_MS);
  }

  app.addHook("onClose", async () => {
    if (worldTickTimer) clearInterval(worldTickTimer);
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
